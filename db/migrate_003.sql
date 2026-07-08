-- Mevcut production veritabanı için geçiş scripti
-- Bu scripti yeni bir kurulumda ÇALIŞTIRMA — sadece schema.sql kullan.
-- roll_entries tablosuna "product_serial" (Ürün ID) kolonu ekler.
--
-- Ürün ID, Lot/Barkod'a alternatif bir tanımlayıcıdır: rulo girişinde
-- ikisinden en az biri girilmelidir. Lot/Barkod boş bırakılırsa, Ürün ID
-- değeri stok takibi için kullanılan lot_barcode kolonuna da yazılır
-- (mevcut tüm stok hesaplamaları lot_barcode üzerinden çalışmaya devam eder).

ALTER TABLE roll_entries ADD COLUMN IF NOT EXISTS product_serial VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_roll_entries_serial ON roll_entries(product_serial);

SELECT 'Geçiş tamamlandı — Ürün ID (product_serial) eklendi.' AS durum;
