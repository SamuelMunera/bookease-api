const prisma = require('../config/database');

function utcDate(y, m, d) {
  return new Date(Date.UTC(y, m, d));
}

function ranges() {
  const now = new Date();
  const y = now.getUTCFullYear(), mo = now.getUTCMonth(), d = now.getUTCDate();

  const dayStart  = utcDate(y, mo, d);
  const dayEnd    = utcDate(y, mo, d + 1);

  const dow = now.getUTCDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const weekStart = utcDate(y, mo, d + mondayOffset);
  const weekEnd   = utcDate(y, mo, d + mondayOffset + 7);

  const monthStart = utcDate(y, mo, 1);
  const monthEnd   = utcDate(y, mo + 1, 1);

  return { dayStart, dayEnd, weekStart, weekEnd, monthStart, monthEnd };
}

async function getBusinessRevenue(ownerId) {
  const business = await prisma.business.findFirst({ where: { ownerId } });
  if (!business) throw new Error('No business found');

  const { dayStart, dayEnd, weekStart, weekEnd, monthStart, monthEnd } = ranges();

  const bookings = await prisma.booking.findMany({
    where: {
      professional: { businessId: business.id },
      status: 'COMPLETED',
      date: { gte: monthStart, lt: monthEnd },
    },
    include: {
      service:      { select: { price: true } },
      homeService:  { select: { price: true, surcharge: true } },
      professional: { select: { id: true, name: true } },
    },
  });

  const proMap = {};
  for (const b of bookings) {
    const pid = b.professional.id;
    if (!proMap[pid]) proMap[pid] = { id: pid, name: b.professional.name, day: 0, week: 0, month: 0 };
    // Precio realmente reservado (con promo) como fuente única; el sellado ya
    // incluye recargo a domicilio. Fallback a service.price para citas viejas.
    const price = b.price != null
      ? Number(b.price)
      : Number(b.service?.price ?? b.homeService?.price ?? 0) + Number(b.homeService?.surcharge ?? 0);
    proMap[pid].month += price;
    if (b.date >= weekStart && b.date < weekEnd)  proMap[pid].week += price;
    if (b.date >= dayStart  && b.date < dayEnd)   proMap[pid].day  += price;
  }

  const professionals = Object.values(proMap).sort((a, b) => b.month - a.month);
  const totals = professionals.reduce(
    (acc, p) => ({ day: acc.day + p.day, week: acc.week + p.week, month: acc.month + p.month }),
    { day: 0, week: 0, month: 0 }
  );

  return { totals, professionals };
}

async function getProfessionalRevenue(userId) {
  const prof = await prisma.professional.findUnique({
    where: { userId },
    include: { business: { select: { showRevenueToProf: true } } },
  });
  if (!prof) throw new Error('Professional profile not found');
  if (!prof.businessId) throw new Error('Not linked to a business');
  if (!prof.business?.showRevenueToProf) throw new Error('Revenue not visible');

  const { dayStart, dayEnd, weekStart, weekEnd, monthStart, monthEnd } = ranges();

  const bookings = await prisma.booking.findMany({
    where: {
      professionalId: prof.id,
      status: 'COMPLETED',
      date: { gte: monthStart, lt: monthEnd },
    },
    include: {
      service:     { select: { price: true } },
      homeService: { select: { price: true, surcharge: true } },
    },
  });

  let day = 0, week = 0, month = 0;
  for (const b of bookings) {
    const price = b.price != null
      ? Number(b.price)
      : Number(b.service?.price ?? b.homeService?.price ?? 0) + Number(b.homeService?.surcharge ?? 0);
    month += price;
    if (b.date >= weekStart && b.date < weekEnd)  week += price;
    if (b.date >= dayStart  && b.date < dayEnd)   day  += price;
  }

  return { day, week, month };
}

async function updateBusinessSettings(ownerId, { showRevenueToProf }) {
  const business = await prisma.business.findFirst({ where: { ownerId } });
  if (!business) throw new Error('No business found');
  return prisma.business.update({
    where: { id: business.id },
    data: { showRevenueToProf: Boolean(showRevenueToProf) },
    select: { id: true, showRevenueToProf: true },
  });
}

module.exports = { getBusinessRevenue, getProfessionalRevenue, updateBusinessSettings };
