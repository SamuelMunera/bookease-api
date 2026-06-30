const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/database');
const { getPlanLimit } = require('../config/plans');
const subscriptionService = require('./subscription.service');
const referralService = require('./referral.service');
const authService = require('./auth.service');

async function registerProfessional({ name, email, password, phone, specialty, bio, experience, businessId, offersHomeService, homeServiceArea, country, timezone, state, zipCode, referralCode }) {
  if (!name || !email || !password) throw new Error('name, email and password are required');
  if (password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres');

  const normalizedEmail = email.toLowerCase().trim();
  const existing = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    include: { professional: { select: { id: true } } },
  });
  // Linking seguro: si el correo ya pertenece a una identidad (p.ej. un dueño de
  // negocio), la misma persona puede añadir un perfil profesional, pero debe
  // probar que es ella con su contraseña actual. No se duplica el User ni se
  // trata el email como "tipo de cuenta".
  if (existing) {
    const ownsIdentity = await bcrypt.compare(password, existing.password);
    if (!ownsIdentity) {
      const err = new Error('Ese correo ya está registrado. Inicia sesión con tu contraseña para añadir tu perfil profesional.');
      err.status = 409;
      throw err;
    }
    if (existing.professional) {
      const err = new Error('Este correo ya tiene un perfil profesional.');
      err.status = 409;
      throw err;
    }
  }

  // Referral/courtesy code (only meaningful for independent professionals)
  const referral = await referralService.resolveReferralCode(referralCode);

  if (businessId) {
    const biz = await prisma.business.findUnique({
      where: { id: businessId },
      include: { professionals: { select: { id: true } } },
    });
    if (biz) {
      const limit = getPlanLimit(biz.plan ?? 'team');
      if (biz.professionals.length >= limit) {
        const err = new Error(`El negocio ha alcanzado el límite de su plan (${limit} profesional${limit !== 1 ? 'es' : ''}). Actualiza el plan para continuar.`);
        err.code = 'PLAN_LIMIT_EXCEEDED';
        throw err;
      }
    }
  }

  const proData = {
    name, phone, specialty, bio, experience,
    ...(businessId ? { businessId } : {}),
    ...(offersHomeService ? { offersHomeService: true } : {}),
    ...(homeServiceArea ? { homeServiceArea: JSON.stringify(homeServiceArea) } : {}),
    ...(country   ? { country } : {}),
    ...(timezone  ? { timezone } : {}),
    ...(state     ? { state } : {}),
    ...(zipCode   ? { zipCode } : {}),
    ...(referral?.type === 'PROMOTER' ? { promoterId: referral.promoterId } : {}),
  };

  let user;
  if (existing) {
    // Vincular un nuevo perfil profesional a la identidad ya existente, sin
    // tocar su contraseña ni su `role` primario (sigue siendo, p.ej., dueño).
    const professional = await prisma.professional.create({
      data: { ...proData, userId: existing.id },
      select: { id: true, businessId: true, specialty: true },
    });
    user = { id: existing.id, name: existing.name, email: existing.email, role: 'PROFESSIONAL', professional };
  } else {
    const hashed = await bcrypt.hash(password, 12);
    user = await prisma.user.create({
      data: {
        name, email: normalizedEmail, password: hashed, role: 'PROFESSIONAL',
        professional: { create: proData },
      },
      select: {
        id: true, name: true, email: true, role: true,
        professional: { select: { id: true, businessId: true, specialty: true } },
      },
    });
  }

  // El contexto activo recién creado es PROFESSIONAL. Si la identidad además es
  // dueña de un negocio, su token podrá alternar de contexto luego.
  const contexts = await authService.getUserContexts({ id: user.id, role: existing ? existing.role : 'PROFESSIONAL' });
  user.availableRoles = contexts;
  const token = jwt.sign({ id: user.id, role: 'PROFESSIONAL' }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

  // Solo professionals (no businessId) get their own subscription.
  // Awaited: a professional must never exist without a TRIALING subscription,
  // otherwise getBillingState() would treat them as payment_required immediately.
  if (!businessId && user.professional) {
    const proCountry = country || 'CO';
    await subscriptionService.createForProfessional(user.professional.id, 'solo', proCountry);
  }

  if (referral?.type === 'COURTESY' && user.professional) {
    // El plan regalado fue fijado por el admin al generar el código — se
    // aplica tal cual a la suscripción ya creada (TRIALING/'solo') de arriba.
    const courtesyPlan = await referralService.redeemCourtesyCode(referral.courtesyCodeId, { professionalId: user.professional.id });
    await subscriptionService.applyCourtesySubscription(user.professional.id, courtesyPlan);
  }

  if (referral?.type === 'PROMOTER' && user.professional) {
    await referralService.recordPromoterConversion({
      promoterId: referral.promoterId, promoterCode: referral.promoterCode, professionalId: user.professional.id,
    });
  }

  return { user, token };
}

/* ── Dueño que también atiende como profesional ───────────────────────────
 * El dueño usa SU MISMA identidad (userId). Activarse crea un Professional
 * ligado a su userId dentro de su propio negocio — sin segunda cuenta. Luego
 * configura disponibilidad/servicios con los endpoints self-service normales
 * (todos resuelven por userId) y aparece como reservable como cualquier otro.
 */
async function getOwnerProfessional(ownerId) {
  const business = await prisma.business.findFirst({ where: { ownerId }, select: { id: true } });
  if (!business) return { business: null, professional: null };
  const professional = await prisma.professional.findUnique({
    where: { userId: ownerId },
    select: { id: true, name: true, businessId: true, isBookable: true, avatarUrl: true, specialty: true },
  });
  return { business, professional: professional || null };
}

async function activateOwnerProfessional(ownerId) {
  const [owner, business] = await Promise.all([
    prisma.user.findUnique({ where: { id: ownerId }, select: { name: true } }),
    prisma.business.findFirst({ where: { ownerId }, include: { professionals: { select: { id: true } } } }),
  ]);
  if (!business) throw new Error('No tienes un negocio. Crea tu negocio antes de activarte como profesional.');

  const existing = await prisma.professional.findUnique({ where: { userId: ownerId } });
  if (existing) {
    // Idempotente: ya tiene perfil profesional.
    if (existing.businessId && existing.businessId !== business.id) {
      const err = new Error('Tu identidad ya tiene un perfil profesional en otro negocio.');
      err.status = 409;
      throw err;
    }
    // Si existía sin negocio (profesional independiente), se vincula a este y se
    // hace visible. Si ya estaba en este negocio, solo se asegura que sea visible.
    return prisma.professional.update({
      where: { id: existing.id },
      data: { businessId: business.id, isBookable: true },
      select: { id: true, name: true, businessId: true, isBookable: true },
    });
  }

  const limit = getPlanLimit(business.plan ?? 'team');
  if (business.professionals.length >= limit) {
    const err = new Error(`El plan del negocio permite máximo ${limit} profesional${limit !== 1 ? 'es' : ''}. Actualiza el plan para agregar más.`);
    err.code = 'PLAN_LIMIT_EXCEEDED';
    throw err;
  }

  return prisma.professional.create({
    data: { name: owner?.name || 'Profesional', userId: ownerId, businessId: business.id, isBookable: true },
    select: { id: true, name: true, businessId: true, isBookable: true },
  });
}

// Mostrar/ocultar al dueño-profesional en la vista pública de reservas, sin
// borrar su perfil, horarios ni servicios (reversible). No afecta su rol/auth.
async function setOwnerProfessionalBookable(ownerId, isBookable) {
  const business = await prisma.business.findFirst({ where: { ownerId }, select: { id: true } });
  if (!business) throw new Error('No tienes un negocio.');
  const prof = await prisma.professional.findUnique({ where: { userId: ownerId }, select: { id: true, businessId: true } });
  if (!prof || prof.businessId !== business.id) throw new Error('Aún no estás activado como profesional en tu negocio.');
  return prisma.professional.update({
    where: { id: prof.id },
    data: { isBookable: Boolean(isBookable) },
    select: { id: true, name: true, businessId: true, isBookable: true },
  });
}

async function getMyProfile(userId) {
  return prisma.professional.findUnique({
    where: { userId },
    include: {
      business: { select: { id: true, name: true, category: true, address: true, city: true } },
    },
  });
}
// bufferTime is included in the Professional model by default

async function getMyBookings(userId) {
  const prof = await prisma.professional.findUnique({ where: { userId } });
  if (!prof) throw new Error('Professional profile not found');
  return prisma.booking.findMany({
    where: { professionalId: prof.id, status: { not: 'CANCELLED' } },
    include: {
      client:       { select: { id: true, name: true, email: true } },
      professional: { select: { id: true, name: true } },
      service:      { select: { id: true, name: true, duration: true, price: true } },
    },
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
  });
}

async function getMyServices(userId) {
  const prof = await prisma.professional.findUnique({ where: { userId } });
  if (!prof) throw new Error('Professional profile not found');
  return prisma.professional.findUnique({
    where: { id: prof.id },
    select: { services: { select: { id: true, name: true, duration: true, price: true } } },
  }).then(p => p?.services ?? []);
}

async function setMyServices(userId, serviceIds) {
  const prof = await prisma.professional.findUnique({ where: { userId } });
  if (!prof) throw new Error('Professional profile not found');
  return prisma.professional.update({
    where: { id: prof.id },
    data: { services: { set: serviceIds.map(id => ({ id })) } },
    select: { services: { select: { id: true, name: true, duration: true, price: true } } },
  }).then(p => p.services);
}

async function getMySchedule(userId) {
  const prof = await prisma.professional.findUnique({ where: { userId } });
  if (!prof) throw new Error('Professional profile not found');
  return prisma.schedule.findMany({
    where: { professionalId: prof.id },
    orderBy: { dayOfWeek: 'asc' },
  });
}

function toMin(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }

function validateDay({ scheduleType = 'fulltime', startTime, endTime, secondStartTime, secondEndTime, isActive }) {
  if (!isActive) return;
  if (!startTime || !endTime) throw new Error('startTime y endTime son requeridos');
  if (toMin(startTime) >= toMin(endTime)) throw new Error(`Bloque 1: inicio debe ser anterior al fin (${startTime} >= ${endTime})`);
  if (scheduleType === 'part_time') {
    if (!secondStartTime || !secondEndTime) throw new Error('Turno partido requiere ambos bloques de horario');
    if (toMin(secondStartTime) >= toMin(secondEndTime)) throw new Error('Bloque 2: inicio debe ser anterior al fin');
    if (toMin(secondStartTime) < toMin(endTime)) throw new Error('El segundo bloque debe comenzar después de que termine el primero (sin solapamiento)');
  }
}

async function setMySchedule(userId, days) {
  const prof = await prisma.professional.findUnique({ where: { userId } });
  if (!prof) throw new Error('Professional profile not found');
  days.forEach(validateDay);
  const results = await Promise.all(
    days.map(({ dayOfWeek, startTime, endTime, isActive, scheduleType = 'fulltime', secondStartTime = null, secondEndTime = null }) => {
      const data = { startTime, endTime, isActive: isActive ?? true, scheduleType, secondStartTime, secondEndTime };
      return prisma.schedule.upsert({
        where: { professionalId_dayOfWeek: { professionalId: prof.id, dayOfWeek } },
        update: data,
        create: { professionalId: prof.id, dayOfWeek, ...data },
      });
    })
  );
  return results;
}

function parseDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

async function getWeekSchedule(userId, weekStart) {
  const prof = await prisma.professional.findUnique({ where: { userId } });
  if (!prof) throw new Error('Professional profile not found');
  const ws = parseDate(weekStart);
  const [recurring, overrides] = await Promise.all([
    prisma.schedule.findMany({ where: { professionalId: prof.id } }),
    prisma.scheduleOverride.findMany({ where: { professionalId: prof.id, weekStart: ws } }),
  ]);
  return [0,1,2,3,4,5,6].map(dow => {
    const ov  = overrides.find(o => o.dayOfWeek === dow);
    const rec = recurring.find(r => r.dayOfWeek === dow);
    if (ov) return {
      dayOfWeek: dow, startTime: ov.startTime, endTime: ov.endTime,
      isActive: ov.isActive, isOverride: true,
      scheduleType: ov.scheduleType ?? 'fulltime',
      secondStartTime: ov.secondStartTime ?? null,
      secondEndTime:   ov.secondEndTime   ?? null,
    };
    return {
      dayOfWeek: dow, startTime: rec?.startTime ?? '09:00', endTime: rec?.endTime ?? '18:00',
      isActive: rec?.isActive ?? false, isOverride: false,
      scheduleType: rec?.scheduleType ?? 'fulltime',
      secondStartTime: rec?.secondStartTime ?? null,
      secondEndTime:   rec?.secondEndTime   ?? null,
    };
  });
}

async function setWeekSchedule(userId, weekStart, days) {
  const prof = await prisma.professional.findUnique({ where: { userId } });
  if (!prof) throw new Error('Professional profile not found');
  days.forEach(validateDay);
  const ws = parseDate(weekStart);
  return Promise.all(days.map(({ dayOfWeek, startTime, endTime, isActive, scheduleType = 'fulltime', secondStartTime = null, secondEndTime = null }) => {
    const data = { startTime, endTime, isActive: isActive ?? true, scheduleType, secondStartTime, secondEndTime };
    return prisma.scheduleOverride.upsert({
      where: { professionalId_weekStart_dayOfWeek: { professionalId: prof.id, weekStart: ws, dayOfWeek } },
      update: data,
      create: { professionalId: prof.id, weekStart: ws, dayOfWeek, ...data },
    });
  }));
}

async function deleteWeekSchedule(userId, weekStart) {
  const prof = await prisma.professional.findUnique({ where: { userId } });
  if (!prof) throw new Error('Professional profile not found');
  const ws = parseDate(weekStart);
  await prisma.scheduleOverride.deleteMany({ where: { professionalId: prof.id, weekStart: ws } });
}

async function create(businessId, data) {
  const biz = await prisma.business.findUnique({
    where: { id: businessId },
    include: { professionals: { select: { id: true } } },
  });
  if (!biz) throw new Error('Business not found');
  const limit = getPlanLimit(biz.plan ?? 'team');
  if (biz.professionals.length >= limit) {
    const err = new Error(`El plan del negocio permite máximo ${limit} profesional${limit !== 1 ? 'es' : ''}. Actualiza el plan para agregar más.`);
    err.code = 'PLAN_LIMIT_EXCEEDED';
    throw err;
  }
  const allowed = ['name', 'bio', 'phone', 'specialty', 'experience'];
  const clean = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)));
  return prisma.professional.create({ data: { ...clean, businessId } });
}

async function findByBusiness(businessId) {
  // Solo campos públicos: nunca exponer userId, country, normalizaciones, etc.
  // isBookable=false oculta al profesional (p.ej. dueño que pausó su agenda).
  return prisma.professional.findMany({
    where: { businessId, isBookable: true },
    select: { id: true, name: true, bio: true, specialty: true, avatarUrl: true },
  });
}

async function findHomeProfessionals({ city, country } = {}) {
  const where = { offersHomeService: true };
  if (country) where.country = country;
  const rows = await prisma.professional.findMany({
    where,
    select: {
      id: true, name: true, specialty: true, bio: true, avatarUrl: true,
      homeServiceArea: true, homeServiceSurcharge: true, homeServiceNotes: true,
      businessId: true,
      homeServices: { where: { isActive: true }, select: { id: true, name: true, duration: true, price: true }, take: 3 },
      reviews: { select: { rating: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return rows
    .map(p => {
      const area = p.homeServiceArea ? JSON.parse(p.homeServiceArea) : null;
      const reviewCount = p.reviews.length;
      const avgRating = reviewCount > 0
        ? Math.round((p.reviews.reduce((s, r) => s + r.rating, 0) / reviewCount) * 10) / 10
        : null;
      return {
        id: p.id,
        name: p.name,
        specialty: p.specialty,
        bio: p.bio,
        avatarUrl: p.avatarUrl,
        cities: area?.cities ?? [],
        homeServiceSurcharge: p.homeServiceSurcharge,
        homeServiceNotes: p.homeServiceNotes,
        hasBusinessToo: !!p.businessId,
        homeServices: p.homeServices,
        avgRating,
        reviewCount,
      };
    })
    .filter(p => {
      if (!city) return true;
      if (p.cities.length === 0) return true; // no restriction = covers all
      return p.cities.some(c => c.toLowerCase().includes(city.toLowerCase()));
    });
}

async function findById(id) {
  return prisma.professional.findUnique({
    where: { id },
    include: {
      business: { select: { id: true, name: true } },
      photos: { orderBy: { createdAt: 'desc' } },
    },
    // offersHomeService, homeServiceArea included from model columns
  });
}

async function update(id, ownerId, data) {
  const prof = await prisma.professional.findUnique({
    where: { id },
    include: { business: { select: { ownerId: true } } },
  });
  if (!prof) throw new Error('Professional not found');
  if (!prof.business || prof.business.ownerId !== ownerId) throw new Error('Forbidden');
  const allowed = ['name', 'bio', 'phone', 'specialty', 'experience'];
  const clean = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)));
  return prisma.professional.update({ where: { id }, data: clean });
}

async function remove(id, ownerId) {
  const prof = await prisma.professional.findUnique({
    where: { id },
    include: { business: { select: { ownerId: true } } },
  });
  if (!prof) throw new Error('Professional not found');
  if (!prof.business || prof.business.ownerId !== ownerId) throw new Error('Forbidden');
  return prisma.professional.delete({ where: { id } });
}

async function getServiceConfigs(userId) {
  const prof = await prisma.professional.findUnique({ where: { userId } });
  if (!prof) throw new Error('Professional profile not found');
  return prisma.professionalServiceConfig.findMany({ where: { professionalId: prof.id } });
}

async function saveServiceConfigs(userId, configs) {
  // configs = [{ serviceId, customDuration }]
  const prof = await prisma.professional.findUnique({ where: { userId } });
  if (!prof) throw new Error('Professional profile not found');
  await Promise.all(
    configs.map(({ serviceId, customDuration }) =>
      prisma.professionalServiceConfig.upsert({
        where: { professionalId_serviceId: { professionalId: prof.id, serviceId } },
        create: { professionalId: prof.id, serviceId, customDuration: customDuration || null },
        update: { customDuration: customDuration || null },
      })
    )
  );
  return prisma.professionalServiceConfig.findMany({ where: { professionalId: prof.id } });
}

async function updateCancelPolicy(userId, cancelMinHours) {
  const pro = await prisma.professional.findUnique({ where: { userId } });
  if (!pro) throw new Error('Professional profile not found');
  return prisma.professional.update({
    where: { id: pro.id },
    data: { cancelMinHours: Math.max(0, parseInt(cancelMinHours, 10) || 0) },
  });
}

async function updateBufferTime(userId, bufferTime) {
  const prof = await prisma.professional.findUnique({ where: { userId } });
  if (!prof) throw new Error('Professional profile not found');
  return prisma.professional.update({
    where: { id: prof.id },
    data: { bufferTime: Math.max(0, parseInt(bufferTime, 10) || 0) },
  });
}

async function updateProfile(userId, data) {
  const prof = await prisma.professional.findUnique({ where: { userId } });
  if (!prof) throw new Error('Professional profile not found');
  // country se fija en el registro y no puede modificarse desde el perfil.
  const allowed = ['name', 'bio', 'phone', 'specialty', 'experience', 'avatarUrl', 'timezone', 'state', 'zipCode'];
  const clean = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)));
  return prisma.professional.update({ where: { id: prof.id }, data: clean });
}

async function getPhotos(userId) {
  const prof = await prisma.professional.findUnique({ where: { userId } });
  if (!prof) throw new Error('Professional profile not found');
  return prisma.professionalPhoto.findMany({
    where: { professionalId: prof.id },
    orderBy: { createdAt: 'desc' },
  });
}

async function addPhoto(userId, url, caption) {
  const prof = await prisma.professional.findUnique({ where: { userId } });
  if (!prof) throw new Error('Professional profile not found');
  return prisma.professionalPhoto.create({
    data: { professionalId: prof.id, url, caption: caption || null },
  });
}

async function deletePhoto(userId, photoId) {
  const prof = await prisma.professional.findUnique({ where: { userId } });
  if (!prof) throw new Error('Professional profile not found');
  const photo = await prisma.professionalPhoto.findFirst({
    where: { id: photoId, professionalId: prof.id },
  });
  if (!photo) throw new Error('Foto no encontrada');
  await prisma.professionalPhoto.delete({ where: { id: photoId } });
}

async function unlinkBusiness(userId) {
  const prof = await prisma.professional.findUnique({ where: { userId } });
  if (!prof) throw new Error('Professional profile not found');
  if (!prof.businessId) throw new Error('No estás vinculado a ningún negocio');
  return prisma.professional.update({
    where: { id: prof.id },
    data: { businessId: null },
  });
}

module.exports = { findHomeProfessionals, registerProfessional, getMyProfile, getMyBookings, getMyServices, setMyServices, getMySchedule, setMySchedule, getWeekSchedule, setWeekSchedule, deleteWeekSchedule, create, findByBusiness, findById, update, remove, getServiceConfigs, saveServiceConfigs, updateBufferTime, updateCancelPolicy, updateProfile, unlinkBusiness, getPhotos, addPhoto, deletePhoto, getOwnerProfessional, activateOwnerProfessional, setOwnerProfessionalBookable };
