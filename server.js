require('dotenv').config();
const express         = require('express');
const session         = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const methodOverride  = require('method-override');
const path            = require('path');
const pool            = require('./db/pool');

const { requireLogin, requireAdmin } = require('./middleware/auth');

const authRoutes         = require('./routes/auth');
const dashboardRoutes    = require('./routes/dashboard');
const rollEntryRoutes    = require('./routes/rollEntries');
const cuttingEntryRoutes = require('./routes/cuttingEntries');
const reportsRoutes      = require('./routes/reports');
const exportsRoutes      = require('./routes/exports');
const productsRoutes     = require('./routes/products');
const shelvesRoutes      = require('./routes/shelves');
const usersRoutes        = require('./routes/users');
const apiRoutes          = require('./routes/api');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── View engine ────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Static ─────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Body parser ────────────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ── Method override ────────────────────────────────────────────────────────
app.use(methodOverride('_method'));

// ── Health check — auth gerektirmez ────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'fuschia-stock-panel', uptime: Math.floor(process.uptime()) });
});

app.get('/health/db', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'connected' });
  } catch (err) {
    console.error('Health/db hatası:', err.message);
    res.status(503).json({ ok: false, db: 'error' });
  }
});

// ── Session ────────────────────────────────────────────────────────────────
const PgSession = connectPgSimple(session);

app.use(session({
  store: new PgSession({
    pool,
    tableName: 'session',
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET || 'fuschia-dev-secret-degistir',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 10 * 60 * 60 * 1000,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  },
}));

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/',               authRoutes);
app.use('/',               requireLogin, dashboardRoutes);
app.use('/roll-entry',     requireLogin, rollEntryRoutes);
app.use('/cutting-entry',  requireLogin, cuttingEntryRoutes);
app.use('/reports',        requireLogin, reportsRoutes);
app.use('/reports',        requireLogin, exportsRoutes);
app.use('/products',       requireLogin, requireAdmin, productsRoutes);
app.use('/shelves',        requireLogin, requireAdmin, shelvesRoutes);
app.use('/users',          requireLogin, requireAdmin, usersRoutes);
app.use('/api',            requireLogin, apiRoutes);

// ── 404 ────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Sayfa Bulunamadı',
    message: 'Aradığınız sayfa mevcut değil.',
    user: req.session,
  });
});

// ── Global hata handler ────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Uygulama hatası:', err);
  res.status(500).render('error', {
    title: 'Sunucu Hatası',
    message: 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.',
    user: req.session,
  });
});

// ── Başlat ─────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Fuschia Stok Paneli → http://localhost:${PORT}`);
  if (process.env.NODE_ENV !== 'production') {
    console.log('Health: http://localhost:' + PORT + '/health');
  }
});
