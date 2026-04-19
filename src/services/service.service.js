const prisma = require('../config/database');

const ALLOWED_FIELDS = ['name', 'description', 'duration', 'price'];

async function create(businessId, data) {
  const clean = Object.fromEntries(Object.entries(data).filter(([k]) => ALLOWED_FIELDS.includes(k)));
  return prisma.service.create({ data: { ...clean, businessId } });
}

async function findByBusiness(businessId) {
  return prisma.service.findMany({ where: { businessId } });
}

async function update(id, ownerId, data) {
  const service = await prisma.service.findUnique({
    where: { id },
    include: { business: { select: { ownerId: true } } },
  });
  if (!service) throw new Error('Service not found');
  if (service.business.ownerId !== ownerId) throw new Error('Forbidden');
  const clean = Object.fromEntries(Object.entries(data).filter(([k]) => ALLOWED_FIELDS.includes(k)));
  return prisma.service.update({ where: { id }, data: clean });
}

async function remove(id, ownerId) {
  const service = await prisma.service.findUnique({
    where: { id },
    include: { business: { select: { ownerId: true } } },
  });
  if (!service) throw new Error('Service not found');
  if (service.business.ownerId !== ownerId) throw new Error('Forbidden');
  return prisma.service.delete({ where: { id } });
}

module.exports = { create, findByBusiness, update, remove };
