const express = require('express');
const pool    = require('../db/pool');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const [
      generalStats,
      todayStats,
      activeLots,
      evalPieces,
      recentMovements,
      shelfStock,
      topFire,
    ] = await Promise.all([
      // Genel toplamlar
      pool.query('SELECT * FROM v_dashboard_summary'),

      // Bugünkü hareketler özeti
      pool.query(`
        SELECT
          COALESCE(SUM(CASE WHEN movement_type='sales_out'      THEN ABS(meter) END), 0)::NUMERIC(12,2) AS today_sales,
          COALESCE(SUM(CASE WHEN movement_type='fire_out'       THEN ABS(meter) END), 0)::NUMERIC(12,2) AS today_fire,
          COALESCE(SUM(CASE WHEN movement_type='evaluation_out' THEN ABS(meter) END), 0)::NUMERIC(12,2) AS today_eval,
          COALESCE(SUM(CASE WHEN movement_type='roll_in'        THEN meter      END), 0)::NUMERIC(12,2) AS today_in
        FROM stock_movements
        WHERE movement_date = CURRENT_DATE
      `),

      // Aktif lot sayısı (kalan > 0)
      pool.query(`
        SELECT COUNT(DISTINCT lot_barcode) AS cnt
        FROM (
          SELECT lot_barcode, SUM(meter) AS rem
          FROM stock_movements
          GROUP BY lot_barcode
          HAVING SUM(meter) > 0
        ) t
      `),

      // Değerlendirme parça sayısı (available)
      pool.query(`SELECT COUNT(*) AS cnt FROM evaluation_pieces WHERE status='available'`),

      // Son 10 hareket
      pool.query(`
        SELECT
          sm.id, sm.movement_date, sm.movement_type,
          p.product_code, sm.lot_barcode,
          src.shelf_code AS source_shelf,
          tgt.shelf_code AS target_shelf,
          sm.cut_cm, sm.quantity, sm.meter,
          u.username AS created_by
        FROM stock_movements sm
        JOIN products p ON p.id = sm.product_id
        LEFT JOIN shelves src ON src.id = sm.source_shelf_id
        LEFT JOIN shelves tgt ON tgt.id = sm.target_shelf_id
        JOIN users u ON u.id = sm.created_by
        ORDER BY sm.created_at DESC
        LIMIT 10
      `),

      // Raf bazlı kalan stok (main + evaluation, kalan > 0)
      pool.query(`
        SELECT
          sh.shelf_code,
          sh.shelf_type,
          SUM(sm.meter)::NUMERIC(12,2) AS remaining_meter
        FROM stock_movements sm
        JOIN shelves sh ON sh.id = CASE
          WHEN sm.movement_type IN ('roll_in','evaluation_in') THEN sm.target_shelf_id
          ELSE sm.source_shelf_id
        END
        WHERE sh.shelf_type IN ('main','evaluation')
        GROUP BY sh.shelf_code, sh.shelf_type
        HAVING SUM(sm.meter) > 0
        ORDER BY sh.shelf_type, remaining_meter DESC
        LIMIT 30
      `),

      // Son 30 günde en çok fire çıkan 10 ürün
      pool.query(`
        SELECT
          p.product_code,
          SUM(ce.total_meter)::NUMERIC(12,2) AS total_fire_meter,
          SUM(ce.quantity)                   AS total_qty
        FROM cutting_entries ce
        JOIN products p ON p.id = ce.product_id
        WHERE ce.output_type = 'fire'
          AND ce.entry_date >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY p.product_code
        ORDER BY total_fire_meter DESC
        LIMIT 10
      `),
    ]);

    res.render('dashboard', {
      title: 'Dashboard',
      user: req.session,
      summary: generalStats.rows[0],
      today: todayStats.rows[0],
      activeLotCount: parseInt(activeLots.rows[0].cnt, 10),
      evalPieceCount: parseInt(evalPieces.rows[0].cnt, 10),
      recentMovements: recentMovements.rows,
      shelfStock: shelfStock.rows,
      topFire: topFire.rows,
    });
  } catch (err) {
    console.error('Dashboard hatası:', err);
    res.render('error', { title: 'Hata', message: 'Dashboard yüklenemedi.', user: req.session });
  }
});

module.exports = router;
