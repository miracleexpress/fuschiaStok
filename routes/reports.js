const express = require('express');
const pool    = require('../db/pool');

const router = express.Router();

// ── Kullanıcı listesi (filtre için) ──────────────────────────────────────
async function getUserList() {
  const { rows } = await pool.query(
    'SELECT id, username FROM users ORDER BY username'
  );
  return rows;
}

// ── Rulo Stok ─────────────────────────────────────────────────────────────
router.get('/roll-stock', async (req, res) => {
  try {
    const { product_code, lot_barcode, shelf_code, sort } = req.query;

    let sql = `
      SELECT
        p.product_code,
        p.name AS product_name,
        sm.lot_barcode,
        sh.shelf_code,
        sh.id AS shelf_id,
        sh.shelf_type,
        SUM(CASE WHEN sm.meter > 0 THEN sm.meter ELSE 0 END)::NUMERIC(12,2)      AS total_in_meter,
        SUM(CASE WHEN sm.meter < 0 THEN ABS(sm.meter) ELSE 0 END)::NUMERIC(12,2) AS total_out_meter,
        SUM(sm.meter)::NUMERIC(12,2)                                               AS remaining_meter
      FROM stock_movements sm
      JOIN products p ON p.id = sm.product_id
      JOIN shelves  sh ON sh.id = CASE
        WHEN sm.movement_type IN ('roll_in','evaluation_in','central_in') THEN sm.target_shelf_id
        ELSE sm.source_shelf_id
      END
      WHERE sh.shelf_type IN ('regulation', 'main', 'evaluation')
    `;
    const params = [];

    if (product_code) {
      params.push('%' + product_code.trim() + '%');
      sql += ` AND p.product_code ILIKE $${params.length}`;
    }
    if (lot_barcode) {
      params.push('%' + lot_barcode.trim() + '%');
      sql += ` AND sm.lot_barcode ILIKE $${params.length}`;
    }
    if (shelf_code) {
      params.push('%' + shelf_code.trim() + '%');
      sql += ` AND sh.shelf_code ILIKE $${params.length}`;
    }

    sql += `
      GROUP BY p.product_code, p.name, sm.lot_barcode, sh.shelf_code, sh.id, sh.shelf_type
      HAVING SUM(sm.meter) > 0
    `;

    const sortMap = {
      remaining_desc: 'remaining_meter DESC',
      remaining_asc:  'remaining_meter ASC',
      product_code:   'p.product_code, sm.lot_barcode',
    };
    sql += ' ORDER BY ' + (sortMap[sort] || 'p.product_code, sm.lot_barcode, sh.shelf_code');

    const result = await pool.query(sql, params);
    res.render('roll-stock', {
      title: 'Stok',
      user: req.session,
      regulationRows: result.rows.filter(r => r.shelf_type === 'regulation'),
      mainRows:       result.rows.filter(r => r.shelf_type === 'main'),
      evalRows:       result.rows.filter(r => r.shelf_type === 'evaluation'),
      filter: req.query,
    });
  } catch (err) {
    console.error('Rulo stok raporu:', err);
    res.render('error', { title: 'Hata', message: 'Rapor yüklenemedi.', user: req.session });
  }
});

// ── Değerlendirme Stok ────────────────────────────────────────────────────
router.get('/eval-stock', async (req, res) => {
  try {
    const { status, product_code, shelf_code } = req.query;
    const params = [];
    let sql = 'SELECT * FROM v_eval_stock WHERE 1=1';

    if (status && ['available','used','cancelled'].includes(status)) {
      params.push(status);
      sql += ` AND status = $${params.length}`;
    }
    if (product_code) {
      params.push('%' + product_code.trim() + '%');
      sql += ` AND product_code ILIKE $${params.length}`;
    }
    if (shelf_code) {
      params.push('%' + shelf_code.trim() + '%');
      sql += ` AND evaluation_shelf ILIKE $${params.length}`;
    }

    const result = await pool.query(sql, params);
    res.render('eval-stock', {
      title: 'Değerlendirme Stok',
      user: req.session,
      rows: result.rows,
      filter: req.query,
    });
  } catch (err) {
    console.error('Değerlendirme stok:', err);
    res.render('error', { title: 'Hata', message: 'Rapor yüklenemedi.', user: req.session });
  }
});

// ── Fire Raporu ───────────────────────────────────────────────────────────
router.get('/fire', async (req, res) => {
  try {
    const { date_from, date_to, product_code, lot_barcode, username } = req.query;
    const params = [];
    let sql = 'SELECT * FROM v_fire_report WHERE 1=1';

    if (date_from) { params.push(date_from); sql += ` AND entry_date >= $${params.length}`; }
    if (date_to)   { params.push(date_to);   sql += ` AND entry_date <= $${params.length}`; }
    if (product_code) {
      params.push('%' + product_code.trim() + '%');
      sql += ` AND product_code ILIKE $${params.length}`;
    }
    if (lot_barcode) {
      params.push('%' + lot_barcode.trim() + '%');
      sql += ` AND lot_barcode ILIKE $${params.length}`;
    }
    if (username) {
      params.push(username.trim());
      sql += ` AND created_by = $${params.length}`;
    }

    // Toplam (aynı filtreler)
    let totalSql = `
      SELECT SUM(ce.quantity) AS total_qty, SUM(ce.total_meter) AS total_meter
      FROM cutting_entries ce
      JOIN products p ON p.id = ce.product_id
      JOIN users    u ON u.id = ce.created_by
      WHERE ce.output_type = 'fire'
    `;
    const totalParams = [];
    if (date_from)    { totalParams.push(date_from); totalSql += ` AND ce.entry_date >= $${totalParams.length}`; }
    if (date_to)      { totalParams.push(date_to);   totalSql += ` AND ce.entry_date <= $${totalParams.length}`; }
    if (product_code) { totalParams.push('%' + product_code.trim() + '%'); totalSql += ` AND p.product_code ILIKE $${totalParams.length}`; }
    if (lot_barcode)  { totalParams.push('%' + lot_barcode.trim() + '%'); totalSql += ` AND ce.lot_barcode ILIKE $${totalParams.length}`; }
    if (username)     { totalParams.push(username.trim()); totalSql += ` AND u.username = $${totalParams.length}`; }

    const [result, totals, overall, users] = await Promise.all([
      pool.query(sql, params),
      pool.query(totalSql, totalParams),
      pool.query('SELECT total_in_meter, total_fire_meter FROM v_dashboard_summary'),
      getUserList(),
    ]);

    const totalInMeter  = parseFloat(overall.rows[0]?.total_in_meter  || 0);
    const totalFireMeter = parseFloat(overall.rows[0]?.total_fire_meter || 0);
    const fireRatio = totalInMeter > 0 ? (totalFireMeter / totalInMeter) * 100 : 0;

    res.render('fire-report', {
      title: 'Fire Raporu',
      user: req.session,
      rows: result.rows,
      totals: totals.rows[0],
      fireRatio,
      filter: req.query,
      users,
    });
  } catch (err) {
    console.error('Fire raporu:', err);
    res.render('error', { title: 'Hata', message: 'Rapor yüklenemedi.', user: req.session });
  }
});

// ── Satış Raporu ──────────────────────────────────────────────────────────
router.get('/sales', async (req, res) => {
  try {
    const { date_from, date_to, product_code, lot_barcode, username } = req.query;
    const params = [];
    let sql = 'SELECT * FROM v_sales_report WHERE 1=1';

    if (date_from) { params.push(date_from); sql += ` AND entry_date >= $${params.length}`; }
    if (date_to)   { params.push(date_to);   sql += ` AND entry_date <= $${params.length}`; }
    if (product_code) { params.push('%' + product_code.trim() + '%'); sql += ` AND product_code ILIKE $${params.length}`; }
    if (lot_barcode)  { params.push('%' + lot_barcode.trim() + '%'); sql += ` AND lot_barcode ILIKE $${params.length}`; }
    if (username)     { params.push(username.trim()); sql += ` AND created_by = $${params.length}`; }

    let totalSql = `
      SELECT SUM(ce.quantity) AS total_qty, SUM(ce.total_meter) AS total_meter
      FROM cutting_entries ce
      JOIN products p ON p.id = ce.product_id
      JOIN users    u ON u.id = ce.created_by
      WHERE ce.output_type = 'sales'
    `;
    const totalParams = [];
    if (date_from)    { totalParams.push(date_from); totalSql += ` AND ce.entry_date >= $${totalParams.length}`; }
    if (date_to)      { totalParams.push(date_to);   totalSql += ` AND ce.entry_date <= $${totalParams.length}`; }
    if (product_code) { totalParams.push('%' + product_code.trim() + '%'); totalSql += ` AND p.product_code ILIKE $${totalParams.length}`; }
    if (lot_barcode)  { totalParams.push('%' + lot_barcode.trim() + '%'); totalSql += ` AND ce.lot_barcode ILIKE $${totalParams.length}`; }
    if (username)     { totalParams.push(username.trim()); totalSql += ` AND u.username = $${totalParams.length}`; }

    const [result, totals, users] = await Promise.all([
      pool.query(sql, params),
      pool.query(totalSql, totalParams),
      getUserList(),
    ]);

    res.render('sales-report', {
      title: 'Satış Raporu',
      user: req.session,
      rows: result.rows,
      totals: totals.rows[0],
      filter: req.query,
      users,
    });
  } catch (err) {
    console.error('Satış raporu:', err);
    res.render('error', { title: 'Hata', message: 'Rapor yüklenemedi.', user: req.session });
  }
});

// ── Tüm Hareketler ────────────────────────────────────────────────────────
router.get('/movements', async (req, res) => {
  try {
    const { date_from, date_to, movement_type, product_code, lot_barcode, username } = req.query;
    const params = [];
    let sql = `
      SELECT
        sm.id, sm.movement_date, sm.movement_type,
        p.product_code, sm.lot_barcode,
        src.shelf_code AS source_shelf,
        tgt.shelf_code AS target_shelf,
        sm.cut_cm, sm.quantity, sm.meter,
        sm.note, u.username AS created_by, sm.created_at
      FROM stock_movements sm
      JOIN products p ON p.id = sm.product_id
      LEFT JOIN shelves src ON src.id = sm.source_shelf_id
      LEFT JOIN shelves tgt ON tgt.id = sm.target_shelf_id
      JOIN users u ON u.id = sm.created_by
      WHERE 1=1
    `;

    if (date_from) { params.push(date_from); sql += ` AND sm.movement_date >= $${params.length}`; }
    if (date_to)   { params.push(date_to);   sql += ` AND sm.movement_date <= $${params.length}`; }
    if (movement_type && ['roll_in','sales_out','fire_out','evaluation_out','evaluation_in','regulation_out','central_in'].includes(movement_type)) {
      params.push(movement_type); sql += ` AND sm.movement_type = $${params.length}`;
    }
    if (product_code) { params.push('%' + product_code.trim() + '%'); sql += ` AND p.product_code ILIKE $${params.length}`; }
    if (lot_barcode)  { params.push('%' + lot_barcode.trim() + '%'); sql += ` AND sm.lot_barcode ILIKE $${params.length}`; }
    if (username)     { params.push(username.trim()); sql += ` AND u.username = $${params.length}`; }

    sql += ' ORDER BY sm.movement_date DESC, sm.created_at DESC LIMIT 200';

    const [result, users] = await Promise.all([
      pool.query(sql, params),
      getUserList(),
    ]);

    res.render('movements', {
      title: 'Stok Hareketleri',
      user: req.session,
      rows: result.rows,
      filter: req.query,
      users,
    });
  } catch (err) {
    console.error('Hareketler raporu:', err);
    res.render('error', { title: 'Hata', message: 'Rapor yüklenemedi.', user: req.session });
  }
});

module.exports = router;
