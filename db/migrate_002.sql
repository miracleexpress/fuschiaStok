-- Mevcut production veritabanı için geçiş scripti
-- Bu scripti yeni bir kurulumda ÇALIŞTIRMA — sadece schema.sql kullan.
-- Regüle Depo katmanını ekler: mal önce regüle depoya girer (roll_in),
-- sonra lot okutularak merkez depoya aktarılır (regulation_out + central_in).
-- Mevcut "main" raf tipi artık "Merkez Depo" anlamına gelir (veritabanı değeri aynı kalır).

-- 1. Raf tipi kısıtlamasına 'regulation' ekle
ALTER TABLE shelves
  DROP CONSTRAINT IF EXISTS shelves_shelf_type_check;

ALTER TABLE shelves
  ADD CONSTRAINT shelves_shelf_type_check
  CHECK (shelf_type IN ('main','evaluation','system','regulation'));

-- 2. Hareket tipi kısıtlamasına 'regulation_out' ve 'central_in' ekle
ALTER TABLE stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;

ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_movement_type_check
  CHECK (movement_type IN ('roll_in','sales_out','fire_out','evaluation_out','evaluation_in','regulation_out','central_in'));

-- 3. Regüle → Merkez Depo transfer kayıtları tablosu
CREATE TABLE IF NOT EXISTS regulation_transfers (
  id               SERIAL PRIMARY KEY,
  transfer_date    DATE          NOT NULL DEFAULT CURRENT_DATE,
  product_id       INTEGER       NOT NULL REFERENCES products(id),
  lot_barcode      VARCHAR(100)  NOT NULL,
  source_shelf_id  INTEGER       NOT NULL REFERENCES shelves(id),
  target_shelf_id  INTEGER       NOT NULL REFERENCES shelves(id),
  meter            NUMERIC(12,2) NOT NULL CHECK (meter > 0),
  note             TEXT,
  created_by       INTEGER       NOT NULL REFERENCES users(id),
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_regtransfer_product ON regulation_transfers(product_id);
CREATE INDEX IF NOT EXISTS idx_regtransfer_lot     ON regulation_transfers(lot_barcode);

-- 4. v_roll_stock view'ını güncelle (regüle depo + central_in dahil)
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
  WHEN sm.movement_type IN ('roll_in','evaluation_in','central_in') THEN sm.target_shelf_id
  ELSE sm.source_shelf_id
END
WHERE sh.shelf_type IN ('main','evaluation','regulation')
GROUP BY p.product_code, p.name, sm.lot_barcode, sh.shelf_code, sh.id, sh.shelf_type
HAVING SUM(sm.meter) > 0
ORDER BY p.product_code, sm.lot_barcode, sh.shelf_code;

-- 5. NOT: Bu geçişten sonra Raflar sayfasından ("Yeni Raf Ekle") en az bir tane
--    "Regüle Depo" tipinde raf eklemeniz gerekir — Rulo Girişi artık bu rafları listeler.
--    Mevcut "main" tipi raflarınız aynı kalır ve artık "Merkez Depo" olarak gösterilir.

SELECT 'Geçiş tamamlandı — Regüle Depo eklendi.' AS durum;
