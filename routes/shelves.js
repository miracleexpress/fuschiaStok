const express = require('express');
const pool    = require('../db/pool');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM shelves ORDER BY shelf_type, shelf_code"
    );
    res.render('shelves', {
      title: 'Raf Yönetimi',
      user: req.session,
      shelves: result.rows,
      success: req.query.success || null,
      error: null
    });
  } catch (err) {
    console.error('Raf listesi hatası:', err);
    res.render('error', { title: 'Hata', message: 'Sayfa yüklenemedi.', user: req.session });
  }
});

router.post('/', async (req, res) => {
  const { shelf_code, shelf_type } = req.body;

  const loadPage = async (error) => {
    const result = await pool.query("SELECT * FROM shelves ORDER BY shelf_type, shelf_code");
    res.render('shelves', {
      title: 'Raf Yönetimi',
      user: req.session,
      shelves: result.rows,
      success: null,
      error
    });
  };

  if (!shelf_code || !shelf_type) return loadPage('Raf kodu ve tipi zorunludur.');
  if (!['main','evaluation','system'].includes(shelf_type)) return loadPage('Geçersiz raf tipi.');

  try {
    await pool.query(
      'INSERT INTO shelves (shelf_code, shelf_type) VALUES ($1, $2)',
      [shelf_code.trim().toUpperCase(), shelf_type]
    );
    res.redirect('/shelves?success=1');
  } catch (err) {
    if (err.code === '23505') return loadPage('Bu raf kodu zaten mevcut.');
    console.error('Raf ekleme hatası:', err);
    return loadPage('Kayıt sırasında hata oluştu.');
  }
});

router.post('/:id/toggle', async (req, res) => {
  try {
    await pool.query('UPDATE shelves SET is_active = NOT is_active WHERE id = $1', [req.params.id]);
    res.redirect('/shelves?success=1');
  } catch (err) {
    console.error('Raf toggle hatası:', err);
    res.redirect('/shelves');
  }
});

module.exports = router;
