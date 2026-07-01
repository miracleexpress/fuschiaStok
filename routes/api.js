/**
 * /api/* — Login zorunlu, JSON döner
 */
const express = require('express');
const pool    = require('../db/pool');
const { getLotsByProductCode } = require('../utils/calculations');

const router = express.Router();

// GET /api/lots?product_code=DT-04
// Ürün koduna göre stokta kalan lot + raf kombinasyonları
router.get('/lots', async (req, res) => {
  const { product_code } = req.query;
  if (!product_code) return res.json([]);
  try {
    const rows = await getLotsByProductCode(pool, product_code);
    res.json(rows);
  } catch (err) {
    console.error('/api/lots hatası:', err);
    res.status(500).json({ error: 'Lot listesi alınamadı.' });
  }
});

// GET /api/lot-stock?product_code=DT-04&lot_barcode=JAL-001
// Belirli ürün + lot için raf bazlı kalan metre
router.get('/lot-stock', async (req, res) => {
  const { product_code, lot_barcode } = req.query;
  if (!product_code || !lot_barcode) return res.json({ shelves: [] });
  try {
    const { rows } = await pool.query(
      `SELECT
         sh.id              AS shelf_id,
         sh.shelf_code,
         SUM(sm.meter)::NUMERIC(12,2) AS remaining_meter
       FROM stock_movements sm
       JOIN products p  ON p.id  = sm.product_id
       JOIN shelves  sh ON sh.id = CASE
         WHEN sm.movement_type = 'roll_in' THEN sm.target_shelf_id
         ELSE sm.source_shelf_id
       END
       WHERE UPPER(p.product_code) = UPPER($1)
         AND sm.lot_barcode        = $2
         AND sh.shelf_type IN ('main', 'evaluation')
       GROUP BY sh.id, sh.shelf_code
       HAVING SUM(sm.meter) > 0
       ORDER BY sh.shelf_code`,
      [product_code.trim(), lot_barcode.trim()]
    );
    res.json({ shelves: rows });
  } catch (err) {
    console.error('/api/lot-stock hatası:', err);
    res.status(500).json({ error: 'Stok bilgisi alınamadı.' });
  }
});

// GET /api/check-lot?product_code=DT-04&lot_barcode=JAL-001
// Lot barkodunun başka ürünle çakışıp çakışmadığını kontrol et
// Yanıt: { status: 'ok' | 'duplicate_same' | 'duplicate_other', product_code? }
router.get('/check-lot', async (req, res) => {
  const { product_code, lot_barcode } = req.query;
  if (!product_code || !lot_barcode) return res.json({ status: 'ok' });
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT p.product_code
       FROM roll_entries re
       JOIN products p ON p.id = re.product_id
       WHERE re.lot_barcode = $1`,
      [lot_barcode.trim()]
    );
    if (rows.length === 0) return res.json({ status: 'ok' });

    const sameProduct = rows.some(
      r => r.product_code.toUpperCase() === product_code.trim().toUpperCase()
    );
    const otherProducts = rows.filter(
      r => r.product_code.toUpperCase() !== product_code.trim().toUpperCase()
    );

    if (otherProducts.length > 0) {
      return res.json({ status: 'duplicate_other', product_code: otherProducts[0].product_code });
    }
    if (sameProduct) {
      return res.json({ status: 'duplicate_same' });
    }
    return res.json({ status: 'ok' });
  } catch (err) {
    console.error('/api/check-lot hatası:', err);
    res.status(500).json({ error: 'Kontrol yapılamadı.' });
  }
});

// GET /api/products — aktif ürün listesi (autocomplete için)
router.get('/products', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT product_code, name FROM products WHERE is_active = TRUE ORDER BY product_code`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Ürün listesi alınamadı.' });
  }
});

module.exports = router;
