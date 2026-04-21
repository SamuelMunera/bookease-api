const prisma = require('../config/database');

// ─── Home config (on Professional) ──────────────────────────────────────────

async function getHomeConfig(professionalId) {
  const pro = await prisma.professional.findUnique({
    where: { id: professionalId },
    select: {
      offersHomeService: true,
      homeServiceArea: true,
      homeServiceSurcharge: true,
      homeServiceNotes: true,
    },
  });
  if (!pro) throw new Error('Professional not found');
  return {
    offersHomeService: pro.offersHomeService,
    homeServiceArea: pro.homeServiceArea ? JSON.parse(pro.homeServiceArea) : null,
    homeServiceSurcharge: pro.homeServiceSurcharge,
    homeServiceNotes: pro.homeServiceNotes,
  };
}

async function updateHomeConfig(professionalId, { offersHomeService, homeServiceArea, homeServiceSurcharge, homeServiceNotes }) {
  const data = {};
  if (offersHomeService !== undefined) data.offersHomeService = Boolean(offersHomeService);
  if (homeServiceArea !== undefined) data.homeServiceArea = homeServiceArea ? JSON.stringify(homeServiceArea) : null;
  if (homeServiceSurcharge !== undefined) data.homeServiceSurcharge = homeServiceSurcharge;
  if (homeServiceNotes !== undefined) data.homeServiceNotes = homeServiceNotes ?? null;

  const pro = await prisma.professional.update({
    where: { id: professionalId },
    data,
    select: {
      offersHomeService: true,
      homeServiceArea: true,
      homeServiceSurcharge: true,
      homeServiceNotes: true,
    },
  });
  return {
    offersHomeService: pro.offersHomeService,
    homeServiceArea: pro.homeServiceArea ? JSON.parse(pro.homeServiceArea) : null,
    homeServiceSurcharge: pro.homeServiceSurcharge,
    homeServiceNotes: pro.homeServiceNotes,
  };
}

// ─── Home services catalog ───────────────────────────────────────────────────

async function listHomeServices(professionalId) {
  return prisma.homeService.findMany({
    where: { professionalId },
    orderBy: { createdAt: 'asc' },
  });
}

async function createHomeService(professionalId, { name, description, duration, price, surcharge }) {
  if (!name || !duration || price === undefined) throw new Error('name, duration and price are required');
  return prisma.homeService.create({
    data: { professionalId, name, description, duration: Number(duration), price, surcharge: surcharge ?? null },
  });
}

async function updateHomeService(professionalId, id, fields) {
  const svc = await prisma.homeService.findUnique({ where: { id } });
  if (!svc || svc.professionalId !== professionalId) throw new Error('Not found');
  const data = {};
  if (fields.name !== undefined) data.name = fields.name;
  if (fields.description !== undefined) data.description = fields.description;
  if (fields.duration !== undefined) data.duration = Number(fields.duration);
  if (fields.price !== undefined) data.price = fields.price;
  if (fields.surcharge !== undefined) data.surcharge = fields.surcharge;
  if (fields.isActive !== undefined) data.isActive = Boolean(fields.isActive);
  return prisma.homeService.update({ where: { id }, data });
}

async function deleteHomeService(professionalId, id) {
  const svc = await prisma.homeService.findUnique({ where: { id } });
  if (!svc || svc.professionalId !== professionalId) throw new Error('Not found');
  await prisma.homeService.delete({ where: { id } });
}

// ─── Home schedule ───────────────────────────────────────────────────────────

async function getHomeSchedule(professionalId) {
  return prisma.homeSchedule.findMany({
    where: { professionalId },
    orderBy: { dayOfWeek: 'asc' },
  });
}

async function setHomeSchedule(professionalId, days) {
  if (!Array.isArray(days)) throw new Error('days must be an array');
  await prisma.$transaction(
    days.map(({ dayOfWeek, startTime, endTime, isActive }) =>
      prisma.homeSchedule.upsert({
        where: { professionalId_dayOfWeek: { professionalId, dayOfWeek } },
        update: { startTime, endTime, isActive: isActive ?? true },
        create: { professionalId, dayOfWeek, startTime, endTime, isActive: isActive ?? true },
      })
    )
  );
  return getHomeSchedule(professionalId);
}

// ─── Coverage check ──────────────────────────────────────────────────────────

async function checkCoverage(professionalId, clientCity) {
  const pro = await prisma.professional.findUnique({
    where: { id: professionalId },
    select: { offersHomeService: true, homeServiceArea: true },
  });
  if (!pro || !pro.offersHomeService) throw new Error('Professional does not offer home services');

  if (!pro.homeServiceArea) return true; // No restriction = covers everywhere

  const area = JSON.parse(pro.homeServiceArea);
  if (!area.cities || area.cities.length === 0) return true;

  const normalise = (s) => s.trim().toLowerCase();
  const covered = area.cities.some((c) => normalise(c) === normalise(clientCity));
  return covered;
}

module.exports = {
  getHomeConfig, updateHomeConfig,
  listHomeServices, createHomeService, updateHomeService, deleteHomeService,
  getHomeSchedule, setHomeSchedule,
  checkCoverage,
};
