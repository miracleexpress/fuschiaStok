const express = require('express');
const pool    = require('../db/pool');
const { parseProductCode } = require('../utils/calculations');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM products ORDER BY product_code'
    );
    res.render('products', {
      title: 'Ürün Yönetimi',
      user: req.session,
      products: rows,
      success: req.query.success || null,
      error: null,
    });
  } catch (err) {
    console.error('Ürün listesi:', err);
    res.render('error', { title: 'Hata', message: 'Sayfa yüklenemedi.', user: req.session });
  }
});

// POST /products — yeni ürün ekle
router.post('/', async (req, res) => {
  const { product_code, pattern_code, variant_code, name } = req.body;

  const loadPage = async (error) => {
    const { rows } = await pool.query('SELECT * FROM products ORDER BY product_code');
    return res.render('products', {
      title: 'Ürün Yönetimi',
      user: req.session,
      products: rows,
      success: null,
      error,
    });
  };

  if (!product_code) return loadPage('Ürün kodu zorunludur.');

  const cleanCode = product_code.trim().toUpperCase();
  const parsed    = parseProductCode(cleanCode);

  try {
    await pool.query(
      `INSERT INTO products (product_code, pattern_code, variant_code, name)
       VALUES ($1, $2, $3, $4)`,
      [
        cleanCode,
        pattern_code || parsed.pattern_code || null,
        variant_code || parsed.variant_code || null,
        name || null,
      ]
    );
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, table_name, new_data)
       VALUES ($1,'INSERT','products',$2)`,
      [req.session.userId, JSON.stringify({ product_code: cleanCode })]
    );
    res.redirect('/products?success=1');
  } catch (err) {
    if (err.code === '23505') return loadPage('Bu ürün kodu zaten mevcut.');
    console.error('Ürün ekleme:', err);
    return loadPage('Kayıt sırasında hata oluştu.');
  }
});

// POST /products/:id/name — ad güncelle
router.post('/:id/name', async (req, res) => {
  const { name } = req.body;
  try {
    await pool.query('UPDATE products SET name=$1 WHERE id=$2', [name || null, req.params.id]);
    res.redirect('/products?success=1');
  } catch (err) {
    console.error('Ürün ad güncelleme:', err);
    res.redirect('/products');
  }
});

// POST /products/:id/toggle — aktif/pasif
router.post('/:id/toggle', async (req, res) => {
  try {
    await pool.query('UPDATE products SET is_active=NOT is_active WHERE id=$1', [req.params.id]);
    res.redirect('/products?success=1');
  } catch (err) {
    console.error('Ürün toggle:', err);
    res.redirect('/products');
  }
});

module.exports = router;
