const jwt = require('jsonwebtoken');
const prisma = require('../config/database');

// S-005: cache mínimo en memoria para no consultar la DB en cada request.
// Guardamos únicamente passwordChangedAt por userId con un TTL corto; el peor
// caso tras cambiar contraseña es que un token viejo siga válido durante TTL_MS.
const TTL_MS = 30 * 1000;
const pwdChangedCache = new Map(); // userId -> { value: number|null, exp: number }

// LOW: the cache never evicted, so it leaked slowly in long-lived processes.
// On write, if we exceed MAX_CACHE_ENTRIES, purge expired entries; if still at
// capacity (all live), drop the oldest inserted key (Map preserves insertion
// order). Purely a memory bound — revocation logic below is unchanged.
const MAX_CACHE_ENTRIES = 5000;

function setPasswordChangedCache(userId, entry) {
  if (pwdChangedCache.size >= MAX_CACHE_ENTRIES) {
    const now = Date.now();
    for (const [key, cached] of pwdChangedCache) {
      if (cached.exp <= now) pwdChangedCache.delete(key);
    }
    if (pwdChangedCache.size >= MAX_CACHE_ENTRIES) {
      const oldest = pwdChangedCache.keys().next().value;
      if (oldest !== undefined) pwdChangedCache.delete(oldest);
    }
  }
  pwdChangedCache.set(userId, entry);
}

async function getPasswordChangedAt(userId) {
  const now = Date.now();
  const cached = pwdChangedCache.get(userId);
  if (cached && cached.exp > now) return cached.value;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, passwordChangedAt: true },
  });
  if (!user) return undefined; // usuario inexistente -> token inválido
  const value = user.passwordChangedAt ? user.passwordChangedAt.getTime() : null;
  setPasswordChangedCache(userId, { value, exp: now + TTL_MS });
  return value;
}

async function authenticate(req, res, next) {
  // Prioridad: Authorization Bearer (flujo original) cuando está presente.
  // Fallback: cookie de sesión `token` (HttpOnly) solo si no hay Bearer. Así un
  // Bearer válido nunca queda ensombrecido por una cookie obsoleta. Marcamos en
  // req.authViaCookie para que el middleware CSRF sepa si la auth vino por cookie.
  let token;
  let authViaCookie = false;
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    token = header.split(' ')[1];
  } else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
    authViaCookie = true;
  } else {
    return res.status(401).json({ error: 'Token required' });
  }
  req.authViaCookie = authViaCookie;

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    console.warn('[auth] 401 invalid token', JSON.stringify({
      path: req.originalUrl, method: req.method, reason: err.message, ts: new Date().toISOString(),
    }));
    return res.status(401).json({ error: 'Invalid token' });
  }

  // S-005: revocar tokens emitidos antes de un cambio de contraseña. El JWT
  // incluye `iat` (segundos). Si iat < passwordChangedAt, el token es obsoleto.
  try {
    const passwordChangedAt = await getPasswordChangedAt(decoded.id);
    if (passwordChangedAt === undefined) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (passwordChangedAt !== null && typeof decoded.iat === 'number' && decoded.iat * 1000 < passwordChangedAt) {
      console.warn('[auth] 401 token revoked by password change', JSON.stringify({
        userId: decoded.id, path: req.originalUrl, method: req.method, ts: new Date().toISOString(),
      }));
      return res.status(401).json({ error: 'Token expired, please log in again' });
    }
  } catch (err) {
    console.error('[auth] password-change check failed', err.message);
    return res.status(401).json({ error: 'Invalid token' });
  }

  req.user = decoded;
  next();
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
