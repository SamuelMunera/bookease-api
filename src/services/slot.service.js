const prisma = require('../config/database');

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

// Parses "YYYY-MM-DD" as UTC midnight so it matches PostgreSQL DATE storage
function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function getWeekStartStr(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const dow = date.getDay();
  const diff = dow === 0 ? -6 : 1 - dow; // shift to Monday
  date.setDate(date.getDate() + diff);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

async function getAvailableSlots(professionalId, serviceId, dateStr) {
  const localDate = parseLocalDate(dateStr);
  // Compute dayOfWeek from local midnight to avoid UTC offset shifting the day
  const [_y, _m, _d] = dateStr.split('-').map(Number);
  const dayOfWeek = new Date(_y, _m - 1, _d).getDay(); // 0=Sunday ... 6=Saturday

  // 1. Service duration
  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service) throw new Error('Service not found');
  const duration = service.duration;

  // 2. Check week-specific override first, then fall back to recurring schedule
  const weekStart = parseLocalDate(getWeekStartStr(dateStr));
  const override = await prisma.scheduleOverride.findUnique({
    where: { professionalId_weekStart_dayOfWeek: { professionalId, weekStart, dayOfWeek } },
  });

  let dayStart, dayEnd;
  if (override) {
    if (!override.isActive) return [];
    dayStart = toMinutes(override.startTime);
    dayEnd   = toMinutes(override.endTime);
  } else {
    const schedule = await prisma.schedule.findUnique({
      where: { professionalId_dayOfWeek: { professionalId, dayOfWeek } },
    });
    if (!schedule || !schedule.isActive) return [];
    dayStart = toMinutes(schedule.startTime);
    dayEnd   = toMinutes(schedule.endTime);
  }

  // 3. Exceptions for that date
  const exceptions = await prisma.scheduleException.findMany({
    where: { professionalId, date: localDate },
  });

  // Full-day block → no slots
  if (exceptions.some((e) => !e.startTime && !e.endTime)) return [];

  const exceptionBlocks = exceptions
    .filter((e) => e.startTime && e.endTime)
    .map((e) => ({ start: toMinutes(e.startTime), end: toMinutes(e.endTime) }));

  // 4. Existing bookings (not cancelled)
  const bookings = await prisma.booking.findMany({
    where: {
      professionalId,
      date: localDate,
      status: { not: 'CANCELLED' },
    },
  });

  const bookingBlocks = bookings.map((b) => ({
    start: toMinutes(b.startTime),
    end: toMinutes(b.endTime),
  }));

  const blocked = [...exceptionBlocks, ...bookingBlocks];

  // 5. Generate slots (past-time filtering is handled by the client with local time)
  const slots = [];
  for (let start = dayStart; start + duration <= dayEnd; start += duration) {
    const end = start + duration;
    if (!blocked.some((b) => overlaps(start, end, b.start, b.end))) {
      slots.push({ startTime: toTime(start), endTime: toTime(end) });
    }
  }

  return slots;
}

module.exports = { getAvailableSlots, toMinutes, toTime, parseLocalDate, overlaps };
