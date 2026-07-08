-- Fuschia / Etullen Stok Yönetim Sistemi — Veritabanı Şeması
-- PostgreSQL 14+
-- UYARI: DROP TABLE kullanıyor — mevcut production DB için db/migrate_001.sql kullan.

DROP TABLE IF EXISTS audit_logs          CASCADE;
DROP TABLE IF EXISTS regulation_transfers CASCADE;
DROP TABLE IF EXISTS evaluation_pieces   CASCADE;
DROP TABLE IF EXISTS stock_movements     CASCADE;
DROP TABLE IF EXISTS cutting_entries   CASCADE;
DROP TABLE IF EXISTS roll_entries      CASCADE;
DROP TABLE IF EXISTS shelves           CASCADE;
DROP TABLE IF EXISTS products          CASCADE;
DROP TABLE IF EXISTS users             CASCADE;

-- ─────────────────────────────────────────────
-- 1. KULLANICILAR
-- ─────────────────────────────────────────────
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(50)  UNIQUE NOT NULL,
  password_hash TEXT         NOT NULL,
  role          VARCHAR(20)  NOT NULL DEFAULT 'depo' CHECK (role IN ('admin','depo')),
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 2. ÜRÜNLER
-- ─────────────────────────────────────────────
CREATE TABLE products (
  id            SERIAL PRIMARY KEY,
  product_code  VARCHAR(20)  UNIQUE NOT NULL,
  pattern_code  VARCHAR(10),
  variant_code  VARCHAR(10),
  name          VARCHAR(100),
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 3. RAFLAR
-- ─────────────────────────────────────────────
CREATE TABLE shelves (
  id          SERIAL PRIMARY KEY,
  shelf_code  VARCHAR(20)  UNIQUE NOT NULL,
  shelf_type  VARCHAR(20)  NOT NULL CHECK (shelf_type IN ('main','evaluation','system','regulation')),
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE
);

-- ─────────────────────────────────────────────
-- 4. RULO GİRİŞLERİ
-- ─────────────────────────────────────────────
CREATE TABLE roll_entries (
  id             SERIAL PRIMARY KEY,
  entry_date     DATE          NOT NULL DEFAULT CURRENT_DATE,
  product_id     INTEGER       NOT NULL REFERENCES products(id),
  lot_barcode    VARCHAR(100)  NOT NULL,
  product_serial VARCHAR(100),
  entry_meter    NUMERIC(12,2) NOT NULL CHECK (entry_meter > 0),
  shelf_id       INTEGER       NOT NULL REFERENCES shelves(id),
  supplier       VARCHAR(100)  NOT NULL DEFAULT 'Jalpersan',
  note           TEXT,
  created_by     INTEGER       NOT NULL REFERENCES users(id),
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 5. KESİM / SARF GİRİŞLERİ
-- ─────────────────────────────────────────────
CREATE TABLE cutting_entries (
  id              SERIAL PRIMARY KEY,
  entry_date      DATE          NOT NULL DEFAULT CURRENT_DATE,
  product_id      INTEGER       NOT NULL REFERENCES products(id),
  lot_barcode     VARCHAR(100)  NOT NULL,
  source_shelf_id INTEGER       NOT NULL REFERENCES shelves(id),
  cut_cm          NUMERIC(12,2) NOT NULL CHECK (cut_cm > 0),
  quantity        INTEGER       NOT NULL CHECK (quantity > 0),
  output_type     VARCHAR(20)   NOT NULL CHECK (output_type IN ('sales','fire','evaluation')),
  target_shelf_id INTEGER       REFERENCES shelves(id),
  total_meter     NUMERIC(12,2) NOT NULL,
  note            TEXT,
  created_by      INTEGER       NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 6. STOK HAREKETLERİ
--
--  movement_type   | meter | source_shelf | target_shelf
--  ─────────────────────────────────────────────────────
--  roll_in         |  +    | NULL         | regüle depo rafı  ← ilk giriş regüle depoya
--  regulation_out  |  -    | regüle rafı  | NULL              ← regüle depodan çıkış
--  central_in      |  +    | NULL         | merkez depo rafı  ← merkez depoya giriş
--  evaluation_in   |  +    | kaynak raf   | değer. rafı       ← eval rafa GİRİŞ
--  sales_out       |  -    | kaynak raf   | SATIŞ sistemi
--  fire_out        |  -    | kaynak raf   | FİRE sistemi
--  evaluation_out  |  -    | ana (merkez) raf | değer. rafı   ← merkez raftan ÇIKIŞ
--
--  regulation_out + central_in birbirini götürür; net stok değişmez (transfer).
--  evaluation_out + evaluation_in birbirini götürür; net stok değişmez.
--  Gerçek çıkış: sales_out ve fire_out.
-- ─────────────────────────────────────────────
CREATE TABLE stock_movements (
  id              SERIAL PRIMARY KEY,
  movement_date   DATE          NOT NULL DEFAULT CURRENT_DATE,
  movement_type   VARCHAR(30)   NOT NULL CHECK (
    movement_type IN ('roll_in','sales_out','fire_out','evaluation_out','evaluation_in','regulation_out','central_in')
  ),
  product_id      INTEGER       NOT NULL REFERENCES products(id),
  lot_barcode     VARCHAR(100)  NOT NULL,
  source_shelf_id INTEGER       REFERENCES shelves(id),
  target_shelf_id INTEGER       REFERENCES shelves(id),
  cut_cm          NUMERIC(12,2),
  quantity        INTEGER,
  meter           NUMERIC(12,2) NOT NULL,
  ref_table       VARCHAR(50),
  ref_id          INTEGER,
  note            TEXT,
  created_by      INTEGER       NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 7. DEĞERLENDİRME PARÇALARI
-- ─────────────────────────────────────────────
CREATE TABLE evaluation_pieces (
  id                  SERIAL PRIMARY KEY,
  entry_date          DATE          NOT NULL DEFAULT CURRENT_DATE,
  product_id          INTEGER       NOT NULL REFERENCES products(id),
  lot_barcode         VARCHAR(100)  NOT NULL,
  source_shelf_id     INTEGER       NOT NULL REFERENCES shelves(id),
  evaluation_shelf_id INTEGER       NOT NULL REFERENCES shelves(id),
  cut_cm              NUMERIC(12,2) NOT NULL CHECK (cut_cm > 0),
  quantity            INTEGER       NOT NULL CHECK (quantity > 0),
  total_meter         NUMERIC(12,2) NOT NULL,
  status              VARCHAR(20)   NOT NULL DEFAULT 'available'
                        CHECK (status IN ('available','used','cancelled')),
  note                TEXT,
  created_by          INTEGER       NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 7b. REGÜLE → MERKEZ DEPO TRANSFERLERİ
-- ─────────────────────────────────────────────
CREATE TABLE regulation_transfers (
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

-- ─────────────────────────────────────────────
-- 8. DENETİM KAYITLARI
-- ─────────────────────────────────────────────
CREATE TABLE audit_logs (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER     REFERENCES users(id),
  action     VARCHAR(20) NOT NULL,
  table_name VARCHAR(50) NOT NULL,
  record_id  INTEGER,
  old_data   JSONB,
  new_data   JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- İNDEKSLER
-- ─────────────────────────────────────────────
CREATE INDEX idx_roll_entries_product ON roll_entries(product_id);
CREATE INDEX idx_roll_entries_lot     ON roll_entries(lot_barcode);
CREATE INDEX idx_roll_entries_serial  ON roll_entries(product_serial);
CREATE INDEX idx_roll_entries_shelf   ON roll_entries(shelf_id);
CREATE INDEX idx_cutting_product      ON cutting_entries(product_id);
CREATE INDEX idx_cutting_lot          ON cutting_entries(lot_barcode);
CREATE INDEX idx_cutting_type         ON cutting_entries(output_type);
CREATE INDEX idx_sm_product           ON stock_movements(product_id);
CREATE INDEX idx_sm_lot               ON stock_movements(lot_barcode);
CREATE INDEX idx_sm_type              ON stock_movements(movement_type);
CREATE INDEX idx_sm_date              ON stock_movements(movement_date);
CREATE INDEX idx_sm_source_shelf      ON stock_movements(source_shelf_id);
CREATE INDEX idx_sm_target_shelf      ON stock_movements(target_shelf_id);
CREATE INDEX idx_eval_product         ON evaluation_pieces(product_id);
CREATE INDEX idx_eval_status          ON evaluation_pieces(status);
CREATE INDEX idx_regtransfer_product  ON regulation_transfers(product_id);
CREATE INDEX idx_regtransfer_lot      ON regulation_transfers(lot_barcode);
CREATE INDEX idx_audit_user           ON audit_logs(user_id);
CREATE INDEX idx_audit_table          ON audit_logs(table_name, record_id);

-- ─────────────────────────────────────────────
-- VIEW: RULO & DEĞERLENDİRME RAF STOĞU (regüle + merkez + değerlendirme)
--
-- roll_in / evaluation_in / central_in → hedef raf (girişler)
-- diğerleri                            → kaynak raf (çıkışlar)
-- ─────────────────────────────────────────────
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

-- ─────────────────────────────────────────────
-- VIEW: DEĞERLENDİRME PARÇA LİSTESİ
-- ─────────────────────────────────────────────
CREATE OR REPLACE VIEW v_eval_stock AS
SELECT
  ep.id,
  ep.entry_date,
  p.product_code,
  p.name         AS product_name,
  ep.lot_barcode,
  src.shelf_code AS source_shelf,
  evs.shelf_code AS evaluation_shelf,
  ep.cut_cm,
  ep.quantity,
  ep.total_meter,
  ep.status,
  ep.note,
  u.username     AS created_by
FROM evaluation_pieces ep
JOIN products p   ON p.id   = ep.product_id
JOIN shelves  src ON src.id = ep.source_shelf_id
JOIN shelves  evs ON evs.id = ep.evaluation_shelf_id
JOIN users    u   ON u.id   = ep.created_by
ORDER BY ep.entry_date DESC, ep.id DESC;

-- ─────────────────────────────────────────────
-- VIEW: FİRE RAPORU
-- ─────────────────────────────────────────────
CREATE OR REPLACE VIEW v_fire_report AS
SELECT
  ce.id,
  ce.entry_date,
  p.product_code,
  p.name         AS product_name,
  ce.lot_barcode,
  s.shelf_code   AS source_shelf,
  ce.cut_cm,
  ce.quantity,
  ce.total_meter,
  ce.note,
  u.username     AS created_by
FROM cutting_entries ce
JOIN products p ON p.id = ce.product_id
JOIN shelves  s ON s.id = ce.source_shelf_id
JOIN users    u ON u.id = ce.created_by
WHERE ce.output_type = 'fire'
ORDER BY ce.entry_date DESC, ce.id DESC;

-- ─────────────────────────────────────────────
-- VIEW: SATIŞ RAPORU
-- ─────────────────────────────────────────────
CREATE OR REPLACE VIEW v_sales_report AS
SELECT
  ce.id,
  ce.entry_date,
  p.product_code,
  p.name         AS product_name,
  ce.lot_barcode,
  s.shelf_code   AS source_shelf,
  ce.cut_cm,
  ce.quantity,
  ce.total_meter,
  ce.note,
  u.username     AS created_by
FROM cutting_entries ce
JOIN products p ON p.id = ce.product_id
JOIN shelves  s ON s.id = ce.source_shelf_id
JOIN users    u ON u.id = ce.created_by
WHERE ce.output_type = 'sales'
ORDER BY ce.entry_date DESC, ce.id DESC;

-- ─────────────────────────────────────────────
-- VIEW: DASHBOARD ÖZETİ
--
-- Net kalan stok = SUM(meter) over all movements
-- Çünkü: evaluation_in ve evaluation_out birbirini götürür,
-- gerçek çıkışlar sales_out ve fire_out'tur.
-- ─────────────────────────────────────────────
CREATE OR REPLACE VIEW v_dashboard_summary AS
SELECT
  COALESCE(SUM(CASE WHEN movement_type = 'roll_in'       THEN meter      ELSE 0 END), 0)::NUMERIC(12,2) AS total_in_meter,
  COALESCE(SUM(CASE WHEN movement_type = 'sales_out'     THEN ABS(meter) ELSE 0 END), 0)::NUMERIC(12,2) AS total_sales_meter,
  COALESCE(SUM(CASE WHEN movement_type = 'fire_out'      THEN ABS(meter) ELSE 0 END), 0)::NUMERIC(12,2) AS total_fire_meter,
  COALESCE(SUM(CASE WHEN movement_type = 'evaluation_in' THEN meter      ELSE 0 END), 0)::NUMERIC(12,2) AS total_eval_meter,
  COALESCE(SUM(meter), 0)::NUMERIC(12,2) AS remaining_stock_meter
FROM stock_movements;
