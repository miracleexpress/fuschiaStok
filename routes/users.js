const express = require('express');
const bcrypt  = require('bcrypt');
const pool    = require('../db/pool');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, username, role, is_active, created_at FROM users ORDER BY id'
    );
    res.render('users', {
      title: 'Kullanıcı Yönetimi',
      user: req.session,
      users: rows,
      success: req.query.success || null,
      error: null,
    });
  } catch (err) {
    console.error('Kullanıcı listesi:', err);
    res.render('error', { title: 'Hata', message: 'Sayfa yüklenemedi.', user: req.session });
  }
});

// POST /users — yeni kullanıcı
router.post('/', async (req, res) => {
  const { username, password, role } = req.body;

  const loadPage = async (error) => {
    const { rows } = await pool.query(
      'SELECT id, username, role, is_active, created_at FROM users ORDER BY id'
    );
    return res.render('users', {
      title: 'Kullanıcı Yönetimi',
      user: req.session,
      users: rows,
      success: null,
      error,
    });
  };

  if (!username || !password || !role)      return loadPage('Tüm alanlar zorunludur.');
  if (!['admin','depo'].includes(role))     return loadPage('Geçersiz rol.');
  if (password.length < 6)                  return loadPage('Şifre en az 6 karakter olmalıdır.');

  try {
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (username, password_hash, role) VALUES ($1,$2,$3)',
      [username.trim(), hash, role]
    );
    res.redirect('/users?success=1');
  } catch (err) {
    if (err.code === '23505') return loadPage('Bu kullanıcı adı zaten mevcut.');
    console.error('Kullanıcı ekleme:', err);
    return loadPage('Kayıt sırasında hata oluştu.');
  }
});

// POST /users/:id/password — şifre değiştir
router.post('/:id/password', async (req, res) => {
  const { password } = req.body;
  const targetId = parseInt(req.params.id, 10);

  if (!password || password.length < 6) {
    return res.redirect('/users?error=Şifre+en+az+6+karakter+olmalıdır');
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, targetId]);
    res.redirect('/users?success=1');
  } catch (err) {
    console.error('Şifre güncelleme:', err);
    res.redirect('/users');
  }
});

// POST /users/:id/toggle — aktif/pasif
router.post('/:id/toggle', async (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  // Kendi hesabını kapatamaz
  if (targetId === req.session.userId) return res.redirect('/users');
  try {
    await pool.query('UPDATE users SET is_active=NOT is_active WHERE id=$1', [targetId]);
    res.redirect('/users?success=1');
  } catch (err) {
    console.error('Kullanıcı toggle:', err);
    res.redirect('/users');
  }
});

module.exports = router;
