const prisma = require('../config/database');

const ALLOWED_FIELDS = ['name', 'description', 'duration', 'price', 'categoryId'];

async function create(businessId, data) {
  const clean = Object.fromEntries(Object.entries(data).filter(([k]) => ALLOWED_FIELDS.includes(k)));
  // Solo se vinculan profesionales que realmente pertenecen a este negocio.
  let connectIds = [];
  if (Array.isArray(data.professionalIds) && data.professionalIds.length) {
    const valid = await prisma.professional.findMany({
      where: { id: { in: data.professionalIds }, businessId },
      select: { id: true },
    });
    connectIds = valid.map(p => ({ id: p.id }));
  }
  return prisma.service.create({
    data: {
      ...clean,
      businessId,
      ...(connectIds.length ? { professionals: { connect: connectIds } } : {}),
    },
    include: {
      category:      { select: { id: true, name: true } },
      professionals: { select: { id: true, name: true } },
    },
  });
}

async function findByBusiness(businessId) {
  return prisma.service.findMany({
    where: { businessId },
    include: { category: { select: { id: true, name: true } } },
    orderBy: { name: 'asc' },
  });
}

async function update(id, ownerId, data) {
  const service = await prisma.service.findUnique({
    where: { id },
    include: { business: { select: { ownerId: true } } },
  });
  if (!service) throw new Error('Service not found');
  if (service.business.ownerId !== ownerId) throw new Error('Forbidden');
  const clean = Object.fromEntries(Object.entries(data).filter(([k]) => ALLOWED_FIELDS.includes(k)));
  // Reemplaza el set de profesionales si se envía professionalIds (validados).
  let proUpdate = {};
  if (Array.isArray(data.professionalIds)) {
    const valid = await prisma.professional.findMany({
      where: { id: { in: data.professionalIds }, businessId: service.businessId },
      select: { id: true },
    });
    proUpdate = { professionals: { set: valid.map(p => ({ id: p.id })) } };
  }
  return prisma.service.update({
    where: { id },
    data: { ...clean, ...proUpdate },
    include: {
      category:      { select: { id: true, name: true } },
      professionals: { select: { id: true, name: true } },
    },
  });
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
