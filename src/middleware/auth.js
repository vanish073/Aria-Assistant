'use strict';

/**
 * Require authenticated session
 */
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Unauthorized. Please login via /auth/google' });
    }
    return res.redirect('/auth/google');
  }
  next();
}

/**
 * Require a specific role (admin | user | readonly)
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!roles.includes(req.session.role)) {
      return res.status(403).json({ error: `Forbidden. Required role: ${roles.join(' or ')}` });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
