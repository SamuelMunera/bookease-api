const prisma = require('../config/database');
const { toMinutes, toTime, parseLocalDate, overlaps } = require('./slot.service');
const { computeServicePricing } = require('../utils/pricing');
const emailService = require('./email.service');
const { bookingToUTCMs } = require('../utils/timezone');
const { retryOnConflict } = require('../utils/retry');
const { assertBillingActive } = require('./subscription.service');

// Espejo de slot.service.buildBlocks: un bloque para fulltime, dos para
// part_time. Se replica aquí porque slot.service no lo exporta y la validación
// de reserva DEBE usar exactamente la misma construcción de bloques que el motor
// de slots, o los horarios del segundo bloque part-time serían rechazados (A-01).
function buildBlocks(sched) {
  const blocks = [{ start: toMinutes(sched.startTime), end: toMinutes(sched.endTime) }];
  if (sched.scheduleType === 'part_time' && sched.secondStartTime && sched.secondEndTime) {
    blocks.push({ start: toMinutes(sched.secondStartTime), end: toMinutes(sched.secondEndTime) });
  }
  return blocks;
}

// Espejo de slot.service.nowInTimezone (no exportada): "hoy" (YYYY-MM-DD) y el
// minuto-del-día actual en una timezone dada. Se usa para no rechazar reservas
// de HOY según el reloj UTC del servidor (A-02).
function nowInTimezone(timezone) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const dateStr = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = parts.hour === '24' ? 0 : Number(parts.hour);
  const minutes = hour * 60 + Number(parts.minute);
  return { dateStr, minutes };
}

const BOOKING_INCLUDE = {
  client: { select: { id: true, name: true, email: true, phone: true } },
  professional: {
    select: {
      id: true, name: true, businessId: true, country: true,
      // Política de multa: viaja con cada booking para que el cliente vea el
      // aviso en su modal de cancelación sin otra request.
      cancelMinHours: true, cancelFeeEnabled: true, cancelFeeWindowHours: true, cancelFeeAmount: true,
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

// Sella el precio realmente reservado (fuente única de verdad). Aplica la
// promoción vigente del negocio sobre el servicio; para servicios a domicilio usa
// precio + recargo. Best-effort: nunca rompe la reserva si algo falla.
async function stampBookingPrice(booking) {
  try {
    if (booking.homeServiceId) {
      const hs = await prisma.homeService.findUnique({
        where: { id: booking.homeServiceId }, select: { price: true, surcharge: true },
      });
      const base = Number(hs?.price ?? 0) + Number(hs?.surcharge ?? 0);
      return prisma.booking.update({
        where: { id: booking.id },
        data: { price: base, originalPrice: base },
        include: BOOKING_INCLUDE,
      });
    }
    if (!booking.serviceId || !booking.service) return booking;
    const now = new Date();
    const businessId = booking.professional?.businessId
      ?? (await prisma.professional.findUnique({ where: { id: booking.professionalId }, select: { businessId: true } }))?.businessId;
    const promotions = businessId
      ? await prisma.promotion.findMany({ where: { businessId, isActive: true, startDate: { lte: now }, endDate: { gte: now } } })
      : [];
    const pricing = computeServicePricing(booking.service, promotions, now);
    return prisma.booking.update({
      where: { id: booking.id },
      data: {
        price: pricing.finalPrice,
        originalPrice: pricing.originalPrice,
        promoId: pricing.promoId,
        promoTitle: pricing.promoTitle,
      },
      include: BOOKING_INCLUDE,
    });
  } catch (e) {
    console.error('[booking] price stamp:', e.message);
    return booking;
  }
}

async function createBooking({ clientId, professionalId, serviceId, date, startTime, source, guestName, createClient }) {
  await assertBillingActive(professionalId);

  const localDate = parseLocalDate(date);
  // A-02: la validación de "fecha/hora pasada" se hace en la timezone del
  // negocio/profesional, no con el reloj UTC del servidor. A las 20:00 en Bogotá
  // aún es HOY, no "mañana UTC", así que una reserva de hoy no debe rechazarse.
  const bookingTz = await getTimezoneForBooking(professionalId);
  const { dateStr: todayStr, minutes: nowMinutes } = nowInTimezone(bookingTz);
  if (date < todayStr) throw new Error('Cannot book a past date');
  if (date === todayStr && toMinutes(startTime) < nowMinutes)
    throw new Error('Cannot book a past time');

  const [_dy, _dm, _dd] = date.split('-').map(Number);
  const dayOfWeek = new Date(_dy, _dm - 1, _dd).getDay();

  let booking = await retryOnConflict(() => prisma.$transaction(
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

      let sched, isActive;
      if (override) {
        isActive = override.isActive;
        sched    = override;
      } else {
        sched = await tx.schedule.findUnique({
          where: { professionalId_dayOfWeek: { professionalId, dayOfWeek } },
        });
        isActive = sched?.isActive ?? false;
      }

      if (!isActive) throw new Error('Professional not available on this day');
      // A-01: aceptar el slot si cae COMPLETO dentro de cualquier bloque (fulltime
      // o los dos bloques part_time), usando la misma construcción que el motor de
      // slots. Antes sólo se comparaba contra el primer bloque, y todo horario del
      // segundo bloque part-time fallaba con "Slot is outside working hours".
      const blocks = sched ? buildBlocks(sched) : [];
      if (!blocks.some((b) => slotStart >= b.start && slotEnd <= b.end))
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

      // M-05: si viene un cliente invitado a crear (reserva manual sin cuenta
      // existente), se crea DENTRO de la transacción y sólo DESPUÉS de validar el
      // slot. Así un slot inválido revierte todo y no deja usuarios huérfanos, y
      // cada reintento no acumula cuentas fantasma.
      let effectiveClientId = clientId;
      if (!effectiveClientId && createClient) {
        const created = await tx.user.create({ data: createClient });
        effectiveClientId = created.id;
      }
      if (!effectiveClientId) throw new Error('Client is required');

      return tx.booking.create({
        data: {
          clientId: effectiveClientId, professionalId, serviceId,
          // Reserva online del cliente (sin source) → PENDING: la confirma el
          // negocio/profesional desde su agenda. Reserva manual del staff
          // (source explícito: MANUAL/WHATSAPP/CALL/PRESENCIAL) → CONFIRMED
          // directo, la crea el propio staff y no necesita aprobación.
          date: localDate, startTime, endTime, status: source ? 'CONFIRMED' : 'PENDING',
          // M-05: source/guestName se estampan en el mismo insert (antes eran un
          // update posterior).
          ...(source ? { source } : {}),
          ...(guestName ? { guestName } : {}),
        },
        include: BOOKING_INCLUDE,
      });
    },
    { isolationLevel: 'Serializable' }
  ));


  // Sella el precio promocional real antes de notificar/retornar.
  booking = await stampBookingPrice(booking);

  // IMPORTANTE: se espera el envío DENTRO del ciclo de la petición. En serverless
  // (Vercel) la función se congela al responder, así que un envío fire-and-forget
  // nunca llega a completarse y el correo no sale. El .catch evita que un fallo de
  // Resend rompa la reserva ya confirmada.
  await emailService.sendBookingConfirmation(booking).catch(e => console.error('[email] confirmation:', e.message));
  return booking;
}

// Shape público de la política de multa que consumen los clientes (modal de
// cancelación, BookingPage). Decimal → Number para no serializar strings.
function feePolicyOf(pro) {
  return {
    enabled: pro?.cancelFeeEnabled ?? false,
    windowHours: pro?.cancelFeeWindowHours ?? 0,
    amount: pro?.cancelFeeAmount != null ? Number(pro.cancelFeeAmount) : null,
  };
}

async function getUserBookings(clientId) {
  const bookings = await prisma.booking.findMany({
    where: { clientId },
    include: BOOKING_INCLUDE,
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
  });
  // El cliente necesita ver la política de multa junto a cada cita (aviso al
  // cancelar). Se expone como objeto `cancellationFee` y se retiran los campos
  // crudos del professional para mantener un único contrato.
  return bookings.map((b) => ({
    ...b,
    professional: b.professional && {
      ...b.professional,
      cancellationFee: feePolicyOf(b.professional),
    },
  }));
}

// Returns { minHours, timezone, fee } for a booking
async function getCancelPolicy(professionalId) {
  const pro = await prisma.professional.findUnique({
    where:  { id: professionalId },
    select: {
      cancelMinHours: true, timezone: true,
      cancelFeeEnabled: true, cancelFeeWindowHours: true, cancelFeeAmount: true,
      business: { select: { cancelMinHours: true, timezone: true } },
    },
  });
  if (!pro) return { minHours: 0, timezone: 'America/Bogota', fee: feePolicyOf(null) };
  const bizHours = pro.business?.cancelMinHours ?? 0;
  const minHours = bizHours > 0 ? bizHours : (pro.cancelMinHours ?? 0);
  const timezone = pro.business?.timezone || pro.timezone || 'America/Bogota';
  return { minHours, timezone, fee: feePolicyOf(pro) };
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

// REGLA CENTRAL de la multa: si el profesional tiene cancelFeeEnabled=true, la
// multa REEMPLAZA el bloqueo duro de cancelación (tanto el cancelMinHours del
// pro como el del negocio que lo pisa): el cliente siempre puede cancelar; si
// lo hace con menos de cancelFeeWindowHours de anticipación se le genera una
// deuda (LATE_CANCEL). Con la multa desactivada todo queda exactamente como
// antes (assertCancellationWindow intacto). Aplica SOLO a cancelaciones del
// CLIENTE: las del negocio/profesional nunca multan.
// Devuelve el monto de la multa a aplicar, o null si no corresponde.
async function resolveClientCancellation(booking) {
  const { minHours, timezone, fee } = await getCancelPolicy(booking.professionalId);
  if (!fee.enabled) {
    assertCancellationWindow(booking, minHours, timezone);
    return null;
  }
  const amount = fee.amount ?? 0;
  if (fee.windowHours <= 0 || amount <= 0) return null;
  const bookingMs = bookingToUTCMs(booking.date, booking.startTime, timezone);
  const hoursLeft = (bookingMs - Date.now()) / 3600000;
  return hoursLeft < fee.windowHours ? amount : null;
}

// Crea la deuda dentro de la transacción que cambia el estado de la cita.
// Idempotente por bookingId @unique (upsert): un reintento no duplica deuda.
// El monto es snapshot del cancelFeeAmount vigente al momento del evento.
function createCancellationFee(tx, booking, amount, reason) {
  return tx.cancellationFee.upsert({
    where:  { bookingId: booking.id },
    create: {
      bookingId: booking.id,
      professionalId: booking.professionalId,
      clientId: booking.clientId,
      amount,
      reason,
    },
    update: {},
  });
}

async function cancelBooking(id, clientId) {
  const booking = await prisma.booking.findUnique({ where: { id } });
  if (!booking) throw new Error('Booking not found');
  if (booking.clientId !== clientId) throw new Error('Forbidden');
  if (booking.status === 'CANCELLED') throw new Error('Already cancelled');
  const feeAmount = await resolveClientCancellation(booking);

  // Update + deuda en la MISMA transacción: nunca queda una cancelación sin su
  // deuda ni una deuda de una cita que no llegó a cancelarse.
  const cancelled = await prisma.$transaction(async (tx) => {
    const upd = await tx.booking.update({
      where: { id },
      data: { status: 'CANCELLED' },
      include: BOOKING_INCLUDE,
    });
    if (feeAmount != null) await createCancellationFee(tx, booking, feeAmount, 'LATE_CANCEL');
    return upd;
  });
  await emailService.sendBookingCancellation(cancelled, { feeAmount }).catch(e => console.error('[email] cancellation:', e.message));
  return { ...cancelled, feeApplied: feeAmount != null ? { amount: feeAmount } : null };
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

  const bookings = await prisma.booking.findMany({
    where: { professional: { businessId }, ...dateFilter },
    include: BOOKING_INCLUDE,
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
  });
  return attachClientDebt(bookings);
}

// Adjunta a cada booking la deuda PENDIENTE del cliente con el profesional de
// ESA cita: clientDebt = { pendingCount, pendingTotal } | null. Un solo groupBy
// para toda la lista (sin N+1). La clave es el par cliente+profesional: la
// deuda es con cada profesional, no global del negocio.
async function attachClientDebt(bookings) {
  if (!bookings.length) return bookings;
  const clientIds = [...new Set(bookings.map((b) => b.clientId))];
  const proIds    = [...new Set(bookings.map((b) => b.professionalId))];
  const groups = await prisma.cancellationFee.groupBy({
    by: ['clientId', 'professionalId'],
    where: { status: 'PENDING', clientId: { in: clientIds }, professionalId: { in: proIds } },
    _count: { _all: true },
    _sum:   { amount: true },
  });
  const debtMap = new Map(groups.map((g) => [
    `${g.clientId}:${g.professionalId}`,
    { pendingCount: g._count._all, pendingTotal: Number(g._sum.amount ?? 0) },
  ]));
  return bookings.map((b) => ({
    ...b,
    clientDebt: debtMap.get(`${b.clientId}:${b.professionalId}`) ?? null,
  }));
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
  await emailService.sendBookingCancellation(cancelled).catch(e => console.error('[email] cancellation:', e.message));
  return cancelled;
}

// Cancelación hecha por el profesional desde su agenda. Nunca genera multa
// (las multas aplican solo a cancelaciones del cliente) ni valida ventana: el
// profesional gestiona su agenda libremente. El cliente recibe el correo de
// cancelación estándar.
async function cancelBookingAsProfessional(id, userId) {
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { professional: { select: { userId: true } } },
  });
  if (!booking) throw new Error('Booking not found');
  if (booking.professional?.userId !== userId) throw new Error('Forbidden');
  if (TERMINAL_STATUSES.has(booking.status))
    throw new Error('No se puede cancelar una cita cancelada, completada o marcada como no asistida.');

  const cancelled = await prisma.booking.update({
    where: { id },
    data: { status: 'CANCELLED' },
    include: BOOKING_INCLUDE,
  });
  await emailService.sendBookingCancellation(cancelled).catch(e => console.error('[email] cancellation:', e.message));
  return cancelled;
}

async function confirmBooking(id, userId) {
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { professional: { select: { userId: true, business: { select: { ownerId: true } } } } },
  });
  if (!booking) throw new Error('Booking not found');
  // Puede confirmar el dueño del negocio o el propio profesional de la cita
  // (imprescindible para profesionales independientes, sin negocio).
  const isOwner  = booking.professional.business?.ownerId === userId;
  const isOwnPro = booking.professional.userId === userId;
  if (!isOwner && !isOwnPro) throw new Error('Forbidden');
  if (booking.status !== 'PENDING') throw new Error('Only PENDING bookings can be confirmed');

  const confirmed = await prisma.booking.update({
    where: { id },
    data: { status: 'CONFIRMED' },
    include: BOOKING_INCLUDE,
  });

  // Este es el momento real de "confirmada": avisar al cliente. El lado
  // negocio no se re-notifica (ya recibió el aviso de nueva reserva al crearse).
  await emailService.sendBookingConfirmation(confirmed, { clientOnly: true }).catch(e => console.error('[email] confirm:', e.message));

  return confirmed;
}

async function rescheduleBooking(id, userId, { date, startTime }) {
  const localDate = parseLocalDate(date);

  // Puede aplazar el cliente de la cita o el profesional que la atiende.
  const existingForPolicy = await prisma.booking.findUnique({
    where: { id },
    include: { professional: { select: { userId: true } } },
  });
  if (!existingForPolicy) throw new Error('Booking not found');
  const actor = existingForPolicy.clientId === userId ? 'client'
    : existingForPolicy.professional?.userId === userId ? 'professional'
    : null;
  if (!actor) throw new Error('Forbidden');

  const { minHours, timezone } = await getCancelPolicy(existingForPolicy.professionalId);
  const rescheduleTz = timezone;
  // La ventana de cancelación restringe al CLIENTE; el profesional gestiona su
  // propia agenda sin esa restricción.
  if (actor === 'client') assertCancellationWindow(existingForPolicy, minHours, timezone);

  // A-02: "fecha/hora pasada" en la timezone del negocio/profesional, no UTC.
  const { dateStr: todayStr, minutes: nowMinutes } = nowInTimezone(rescheduleTz);
  if (date < todayStr) throw new Error('Cannot reschedule to a past date');
  if (date === todayStr && toMinutes(startTime) < nowMinutes)
    throw new Error('Cannot reschedule to a past time');

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
      // Propiedad ya validada fuera de la transacción (cliente o profesional de
      // la cita); clientId/professionalId son inmutables en un booking.
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
      let rSched, rIsActive;
      if (rOverride) {
        rIsActive = rOverride.isActive;
        rSched    = rOverride;
      } else {
        rSched = await tx.schedule.findUnique({
          where: { professionalId_dayOfWeek: { professionalId, dayOfWeek } },
        });
        rIsActive = rSched?.isActive ?? false;
      }
      if (!rIsActive) throw new Error('Professional not available on this day');
      // A-01: aceptar si el slot cae COMPLETO dentro de cualquier bloque
      // (fulltime o los dos bloques part_time), igual que el motor de slots.
      const rBlocks = rSched ? buildBlocks(rSched) : [];
      if (!rBlocks.some((b) => slotStart >= b.start && slotEnd <= b.end))
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

      // F-009: no forzar status:'CONFIRMED'. Si la cita estaba PENDING (esperando
      // aprobación manual del negocio), reagendar no debe saltarla a CONFIRMED sin
      // aprobación. Los estados terminales ya se bloquean arriba (TERMINAL_STATUSES),
      // así que preservar el estado previo es seguro.
      return tx.booking.update({
        where: { id },
        data: { date: localDate, startTime, endTime },
        include: BOOKING_INCLUDE,
      });
    },
    { isolationLevel: 'Serializable' }
  ));

  // Notificar el cambio de fecha/hora a la otra parte: al cliente si movió el
  // profesional; al negocio/profesional si movió el cliente.
  await emailService.sendBookingReschedule(rescheduled, {
    actor,
    oldDate: existingForPolicy.date,
    oldStartTime: existingForPolicy.startTime,
  }).catch(e => console.error('[email] reschedule:', e.message));

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

  // M-05: para el invitado sin cuenta, NO se crea el User aquí (antes de validar
  // el slot). Se prepara la data y se difiere su creación al interior de la
  // transacción de createBooking, que sólo la ejecuta si el slot es válido.
  let resolvedClientId = client ? client.id : null;
  let createClient = null;

  if (!client) {
    const bcrypt = require('bcryptjs');
    const crypto = require('crypto');
    if (isWalkIn && !lookupEmail) {
      // C-01: cita presencial/walk-in sin email NO crea una cuenta nueva por
      // cada cita (eso generaba usuarios CLIENT fantasma, acumulables y
      // enumerables). Se reutiliza un único usuario placeholder por negocio
      // (o por profesional independiente). El nombre real del cliente vive en
      // booking.guestName, no en el User. El upsert es idempotente, así que no
      // deja huérfanos aunque createBooking falle después.
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
      resolvedClientId = client.id;
    } else {
      const tempPass = crypto.randomBytes(16).toString('hex');
      createClient = {
        name:     clientName || (lookupEmail ? lookupEmail.split('@')[0] : 'Cliente'),
        email:    lookupEmail || `guest-${crypto.randomBytes(8).toString('hex')}@slotly.internal`,
        password: await bcrypt.hash(tempPass, 12),
        role:     'CLIENT',
        ...(clientPhone ? { phone: clientPhone } : {}),
      };
    }
  }

  // Reuse core booking logic (validates schedule, conflicts, etc.). El invitado
  // (createClient) se crea dentro de la transacción tras validar el slot, y
  // source/guestName se estampan en el mismo insert (M-05).
  return createBooking({
    clientId: resolvedClientId,
    professionalId, serviceId, date, startTime,
    source: safeSource,
    guestName: clientName || null,
    createClient,
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
  // No-show multa siempre que la política esté activada (sin ventana: no
  // presentarse es siempre "tardío"). Misma transacción e idempotencia que la
  // cancelación tardía.
  const { fee } = await getCancelPolicy(booking.professionalId);
  const feeAmount = fee.enabled && (fee.amount ?? 0) > 0 ? fee.amount : null;
  return prisma.$transaction(async (tx) => {
    const upd = await tx.booking.update({
      where: { id },
      data: { status: 'NO_SHOW' },
      include: BOOKING_INCLUDE,
    });
    if (feeAmount != null) await createCancellationFee(tx, booking, feeAmount, 'NO_SHOW');
    return upd;
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

module.exports = { createBooking, getUserBookings, cancelBooking, cancelBookingAsOwner, cancelBookingAsProfessional, getBusinessBookings, confirmBooking, rescheduleBooking, createManualBooking, markNoShow, markComplete, getCancelPolicy, assertCancellationWindow, nowInTimezone, resolveClientCancellation, createCancellationFee, attachClientDebt, feePolicyOf };
