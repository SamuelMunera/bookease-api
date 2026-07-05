const crypto = require('crypto');

// Configuración de cookies de autenticación (HttpOnly) + CSRF (double-submit).
// ADITIVO: no reemplaza el flujo Bearer; solo añade cookies en paralelo.

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Flag de servidor que gatea TODO el comportamiento cookie+CSRF.
// Default OFF: solo `AUTH_COOKIE_ENABLED === 'true'` habilita el modo cookie.
// Con el flag OFF no se plantan cookies y el CSRF es no-op => comportamiento
// byte-idéntico al flujo Bearer actual (cero riesgo de lockout).
function authCookieEnabled() {
  return process.env.AUTH_COOKIE_ENABLED === 'true';
}

// Parsea JWT_EXPIRES_IN (p.ej. '7d', '12h', '30m', '3600s', o número en segundos)
// a milisegundos. Si no es parseable, cae a 7 días.
function parseExpiresToMs(raw) {
  if (!raw) return SEVEN_DAYS_MS;
  const str = String(raw).trim();

  // Número puro => segundos (convención de jsonwebtoken)
  if (/^\d+$/.test(str)) {
    return parseInt(str, 10) * 1000;
  }

  const m = /^(\d+)\s*(ms|s|m|h|d|w|y)$/i.exec(str);
  if (!m) return SEVEN_DAYS_MS;
  const value = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  const unitMs = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    y: 365 * 24 * 60 * 60 * 1000,
  }[unit];
  if (!unitMs || !Number.isFinite(value) || value <= 0) return SEVEN_DAYS_MS;
  return value * unitMs;
}

// Atributos comunes a ambas cookies. Se calculan por-llamada para respetar
// cambios de env en tests, pero son baratos.
function baseCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  const opts = {
    path: '/',
    secure: isProd, // Secure solo en producción (localhost usa http)
    sameSite: process.env.COOKIE_SAMESITE || 'Lax',
    maxAge: parseExpiresToMs(process.env.JWT_EXPIRES_IN),
  };
  // Domain host-only si no se define COOKIE_DOMAIN
  if (process.env.COOKIE_DOMAIN) opts.domain = process.env.COOKIE_DOMAIN;
  return opts;
}

function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Setea la cookie `token` (HttpOnly) y una cookie `csrfToken` legible por JS.
// Devuelve el valor CSRF generado por si el caller quiere usarlo.
function setAuthCookies(res, token) {
  // Gate crítico: si el modo cookie no está habilitado, NO plantar ninguna
  // cookie. Así, con el frontend en modo Bearer (default), la cookie `token`
  // nunca se envía y csrfProtection nunca se activa.
  if (!authCookieEnabled()) return undefined;

  const base = baseCookieOptions();

  // Cookie de auth: HttpOnly
  res.cookie('token', token, { ...base, httpOnly: true });

  // Cookie CSRF: NO HttpOnly (el cliente debe leerla para reenviarla en header)
  const csrfToken = generateCsrfToken();
  res.cookie('csrfToken', csrfToken, { ...base, httpOnly: false });

  return csrfToken;
}

// Limpia ambas cookies. Debe usar los MISMOS atributos (path/domain/sameSite/
// secure) que al setearlas, si no el navegador no las borra.
function clearAuthCookies(res) {
  const isProd = process.env.NODE_ENV === 'production';
  const opts = {
    path: '/',
    secure: isProd,
    sameSite: process.env.COOKIE_SAMESITE || 'Lax',
  };
  if (process.env.COOKIE_DOMAIN) opts.domain = process.env.COOKIE_DOMAIN;

  res.clearCookie('token', { ...opts, httpOnly: true });
  res.clearCookie('csrfToken', { ...opts, httpOnly: false });
}

module.exports = { setAuthCookies, clearAuthCookies, generateCsrfToken, parseExpiresToMs, authCookieEnabled };
