const crypto = require('crypto');
const { authCookieEnabled } = require('../config/authCookie');

// Protección CSRF con patrón double-submit cookie.
//
// Diseño defensivo (SIN lockout del flujo Bearer):
//  - Solo aplica a métodos que cambian estado (POST/PUT/PATCH/DELETE).
//  - Solo se ACTIVA cuando la request trae la cookie de sesión `token`. Si la
//    request no tiene esa cookie (p.ej. se autentica por Authorization: Bearer,
//    o es pública), NO se exige CSRF — Bearer no es vulnerable a CSRF.
//  - Rutas exentas explícitas (login/register/oauth/webhooks/cron).
//
// Al activarse exige: header `X-CSRF-Token` === cookie `csrfToken` (double-submit).

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Prefijos de ruta exentos. Se comparan contra req.path (montado a nivel app,
// por lo que incluye el prefijo /api).
const EXEMPT_PREFIXES = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/google',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/logout',           // logout siempre disponible => recuperación si el csrfToken se desincroniza
  '/api/payments/wompi/webhook', // webhook Wompi: valida su propia firma, sin auth de usuario
  '/api/cron',                  // cron: valida su propio secret
];

function isExempt(pathname) {
  for (const prefix of EXEMPT_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) return true;
  }
  return false;
}

// Comparación en tiempo constante para no filtrar información por timing.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function csrfProtection(req, res, next) {
  // Gate crítico: si el modo cookie no está habilitado (default), el CSRF es
  // completamente no-op. Sin este flag no se plantan cookies, por lo que no hay
  // nada que proteger y el flujo Bearer queda byte-idéntico al actual.
  if (!authCookieEnabled()) return next();

  // Métodos seguros: nunca requieren CSRF.
  if (SAFE_METHODS.has(req.method)) return next();

  // Rutas exentas.
  if (isExempt(req.path)) return next();

  // Solo hay riesgo CSRF si existe sesión por cookie. Sin cookie `token`
  // (típico del flujo Bearer o requests públicas) no exigimos CSRF.
  const cookieToken = req.cookies && req.cookies.token;
  if (!cookieToken) return next();

  // Sesión por cookie => double-submit obligatorio.
  const headerCsrf = req.headers['x-csrf-token'];
  const cookieCsrf = req.cookies && req.cookies.csrfToken;

  if (!headerCsrf || !cookieCsrf || !safeEqual(headerCsrf, cookieCsrf)) {
    console.warn('[csrf] 403 CSRF token mismatch', JSON.stringify({
      path: req.originalUrl, method: req.method, ts: new Date().toISOString(),
    }));
    return res.status(403).json({ error: 'CSRF token inválido o ausente' });
  }

  next();
}

module.exports = { csrfProtection, isExempt };
