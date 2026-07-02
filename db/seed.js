/**
 * Seed scripti — schema.sql çalıştıktan sonra çalıştır:
 *   node db/seed.js
 *
 * UYARI: Bu script mevcut users tablosunu temizleyip yeniden oluşturur.
 */
require('dotenv').config();
const { Pool } = require('pg');
const bcrypt   = require('bcrypt');
const fs       = require('fs');
const path     = require('path');

const isProduction = process.env.NODE_ENV === 'production';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

async function main() {
  const client = await pool.connect();
  try {
    console.log('Seed başlıyor...');

    // Schema SQL'i çalıştır
    const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await client.query(schemaSql);
    console.log('✓ Schema oluşturuldu');

    // Kullanıcılar
    const adminHash = await bcrypt.hash('admin123', 10);
    const depoHash  = await bcrypt.hash('depo123', 10);

    await client.query(
      `INSERT INTO users (username, password_hash, role) VALUES
       ('admin', $1, 'admin'),
       ('depo',  $2, 'depo')
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [adminHash, depoHash]
    );
    console.log('✓ Kullanıcılar oluşturuldu (admin/admin123, depo/depo123)');

    // Raflar — Merkez depo rafları
    const mainShelves = [];
    for (let row = 1; row <= 8; row++) {
      for (const col of ['A','B','C','D','E','F']) {
        mainShelves.push(`${row}-${col}`);
      }
    }
    for (const code of mainShelves) {
      await client.query(
        `INSERT INTO shelves (shelf_code, shelf_type) VALUES ($1,'main')
         ON CONFLICT (shelf_code) DO NOTHING`,
        [code]
      );
    }
    console.log(`✓ ${mainShelves.length} merkez depo rafı oluşturuldu`);

    // Regüle depo rafları (ilk giriş burada yapılır, sonra merkez depoya aktarılır)
    const regulationShelves = ['R-1','R-2','R-3','R-4','R-5','R-6','R-7','R-8','R-9','R-10'];
    for (const code of regulationShelves) {
      await client.query(
        `INSERT INTO shelves (shelf_code, shelf_type) VALUES ($1,'regulation')
         ON CONFLICT (shelf_code) DO NOTHING`,
        [code]
      );
    }
    console.log(`✓ ${regulationShelves.length} regüle depo rafı oluşturuldu`);

    // Değerlendirme rafları
    const evalShelves = ['D-1A','D-1B','D-1C','D-1D','D-1E','D-1F'];
    for (const code of evalShelves) {
      await client.query(
        `INSERT INTO shelves (shelf_code, shelf_type) VALUES ($1,'evaluation')
         ON CONFLICT (shelf_code) DO NOTHING`,
        [code]
      );
    }
    console.log('✓ 6 değerlendirme rafı oluşturuldu');

    // Sistem alanları
    await client.query(
      `INSERT INTO shelves (shelf_code, shelf_type) VALUES ('SATIŞ','system'),('FİRE','system')
       ON CONFLICT (shelf_code) DO NOTHING`
    );
    console.log('✓ Sistem alanları oluşturuldu (SATIŞ, FİRE)');

    // Ürünler
    const products = [
      ['DT-04','DT','04','DT Desen 04'],
      ['DT-05','DT','05','DT Desen 05'],
      ['DT-06','DT','06','DT Desen 06'],
      ['PL-01','PL','01','PL Desen 01'],
      ['PL-02','PL','02','PL Desen 02'],
    ];
    for (const [code, pattern, variant, name] of products) {
      await client.query(
        `INSERT INTO products (product_code, pattern_code, variant_code, name)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (product_code) DO NOTHING`,
        [code, pattern, variant, name]
      );
    }
    console.log('✓ 5 ürün oluşturuldu');

    console.log('\n✅ Seed tamamlandı!');
    console.log('   Giriş: admin / admin123');
    console.log('   Giriş: depo  / depo123');
  } catch (err) {
    console.error('❌ Seed hatası:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
