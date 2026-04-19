const prisma = require('../config/database');

async function create(ownerId, data) {
  return prisma.business.create({
    data: { ...data, ownerId },
  });
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
  return prisma.business.update({
    where: { id, ownerId },
    data,
  });
}

async function remove(id, ownerId) {
  return prisma.business.delete({ where: { id, ownerId } });
}

module.exports = { create, findAll, findById, getMyBusiness, updateProfile, update, remove };
