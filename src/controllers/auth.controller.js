const authService = require('../services/auth.service');

async function register(req, res) {
  try {
    const result = await authService.register(req.body);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function login(req, res) {
  try {
    const result = await authService.login(req.body);
    res.json(result);
  } catch (err) {
    res.status(401).json({ error: err.message });
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

module.exports = { register, login, changePassword, forgotPassword, resetPassword, googleAuth, updateMe };
