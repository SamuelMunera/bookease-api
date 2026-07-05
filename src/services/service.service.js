const prisma = require('../config/database');
const { computeServicePricing, getActivePromotions } = require('../utils/pricing');

const ALLOWED_FIELDS = ['name', 'description', 'duration', 'price', 'categoryId'];

async function create(businessId, callerId, data) {
  // IDOR guard: solo el dueño del negocio puede crear servicios en él.
  const biz = await prisma.business.findUnique({
    where: { id: businessId },
    select: { ownerId: true },
  });
  if (!biz) throw new Error('Business not found');
  if (biz.ownerId !== callerId) throw new Error('Forbidden');
  const clean = Object.fromEntries(Object.entries(data).filter(([k]) => ALLOWED_FIELDS.includes(k)));
  // Validación server-side (mismas reglas que update): no confiar solo en el
  // controller — la API directa puede saltarse el frontend.
  if (!clean.name || String(clean.name).trim() === '') throw new Error('name is required');
  const price = Number(clean.price);
  if (!Number.isFinite(price) || price < 0) throw new Error('price must be >= 0');
  clean.price = price;
  if (clean.duration !== undefined) {
    const d = Number(clean.duration);
    if (!Number.isFinite(d) || d < 5 || d % 5 !== 0) throw new Error('duration must be a positive multiple of 5 (minutes)');
    clean.duration = d;
  }
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
  const now = new Date();
  const [services, promotions] = await Promise.all([
    prisma.service.findMany({
      where: { businessId },
      include: { category: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.promotion.findMany({
      where: { businessId, isActive: true, startDate: { lte: now }, endDate: { gte: now } },
    }),
  ]);
  // Misma fuente de verdad de precio que la vista pública del negocio: cada
  // servicio expone `pricing` con el precio promocional vigente. Así el flujo de
  // reserva NO vuelve al precio full al seleccionar el servicio.
  const active = getActivePromotions(promotions, now);
  return services.map((svc) => ({ ...svc, pricing: computeServicePricing(svc, active, now) }));
}

async function update(id, ownerId, data) {
  const service = await prisma.service.findUnique({
    where: { id },
    include: { business: { select: { ownerId: true } } },
  });
  if (!service) throw new Error('Service not found');
  if (service.business.ownerId !== ownerId) throw new Error('Forbidden');
  const clean = Object.fromEntries(Object.entries(data).filter(([k]) => ALLOWED_FIELDS.includes(k)));
  if (clean.duration !== undefined) {
    const d = Number(clean.duration);
    if (!Number.isFinite(d) || d < 5 || d % 5 !== 0) throw new Error('duration must be a positive multiple of 5 (minutes)');
    clean.duration = d;
  }
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
