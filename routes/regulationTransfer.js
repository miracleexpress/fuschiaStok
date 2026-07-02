const express = require('express');
const pool    = require('../db/pool');
const { getRemainingMeterTx } = require('../utils/calculations');

const router = express.Router();

async function getRecentTransfers(client) {
  const { rows } = await client.query(
    `SELECT
       rt.id, rt.transfer_date, p.product_code, rt.lot_barcode,
       src.shelf_code AS source_shelf, tgt.shelf_code AS target_shelf,
       rt.meter, u.username AS created_by, rt.created_at
     FROM regulation_transfers rt
     JOIN products p   ON p.id   = rt.product_id
     JOIN shelves  src ON src.id = rt.source_shelf_id
     JOIN shelves  tgt ON tgt.id = rt.target_shelf_id
     JOIN users    u   ON u.id   = rt.created_by
     ORDER BY rt.created_at DESC
     LIMIT 15`
  );
  return rows;
}

// GET /regulation-transfer
router.get('/', async (req, res) => {
  try {
    const [targetShelves, recent] = await Promise.all([
      pool.query("SELECT id, shelf_code FROM shelves WHERE shelf_type='main' AND is_active=TRUE ORDER BY shelf_code"),
      getRecentTransfers(pool),
    ]);
    res.render('regulation-transfer', {
      title: 'Merkez Depoya Aktar',
      user: req.session,
      targetShelves: targetShelves.rows,
      recent,
      success: req.query.success || null,
      error: null,
      formData: {},
    });
  } catch (err) {
    console.error('Transfer formu yüklenemedi:', err);
    res.render('error', { title: 'Hata', message: 'Sayfa yüklenemedi.', user: req.session });
  }
});

// POST /regulation-transfer
router.post('/', async (req, res) => {
  const {
    transfer_date, product_code, lot_barcode,
    source_shelf_id, target_shelf_id, meter, note,
  } = req.body;

  const loadForm = async (error) => {
    const [targetShelves, recent] = await Promise.all([
      pool.query("SELECT id, shelf_code FROM shelves WHERE shelf_type='main' AND is_active=TRUE ORDER BY shelf_code"),
      getRecentTransfers(pool),
    ]);
    return res.render('regulation-transfer', {
      title: 'Merkez Depoya Aktar',
      user: req.session,
      targetShelves: targetShelves.rows,
      recent,
      success: null,
      error,
      formData: req.body,
    });
  };

  if (!transfer_date || !product_code || !lot_barcode || !source_shelf_id || !target_shelf_id || !meter) {
    return loadForm('Tüm zorunlu alanları doldurun.');
  }
  const transferMeter = parseFloat(meter);
  if (isNaN(transferMeter) || transferMeter <= 0) {
    return loadForm('Aktarılacak metre 0\'dan büyük olmalıdır.');
  }

  const cleanLot  = lot_barcode.trim();
  const cleanCode = product_code.trim().toUpperCase();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const prodRes = await client.query(
      'SELECT id FROM products WHERE UPPER(product_code) = $1',
      [cleanCode]
    );
    if (prodRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return loadForm(`"${cleanCode}" ürün kodu bulunamadı.`);
    }
    const productId = prodRes.rows[0].id;

    const srcShelfRes = await client.query('SELECT shelf_type FROM shelves WHERE id = $1', [source_shelf_id]);
    if (srcShelfRes.rows[0]?.shelf_type !== 'regulation') {
      await client.query('ROLLBACK');
      return loadForm('Kaynak raf bir Regüle Depo rafı olmalıdır.');
    }
    const tgtShelfRes = await client.query('SELECT shelf_type FROM shelves WHERE id = $1', [target_shelf_id]);
    if (tgtShelfRes.rows[0]?.shelf_type !== 'main') {
      await client.query('ROLLBACK');
      return loadForm('Hedef raf bir Merkez Depo rafı olmalıdır.');
    }

    await client.query('SELECT pg_advisory_xact_lock($1)', [productId]);

    const remaining = await getRemainingMeterTx(client, productId, cleanLot, source_shelf_id);
    if (remaining < transferMeter) {
      await client.query('ROLLBACK');
      return loadForm(`Yetersiz stok! Regüle depoda kalan: ${remaining.toFixed(2)} m — Aktarılmak istenen: ${transferMeter.toFixed(2)} m.`);
    }

    const transferRes = await client.query(
      `INSERT INTO regulation_transfers
         (transfer_date, product_id, lot_barcode, source_shelf_id, target_shelf_id, meter, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      [transfer_date, productId, cleanLot, source_shelf_id, target_shelf_id, transferMeter, note || null, req.session.userId]
    );
    const transferId = transferRes.rows[0].id;

    await client.query(
      `INSERT INTO stock_movements
         (movement_date, movement_type, product_id, lot_barcode,
          source_shelf_id, meter, ref_table, ref_id, note, created_by)
       VALUES ($1,'regulation_out',$2,$3,$4,$5,'regulation_transfers',$6,$7,$8)`,
      [transfer_date, productId, cleanLot, source_shelf_id, -transferMeter, transferId, note || null, req.session.userId]
    );

    await client.query(
      `INSERT INTO stock_movements
         (movement_date, movement_type, product_id, lot_barcode,
          target_shelf_id, meter, ref_table, ref_id, note, created_by)
       VALUES ($1,'central_in',$2,$3,$4,$5,'regulation_transfers',$6,$7,$8)`,
      [transfer_date, productId, cleanLot, target_shelf_id, transferMeter, transferId, note || null, req.session.userId]
    );

    await client.query(
      `INSERT INTO audit_logs (user_id, action, table_name, record_id, new_data)
       VALUES ($1,'INSERT','regulation_transfers',$2,$3)`,
      [req.session.userId, transferId, JSON.stringify({ product_code: cleanCode, lot_barcode: cleanLot, meter: transferMeter, source_shelf_id, target_shelf_id })]
    );

    await client.query('COMMIT');
    res.redirect('/regulation-transfer?success=1');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Transfer kayıt hatası:', err);
    return loadForm('Kayıt sırasında beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.');
  } finally {
    client.release();
  }
});

module.exports = router;
