const express = require('express');
const pool    = require('../db/pool');
const {
  calcTotalMeter,
  getRemainingMeterTx,
  getLotsByProductCode,
} = require('../utils/calculations');

const router = express.Router();

async function getRecentCuttings(client) {
  const { rows } = await client.query(
    `SELECT
       ce.id, ce.entry_date, p.product_code, ce.lot_barcode,
       sh.shelf_code AS source_shelf, ce.cut_cm, ce.quantity,
       ce.output_type, ce.total_meter, u.username AS created_by,
       ce.created_at
     FROM cutting_entries ce
     JOIN products p  ON p.id  = ce.product_id
     JOIN shelves  sh ON sh.id = ce.source_shelf_id
     JOIN users    u  ON u.id  = ce.created_by
     ORDER BY ce.created_at DESC
     LIMIT 15`
  );
  return rows;
}

// GET /cutting-entry
router.get('/', async (req, res) => {
  try {
    const [products, evalShelves, recent] = await Promise.all([
      pool.query("SELECT id, product_code, name FROM products WHERE is_active=TRUE ORDER BY product_code"),
      pool.query("SELECT id, shelf_code FROM shelves WHERE shelf_type='evaluation' AND is_active=TRUE ORDER BY shelf_code"),
      getRecentCuttings(pool),
    ]);
    res.render('cutting-entry', {
      title: 'Kesim / Sarf Girişi',
      user: req.session,
      products: products.rows,
      evalShelves: evalShelves.rows,
      recent,
      success: req.query.success || null,
      error: null,
      formData: {},
    });
  } catch (err) {
    console.error('Kesim formu yüklenemedi:', err);
    res.render('error', { title: 'Hata', message: 'Sayfa yüklenemedi.', user: req.session });
  }
});

// POST /cutting-entry
router.post('/', async (req, res) => {
  const {
    entry_date, product_code, lot_barcode, source_shelf_id,
    cut_cm, quantity, output_type, target_shelf_id, note,
  } = req.body;

  const loadForm = async (error) => {
    const [products, evalShelves, recent] = await Promise.all([
      pool.query("SELECT id, product_code, name FROM products WHERE is_active=TRUE ORDER BY product_code"),
      pool.query("SELECT id, shelf_code FROM shelves WHERE shelf_type='evaluation' AND is_active=TRUE ORDER BY shelf_code"),
      getRecentCuttings(pool),
    ]);
    return res.render('cutting-entry', {
      title: 'Kesim / Sarf Girişi',
      user: req.session,
      products: products.rows,
      evalShelves: evalShelves.rows,
      recent,
      success: null,
      error,
      formData: req.body,
    });
  };

  // ── Validasyon ──────────────────────────────────────────────────────────────
  if (!entry_date || !product_code || !lot_barcode || !source_shelf_id || !cut_cm || !quantity || !output_type) {
    return loadForm('Tüm zorunlu alanları doldurun.');
  }
  const cm  = parseFloat(cut_cm);
  const qty = parseInt(quantity, 10);
  if (isNaN(cm)  || cm  <= 0) return loadForm('Kesim cm 0\'dan büyük olmalıdır.');
  if (isNaN(qty) || qty <= 0) return loadForm('Adet 0\'dan büyük olmalıdır.');
  if (!['sales','fire','evaluation'].includes(output_type)) return loadForm('Geçersiz çıkış tipi.');
  if (output_type === 'evaluation' && !target_shelf_id) {
    return loadForm('Değerlendirme için hedef raf seçilmelidir.');
  }

  const totalMeter = calcTotalMeter(cm, qty);
  const rawLot     = lot_barcode.trim();
  const cleanLot   = rawLot.includes('||') ? rawLot.split('||')[0].trim() : rawLot;
  const cleanCode  = product_code.trim().toUpperCase();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Ürün bul ────────────────────────────────────────────────────────────
    const prodRes = await client.query(
      'SELECT id FROM products WHERE UPPER(product_code) = $1',
      [cleanCode]
    );
    if (prodRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return loadForm(`"${cleanCode}" ürün kodu bulunamadı. Önce rulo girişi yapın.`);
    }
    const productId = prodRes.rows[0].id;

    // ── Kaynak rafın tipini öğren ──────────────────────────────────────────
    const srcShelfRes = await client.query(
      'SELECT shelf_type FROM shelves WHERE id = $1',
      [source_shelf_id]
    );
    const srcShelfType = srcShelfRes.rows[0]?.shelf_type;

    // ── Aynı ürün için serialization kilidi ────────────────────────────────
    await client.query('SELECT pg_advisory_xact_lock($1)', [productId]);

    // ── Stok kontrolü (transaction içinde) ─────────────────────────────────
    const remaining = await getRemainingMeterTx(client, productId, cleanLot, source_shelf_id);
    if (remaining < totalMeter) {
      await client.query('ROLLBACK');
      return loadForm(
        `Yetersiz stok! Kalan: ${remaining.toFixed(2)} m — Çıkacak: ${totalMeter.toFixed(2)} m.`
      );
    }

    // ── Hedef raf belirle ───────────────────────────────────────────────────
    let resolvedTargetId = null;
    if (output_type === 'sales') {
      const r = await client.query("SELECT id FROM shelves WHERE shelf_code='SATIŞ'");
      resolvedTargetId = r.rows[0]?.id || null;
    } else if (output_type === 'fire') {
      const r = await client.query("SELECT id FROM shelves WHERE shelf_code='FİRE'");
      resolvedTargetId = r.rows[0]?.id || null;
    } else {
      resolvedTargetId = parseInt(target_shelf_id, 10) || null;
    }

    const movType = output_type === 'sales' ? 'sales_out'
      : output_type === 'fire' ? 'fire_out' : 'evaluation_out';

    // ── cutting_entries ─────────────────────────────────────────────────────
    const cutRes = await client.query(
      `INSERT INTO cutting_entries
         (entry_date, product_id, lot_barcode, source_shelf_id,
          cut_cm, quantity, output_type, target_shelf_id, total_meter, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [entry_date, productId, cleanLot, source_shelf_id,
       cm, qty, output_type, resolvedTargetId, totalMeter, note || null, req.session.userId]
    );
    const cutId = cutRes.rows[0].id;

    // ── stock_movements: çıkış (negatif) ───────────────────────────────────
    await client.query(
      `INSERT INTO stock_movements
         (movement_date, movement_type, product_id, lot_barcode,
          source_shelf_id, target_shelf_id, cut_cm, quantity, meter,
          ref_table, ref_id, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'cutting_entries',$10,$11,$12)`,
      [entry_date, movType, productId, cleanLot,
       source_shelf_id, resolvedTargetId, cm, qty, -totalMeter,
       cutId, note || null, req.session.userId]
    );

    if (output_type === 'evaluation') {
      // ── stock_movements: değerlendirme rafına giriş (pozitif) ─────────────
      // Bu kayıt sayesinde eval raf stoğu getLotsByProductCode'da görünür.
      await client.query(
        `INSERT INTO stock_movements
           (movement_date, movement_type, product_id, lot_barcode,
            source_shelf_id, target_shelf_id, cut_cm, quantity, meter,
            ref_table, ref_id, note, created_by)
         VALUES ($1,'evaluation_in',$2,$3,$4,$5,$6,$7,$8,'cutting_entries',$9,$10,$11)`,
        [entry_date, productId, cleanLot,
         source_shelf_id, resolvedTargetId, cm, qty, totalMeter,
         cutId, note || null, req.session.userId]
      );

      // ── evaluation_pieces kaydı ───────────────────────────────────────────
      await client.query(
        `INSERT INTO evaluation_pieces
           (entry_date, product_id, lot_barcode, source_shelf_id,
            evaluation_shelf_id, cut_cm, quantity, total_meter, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [entry_date, productId, cleanLot, source_shelf_id,
         resolvedTargetId, cm, qty, totalMeter, note || null, req.session.userId]
      );
    }

    // ── Değerlendirme rafından satış/fire ise eval_piece'i kapat ───────────
    if (srcShelfType === 'evaluation' && output_type !== 'evaluation') {
      await client.query(
        `UPDATE evaluation_pieces SET status = 'used'
         WHERE id = (
           SELECT id FROM evaluation_pieces
           WHERE product_id = $1 AND lot_barcode = $2
             AND evaluation_shelf_id = $3 AND status = 'available'
           ORDER BY created_at ASC
           LIMIT 1
         )`,
        [productId, cleanLot, source_shelf_id]
      );
    }

    await client.query(
      `INSERT INTO audit_logs (user_id, action, table_name, record_id, new_data)
       VALUES ($1,'INSERT','cutting_entries',$2,$3)`,
      [req.session.userId, cutId,
       JSON.stringify({ product_code: cleanCode, lot_barcode: cleanLot, cm, qty, totalMeter, output_type })]
    );

    await client.query('COMMIT');
    res.redirect('/cutting-entry?success=1');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Kesim kayıt hatası:', err);
    return loadForm('Kayıt sırasında beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.');
  } finally {
    client.release();
  }
});

module.exports = router;
