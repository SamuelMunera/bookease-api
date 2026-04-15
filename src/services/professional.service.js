const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/database');

async function registerProfessional({ name, email, password, phone, specialty, bio, experience, businessId }) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new Error('Email already registered');

  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business) throw new Error('Business not found');

  const hashed = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      name, email, password: hashed, role: 'PROFESSIONAL',
      professional: {
        create: { name, phone, specialty, bio, experience, businessId },
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

async function getMyBookings(userId) {
  const prof = await prisma.professional.findUnique({ where: { userId } });
  if (!prof) throw new Error('Professional profile not found');
  return prisma.booking.findMany({
    where: { professionalId: prof.id, status: { not: 'CANCELLED' } },
    include: {
      client:  { select: { id: true, name: true, email: true } },
      service: { select: { id: true, name: true, duration: true, price: true } },
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

async function create(businessId, data) {
  return prisma.professional.create({ data: { ...data, businessId } });
}

async function findByBusiness(businessId) {
  return prisma.professional.findMany({ where: { businessId } });
}

async function findById(id) {
  return prisma.professional.findUnique({
    where: { id },
    include: { business: { select: { id: true, name: true } } },
  });
}

async function update(id, data) {
  return prisma.professional.update({ where: { id }, data });
}

async function remove(id) {
  return prisma.professional.delete({ where: { id } });
}

module.exports = { registerProfessional, getMyProfile, getMyBookings, getMyServices, setMyServices, getMySchedule, setMySchedule, create, findByBusiness, findById, update, remove };
