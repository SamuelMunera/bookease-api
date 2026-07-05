const authService = require('../services/auth.service');
const { setAuthCookies, clearAuthCookies } = require('../config/authCookie');

async function register(req, res) {
  try {
    const result = await authService.register(req.body);
    // ADITIVO: emitir cookies (auth HttpOnly + csrf). El body sigue devolviendo
    // {user, token} para no romper el flujo Bearer existente.
    if (result && result.token) setAuthCookies(res, result.token);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

const VALID_AUDIENCES = ['client', 'pro', 'admin'];
const VALID_CONTEXTS = ['CLIENT', 'BUSINESS_OWNER', 'PROFESSIONAL', 'ADMIN'];

async function login(req, res) {
  try {
    const { email, password, audience, context } = req.body;
    if (audience !== undefined && !VALID_AUDIENCES.includes(audience)) {
      return res.status(400).json({ error: 'audience inválido' });
    }
    if (context !== undefined && !VALID_CONTEXTS.includes(context)) {
      return res.status(400).json({ error: 'context inválido' });
    }
    const result = await authService.login({ email, password, audience, context });
    if (result && result.token) setAuthCookies(res, result.token);
    res.json(result);
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message });
  }
}

// Cambia el contexto activo (negocio/profesional/…) de la identidad autenticada.
async function switchContext(req, res) {
  try {
    const { role } = req.body;
    if (!VALID_CONTEXTS.includes(role)) {
      return res.status(400).json({ error: 'role inválido' });
    }
    const result = await authService.switchContext(req.user.id, role);
    // El token cambia al cambiar de contexto: refrescar cookies (y rotar CSRF).
    if (result && result.token) setAuthCookies(res, result.token);
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
}

async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'currentPassword y newPassword son requeridos' });
    }
    await authService.changePassword(req.user.id, { currentPassword, newPassword });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function forgotPassword(req, res) {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email es requerido' });
    await authService.forgotPassword(email);
    res.json({ ok: true, message: 'Si el correo existe, recibirás un enlace de recuperación.' });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
}

async function resetPassword(req, res) {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: 'token y newPassword son requeridos' });
    await authService.resetPassword(token, newPassword);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function googleAuth(req, res) {
  try {
    const { accessToken, role } = req.body;
    if (!accessToken) return res.status(400).json({ error: 'accessToken requerido' });
    const result = await authService.googleAuth(accessToken, role);
    if (result && result.token) setAuthCookies(res, result.token);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function updateMe(req, res) {
  try {
    const { phone, country } = req.body;
    const prisma = require('../config/database');
    const data = {};
    if (phone !== undefined) data.phone = phone || null;
    if (country !== undefined && ['CO', 'US'].includes(country?.toUpperCase())) {
      data.country = country.toUpperCase();
    }
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data,
      select: { id: true, name: true, email: true, role: true, phone: true, country: true },
    });
    res.json({ user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

// Cierra la sesión por cookie: limpia auth + csrf. Idempotente; el flujo Bearer
// no depende de esto (el cliente Bearer simplemente descarta su token).
async function logout(_req, res) {
  clearAuthCookies(res);
  res.status(200).json({ ok: true });
}

module.exports = { register, login, switchContext, changePassword, forgotPassword, resetPassword, googleAuth, updateMe, logout };
