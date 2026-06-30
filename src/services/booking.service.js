const prisma = require('../config/database');
const { toMinutes, toTime, parseLocalDate, overlaps } = require('./slot.service');
const emailService = require('./email.service');
const { bookingToUTCMs } = require('../utils/timezone');
const { retryOnConflict } = require('../utils/retry');
const { assertBillingActive } = require('./subscription.service');

const BOOKING_INCLUDE = {
  client: { select: { id: true, name: true, email: true, phone: true } },
  professional: {
    select: {
      id: true, name: true,
      user:     { select: { email: true } },
      business: { select: { name: true, owner: { select: { email: true } } } },
    },
  },
  service: { select: { id: true, name: true, duration: true, price: true } },
  homeService: { select: { id: true, name: true, duration: true, price: true, surcharge: true } },
};

// Returns { effectiveDuration, bufferTime } for a professional+service pair
async function getEffectiveTiming(tx, professionalId, serviceId) {
  const [proRow, svcConfig] = await Promise.all([
    tx.professional.findUnique({ where: { id: professionalId }, select: { bufferTime: true } }),
    tx.professionalServiceConfig.findUnique({
      where: { professionalId_serviceId: { professionalId, serviceId } },
    }),
  ]);
  return {
    bufferTime: proRow?.bufferTime ?? 0,
    customDuration: svcConfig?.customDuration ?? null,
  };
}

async function createBooking({ clientId, professionalId, serviceId, date, startTime }) {
  await assertBillingActive(professionalId);

  const localDate = parseLocalDate(date);
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (localDate < today) throw new Error('Cannot book a past date');

  const [_dy, _dm, _dd] = date.split('-').map(Number);
  const dayOfWeek = new Date(_dy, _dm - 1, _dd).getDay();

  const booking = await retryOnConflict(() => prisma.$transaction(
    async (tx) => {
      const service = await tx.service.findUnique({ where: { id: serviceId } });
      if (!service) throw new Error('Service not found');

      const { bufferTime, customDuration } = await getEffectiveTiming(tx, professionalId, serviceId);
      const effectiveDuration = customDuration ?? service.duration;

      const slotStart = toMinutes(startTime);
      const slotEnd = slotStart + effectiveDuration;
      const endTime = toTime(slotEnd);

      // Week override → recurring schedule
      const [wy, wm, wd] = date.split('-').map(Number);
      const wDate = new Date(wy, wm - 1, wd);
      const wDiff = wDate.getDay() === 0 ? -6 : 1 - wDate.getDay();
      wDate.setDate(wDate.getDate() + wDiff);
      const weekStart = new Date(Date.UTC(wDate.getFullYear(), wDate.getMonth(), wDate.getDate()));
      const override = await tx.scheduleOverride.findUnique({
        where: { professionalId_weekStart_dayOfWeek: { professionalId, weekStart, dayOfWeek } },
      });

      let dayStartMin, dayEndMin, isActive;
      if (override) {
        isActive    = override.isActive;
        dayStartMin = toMinutes(override.startTime);
        dayEndMin   = toMinutes(override.endTime);
      } else {
        const schedule = await tx.schedule.findUnique({
          where: { professionalId_dayOfWeek: { professionalId, dayOfWeek } },
        });
        isActive    = schedule?.isActive ?? false;
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

      // Conflict check: fetch bookings in JS to apply buffer correctly
      const existingBookings = await tx.booking.findMany({
        where: { professionalId, date: localDate, status: { not: 'CANCELLED' } },
      });
      const conflict = existingBookings.some(b => {
        const bStart = toMinutes(b.startTime);
        const bEnd   = toMinutes(b.endTime) + bufferTime; // existing booking blocks until end + buffer
        return overlaps(slotStart, slotEnd, bStart, bEnd);
      });
      if (conflict) {
        console.warn(`[booking] slot conflict: prof=${professionalId} date=${date} slot=${startTime}`);
        const err = new Error('Slot is no longer available');
        err.code = 'SLOT_CONFLICT';
        throw err;
      }

      return tx.booking.create({
        data: { clientId, professionalId, serviceId, date: localDate, startTime, endTime, status: 'CONFIRMED' },
        include: BOOKING_INCLUDE,
      });
    },
    { isolationLevel: 'Serializable' }
  ));


  emailService.sendBookingConfirmation(booking).catch(e => console.error('[email] confirmation:', e.message));
  return booking;
}

async function getUserBookings(clientId) {
  return prisma.booking.findMany({
    where: { clientId },
    include: BOOKING_INCLUDE,
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
  });
}

// Returns { minHours, timezone } for a booking
async function getCancelPolicy(professionalId) {
  const pro = await prisma.professional.findUnique({
    where:  { id: professionalId },
    select: { cancelMinHours: true, timezone: true, business: { select: { cancelMinHours: true, timezone: true } } },
  });
  if (!pro) return { minHours: 0, timezone: 'America/Bogota' };
  const bizHours = pro.business?.cancelMinHours ?? 0;
  const minHours = bizHours > 0 ? bizHours : (pro.cancelMinHours ?? 0);
  const timezone = pro.business?.timezone || pro.timezone || 'America/Bogota';
  return { minHours, timezone };
}

function assertCancellationWindow(booking, minHours, timezone = 'America/Bogota') {
  if (!minHours) return;
  const bookingMs = bookingToUTCMs(booking.date, booking.startTime, timezone);
  const hoursLeft = (bookingMs - Date.now()) / 3600000;
  if (hoursLeft < minHours) {
    const err = new Error(
      `No puedes cancelar esta reserva. La política requiere al menos ${minHours} hora${minHours !== 1 ? 's' : ''} de anticipación.`
    );
    err.status = 422;
    err.code   = 'CANCELLATION_WINDOW_EXPIRED';
    throw err;
  }
}

async function cancelBooking(id, clientId) {
  const booking = await prisma.booking.findUnique({ where: { id } });
  if (!booking) throw new Error('Booking not found');
  if (booking.clientId !== clientId) throw new Error('Forbidden');
  if (booking.status === 'CANCELLED') throw new Error('Already cancelled');
  const { minHours, timezone } = await getCancelPolicy(booking.professionalId);
  assertCancellationWindow(booking, minHours, timezone);

  const cancelled = await prisma.booking.update({
    where: { id },
    data: { status: 'CANCELLED' },
    include: BOOKING_INCLUDE,
  });
  emailService.sendBookingCancellation(cancelled).catch(e => console.error('[email] cancellation:', e.message));
  return cancelled;
}

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
  if (!booking.professional.business || booking.professional.business.ownerId !== ownerId) throw new Error('Forbidden');
  if (booking.status === 'CANCELLED') throw new Error('Already cancelled');

  const cancelled = await prisma.booking.update({
    where: { id },
    data: { status: 'CANCELLED' },
    include: BOOKING_INCLUDE,
  });
  emailService.sendBookingCancellation(cancelled).catch(e => console.error('[email] cancellation:', e.message));
  return cancelled;
}

async function confirmBooking(id, ownerId) {
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { professional: { include: { business: { select: { ownerId: true } } } } },
  });
  if (!booking) throw new Error('Booking not found');
  if (!booking.professional.business || booking.professional.business.ownerId !== ownerId) throw new Error('Forbidden');
  if (booking.status !== 'PENDING') throw new Error('Only PENDING bookings can be confirmed');

  const confirmed = await prisma.booking.update({
    where: { id },
    data: { status: 'CONFIRMED' },
    include: BOOKING_INCLUDE,
  });

  return confirmed;
}

async function rescheduleBooking(id, clientId, { date, startTime }) {
  const localDate = parseLocalDate(date);
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (localDate < today) throw new Error('Cannot reschedule to a past date');

  // Validate cancellation policy before allowing reschedule
  const existingForPolicy = await prisma.booking.findUnique({ where: { id } });
  if (existingForPolicy) {
    const { minHours, timezone } = await getCancelPolicy(existingForPolicy.professionalId);
    assertCancellationWindow(existingForPolicy, minHours, timezone);
  }

  const rescheduled = await retryOnConflict(() => prisma.$transaction(
    async (tx) => {
      const existing = await tx.booking.findUnique({
        where: { id },
        include: {
          service: { select: { duration: true } },
          homeService: { select: { duration: true } },
        },
      });
      if (!existing) throw new Error('Booking not found');
      if (existing.clientId !== clientId) throw new Error('Forbidden');
      // C-19: no se puede reagendar una cita en estado terminal (cancelada,
      // completada o no-show) — eso revivía estados terminales y falseaba métricas.
      if (TERMINAL_STATUSES.has(existing.status))
        throw new Error('No se puede reagendar una cita cancelada, completada o marcada como no asistida.');

      const { professionalId, service, homeService } = existing;
      if (existing.type === 'HOME_SERVICE') throw new Error('Home service bookings cannot be rescheduled here');
      const { bufferTime, customDuration } = await getEffectiveTiming(tx, professionalId, existing.serviceId);
      const effectiveDuration = customDuration ?? service.duration;

      const [rdy, rdm, rdd] = date.split('-').map(Number);
      const dayOfWeek = new Date(rdy, rdm - 1, rdd).getDay();
      const slotStart = toMinutes(startTime);
      const slotEnd = slotStart + effectiveDuration;
      const endTime = toTime(slotEnd);

      const rwDate = new Date(rdy, rdm - 1, rdd);
      const rwDiff = rwDate.getDay() === 0 ? -6 : 1 - rwDate.getDay();
      rwDate.setDate(rwDate.getDate() + rwDiff);
      const rWeekStart = new Date(Date.UTC(rwDate.getFullYear(), rwDate.getMonth(), rwDate.getDate()));

      const rOverride = await tx.scheduleOverride.findUnique({
        where: { professionalId_weekStart_dayOfWeek: { professionalId, weekStart: rWeekStart, dayOfWeek } },
      });
      let rIsActive, rDayStart, rDayEnd;
      if (rOverride) {
        rIsActive = rOverride.isActive;
        rDayStart = toMinutes(rOverride.startTime);
        rDayEnd   = toMinutes(rOverride.endTime);
      } else {
        const schedule = await tx.schedule.findUnique({
          where: { professionalId_dayOfWeek: { professionalId, dayOfWeek } },
        });
        rIsActive = schedule?.isActive ?? false;
        rDayStart = schedule ? toMinutes(schedule.startTime) : 0;
        rDayEnd   = schedule ? toMinutes(schedule.endTime)   : 0;
      }
      if (!rIsActive) throw new Error('Professional not available on this day');
      if (slotStart < rDayStart || slotEnd > rDayEnd)
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

      const existingBookings = await tx.booking.findMany({
        where: { professionalId, date: localDate, status: { not: 'CANCELLED' }, id: { not: id } },
      });
      const conflict = existingBookings.some(b => {
        const bStart = toMinutes(b.startTime);
        const bEnd   = toMinutes(b.endTime) + bufferTime;
        return overlaps(slotStart, slotEnd, bStart, bEnd);
      });
      if (conflict) {
        console.warn(`[booking] reschedule conflict: prof=${professionalId} date=${date} slot=${startTime}`);
        const err = new Error('Slot is no longer available');
        err.code = 'SLOT_CONFLICT';
        throw err;
      }

      return tx.booking.update({
        where: { id },
        data: { date: localDate, startTime, endTime, status: 'CONFIRMED' },
        include: BOOKING_INCLUDE,
      });
    },
    { isolationLevel: 'Serializable' }
  ));

  return rescheduled;
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const VALID_SOURCES = new Set(['ONLINE', 'MANUAL', 'WHATSAPP', 'CALL', 'PRESENCIAL']);

// Manual booking — created by business owner or professional on behalf of a client
async function createManualBooking({ creatorId, creatorRole, professionalId, serviceId, date, startTime, clientEmail, clientName, clientPhone, source }) {
  if (!professionalId || !serviceId || !date || !startTime)
    throw new Error('professionalId, serviceId, date y startTime son obligatorios');
  await assertBillingActive(professionalId);
  const walkInSources = new Set(['PRESENCIAL', 'MANUAL']);
  const isWalkIn = source && walkInSources.has((source || '').toUpperCase());
  if (!isWalkIn && !clientEmail && !clientName)
    throw new Error('Proporciona el email o nombre del cliente');
  if (clientEmail && !EMAIL_RE.test(clientEmail.trim()))
    throw new Error('Email del cliente inválido');

  // Authorization: creator must own or manage the professional
  const pro = await prisma.professional.findUnique({
    where: { id: professionalId },
    select: { userId: true, businessId: true, business: { select: { ownerId: true } } },
  });
  if (!pro) throw new Error('Professional not found');
  const isOwnPro  = pro.userId === creatorId;
  const isBizOwner = pro.business?.ownerId === creatorId;
  if (!isOwnPro && !isBizOwner) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }

  const safeSource = source && VALID_SOURCES.has(source.toUpperCase()) ? source.toUpperCase() : 'MANUAL';

  // Resolve or create client
  const lookupEmail = clientEmail ? clientEmail.toLowerCase().trim() : null;
  let client = lookupEmail
    ? await prisma.user.findUnique({ where: { email: lookupEmail } })
    : null;

  if (!client) {
    const bcrypt = require('bcryptjs');
    const crypto = require('crypto');
    if (isWalkIn && !lookupEmail) {
      // C-01: cita presencial/walk-in sin email NO crea una cuenta nueva por
      // cada cita (eso generaba usuarios CLIENT fantasma, acumulables y
      // enumerables). Se reutiliza un único usuario placeholder por negocio
      // (o por profesional independiente). El nombre real del cliente vive en
      // booking.guestName, no en el User.
      const walkInEmail = pro.businessId
        ? `walkin-${pro.businessId}@slotly.internal`
        : `walkin-pro-${professionalId}@slotly.internal`;
      // upsert evita la carrera unique-violation si llegan dos reservas
      // presenciales simultáneas para el mismo negocio (N2-01).
      client = await prisma.user.upsert({
        where:  { email: walkInEmail },
        update: {},
        create: {
          name:     'Cliente presencial',
          email:    walkInEmail,
          password: await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 12),
          role:     'CLIENT',
        },
      });
    } else {
      const tempPass = crypto.randomBytes(16).toString('hex');
      client = await prisma.user.create({
        data: {
          name:     clientName || (lookupEmail ? lookupEmail.split('@')[0] : 'Cliente'),
          email:    lookupEmail || `guest-${crypto.randomBytes(8).toString('hex')}@slotly.internal`,
          password: await bcrypt.hash(tempPass, 12),
          role:     'CLIENT',
          ...(clientPhone ? { phone: clientPhone } : {}),
        },
      });
    }
  }

  // Reuse core booking logic (validates schedule, conflicts, etc.)
  const booking = await createBooking({ clientId: client.id, professionalId, serviceId, date, startTime });

  // Stamp source and guest name
  return prisma.booking.update({
    where: { id: booking.id },
    data: { source: safeSource, guestName: clientName || null },
    include: BOOKING_INCLUDE,
  });
}

// Shared auth check: professional OR business owner of that professional
async function assertCanManageBooking(booking, userId) {
  const pro = await prisma.professional.findUnique({
    where: { id: booking.professionalId },
    select: { userId: true, business: { select: { ownerId: true } } },
  });
  if (!pro) throw new Error('Professional not found');
  const isOwnPro  = pro.userId === userId;
  const isBizOwner = pro.business?.ownerId === userId;
  if (!isOwnPro && !isBizOwner) throw new Error('Forbidden');
}

function assertIsInPast(booking, timezone = 'America/Bogota') {
  const bookingMs = bookingToUTCMs(booking.date, booking.startTime, timezone);
  if (bookingMs > Date.now()) throw new Error('Solo puedes marcar esto para citas que ya pasaron.');
}

async function getTimezoneForBooking(professionalId) {
  const pro = await prisma.professional.findUnique({
    where: { id: professionalId },
    select: { timezone: true, business: { select: { timezone: true } } },
  });
  return pro?.business?.timezone ?? pro?.timezone ?? 'America/Bogota';
}

const TERMINAL_STATUSES = new Set(['CANCELLED', 'COMPLETED', 'NO_SHOW']);

async function markNoShow(id, userId) {
  const booking = await prisma.booking.findUnique({ where: { id } });
  if (!booking) throw new Error('Booking not found');
  if (TERMINAL_STATUSES.has(booking.status)) {
    throw new Error(`No se puede marcar como no-show: la cita ya está ${booking.status.toLowerCase()}.`);
  }
  await assertCanManageBooking(booking, userId);
  const tz = await getTimezoneForBooking(booking.professionalId);
  assertIsInPast(booking, tz);
  return prisma.booking.update({
    where: { id },
    data: { status: 'NO_SHOW' },
    include: BOOKING_INCLUDE,
  });
}

async function markComplete(id, userId) {
  const booking = await prisma.booking.findUnique({ where: { id } });
  if (!booking) throw new Error('Booking not found');
  if (TERMINAL_STATUSES.has(booking.status)) {
    throw new Error(`No se puede completar: la cita ya está ${booking.status.toLowerCase()}.`);
  }
  await assertCanManageBooking(booking, userId);
  const tz = await getTimezoneForBooking(booking.professionalId);
  assertIsInPast(booking, tz);
  return prisma.booking.update({
    where: { id },
    data: { status: 'COMPLETED' },
    include: BOOKING_INCLUDE,
  });
}

module.exports = { createBooking, getUserBookings, cancelBooking, cancelBookingAsOwner, getBusinessBookings, confirmBooking, rescheduleBooking, createManualBooking, markNoShow, markComplete };
