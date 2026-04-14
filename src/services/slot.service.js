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

async function getAvailableSlots(professionalId, serviceId, dateStr) {
  const localDate = parseLocalDate(dateStr);
  const dayOfWeek = localDate.getDay(); // 0=Sunday ... 6=Saturday

  // 1. Service duration
  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service) throw new Error('Service not found');
  const duration = service.duration;

  // 2. Professional weekly schedule for that day
  const schedule = await prisma.schedule.findUnique({
    where: { professionalId_dayOfWeek: { professionalId, dayOfWeek } },
  });
  if (!schedule || !schedule.isActive) return [];

  const dayStart = toMinutes(schedule.startTime);
  const dayEnd = toMinutes(schedule.endTime);

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

  // 5. Generate slots
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
