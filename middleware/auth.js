function requireLogin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.redirect('/login');
  }
  if (req.session.userRole !== 'admin') {
    return res.status(403).render('error', {
      title: 'Erişim Engellendi',
      message: 'Bu sayfaya erişim için yönetici yetkisi gereklidir.',
      user: req.session
    });
  }
  next();
}

module.exports = { requireLogin, requireAdmin };
