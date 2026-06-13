const jwt = require('jsonwebtoken');

function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token required' });
  }

  const token = header.split(' ')[1];
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    console.warn('[auth] 401 invalid token', JSON.stringify({
      path: req.originalUrl, method: req.method, reason: err.message, ts: new Date().toISOString(),
    }));
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      console.warn('[auth] 403 role mismatch', JSON.stringify({
        userId: req.user.id, userRole: req.user.role, required: roles,
        path: req.originalUrl, method: req.method, ts: new Date().toISOString(),
      }));
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

module.exports = { authenticate, requireRole };
