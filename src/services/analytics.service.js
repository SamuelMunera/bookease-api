const prisma = require('../config/database');

const DAYS_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const REVENUE_STATUSES = new Set(['CONFIRMED', 'COMPLETED']);
const COUNT_STATUSES   = new Set(['CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']);

function localToday(timezone) {
  const str = new Date().toLocaleString('en-CA', { timeZone: timezone });
  return str.split(',')[0].trim(); // YYYY-MM-DD
}

function getPeriodRange(period, timezone) {
  const today = localToday(timezone);
  const [y, m, d] = today.split('-').map(Number);

  if (period === 'today') {
    const from = new Date(Date.UTC(y, m - 1, d));
    return { from, to: new Date(Date.UTC(y, m - 1, d + 1)) };
  }
  if (period === 'week') {
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const offset = dow === 0 ? -6 : 1 - dow;
    const from = new Date(Date.UTC(y, m - 1, d + offset));
    return { from, to: new Date(Date.UTC(y, m - 1, d + offset + 7)) };
  }
  // month
  return {
    from: new Date(Date.UTC(y, m - 1, 1)),
    to:   new Date(Date.UTC(y, m,     1)),
  };
}

function buildAnalytics(bookings, priorClientIds) {
  let total = 0, confirmed = 0, completed = 0, cancelled = 0, noShow = 0, pending = 0, revenue = 0;
  const clientsSeen = new Set();
  const hourCounts  = Array(24).fill(0);
  const dayCounts   = Array(7).fill(0);
  const serviceMap  = {};

  for (const b of bookings) {
    total++;
    switch (b.status) {
      case 'PENDING':   pending++;   break;
      case 'CONFIRMED': confirmed++; break;
      case 'COMPLETED': completed++; break;
      case 'CANCELLED': cancelled++; break;
      case 'NO_SHOW':   noShow++;    break;
    }

    if (!COUNT_STATUSES.has(b.status)) continue;

    clientsSeen.add(b.clientId);

    const price     = Number(b.service?.price ?? b.homeService?.price ?? 0);
    const surcharge = Number(b.homeService?.surcharge ?? 0);
    if (REVENUE_STATUSES.has(b.status)) revenue += price + surcharge;

    const hour = parseInt((b.startTime || '00:00').split(':')[0], 10);
    hourCounts[hour]++;
    const dow = new Date(b.date).getUTCDay();
    dayCounts[dow]++;

    const svcId   = b.serviceId ?? b.homeServiceId ?? '__manual__';
    const svcName = b.service?.name ?? b.homeService?.name ?? 'Sin servicio';
    if (!serviceMap[svcId]) serviceMap[svcId] = { name: svcName, count: 0, revenue: 0, noShow: 0 };
    serviceMap[svcId].count++;
    if (REVENUE_STATUSES.has(b.status)) serviceMap[svcId].revenue += price + surcharge;
    if (b.status === 'NO_SHOW') serviceMap[svcId].noShow++;
  }

  const newClients       = [...clientsSeen].filter(id => !priorClientIds.has(id)).length;
  const recurringClients = clientsSeen.size - newClients;
  const recurringPct     = clientsSeen.size > 0
    ? Math.round((recurringClients / clientsSeen.size) * 100) : 0;

  const peakHourIdx = hourCounts.indexOf(Math.max(...hourCounts));
  const peakDayIdx  = dayCounts.indexOf(Math.max(...dayCounts));

  const topServices = Object.values(serviceMap)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const noShowRate = total > 0 ? Math.round((noShow / total) * 100) : 0;

  const servicesByNoShow = Object.values(serviceMap)
    .filter(s => s.noShow > 0)
    .sort((a, b) => b.noShow - a.noShow)
    .slice(0, 6);

  return {
    summary: { total, confirmed, completed, cancelled, noShow, pending, revenue },
    customers: {
      total: clientsSeen.size,
      new: newClients,
      recurring: recurringClients,
      recurringPct,
    },
    peakHours: hourCounts.map((count, hour) => ({ hour, count })),
    peakDays:  dayCounts.map((count, idx)  => ({ day: idx, label: DAYS_ES[idx], count })),
    topServices,
    servicesByNoShow,
    insights: {
      peakHour:    hourCounts[peakHourIdx] > 0 ? peakHourIdx : null,
      peakDay:     dayCounts[peakDayIdx]   > 0 ? DAYS_ES[peakDayIdx] : null,
      recurringPct,
      topService:  topServices[0]?.name ?? null,
      noShowRate,
    },
  };
}

async function getBusinessAnalytics(ownerId, period = 'month') {
  const business = await prisma.business.findFirst({
    where: { ownerId },
    select: { id: true, timezone: true, country: true },
  });
  if (!business) throw new Error('No business found');

  const { from, to } = getPeriodRange(period, business.timezone);

  const [bookings, priorBookings] = await Promise.all([
    prisma.booking.findMany({
      where: { professional: { businessId: business.id }, date: { gte: from, lt: to } },
      select: {
        id: true, clientId: true, status: true, startTime: true, date: true,
        serviceId: true, homeServiceId: true, professionalId: true,
        professional: { select: { id: true, name: true } },
        service:      { select: { name: true, price: true } },
        homeService:  { select: { name: true, price: true, surcharge: true } },
      },
    }),
    prisma.booking.findMany({
      where: {
        professional: { businessId: business.id },
        date:   { lt: from },
        status: { in: ['CONFIRMED', 'COMPLETED'] },
      },
      select: { clientId: true },
    }),
  ]);

  const priorIds   = new Set(priorBookings.map(b => b.clientId));
  const analytics  = buildAnalytics(bookings, priorIds);

  // Per-professional breakdown
  const proMap = {};
  for (const b of bookings) {
    const pid = b.professionalId;
    if (!proMap[pid]) proMap[pid] = {
      id: pid, name: b.professional.name,
      total: 0, confirmed: 0, cancelled: 0, noShow: 0, revenue: 0,
    };
    proMap[pid].total++;
    const p = Number(b.service?.price ?? b.homeService?.price ?? 0)
            + Number(b.homeService?.surcharge ?? 0);
    if (REVENUE_STATUSES.has(b.status)) { proMap[pid].confirmed++; proMap[pid].revenue += p; }
    if (b.status === 'CANCELLED') proMap[pid].cancelled++;
    if (b.status === 'NO_SHOW')   proMap[pid].noShow++;
  }

  const professionals = Object.values(proMap)
    .map(p => ({ ...p, noShowRate: p.total > 0 ? Math.round((p.noShow / p.total) * 100) : 0 }))
    .sort((a, b) => b.revenue - a.revenue);

  return {
    period, currency: business.country === 'US' ? 'USD' : 'COP',
    from: from.toISOString().slice(0, 10),
    to:   to.toISOString().slice(0, 10),
    ...analytics,
    professionals,
  };
}

async function getProfessionalAnalytics(userId, period = 'month') {
  const prof = await prisma.professional.findUnique({
    where: { userId },
    select: { id: true, timezone: true, country: true, business: { select: { timezone: true, country: true } } },
  });
  if (!prof) throw new Error('Professional profile not found');

  const timezone = prof.business?.timezone ?? prof.timezone ?? 'America/Bogota';
  const currency = (prof.business?.country ?? prof.country) === 'US' ? 'USD' : 'COP';
  const { from, to } = getPeriodRange(period, timezone);

  const [bookings, priorBookings] = await Promise.all([
    prisma.booking.findMany({
      where: { professionalId: prof.id, date: { gte: from, lt: to } },
      select: {
        id: true, clientId: true, status: true, startTime: true, date: true,
        serviceId: true, homeServiceId: true,
        service:     { select: { name: true, price: true } },
        homeService: { select: { name: true, price: true, surcharge: true } },
      },
    }),
    prisma.booking.findMany({
      where: {
        professionalId: prof.id,
        date:   { lt: from },
        status: { in: ['CONFIRMED', 'COMPLETED'] },
      },
      select: { clientId: true },
    }),
  ]);

  const priorIds  = new Set(priorBookings.map(b => b.clientId));
  const analytics = buildAnalytics(bookings, priorIds);

  return {
    period, currency,
    from: from.toISOString().slice(0, 10),
    to:   to.toISOString().slice(0, 10),
    ...analytics,
  };
}

module.exports = { getBusinessAnalytics, getProfessionalAnalytics };
