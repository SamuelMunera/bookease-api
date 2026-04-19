const prisma = require('../config/database');

const BUSINESS_EDITABLE = ['name', 'description', 'address', 'city', 'phone', 'category'];

async function create(ownerId, data) {
  const clean = Object.fromEntries(Object.entries(data).filter(([k]) => BUSINESS_EDITABLE.includes(k)));
  return prisma.business.create({ data: { ...clean, ownerId } });
}

async function findAll({ category, city } = {}) {
  return prisma.business.findMany({
    where: {
      ...(category && { category }),
      ...(city && { city: { contains: city, mode: 'insensitive' } }),
    },
    include: { professionals: true, services: true },
  });
}

async function findById(id) {
  return prisma.business.findUnique({
    where: { id },
    include: { professionals: true, services: true },
  });
}

async function getMyBusiness(ownerId) {
  return prisma.business.findFirst({
    where: { ownerId },
    include: { professionals: true, services: true },
  });
}

async function updateProfile(ownerId, data) {
  const business = await prisma.business.findFirst({ where: { ownerId } });
  if (!business) throw new Error('Negocio no encontrado');
  const allowed = ['name', 'description', 'address', 'city', 'phone', 'category', 'logoUrl'];
  const clean = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)));
  return prisma.business.update({ where: { id: business.id }, data: clean });
}

async function update(id, ownerId, data) {
  const clean = Object.fromEntries(Object.entries(data).filter(([k]) => BUSINESS_EDITABLE.includes(k)));
  return prisma.business.update({ where: { id, ownerId }, data: clean });
}

async function remove(id, ownerId) {
  return prisma.business.delete({ where: { id, ownerId } });
}

module.exports = { create, findAll, findById, getMyBusiness, updateProfile, update, remove };
