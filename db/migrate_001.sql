-- Mevcut production veritabanı için geçiş scripti
-- Bu scripti yeni bir kurulumda ÇALIŞTIRMA — sadece schema.sql kullan.
-- Varolan DB'de evaluation_in hareket tipini ekler.

-- 1. Hareket tipi kısıtlamasını güncelle
ALTER TABLE stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;

ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_movement_type_check
  CHECK (movement_type IN ('roll_in','sales_out','fire_out','evaluation_out','evaluation_in'));

-- 2. v_roll_stock view'ını güncelle
CREATE OR REPLACE VIEW v_roll_stock AS
SELECT
  p.product_code,
  p.name          AS product_name,
  sm.lot_barcode,
  sh.shelf_code,
  sh.id           AS shelf_id,
  sh.shelf_type,
  SUM(CASE WHEN sm.meter > 0 THEN sm.meter      ELSE 0 END)::NUMERIC(12,2) AS total_in_meter,
  SUM(CASE WHEN sm.meter < 0 THEN ABS(sm.meter) ELSE 0 END)::NUMERIC(12,2) AS total_out_meter,
  SUM(sm.meter)::NUMERIC(12,2)                                               AS remaining_meter
FROM stock_movements sm
JOIN products p ON p.id = sm.product_id
JOIN shelves sh ON sh.id = CASE
  WHEN sm.movement_type IN ('roll_in','evaluation_in') THEN sm.target_shelf_id
  ELSE sm.source_shelf_id
END
WHERE sh.shelf_type IN ('main','evaluation')
GROUP BY p.product_code, p.name, sm.lot_barcode, sh.shelf_code, sh.id, sh.shelf_type
HAVING SUM(sm.meter) > 0
ORDER BY p.product_code, sm.lot_barcode, sh.shelf_code;

-- 3. v_dashboard_summary güncelle
CREATE OR REPLACE VIEW v_dashboard_summary AS
SELECT
  COALESCE(SUM(CASE WHEN movement_type = 'roll_in'       THEN meter      ELSE 0 END), 0)::NUMERIC(12,2) AS total_in_meter,
  COALESCE(SUM(CASE WHEN movement_type = 'sales_out'     THEN ABS(meter) ELSE 0 END), 0)::NUMERIC(12,2) AS total_sales_meter,
  COALESCE(SUM(CASE WHEN movement_type = 'fire_out'      THEN ABS(meter) ELSE 0 END), 0)::NUMERIC(12,2) AS total_fire_meter,
  COALESCE(SUM(CASE WHEN movement_type = 'evaluation_in' THEN meter      ELSE 0 END), 0)::NUMERIC(12,2) AS total_eval_meter,
  COALESCE(SUM(meter), 0)::NUMERIC(12,2) AS remaining_stock_meter
FROM stock_movements;

-- 4. Eski evaluation_out kayıtları için geriye dönük evaluation_in oluştur
--    (mevcut değerlendirme kayıtları artık stockta görünsün)
--
-- DİKKAT: Bu INSERT idempotent değildir. Sadece bir kere çalıştır.
-- Zaten evaluation_in kaydı olan kesimler için tekrar oluşturmaz
-- (cutting_entries.id eşleşmesi ile kontrol edilir).
--
INSERT INTO stock_movements
  (movement_date, movement_type, product_id, lot_barcode,
   source_shelf_id, target_shelf_id, cut_cm, quantity, meter,
   ref_table, ref_id, note, created_by)
SELECT
  eo.movement_date,
  'evaluation_in',
  eo.product_id,
  eo.lot_barcode,
  eo.source_shelf_id,
  eo.target_shelf_id,
  eo.cut_cm,
  eo.quantity,
  ABS(eo.meter),
  eo.ref_table,
  eo.ref_id,
  eo.note,
  eo.created_by
FROM stock_movements eo
WHERE eo.movement_type = 'evaluation_out'
  AND NOT EXISTS (
    SELECT 1 FROM stock_movements ei
    WHERE ei.movement_type = 'evaluation_in'
      AND ei.ref_table = eo.ref_table
      AND ei.ref_id    = eo.ref_id
  );

SELECT 'Geçiş tamamlandı.' AS durum;
