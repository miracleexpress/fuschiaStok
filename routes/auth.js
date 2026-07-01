const express = require('express');
const bcrypt  = require('bcrypt');
const pool    = require('../db/pool');

const router = express.Router();

// GET /login
router.get('/login', (req, res) => {
  if (req.session && req.session.userId) return res.redirect('/');
  res.render('login', { title: 'Giriş', error: null });
});

// POST /login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.render('login', { title: 'Giriş', error: 'Kullanıcı adı ve şifre zorunludur.' });
  }
  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1 AND is_active = TRUE',
      [username.trim()]
    );
    if (result.rows.length === 0) {
      return res.render('login', { title: 'Giriş', error: 'Kullanıcı adı veya şifre hatalı.' });
    }
    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.render('login', { title: 'Giriş', error: 'Kullanıcı adı veya şifre hatalı.' });
    }
    req.session.userId   = user.id;
    req.session.username = user.username;
    req.session.userRole = user.role;
    res.redirect('/');
  } catch (err) {
    console.error('Login hatası:', err);
    res.render('login', { title: 'Giriş', error: 'Sunucu hatası. Lütfen tekrar deneyin.' });
  }
});

// POST /logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
