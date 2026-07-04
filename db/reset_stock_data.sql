-- Stok hareketlerini sıfırlama scripti
-- Gerçek kullanıma geçmeden önce test verilerini temizlemek için.
--
-- KORUNANLAR: users, products, shelves (ürün/raf/kullanıcı tanımların aynen kalır)
-- SİLİNENLER: tüm rulo girişleri, kesim/sarf kayıtları, stok hareketleri,
--             değerlendirme parçaları, regüle->merkez transferleri, denetim kayıtları
--
-- UYARI: Bu işlem GERİ ALINAMAZ. Çalıştırmadan önce Render panelinden
-- veritabanının bir "Backup" / snapshot'ını almanız önerilir.

TRUNCATE TABLE
  audit_logs,
  regulation_transfers,
  evaluation_pieces,
  stock_movements,
  cutting_entries,
  roll_entries
RESTART IDENTITY;

SELECT 'Stok verileri sıfırlandı — ürünler, raflar ve kullanıcılar korundu.' AS durum;
