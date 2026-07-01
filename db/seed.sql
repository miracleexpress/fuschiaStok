-- Fuschia / Etullen Stok Sistemi - Seed Verisi
-- Bu dosyayı schema.sql'den SONRA çalıştır

-- ─────────────────────────────────────────────
-- KULLANICILAR
-- Şifreler bcrypt ile hash'lenmiş (bcrypt cost 10)
-- admin123 → $2b$10$... | depo123 → $2b$10$...
-- Aşağıdaki hash'ler node -e "require('bcrypt').hash('admin123',10,(_,h)=>console.log(h))" ile üretildi.
-- Gerçek uygulamada sunucu tarafı seed scripti kullanılmalı.
-- ─────────────────────────────────────────────

-- Hash'leri uygulama aracılığıyla seed etmek için ayrı bir seed script kullanıyoruz.
-- Bu dosyada placeholder kullanılıyor; gerçek hash'ler seed.js ile yüklenir.

INSERT INTO users (username, password_hash, role) VALUES
  ('admin', 'SEED_ADMIN_HASH', 'admin'),
  ('depo',  'SEED_DEPO_HASH',  'depo');

-- ─────────────────────────────────────────────
-- RAFLAR - ANA RULO RAFLARI (1-A … 8-F)
-- ─────────────────────────────────────────────
INSERT INTO shelves (shelf_code, shelf_type) VALUES
  ('1-A','main'),('1-B','main'),('1-C','main'),('1-D','main'),('1-E','main'),('1-F','main'),
  ('2-A','main'),('2-B','main'),('2-C','main'),('2-D','main'),('2-E','main'),('2-F','main'),
  ('3-A','main'),('3-B','main'),('3-C','main'),('3-D','main'),('3-E','main'),('3-F','main'),
  ('4-A','main'),('4-B','main'),('4-C','main'),('4-D','main'),('4-E','main'),('4-F','main'),
  ('5-A','main'),('5-B','main'),('5-C','main'),('5-D','main'),('5-E','main'),('5-F','main'),
  ('6-A','main'),('6-B','main'),('6-C','main'),('6-D','main'),('6-E','main'),('6-F','main'),
  ('7-A','main'),('7-B','main'),('7-C','main'),('7-D','main'),('7-E','main'),('7-F','main'),
  ('8-A','main'),('8-B','main'),('8-C','main'),('8-D','main'),('8-E','main'),('8-F','main');

-- DEĞERLENDİRME RAFLARI
INSERT INTO shelves (shelf_code, shelf_type) VALUES
  ('D-1A','evaluation'),
  ('D-1B','evaluation'),
  ('D-1C','evaluation'),
  ('D-1D','evaluation'),
  ('D-1E','evaluation'),
  ('D-1F','evaluation');

-- SİSTEM ALANLARI
INSERT INTO shelves (shelf_code, shelf_type) VALUES
  ('SATIŞ','system'),
  ('FİRE', 'system');

-- ─────────────────────────────────────────────
-- ÜRÜNLER
-- ─────────────────────────────────────────────
INSERT INTO products (product_code, pattern_code, variant_code, name) VALUES
  ('DT-04', 'DT', '04', 'DT Desen 04'),
  ('DT-05', 'DT', '05', 'DT Desen 05'),
  ('DT-06', 'DT', '06', 'DT Desen 06'),
  ('PL-01', 'PL', '01', 'PL Desen 01'),
  ('PL-02', 'PL', '02', 'PL Desen 02');

-- ─────────────────────────────────────────────
-- ÖRNEK RULO GİRİŞLERİ VE HAREKETLERİ
-- (Gerçek üretim için bu bloğu yorum satırına al)
-- ─────────────────────────────────────────────
/*
-- Örnek rulo girişleri (admin user id=1, shelf 1-A id=1)
INSERT INTO roll_entries (entry_date, product_id, lot_barcode, entry_meter, shelf_id, supplier, created_by)
VALUES
  ('2026-06-01', 1, 'JAL-2026-001', 150.00, 1, 'Jalpersan', 1),
  ('2026-06-01', 1, 'JAL-2026-002', 120.50, 2, 'Jalpersan', 1),
  ('2026-06-02', 2, 'JAL-2026-003', 200.00, 3, 'Jalpersan', 1),
  ('2026-06-03', 3, 'JAL-2026-004',  80.00, 4, 'Jalpersan', 1);

-- Stok hareketleri (girişler)
INSERT INTO stock_movements (movement_date, movement_type, product_id, lot_barcode, target_shelf_id, meter, ref_table, ref_id, created_by)
VALUES
  ('2026-06-01', 'roll_in', 1, 'JAL-2026-001', 1, 150.00, 'roll_entries', 1, 1),
  ('2026-06-01', 'roll_in', 1, 'JAL-2026-002', 2, 120.50, 'roll_entries', 2, 1),
  ('2026-06-02', 'roll_in', 2, 'JAL-2026-003', 3, 200.00, 'roll_entries', 3, 1),
  ('2026-06-03', 'roll_in', 3, 'JAL-2026-004', 4,  80.00, 'roll_entries', 4, 1);

-- Örnek kesim (satış)
INSERT INTO cutting_entries (entry_date, product_id, lot_barcode, source_shelf_id, cut_cm, quantity, output_type, total_meter, created_by)
VALUES
  ('2026-06-05', 1, 'JAL-2026-001', 1, 230, 14, 'sales', 32.20, 2);

INSERT INTO stock_movements (movement_date, movement_type, product_id, lot_barcode, source_shelf_id, cut_cm, quantity, meter, ref_table, ref_id, created_by)
VALUES
  ('2026-06-05', 'sales_out', 1, 'JAL-2026-001', 1, 230, 14, -32.20, 'cutting_entries', 1, 2);
*/
