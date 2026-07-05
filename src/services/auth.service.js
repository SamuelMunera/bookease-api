const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const prisma = require('../config/database');
const { getResend, FROM } = require('../config/email');

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

async function register({ name, email, password, role, phone, country }) {
  if (!name || !email || !password) throw new Error('name, email and password are required');
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100)
    throw new Error('El nombre debe tener entre 2 y 100 caracteres');
  if (typeof email !== 'string' || email.length > 254 || !EMAIL_RE.test(email.trim()))
    throw new Error('Email inválido');
  if (password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres');
  if (password.length > 128) throw new Error('Contraseña demasiado larga');

  const ALLOWED_ROLES = ['CLIENT', 'BUSINESS_OWNER'];
  const safeRole = ALLOWED_ROLES.includes(role?.toUpperCase()) ? role.toUpperCase() : 'CLIENT';
  const safeCountry = ['CO', 'US'].includes(country?.toUpperCase()) ? country.toUpperCase() : 'CO';

  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (existing) throw new Error('Email already registered');

  const hashed = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { name: name.trim(), email: email.toLowerCase().trim(), password: hashed, role: safeRole, country: safeCountry, ...(phone ? { phone } : {}) },
    select: { id: true, name: true, email: true, role: true, country: true },
  });

  const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

  return { user, token };
}

// Mapea cada "audience" (acceso del frontend) a los roles permitidos.
const AUDIENCE_ROLES = {
  client: ['CLIENT'],
  pro: ['BUSINESS_OWNER', 'PROFESSIONAL'],
  admin: ['ADMIN'],
};

// La identidad (User + email) es única, pero una misma persona puede operar en
// varios contextos. Los contextos se DERIVAN de las relaciones, no del email:
// dueño de un negocio => BUSINESS_OWNER, perfil profesional => PROFESSIONAL.
// Se respeta además el `role` primario almacenado para no romper onboarding
// (p.ej. un BUSINESS_OWNER que aún no creó su negocio).
async function getUserContexts(user) {
  const roles = new Set();
  if (user.role === 'CLIENT') roles.add('CLIENT');
  if (user.role === 'ADMIN') roles.add('ADMIN');
  if (user.role === 'BUSINESS_OWNER') roles.add('BUSINESS_OWNER');
  if (user.role === 'PROFESSIONAL') roles.add('PROFESSIONAL');

  const [bizCount, prof] = await Promise.all([
    prisma.business.count({ where: { ownerId: user.id } }),
    prisma.professional.findUnique({ where: { userId: user.id }, select: { id: true } }),
  ]);
  if (bizCount > 0) roles.add('BUSINESS_OWNER');
  if (prof) roles.add('PROFESSIONAL');

  return [...roles];
}

function signToken(userId, role) {
  return jwt.sign({ id: userId, role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

async function login({ email, password, audience, context }) {
  const normalizedEmail = typeof email === 'string' ? email.toLowerCase().trim() : '';
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user) throw new Error('Invalid credentials');

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) throw new Error('Invalid credentials');

  const contexts = await getUserContexts(user);

  // El acceso (audience) acota los contextos elegibles a los suyos.
  // Sin audience se mantiene compatibilidad con llamadas existentes.
  let candidates = contexts;
  if (audience) {
    const allowed = AUDIENCE_ROLES[audience] || [];
    candidates = contexts.filter((r) => allowed.includes(r));
    if (candidates.length === 0) {
      const err = new Error('Esta cuenta no corresponde a este acceso. Usa el inicio de sesión correcto.');
      err.status = 403;
      throw err;
    }
  }

  // Determinar el contexto activo con el que se emite la sesión.
  let activeRole;
  if (context && candidates.includes(context)) {
    activeRole = context;
  } else if (candidates.length === 1) {
    activeRole = candidates[0];
  } else if (candidates.length > 1) {
    // La identidad tiene varios contextos válidos para este acceso: que elija.
    return {
      needsContext: true,
      availableRoles: candidates,
      user: { id: user.id, name: user.name, email: user.email },
    };
  } else {
    activeRole = user.role; // legacy fallback (sin audience, sin relaciones)
  }

  return {
    user: { id: user.id, name: user.name, email: user.email, role: activeRole, country: user.country, availableRoles: contexts },
    token: signToken(user.id, activeRole),
  };
}

// Cambio de contexto para una identidad ya autenticada. Solo permite activar un
// contexto que el usuario realmente posee (sin heredar permisos sin control).
async function switchContext(userId, role) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('Usuario no encontrado');
  const contexts = await getUserContexts(user);
  if (!contexts.includes(role)) {
    const err = new Error('No tienes acceso a ese contexto.');
    err.status = 403;
    throw err;
  }
  return {
    user: { id: user.id, name: user.name, email: user.email, role, country: user.country, availableRoles: contexts },
    token: signToken(user.id, role),
  };
}

async function changePassword(userId, { currentPassword, newPassword }) {
  if (!newPassword || newPassword.length < 8 || newPassword.length > 128) {
    throw new Error('La nueva contraseña debe tener entre 8 y 128 caracteres');
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('Usuario no encontrado');

  const valid = await bcrypt.compare(currentPassword, user.password);
  if (!valid) throw new Error('Contraseña actual incorrecta');

  const hashed = await bcrypt.hash(newPassword, 12);
  // S-005: registrar el instante del cambio para revocar los JWT emitidos antes
  // (el middleware authenticate compara iat del token contra passwordChangedAt).
  await prisma.user.update({ where: { id: userId }, data: { password: hashed, passwordChangedAt: new Date() } });
}

async function forgotPassword(email) {
  const normalizedEmail = typeof email === 'string' ? email.toLowerCase().trim() : '';
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user) return; // no revelar si existe

  await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

  await prisma.passwordResetToken.create({
    data: { token, userId: user.id, expiresAt },
  });

  const frontendUrl = process.env.FRONTEND_URL || process.env.CLIENT_URL || 'https://slotly.com.co';
  const resetUrl = `${frontendUrl}/reset-password?token=${token}`;

  try {
    const resend = getResend();
    await resend.emails.send({
      from: FROM,
      to: email,
      subject: 'Recuperar contraseña · Slotly',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
          <h2 style="color:#7c3aed">Recuperar contraseña</h2>
          <p>Hola <strong>${escHtml(user.name)}</strong>,</p>
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
  if (!newPassword || newPassword.length < 8 || newPassword.length > 128) {
    throw new Error('La contraseña debe tener entre 8 y 128 caracteres');
  }

  const record = await prisma.passwordResetToken.findUnique({ where: { token } });
  if (!record) throw new Error('Token inválido o expirado');
  if (record.used) throw new Error('Token ya utilizado');
  if (record.expiresAt < new Date()) throw new Error('Token expirado');

  const hashed = await bcrypt.hash(newPassword, 12);
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { password: hashed } }),
    prisma.passwordResetToken.update({ where: { token }, data: { used: true } }),
  ]);
}

async function googleAuth(accessToken, role = 'CLIENT') {
  const clientId = process.env.GOOGLE_CLIENT_ID;

  // Validate token with Google and fetch user info in parallel
  const [tokenInfo, userInfo] = await Promise.all([
    fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${accessToken}`).then(r => r.json()),
    fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    }).then(r => r.json()),
  ]);

  if (tokenInfo.error) throw new Error('Token de Google inválido');

  // If GOOGLE_CLIENT_ID is set, always enforce audience check to prevent token substitution attacks
  if (clientId && tokenInfo.aud !== clientId && tokenInfo.azp !== clientId) {
    throw new Error('Token de Google inválido');
  }
  if (!clientId) {
    // S-008: fail-fast en producción — sin GOOGLE_CLIENT_ID el audience check se
    // omitiría y el token podría ser sustituido por uno de otra app. En dev solo
    // avisamos (igual que JWT_SECRET/ALLOWED_ORIGIN).
    if (process.env.NODE_ENV === 'production') {
      throw new Error('GOOGLE_CLIENT_ID no está configurado: no se puede validar el audience del token de Google');
    }
    console.warn('[auth] GOOGLE_CLIENT_ID not set — audience check skipped. Set it in production.');
  }

  // Require verified email to prevent account linking with unverified addresses
  if (!userInfo.email_verified) throw new Error('El email de Google no está verificado');

  const { sub: googleId, email, name } = userInfo;
  const VALID_ROLES = ['CLIENT', 'PROFESSIONAL', 'BUSINESS_OWNER'];
  const effectiveRole = VALID_ROLES.includes(role?.toUpperCase()) ? role.toUpperCase() : 'CLIENT';

  let user = await prisma.user.findUnique({
    where: { googleId },
    select: { id: true, name: true, email: true, role: true },
  });
  let isNew = false;

  if (!user) {
    const byEmail = await prisma.user.findUnique({ where: { email } });
    if (byEmail) {
      user = await prisma.user.update({
        where: { id: byEmail.id },
        data: { googleId },
        select: { id: true, name: true, email: true, role: true },
      });
    } else {
      isNew = true;
      user = await prisma.user.create({
        data: {
          email, name, googleId, role: effectiveRole,
          password: 'GOOGLE_' + crypto.randomBytes(16).toString('hex'),
        },
        select: { id: true, name: true, email: true, role: true },
      });
    }
  }

  // Linking seguro de contexto profesional sobre una identidad Google (nueva o
  // existente, p.ej. un dueño de negocio): Google ya prueba la propiedad del
  // correo, así que no se requiere contraseña. Misma persona, mismo email,
  // distinto contexto — sin duplicar la cuenta.
  if (effectiveRole === 'PROFESSIONAL') {
    const prof = await prisma.professional.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!prof) {
      const created = await prisma.professional.create({ data: { name, userId: user.id }, select: { id: true } });
      try {
        const subscriptionService = require('./subscription.service');
        await subscriptionService.createForProfessional(created.id, 'solo', 'CO');
      } catch (e) {
        console.error('[googleAuth] subscription create:', e.message);
      }
    }
  }

  // El contexto activo es el solicitado si la identidad realmente lo posee; si
  // no, su rol primario. El token sigue llevando un único rol activo.
  const contexts = await getUserContexts(user);
  const activeRole = contexts.includes(effectiveRole) ? effectiveRole : (contexts[0] || user.role);

  return {
    user: { id: user.id, name: user.name, email: user.email, role: activeRole, availableRoles: contexts },
    token: signToken(user.id, activeRole),
    isNew,
  };
}

module.exports = { register, login, changePassword, forgotPassword, resetPassword, googleAuth, switchContext, getUserContexts };
