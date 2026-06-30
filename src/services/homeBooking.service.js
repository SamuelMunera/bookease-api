const prisma = require('../config/database');
const { toMinutes, toTime, parseLocalDate, overlaps } = require('./slot.service');
const { checkCoverage } = require('./homeService.service');
const emailService = require('./email.service');
const { retryOnConflict } = require('../utils/retry');
const { assertBillingActive } = require('./subscription.service');

const HOME_BOOKING_INCLUDE = {
  client: { select: { id: true, name: true, email: true, phone: true } },
  professional: {
    select: {
      id: true, name: true,
      user:     { select: { email: true } },
      business: { select: { name: true, owner: { select: { email: true } } } },
    },
  },
  homeService: { select: { id: true, name: true, duration: true, price: true, surcharge: true } },
};

async function createHomeBooking({ clientId, professionalId, homeServiceId, date, startTime, clientAddress, clientCity }) {
  await assertBillingActive(professionalId);

  const localDate = parseLocalDate(date);
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (localDate < today) throw new Error('Cannot book a past date');

  if (!clientAddress) throw new Error('Client address is required for home service bookings');

  // Coverage check
  const covered = await checkCoverage(professionalId, clientCity || '');
  if (!covered) throw new Error('Professional does not cover this area');

  const [_dy, _dm, _dd] = date.split('-').map(Number);
  const dayOfWeek = new Date(_dy, _dm - 1, _dd).getDay();

  const booking = await retryOnConflict(() => prisma.$transaction(
    async (tx) => {
      const homeService = await tx.homeService.findUnique({ where: { id: homeServiceId } });
      if (!homeService || !homeService.isActive) throw new Error('Home service not found or inactive');
      if (homeService.professionalId !== professionalId) throw new Error('Service does not belong to this professional');

      const proRow = await tx.professional.findUnique({
        where: { id: professionalId },
        select: { bufferTime: true, offersHomeService: true },
      });
      if (!proRow?.offersHomeService) throw new Error('Professional does not offer home services');

      const bufferTime = proRow.bufferTime ?? 0;
      const effectiveDuration = homeService.duration;
      const slotStart = toMinutes(startTime);
      const slotEnd = slotStart + effectiveDuration;
      const endTime = toTime(slotEnd);

      // Check home schedule
      const schedule = await tx.homeSchedule.findUnique({
        where: { professionalId_dayOfWeek: { professionalId, dayOfWeek } },
      });
      if (!schedule || !schedule.isActive) throw new Error('Professional not available on this day for home services');

      const dayStartMin = toMinutes(schedule.startTime);
      const dayEndMin   = toMinutes(schedule.endTime);
      if (slotStart < dayStartMin || slotEnd > dayEndMin)
        throw new Error('Slot is outside home service working hours');

      // Exceptions (shared with business schedule)
      const exceptions = await tx.scheduleException.findMany({
        where: { professionalId, date: localDate },
      });
      if (exceptions.some((e) => !e.startTime && !e.endTime))
        throw new Error('Professional unavailable on this date');
      const blockedByException = exceptions
        .filter((e) => e.startTime && e.endTime)
        .some((e) => overlaps(slotStart, slotEnd, toMinutes(e.startTime), toMinutes(e.endTime)));
      if (blockedByException) throw new Error('Slot overlaps with a blocked period');

      // Conflict check against ALL bookings (both types)
      const existingBookings = await tx.booking.findMany({
        where: { professionalId, date: localDate, status: { not: 'CANCELLED' } },
      });
      const conflict = existingBookings.some((b) => {
        const bStart = toMinutes(b.startTime);
        const bEnd   = toMinutes(b.endTime) + bufferTime;
        return overlaps(slotStart, slotEnd, bStart, bEnd);
      });
      if (conflict) {
        console.warn(`[booking] slot conflict (home): prof=${professionalId} date=${date} slot=${startTime}`);
        const err = new Error('Slot is no longer available');
        err.code = 'SLOT_CONFLICT';
        throw err;
      }

      return tx.booking.create({
        data: {
          clientId,
          professionalId,
          homeServiceId,
          date: localDate,
          startTime,
          endTime,
          status: 'CONFIRMED',
          type: 'HOME_SERVICE',
          clientAddress,
        },
        include: HOME_BOOKING_INCLUDE,
      });
    },
    { isolationLevel: 'Serializable' }
  ));

  emailService.sendBookingConfirmation(booking).catch(e => console.error('[email] home confirmation:', e.message));
  return booking;
}

async function cancelHomeBooking(id, clientId) {
  const booking = await prisma.booking.findUnique({ where: { id } });
  if (!booking) throw new Error('Booking not found');
  if (booking.clientId !== clientId) throw new Error('Forbidden');
  if (booking.type !== 'HOME_SERVICE') throw new Error('Not a home service booking');
  if (booking.status === 'CANCELLED') throw new Error('Already cancelled');

  const cancelled = await prisma.booking.update({
    where: { id },
    data: { status: 'CANCELLED' },
    include: HOME_BOOKING_INCLUDE,
  });
  emailService.sendBookingCancellation(cancelled).catch(e => console.error('[email] home cancellation:', e.message));
  return cancelled;
}

module.exports = { createHomeBooking, cancelHomeBooking };
