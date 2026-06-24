const prisma = require('../config/database');

// "Hoy" (YYYY-MM-DD) y minuto-del-día actual en una timezone dada. Se usa para
// no ofrecer slots cuya hora de inicio ya pasó cuando la fecha consultada es hoy.
function nowInTimezone(timezone) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const dateStr = `${parts.year}-${parts.month}-${parts.day}`;
  // '24' puede aparecer a medianoche en algunos entornos; normalizar a 0.
  const hour = parts.hour === '24' ? 0 : Number(parts.hour);
  const minutes = hour * 60 + Number(parts.minute);
  return { dateStr, minutes };
}

function toMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function toTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

// Returns one block for fulltime, two blocks for part_time
function buildBlocks(sched) {
  const blocks = [{ start: toMinutes(sched.startTime), end: toMinutes(sched.endTime) }];
  if (sched.scheduleType === 'part_time' && sched.secondStartTime && sched.secondEndTime) {
    blocks.push({ start: toMinutes(sched.secondStartTime), end: toMinutes(sched.secondEndTime) });
  }
  return blocks;
}

// Parses "YYYY-MM-DD" as UTC midnight so it matches PostgreSQL DATE storage
function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function getWeekStartStr(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const dow = date.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  date.setDate(date.getDate() + diff);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

async function getAvailableSlots(professionalId, serviceId, dateStr) {
  const localDate = parseLocalDate(dateStr);
  const [_y, _m, _d] = dateStr.split('-').map(Number);
  const dayOfWeek = new Date(_y, _m - 1, _d).getDay();

  // 1. Service base duration
  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service) throw new Error('Service not found');

  // 2. Professional custom duration + buffer
  const [proRow, svcConfig] = await Promise.all([
    prisma.professional.findUnique({
      where: { id: professionalId },
      select: { bufferTime: true, timezone: true, business: { select: { timezone: true } } },
    }),
    prisma.professionalServiceConfig.findUnique({
      where: { professionalId_serviceId: { professionalId, serviceId } },
    }),
  ]);
  const effectiveDuration = svcConfig?.customDuration ?? service.duration;
  const bufferTime = proRow?.bufferTime ?? 0;

  // Si la fecha consultada es HOY en la timezone del negocio/profesional, se
  // descartan los slots cuya hora de inicio ya pasó. Días futuros no se afectan.
  const timezone = proRow?.business?.timezone ?? proRow?.timezone ?? 'America/Bogota';
  const { dateStr: todayStr, minutes: nowMinutes } = nowInTimezone(timezone);
  const minStartMinutes = dateStr === todayStr ? nowMinutes : -Infinity;

  // 3. Check week-specific override first, then recurring schedule
  const weekStart = parseLocalDate(getWeekStartStr(dateStr));
  const override = await prisma.scheduleOverride.findUnique({
    where: { professionalId_weekStart_dayOfWeek: { professionalId, weekStart, dayOfWeek } },
  });

  let availBlocks; // [{ start, end }] — one for fulltime, two for part_time
  if (override) {
    if (!override.isActive) return [];
    availBlocks = buildBlocks(override);
  } else {
    const schedule = await prisma.schedule.findUnique({
      where: { professionalId_dayOfWeek: { professionalId, dayOfWeek } },
    });
    if (!schedule || !schedule.isActive) return [];
    availBlocks = buildBlocks(schedule);
  }

  // 4. Exceptions
  const exceptions = await prisma.scheduleException.findMany({
    where: { professionalId, date: localDate },
  });
  if (exceptions.some((e) => !e.startTime && !e.endTime)) return [];

  const exceptionBlocks = exceptions
    .filter((e) => e.startTime && e.endTime)
    .map((e) => ({ start: toMinutes(e.startTime), end: toMinutes(e.endTime) }));

  // 5. Existing bookings — extend end by bufferTime so next slot can't start during buffer gap
  const bookings = await prisma.booking.findMany({
    where: { professionalId, date: localDate, status: { not: 'CANCELLED' } },
  });
  const bookingBlocks = bookings.map((b) => ({
    start: toMinutes(b.startTime),
    end:   toMinutes(b.endTime) + bufferTime,
  }));

  const blocked = [...exceptionBlocks, ...bookingBlocks];

  // 6. Generate slots across all availability blocks
  const step = effectiveDuration + bufferTime;
  const slots = [];
  for (const { start: blockStart, end: blockEnd } of availBlocks) {
    for (let start = blockStart; start + effectiveDuration <= blockEnd; start += step) {
      if (start < minStartMinutes) continue; // slot ya pasó (solo aplica si es hoy)
      const end = start + effectiveDuration;
      if (!blocked.some((b) => overlaps(start, end, b.start, b.end))) {
        slots.push({ startTime: toTime(start), endTime: toTime(end) });
      }
    }
  }

  return slots;
}

async function getHomeSlots(professionalId, homeServiceId, dateStr) {
  const localDate = parseLocalDate(dateStr);
  const [_y, _m, _d] = dateStr.split('-').map(Number);
  const dayOfWeek = new Date(_y, _m - 1, _d).getDay();

  const homeService = await prisma.homeService.findUnique({ where: { id: homeServiceId } });
  if (!homeService) throw new Error('Home service not found');
  if (!homeService.isActive) return [];

  const proRow = await prisma.professional.findUnique({
    where: { id: professionalId },
    select: { bufferTime: true, offersHomeService: true },
  });
  if (!proRow?.offersHomeService) return [];

  const schedule = await prisma.homeSchedule.findUnique({
    where: { professionalId_dayOfWeek: { professionalId, dayOfWeek } },
  });
  if (!schedule || !schedule.isActive) return [];

  const dayStart = toMinutes(schedule.startTime);
  const dayEnd   = toMinutes(schedule.endTime);
  const effectiveDuration = homeService.duration;
  const bufferTime = proRow?.bufferTime ?? 0;

  const exceptions = await prisma.scheduleException.findMany({
    where: { professionalId, date: localDate },
  });
  if (exceptions.some((e) => !e.startTime && !e.endTime)) return [];

  const exceptionBlocks = exceptions
    .filter((e) => e.startTime && e.endTime)
    .map((e) => ({ start: toMinutes(e.startTime), end: toMinutes(e.endTime) }));

  const bookings = await prisma.booking.findMany({
    where: { professionalId, date: localDate, status: { not: 'CANCELLED' } },
  });
  const bookingBlocks = bookings.map((b) => ({
    start: toMinutes(b.startTime),
    end:   toMinutes(b.endTime) + bufferTime,
  }));

  const blocked = [...exceptionBlocks, ...bookingBlocks];
  const step = effectiveDuration + bufferTime;
  const slots = [];
  for (let start = dayStart; start + effectiveDuration <= dayEnd; start += step) {
    const end = start + effectiveDuration;
    if (!blocked.some((b) => overlaps(start, end, b.start, b.end))) {
      slots.push({ startTime: toTime(start), endTime: toTime(end) });
    }
  }
  return slots;
}

module.exports = { getAvailableSlots, getHomeSlots, toMinutes, toTime, parseLocalDate, overlaps };
