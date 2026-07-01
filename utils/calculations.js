/**
 * Kesim hesabı: cm × adet → metre (2 ondalık)
 */
function calcTotalMeter(cutCm, quantity) {
  const cm  = parseFloat(cutCm);
  const qty = parseInt(quantity, 10);
  if (isNaN(cm) || isNaN(qty) || cm <= 0 || qty <= 0) return 0;
  return Math.round((cm * qty / 100) * 100) / 100;
}

const cmToMeter = calcTotalMeter;

/**
 * Ürün kodunu parçala: "DT-04" → { pattern_code: "DT", variant_code: "04" }
 */
function parseProductCode(productCode) {
  if (!productCode) return { pattern_code: null, variant_code: null };
  const s = productCode.trim().toUpperCase();
  const idx = s.indexOf('-');
  if (idx === -1) return { pattern_code: s, variant_code: null };
  return {
    pattern_code: s.substring(0, idx),
    variant_code: s.substring(idx + 1),
  };
}

/**
 * Sayıyı metre formatında göster
 */
function formatMeter(value) {
  const n = parseFloat(value);
  if (isNaN(n)) return '0.00';
  return n.toFixed(2);
}

/**
 * Belirli ürün + lot + raf için kalan metre.
 *
 * Kural:
 *   roll_in / evaluation_in → pozitif, hedef_raf = $3
 *   diğerleri               → negatif, kaynak_raf = $3
 */
async function getRemainingMeter(pool, productId, lotBarcode, shelfId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(meter), 0)::NUMERIC(12,2) AS remaining
     FROM stock_movements
     WHERE product_id = $1 AND lot_barcode = $2
       AND (
             (movement_type IN ('roll_in','evaluation_in') AND target_shelf_id = $3)
          OR (movement_type NOT IN ('roll_in','evaluation_in') AND source_shelf_id = $3)
           )`,
    [productId, lotBarcode, shelfId]
  );
  return parseFloat(rows[0].remaining);
}

/**
 * Aynı, transaction client'ı ile (concurrent-safe stok kontrolü için).
 */
async function getRemainingMeterTx(client, productId, lotBarcode, shelfId) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(meter), 0)::NUMERIC(12,2) AS remaining
     FROM stock_movements
     WHERE product_id = $1 AND lot_barcode = $2
       AND (
             (movement_type IN ('roll_in','evaluation_in') AND target_shelf_id = $3)
          OR (movement_type NOT IN ('roll_in','evaluation_in') AND source_shelf_id = $3)
           )`,
    [productId, lotBarcode, shelfId]
  );
  return parseFloat(rows[0].remaining);
}

/**
 * Ürün ID'sine göre stokta kalan lot + raf listesi (hem ana hem değerlendirme rafları).
 */
async function getLotsByProductId(pool, productId) {
  const { rows } = await pool.query(
    `SELECT
       sm.lot_barcode,
       sh.id              AS shelf_id,
       sh.shelf_code,
       sh.shelf_type,
       SUM(sm.meter)::NUMERIC(12,2) AS remaining_meter
     FROM stock_movements sm
     JOIN shelves sh ON sh.id = CASE
       WHEN sm.movement_type IN ('roll_in','evaluation_in') THEN sm.target_shelf_id
       ELSE sm.source_shelf_id
     END
     WHERE sm.product_id = $1
       AND sh.shelf_type IN ('main','evaluation')
     GROUP BY sm.lot_barcode, sh.id, sh.shelf_code, sh.shelf_type
     HAVING SUM(sm.meter) > 0
     ORDER BY sm.lot_barcode, sh.shelf_code`,
    [productId]
  );
  return rows;
}

/**
 * Ürün koduna (text) göre stokta kalan lot + raf listesi.
 * Kesim formundaki AJAX endpoint'i bu fonksiyonu kullanır.
 */
async function getLotsByProductCode(pool, productCode) {
  if (!productCode) return [];
  const { rows } = await pool.query(
    `SELECT
       sm.lot_barcode,
       sh.id              AS shelf_id,
       sh.shelf_code,
       sh.shelf_type,
       SUM(sm.meter)::NUMERIC(12,2) AS remaining_meter
     FROM stock_movements sm
     JOIN products p  ON p.id  = sm.product_id
     JOIN shelves  sh ON sh.id = CASE
       WHEN sm.movement_type IN ('roll_in','evaluation_in') THEN sm.target_shelf_id
       ELSE sm.source_shelf_id
     END
     WHERE UPPER(p.product_code) = UPPER($1)
       AND sh.shelf_type IN ('main','evaluation')
     GROUP BY sm.lot_barcode, sh.id, sh.shelf_code, sh.shelf_type
     HAVING SUM(sm.meter) > 0
     ORDER BY sm.lot_barcode, sh.shelf_code`,
    [productCode.trim()]
  );
  return rows;
}

const getLotsByProduct = getLotsByProductId;

module.exports = {
  calcTotalMeter,
  cmToMeter,
  parseProductCode,
  formatMeter,
  getRemainingMeter,
  getRemainingMeterTx,
  getLotsByProduct,
  getLotsByProductId,
  getLotsByProductCode,
};
