const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const prisma = require('../config/database');
const { getResend, FROM } = require('../config/email');

async function register({ name, email, password, role }) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new Error('Email already registered');

  const hashed = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { name, email, password: hashed, role },
    select: { id: true, name: true, email: true, role: true },
  });

  const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });

  return { user, token };
}

async function login({ email, password }) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error('Invalid credentials');

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) throw new Error('Invalid credentials');

  const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });

  return {
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    token,
  };
}

async function changePassword(userId, { currentPassword, newPassword }) {
  if (!newPassword || newPassword.length < 6) {
    throw new Error('La nueva contraseña debe tener al menos 6 caracteres');
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('Usuario no encontrado');

  const valid = await bcrypt.compare(currentPassword, user.password);
  if (!valid) throw new Error('Contraseña actual incorrecta');

  const hashed = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: userId }, data: { password: hashed } });
}

async function forgotPassword(email) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return; // no revelar si existe

  await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

  await prisma.passwordResetToken.create({
    data: { token, userId: user.id, expiresAt },
  });

  const frontendUrl = process.env.FRONTEND_URL || 'https://bookease-client-mu.vercel.app';
  const resetUrl = `${frontendUrl}/reset-password?token=${token}`;

  try {
    const resend = getResend();
    await resend.emails.send({
      from: FROM,
      to: email,
      subject: 'Recuperar contraseña · Bookease',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
          <h2 style="color:#7c3aed">Recuperar contraseña</h2>
          <p>Hola <strong>${user.name}</strong>,</p>
          <p>Recibimos una solicitud para restablecer tu contraseña. Haz clic en el botón para continuar:</p>
          <a href="${resetUrl}" style="display:inline-block;background:#7c3aed;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">
            Restablecer contraseña
          </a>
          <p style="color:#888;font-size:13px">Este enlace expira en 1 hora. Si no solicitaste esto, ignora este correo.</p>
        </div>
      `,
    });
  } catch (e) {
    // no exponer error de email al cliente
    console.error('Email send error:', e.message);
  }
}

async function resetPassword(token, newPassword) {
  if (!newPassword || newPassword.length < 6) {
    throw new Error('La contraseña debe tener al menos 6 caracteres');
  }

  const record = await prisma.passwordResetToken.findUnique({ where: { token } });
  if (!record) throw new Error('Token inválido o expirado');
  if (record.used) throw new Error('Token ya utilizado');
  if (record.expiresAt < new Date()) throw new Error('Token expirado');

  const hashed = await bcrypt.hash(newPassword, 10);
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { password: hashed } }),
    prisma.passwordResetToken.update({ where: { token }, data: { used: true } }),
  ]);
}

module.exports = { register, login, changePassword, forgotPassword, resetPassword };
