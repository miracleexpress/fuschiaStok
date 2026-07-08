const express = require('express');
const pool    = require('../db/pool');

const router = express.Router();

async function getRecentEntries(client) {
  const { rows } = await client.query(
    `SELECT
       re.id,
       re.entry_date,
       p.product_code,
       re.lot_barcode,
       re.product_serial,
       re.entry_meter,
       sh.shelf_code,
       u.username AS created_by,
       re.created_at
     FROM roll_entries re
     JOIN products p ON p.id = re.product_id
     JOIN shelves  sh ON sh.id = re.shelf_id
     JOIN users    u  ON u.id  = re.created_by
     ORDER BY re.created_at DESC
     LIMIT 15`
  );
  return rows;
}

// GET /roll-entry
router.get('/', async (req, res) => {
  try {
    const [shelves, recent] = await Promise.all([
      pool.query("SELECT id, shelf_code FROM shelves WHERE shelf_type='regulation' AND is_active=TRUE ORDER BY shelf_code"),
      getRecentEntries(pool),
    ]);
    res.render('roll-entry', {
      title: 'Rulo Girişi',
      user: req.session,
      shelves: shelves.rows,
      recent,
      success: req.query.success  || null,
      warning: req.query.warning  || null,
      error: null,
      formData: {},
    });
  } catch (err) {
    console.error('Rulo giriş formu:', err);
    res.render('error', { title: 'Hata', message: 'Sayfa yüklenemedi.', user: req.session });
  }
});

// POST /roll-entry
router.post('/', async (req, res) => {
  const {
    entry_date, product_code, lot_barcode, product_serial,
    entry_meter, shelf_id, note,
  } = req.body;

  const shelves = await pool.query(
    "SELECT id, shelf_code FROM shelves WHERE shelf_type='regulation' AND is_active=TRUE ORDER BY shelf_code"
  );

  const renderForm = async (error, warning) => {
    const recent = await getRecentEntries(pool);
    return res.render('roll-entry', {
      title: 'Rulo Girişi',
      user: req.session,
      shelves: shelves.rows,
      recent,
      success: null,
      warning: warning || null,
      error,
      formData: req.body,
    });
  };

  // ── Temel validasyon ──────────────────────────────────────────────────────
  if (!entry_date || !product_code || !entry_meter || !shelf_id) {
    return renderForm('Tüm zorunlu alanları doldurun.');
  }
  const rawLot    = (lot_barcode || '').trim();
  const rawSerial = (product_serial || '').trim();
  if (!rawLot && !rawSerial) {
    return renderForm('Lot / Barkod No veya Ürün ID alanlarından en az biri girilmelidir.');
  }
  const meter = parseFloat(entry_meter);
  if (isNaN(meter) || meter <= 0) {
    return renderForm('Giriş metre 0\'dan büyük olmalıdır.');
  }

  const cleanLot     = rawLot || rawSerial; // stok takibi için kullanılan asıl anahtar
  const cleanSerial  = rawSerial || null;
  const cleanProduct = product_code.trim().toUpperCase();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Ürün bul ─────────────────────────────────────────────────────────
    const productRow = await client.query(
      'SELECT id, product_code FROM products WHERE UPPER(product_code) = $1',
      [cleanProduct]
    );
    if (productRow.rows.length === 0) {
      await client.query('ROLLBACK');
      return renderForm(`"${cleanProduct}" kodlu ürün bulunamadı. Önce Ürünler sayfasından ekleyin.`);
    }
    const productId = productRow.rows[0].id;

    // ── Lot çakışma kontrolü: başka ürünle eşleşiyor mu? ─────────────────
    const conflict = await client.query(
      `SELECT DISTINCT p.product_code
       FROM roll_entries re
       JOIN products p ON p.id = re.product_id
       WHERE re.lot_barcode = $1 AND p.id != $2
       LIMIT 1`,
      [cleanLot, productId]
    );
    if (conflict.rows.length > 0) {
      await client.query('ROLLBACK');
      return renderForm(
        `Bu lot/barkod (${cleanLot}) daha önce "${conflict.rows[0].product_code}" ürünü için kayıtlıdır. Aynı lot farklı ürüne atanamaz.`
      );
    }

    // ── Aynı lot + aynı ürün uyarısı (engelleme değil) ───────────────────
    const dup = await client.query(
      'SELECT COUNT(*) AS cnt FROM roll_entries WHERE lot_barcode=$1 AND product_id=$2',
      [cleanLot, productId]
    );
    const isDuplicate = parseInt(dup.rows[0].cnt, 10) > 0;

    // ── Kayıt ─────────────────────────────────────────────────────────────
    const rollRes = await client.query(
      `INSERT INTO roll_entries
         (entry_date, product_id, lot_barcode, product_serial, entry_meter, shelf_id, supplier, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'Jalpersan',$7,$8)
       RETURNING id`,
      [entry_date, productId, cleanLot, cleanSerial, meter, shelf_id, note || null, req.session.userId]
    );
    const rollId = rollRes.rows[0].id;

    await client.query(
      `INSERT INTO stock_movements
         (movement_date, movement_type, product_id, lot_barcode,
          target_shelf_id, meter, ref_table, ref_id, note, created_by)
       VALUES ($1,'roll_in',$2,$3,$4,$5,'roll_entries',$6,$7,$8)`,
      [entry_date, productId, cleanLot, shelf_id, meter, rollId, note || null, req.session.userId]
    );

    await client.query(
      `INSERT INTO audit_logs (user_id, action, table_name, record_id, new_data)
       VALUES ($1,'INSERT','roll_entries',$2,$3)`,
      [req.session.userId, rollId, JSON.stringify({ product_code: cleanProduct, lot_barcode: cleanLot, product_serial: cleanSerial, meter, shelf_id })]
    );

    await client.query('COMMIT');

    let qs = 'success=1';
    if (isDuplicate) qs += '&warning=duplicate_lot';
    res.redirect('/roll-entry?' + qs);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Rulo giriş kayıt hatası:', err);
    return renderForm('Kayıt sırasında hata oluştu: ' + err.message);
  } finally {
    client.release();
  }
});

module.exports = router;
