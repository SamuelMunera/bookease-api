const prisma = require('../config/database');
const { toMinutes, toTime, parseLocalDate, overlaps } = require('./slot.service');
const emailService = require('./email.service');

const BOOKING_INCLUDE = {
  client: { select: { id: true, name: true, email: true } },
  professional: { select: { id: true, name: true } },
  service: { select: { id: true, name: true, duration: true, price: true } },
};

async function createBooking({ clientId, professionalId, serviceId, date, startTime }) {
  const localDate = parseLocalDate(date);
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (localDate < today) throw new Error('Cannot book a past date');
  const dayOfWeek = localDate.getDay();

  // FIX: assign result so email code is reachable
  const booking = await prisma.$transaction(
    async (tx) => {
      const service = await tx.service.findUnique({ where: { id: serviceId } });
      if (!service) throw new Error('Service not found');

      const slotStart = toMinutes(startTime);
      const slotEnd = slotStart + service.duration;
      const endTime = toTime(slotEnd);

      // Check override first, then fall back to recurring schedule (mirrors slot.service logic)
      const { getWeekStartStr, parseLocalDate: pld } = require('./slot.service');
      const weekStart = pld(getWeekStartStr(date));
      const override = await tx.scheduleOverride.findUnique({
        where: { professionalId_weekStart_dayOfWeek: { professionalId, weekStart, dayOfWeek } },
      });

      let dayStartMin, dayEndMin, isActive;
      if (override) {
        isActive   = override.isActive;
        dayStartMin = toMinutes(override.startTime);
        dayEndMin   = toMinutes(override.endTime);
      } else {
        const schedule = await tx.schedule.findUnique({
          where: { professionalId_dayOfWeek: { professionalId, dayOfWeek } },
        });
        isActive   = schedule?.isActive ?? false;
        dayStartMin = schedule ? toMinutes(schedule.startTime) : 0;
        dayEndMin   = schedule ? toMinutes(schedule.endTime)   : 0;
      }

      if (!isActive) throw new Error('Professional not available on this day');
      if (slotStart < dayStartMin || slotEnd > dayEndMin)
        throw new Error('Slot is outside working hours');

      const exceptions = await tx.scheduleException.findMany({
        where: { professionalId, date: localDate },
      });
      if (exceptions.some((e) => !e.startTime && !e.endTime))
        throw new Error('Professional unavailable on this date');

      const blockedByException = exceptions
        .filter((e) => e.startTime && e.endTime)
        .some((e) => overlaps(slotStart, slotEnd, toMinutes(e.startTime), toMinutes(e.endTime)));
      if (blockedByException) throw new Error('Slot overlaps with a blocked period');

      const conflict = await tx.booking.findFirst({
        where: {
          professionalId,
          date: localDate,
          status: { not: 'CANCELLED' },
          AND: [{ startTime: { lt: endTime } }, { endTime: { gt: startTime } }],
        },
      });
      if (conflict) throw new Error('Slot is no longer available');

      return tx.booking.create({
        data: { clientId, professionalId, serviceId, date: localDate, startTime, endTime, status: 'CONFIRMED' },
        include: BOOKING_INCLUDE,
      });
    },
    { isolationLevel: 'Serializable' }
  );

  emailService
    .sendConfirmation({ ...booking, clientName: booking.client.name }, booking.client.email)
    .catch((err) => console.error('[email] confirmation failed:', err.message));

  return booking;
}

async function getUserBookings(clientId) {
  return prisma.booking.findMany({
    where: { clientId },
    include: BOOKING_INCLUDE,
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
  });
}

async function cancelBooking(id, clientId) {
  const booking = await prisma.booking.findUnique({ where: { id } });
  if (!booking) throw new Error('Booking not found');
  if (booking.clientId !== clientId) throw new Error('Forbidden');
  if (booking.status === 'CANCELLED') throw new Error('Already cancelled');

  const cancelled = await prisma.booking.update({
    where: { id },
    data: { status: 'CANCELLED' },
    include: BOOKING_INCLUDE,
  });

  emailService
    .sendCancellation({ ...cancelled, clientName: cancelled.client.name }, cancelled.client.email)
    .catch((err) => console.error('[email] cancellation failed:', err.message));

  return cancelled;
}

// Gap 1: business agenda
async function getBusinessBookings(businessId, ownerId, { date, from, to } = {}) {
  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business) throw new Error('Business not found');
  if (business.ownerId !== ownerId) throw new Error('Forbidden');

  const dateFilter = date
    ? { date: parseLocalDate(date) }
    : from && to
    ? { date: { gte: parseLocalDate(from), lte: parseLocalDate(to) } }
    : {};

  return prisma.booking.findMany({
    where: { professional: { businessId }, ...dateFilter },
    include: BOOKING_INCLUDE,
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
  });
}

async function cancelBookingAsOwner(id, ownerId) {
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { professional: { include: { business: { select: { ownerId: true } } } } },
  });
  if (!booking) throw new Error('Booking not found');
  if (booking.professional.business.ownerId !== ownerId) throw new Error('Forbidden');
  if (booking.status === 'CANCELLED') throw new Error('Already cancelled');

  const cancelled = await prisma.booking.update({
    where: { id },
    data: { status: 'CANCELLED' },
    include: BOOKING_INCLUDE,
  });

  emailService
    .sendCancellation({ ...cancelled, clientName: cancelled.client.name }, cancelled.client.email)
    .catch((err) => console.error('[email] cancellation failed:', err.message));

  return cancelled;
}

async function confirmBooking(id, ownerId) {
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { professional: { include: { business: { select: { ownerId: true } } } } },
  });
  if (!booking) throw new Error('Booking not found');
  if (booking.professional.business.ownerId !== ownerId) throw new Error('Forbidden');
  if (booking.status !== 'PENDING') throw new Error('Only PENDING bookings can be confirmed');

  const confirmed = await prisma.booking.update({
    where: { id },
    data: { status: 'CONFIRMED' },
    include: BOOKING_INCLUDE,
  });

  emailService
    .sendConfirmation({ ...confirmed, clientName: confirmed.client.name }, confirmed.client.email)
    .catch((err) => console.error('[email] confirmation failed:', err.message));

  return confirmed;
}

async function rescheduleBooking(id, clientId, { date, startTime }) {
  const localDate = parseLocalDate(date);
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (localDate < today) throw new Error('Cannot reschedule to a past date');

  const rescheduled = await prisma.$transaction(
    async (tx) => {
      const existing = await tx.booking.findUnique({
        where: { id },
        include: { service: { select: { duration: true } } },
      });
      if (!existing) throw new Error('Booking not found');
      if (existing.clientId !== clientId) throw new Error('Forbidden');
      if (existing.status === 'CANCELLED') throw new Error('Cannot reschedule a cancelled booking');

      const { professionalId, service } = existing;
      const dayOfWeek = localDate.getDay();
      const slotStart = toMinutes(startTime);
      const slotEnd = slotStart + service.duration;
      const endTime = toTime(slotEnd);

      const schedule = await tx.schedule.findUnique({
        where: { professionalId_dayOfWeek: { professionalId, dayOfWeek } },
      });
      if (!schedule || !schedule.isActive)
        throw new Error('Professional not available on this day');
      if (slotStart < toMinutes(schedule.startTime) || slotEnd > toMinutes(schedule.endTime))
        throw new Error('Slot is outside working hours');

      const exceptions = await tx.scheduleException.findMany({
        where: { professionalId, date: localDate },
      });
      if (exceptions.some((e) => !e.startTime && !e.endTime))
        throw new Error('Professional unavailable on this date');
      const blockedByException = exceptions
        .filter((e) => e.startTime && e.endTime)
        .some((e) => overlaps(slotStart, slotEnd, toMinutes(e.startTime), toMinutes(e.endTime)));
      if (blockedByException) throw new Error('Slot overlaps with a blocked period');

      const conflict = await tx.booking.findFirst({
        where: {
          professionalId,
          date: localDate,
          status: { not: 'CANCELLED' },
          id: { not: id }, // exclude current booking
          AND: [{ startTime: { lt: endTime } }, { endTime: { gt: startTime } }],
        },
      });
      if (conflict) throw new Error('Slot is no longer available');

      return tx.booking.update({
        where: { id },
        data: { date: localDate, startTime, endTime, status: 'CONFIRMED' },
        include: BOOKING_INCLUDE,
      });
    },
    { isolationLevel: 'Serializable' }
  );

  emailService
    .sendConfirmation({ ...rescheduled, clientName: rescheduled.client.name }, rescheduled.client.email)
    .catch((err) => console.error('[email] reschedule confirmation failed:', err.message));

  return rescheduled;
}

module.exports = { createBooking, getUserBookings, cancelBooking, cancelBookingAsOwner, getBusinessBookings, confirmBooking, rescheduleBooking };
