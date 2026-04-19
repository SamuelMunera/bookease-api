const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/database');

async function registerProfessional({ name, email, password, phone, specialty, bio, experience, businessId }) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new Error('Email already registered');

  const hashed = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      name, email, password: hashed, role: 'PROFESSIONAL',
      professional: {
        create: { name, phone, specialty, bio, experience, ...(businessId ? { businessId } : {}) },
      },
    },
    select: {
      id: true, name: true, email: true, role: true,
      professional: { select: { id: true, businessId: true, specialty: true } },
    },
  });

  const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });

  return { user, token };
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

async function setMySchedule(userId, days) {
  // days: [{ dayOfWeek, startTime, endTime, isActive }]
  const prof = await prisma.professional.findUnique({ where: { userId } });
  if (!prof) throw new Error('Professional profile not found');
  const results = await Promise.all(
    days.map(({ dayOfWeek, startTime, endTime, isActive }) =>
      prisma.schedule.upsert({
        where: { professionalId_dayOfWeek: { professionalId: prof.id, dayOfWeek } },
        update: { startTime, endTime, isActive: isActive ?? true },
        create: { professionalId: prof.id, dayOfWeek, startTime, endTime, isActive: isActive ?? true },
      })
    )
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
    if (ov) return { dayOfWeek: dow, startTime: ov.startTime, endTime: ov.endTime, isActive: ov.isActive, isOverride: true };
    return { dayOfWeek: dow, startTime: rec?.startTime ?? '09:00', endTime: rec?.endTime ?? '18:00', isActive: rec?.isActive ?? false, isOverride: false };
  });
}

async function setWeekSchedule(userId, weekStart, days) {
  const prof = await prisma.professional.findUnique({ where: { userId } });
  if (!prof) throw new Error('Professional profile not found');
  const ws = parseDate(weekStart);
  return Promise.all(days.map(({ dayOfWeek, startTime, endTime, isActive }) =>
    prisma.scheduleOverride.upsert({
      where: { professionalId_weekStart_dayOfWeek: { professionalId: prof.id, weekStart: ws, dayOfWeek } },
      update: { startTime, endTime, isActive: isActive ?? true },
      create: { professionalId: prof.id, weekStart: ws, dayOfWeek, startTime, endTime, isActive: isActive ?? true },
    })
  ));
}

async function deleteWeekSchedule(userId, weekStart) {
  const prof = await prisma.professional.findUnique({ where: { userId } });
  if (!prof) throw new Error('Professional profile not found');
  const ws = parseDate(weekStart);
  await prisma.scheduleOverride.deleteMany({ where: { professionalId: prof.id, weekStart: ws } });
}

async function create(businessId, data) {
  return prisma.professional.create({ data: { ...data, businessId } });
}

async function findByBusiness(businessId) {
  return prisma.professional.findMany({ where: { businessId } });
}

async function findById(id) {
  return prisma.professional.findUnique({
    where: { id },
    include: {
      business: { select: { id: true, name: true } },
      photos: { orderBy: { createdAt: 'desc' } },
    },
  });
}

async function update(id, data) {
  return prisma.professional.update({ where: { id }, data });
}

async function remove(id) {
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
  const allowed = ['name', 'bio', 'phone', 'specialty', 'experience', 'avatarUrl'];
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

module.exports = { registerProfessional, getMyProfile, getMyBookings, getMyServices, setMyServices, getMySchedule, setMySchedule, getWeekSchedule, setWeekSchedule, deleteWeekSchedule, create, findByBusiness, findById, update, remove, getServiceConfigs, saveServiceConfigs, updateBufferTime, updateProfile, unlinkBusiness, getPhotos, addPhoto, deletePhoto };
