const prisma = require('../config/database');
const { isLoyaltyEligiblePlan } = require('../config/plans');

// Fidelización tipo punch-card. Reglas cerradas en el debate de diseño:
// - Solo suma sello una cita COMPLETED, una única vez (LoyaltyStamp.bookingId @unique).
// - Elegibilidad evaluada AL MOMENTO de completar: negocio con plan Estudio+,
//   programa activo, y cliente con cuenta real (no walk-in/guest @slotly.internal).
// - Al llegar a la meta se emite recompensa (snapshot de la config) y el contador
//   del ciclo se reinicia a 0.
// - Congelar, nunca borrar: pausar el programa o bajar de plan detiene la
//   acumulación pero conserva tarjetas y recompensas; lo ya ganado se redime siempre.

const INTERNAL_EMAIL_SUFFIX = '@slotly.internal';

// Etiqueta legible de una recompensa (o de un programa, para marketing). Si hay
// rewardDescription se usa como texto preferente; si no, se compone por tipo.
function rewardLabelOf(r) {
  if (!r) return '';
  if (r.rewardDescription && r.rewardDescription.trim()) return r.rewardDescription.trim();
  if (r.rewardType === 'FREE_SERVICE') {
    const name = r.rewardServiceName || r.serviceName;
    return name ? `Servicio gratis: ${name}` : 'Un servicio gratis';
  }
  if (r.rewardType === 'DISCOUNT' && r.rewardDiscount != null) {
    return `${r.rewardDiscount}% de descuento`;
  }
  return 'Recompensa';
}

// Resuelve la elegibilidad de una cita para sellar SOLO con lecturas. Devuelve
// null (no-op silencioso) si no aplica, o { program, businessId, clientId } si sí.
// Se llama ANTES de abrir la transacción de markComplete, de modo que dentro de
// la tx solo queden writes puros y el único modo de fallo sea un fallo real de DB.
async function getAccrualContext(booking) {
  const businessId = booking.professional?.businessId;
  if (!businessId) return null; // profesional independiente, sin negocio

  const clientEmail = booking.client?.email;
  if (!clientEmail || clientEmail.endsWith(INTERNAL_EMAIL_SUFFIX)) return null; // walk-in/guest

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, plan: true },
  });
  if (!business || !isLoyaltyEligiblePlan(business.plan ?? 'team')) return null;

  const program = await prisma.loyaltyProgram.findUnique({ where: { businessId } });
  if (!program || !program.isActive) return null;

  return { program, businessId, clientId: booking.clientId };
}

// Emite una recompensa (snapshot de la config del programa). ÚNICO punto que
// crea LoyaltyReward. Debe correr dentro de una transacción ya abierta.
async function emitRewardInTx(tx, card, program) {
  let rewardServiceName = null;
  if (program.rewardType === 'FREE_SERVICE' && program.rewardServiceId) {
    const svc = await tx.service.findUnique({
      where: { id: program.rewardServiceId },
      select: { name: true },
    });
    rewardServiceName = svc?.name ?? null;
  }
  return tx.loyaltyReward.create({
    data: {
      cardId:            card.id,
      businessId:        card.businessId,
      clientId:          card.clientId,
      status:            'EARNED',
      rewardType:        program.rewardType,
      rewardServiceId:   program.rewardServiceId ?? null,
      rewardServiceName,
      rewardDiscount:    program.rewardDiscount ?? null,
      rewardDescription: program.rewardDescription ?? null,
    },
  });
}

// Suma el sello de una cita dentro de una transacción abierta. Idempotente: si
// la cita ya estaba sellada (P2002 en bookingId @unique), sale sin efecto.
async function accrueStampInTx(tx, booking, ctx) {
  const { program, businessId, clientId } = ctx;

  // Tarjeta del par (negocio, cliente). Upsert evita carrera de creación.
  const card = await tx.loyaltyCard.upsert({
    where: { businessId_clientId: { businessId, clientId } },
    create: { programId: program.id, businessId, clientId },
    update: {},
  });

  // El sello es la barrera de idempotencia. Si ya existe, no re-contamos.
  try {
    await tx.loyaltyStamp.create({
      data: { cardId: card.id, bookingId: booking.id, cycle: card.cyclesCompleted + 1 },
    });
  } catch (err) {
    if (err.code === 'P2002') return; // cita ya sellada: no-op
    throw err;
  }

  // El UPDATE con row-lock serializa incrementos concurrentes; evaluamos sobre
  // el valor devuelto, que ya incluye este sello.
  const updated = await tx.loyaltyCard.update({
    where: { id: card.id },
    data: { stamps: { increment: 1 }, totalStamps: { increment: 1 } },
  });

  if (updated.stamps >= program.stampsRequired) {
    await emitRewardInTx(tx, updated, program);
    await tx.loyaltyCard.update({
      where: { id: card.id },
      data: { stamps: 0, cyclesCompleted: { increment: 1 } },
    });
  }
}

// ─── Config del programa (owner) ────────────────────────────────────────────

const VALID_REWARD_TYPES = ['FREE_SERVICE', 'DISCOUNT', 'CUSTOM'];

function serializeProgram(p) {
  if (!p) return null;
  return {
    id: p.id,
    isActive: p.isActive,
    stampsRequired: p.stampsRequired,
    rewardType: p.rewardType,
    rewardServiceId: p.rewardServiceId,
    rewardDiscount: p.rewardDiscount,
    rewardDescription: p.rewardDescription,
  };
}

async function getProgram(businessId) {
  const program = await prisma.loyaltyProgram.findUnique({ where: { businessId } });
  return serializeProgram(program);
}

// Valida y guarda la config; devuelve { program, rewardsEmitted, error? }. Al
// activar (o mientras esté activo), hace un barrido: las tarjetas que ya
// alcanzan la meta actual reciben su recompensa inmediatamente (máx 1 por
// tarjeta) — evita estados imposibles tipo "7 de 5" cuando el owner baja la meta.
async function upsertProgram(business, body) {
  const { isActive, stampsRequired, rewardType, rewardServiceId, rewardDiscount, rewardDescription } = body;

  const stamps = Number(stampsRequired);
  if (!Number.isInteger(stamps) || stamps < 1 || stamps > 20) {
    return { error: 'La cantidad de sellos debe ser un número entero entre 1 y 20' };
  }
  const type = VALID_REWARD_TYPES.includes(rewardType) ? rewardType : null;
  if (!type) return { error: 'Tipo de recompensa inválido' };

  const desc = typeof rewardDescription === 'string' ? rewardDescription.trim() : '';
  if (desc.length > 300) return { error: 'La descripción no puede superar 300 caracteres' };

  let svcId = null;
  let discount = null;
  if (type === 'FREE_SERVICE') {
    if (!rewardServiceId) return { error: 'Debes elegir el servicio de la recompensa' };
    const svc = await prisma.service.findUnique({ where: { id: rewardServiceId }, select: { businessId: true } });
    if (!svc || svc.businessId !== business.id) return { error: 'El servicio de la recompensa no es válido' };
    svcId = rewardServiceId;
  } else if (type === 'DISCOUNT') {
    const d = Number(rewardDiscount);
    if (!Number.isInteger(d) || d <= 0 || d > 100) {
      return { error: 'El descuento debe ser un número entero entre 1 y 100' };
    }
    discount = d;
  } else if (type === 'CUSTOM') {
    if (!desc) return { error: 'Describe la recompensa para el cliente' };
  }

  const data = {
    isActive: Boolean(isActive),
    stampsRequired: stamps,
    rewardType: type,
    // Coherencia: se escriben nulls en los campos de los tipos no elegidos.
    rewardServiceId:   type === 'FREE_SERVICE' ? svcId : null,
    rewardDiscount:    type === 'DISCOUNT' ? discount : null,
    rewardDescription: desc || null,
  };

  const result = await prisma.$transaction(async (tx) => {
    const program = await tx.loyaltyProgram.upsert({
      where: { businessId: business.id },
      create: { businessId: business.id, ...data },
      update: data,
    });

    let rewardsEmitted = 0;
    if (program.isActive) {
      // Barrido de metas: tarjetas cuyo ciclo actual ya cumple la meta reciben
      // su recompensa ahora. Reset a 0 sin acarreo, máx 1 recompensa por tarjeta.
      const readyCards = await tx.loyaltyCard.findMany({
        where: { programId: program.id, stamps: { gte: program.stampsRequired } },
      });
      for (const card of readyCards) {
        await emitRewardInTx(tx, card, program);
        await tx.loyaltyCard.update({
          where: { id: card.id },
          data: { stamps: 0, cyclesCompleted: { increment: 1 } },
        });
        rewardsEmitted++;
      }
    }
    return { program, rewardsEmitted };
  });

  return { program: serializeProgram(result.program), rewardsEmitted: result.rewardsEmitted };
}

// ─── Vistas del cliente ─────────────────────────────────────────────────────

function serializeReward(r) {
  return {
    id: r.id,
    status: r.status,
    rewardLabel: rewardLabelOf(r),
    earnedAt: r.earnedAt,
    redeemedAt: r.redeemedAt,
  };
}

// Todas las tarjetas del cliente (una por negocio con programa). Incluye
// recompensas EARNED y REDEEMED (historial).
async function getMyCards(clientId) {
  const cards = await prisma.loyaltyCard.findMany({
    where: { clientId },
    include: {
      program: { include: { business: { select: { id: true, name: true, logoUrl: true, plan: true } } } },
      rewards: { orderBy: { earnedAt: 'desc' } },
    },
    orderBy: { updatedAt: 'desc' },
  });
  return cards
    .filter((c) => c.program) // defensivo
    .map((c) => {
      const program = c.program;
      const active = program.isActive && isLoyaltyEligiblePlan(program.business?.plan ?? 'team');
      return {
        business: {
          id: program.business?.id,
          name: program.business?.name,
          logoUrl: program.business?.logoUrl ?? null,
        },
        active,
        stampsRequired: program.stampsRequired,
        rewardLabel: rewardLabelOf(program),
        stamps: c.stamps,
        cyclesCompleted: c.cyclesCompleted,
        rewards: c.rewards.map(serializeReward),
      };
    });
}

// Tarjeta del cliente autenticado en UN negocio. Las recompensas EARNED se
// devuelven aunque el programa esté pausado o el plan haya bajado (lo ganado se
// conserva y se redime siempre).
async function getCardForBusiness(clientId, businessId) {
  const program = await prisma.loyaltyProgram.findUnique({
    where: { businessId },
    include: { business: { select: { plan: true } } },
  });
  const active = !!program && program.isActive && isLoyaltyEligiblePlan(program.business?.plan ?? 'team');

  const card = await prisma.loyaltyCard.findUnique({
    where: { businessId_clientId: { businessId, clientId } },
    include: { rewards: { orderBy: { earnedAt: 'desc' } } },
  });

  return {
    active,
    program: program ? { stampsRequired: program.stampsRequired, rewardLabel: rewardLabelOf(program) } : null,
    card: card ? { stamps: card.stamps, cyclesCompleted: card.cyclesCompleted } : null,
    rewards: card ? card.rewards.map(serializeReward) : [],
  };
}

// Programa público de un negocio (marketing en la ficha). Solo revela datos si
// el plan es elegible y el programa está activo.
async function getPublicProgram(businessId) {
  const program = await prisma.loyaltyProgram.findUnique({
    where: { businessId },
    include: { business: { select: { plan: true } } },
  });
  if (!program || !program.isActive || !isLoyaltyEligiblePlan(program.business?.plan ?? 'team')) {
    return { active: false };
  }
  return {
    active: true,
    stampsRequired: program.stampsRequired,
    rewardType: program.rewardType,
    rewardLabel: rewardLabelOf(program),
  };
}

// ─── Vistas del negocio ─────────────────────────────────────────────────────

// Listado de clientes con progreso, para el panel del owner.
async function listClients(businessId, { search, page = 1, limit = 20 } = {}) {
  const take = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const skip = (Math.max(Number(page) || 1, 1) - 1) * take;

  const program = await prisma.loyaltyProgram.findUnique({ where: { businessId } });
  const stampsRequired = program?.stampsRequired ?? null;

  const where = {
    businessId,
    ...(search && search.trim()
      ? { client: { OR: [
          { name:  { contains: search.trim(), mode: 'insensitive' } },
          { email: { contains: search.trim(), mode: 'insensitive' } },
        ] } }
      : {}),
  };

  const [total, cards] = await Promise.all([
    prisma.loyaltyCard.count({ where }),
    prisma.loyaltyCard.findMany({
      where,
      include: {
        client: { select: { id: true, name: true, email: true } },
        rewards: { where: { status: 'EARNED' }, select: { id: true } },
        stampsLog: { select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
      skip,
      take,
    }),
  ]);

  return {
    total,
    clients: cards.map((c) => ({
      clientId: c.clientId,
      name: c.client?.name ?? null,
      email: c.client?.email ?? null,
      stamps: c.stamps,
      stampsRequired,
      cyclesCompleted: c.cyclesCompleted,
      pendingRewards: c.rewards.length,
      lastStampAt: c.stampsLog[0]?.createdAt ?? null,
    })),
  };
}

// Redime una recompensa EARNED. Autoriza owner del negocio o profesional del
// mismo negocio. SIN gate de plan: lo ya ganado se redime siempre. Anti
// doble-canje atómico vía updateMany condicionado por status.
async function redeemReward(rewardId, userId) {
  const reward = await prisma.loyaltyReward.findUnique({ where: { id: rewardId } });
  if (!reward) throw new Error('NOT_FOUND');

  // Autorización por relaciones (nunca por conocer el id).
  const business = await prisma.business.findFirst({
    where: { id: reward.businessId, ownerId: userId },
    select: { id: true },
  });
  let authorized = !!business;
  if (!authorized) {
    const pro = await prisma.professional.findUnique({
      where: { userId },
      select: { businessId: true },
    });
    authorized = !!pro && pro.businessId === reward.businessId;
  }
  if (!authorized) throw new Error('FORBIDDEN');

  const res = await prisma.loyaltyReward.updateMany({
    where: { id: rewardId, status: 'EARNED' },
    data: { status: 'REDEEMED', redeemedAt: new Date(), redeemedById: userId },
  });
  if (res.count === 0) throw new Error('ALREADY_REDEEMED');

  const updated = await prisma.loyaltyReward.findUnique({ where: { id: rewardId } });
  return serializeReward(updated);
}

// Enriquece una lista de bookings de UN negocio con clientLoyalty por cita, en
// pocas queries (sin N+1). No muta la forma actual: solo añade el campo.
// clientLoyalty = { stamps, target, active, rewardPending: { id, label } | null } | null.
async function attachLoyaltyToBookings(bookings, businessId) {
  const withField = bookings.map((b) => ({ ...b, clientLoyalty: null }));
  if (!businessId || !withField.length) return withField;

  const program = await prisma.loyaltyProgram.findUnique({
    where: { businessId },
    include: { business: { select: { plan: true } } },
  });
  if (!program) return withField;

  const active = program.isActive && isLoyaltyEligiblePlan(program.business?.plan ?? 'team');

  // Clientes reales de la lista (excluye walk-ins/guests sin cuenta).
  const clientIds = [...new Set(
    withField
      .filter((b) => b.client?.email && !b.client.email.endsWith(INTERNAL_EMAIL_SUFFIX))
      .map((b) => b.clientId)
  )];
  if (!clientIds.length) return withField;

  const [cards, rewards] = await Promise.all([
    prisma.loyaltyCard.findMany({
      where: { businessId, clientId: { in: clientIds } },
      select: { clientId: true, stamps: true },
    }),
    prisma.loyaltyReward.findMany({
      where: { businessId, clientId: { in: clientIds }, status: 'EARNED' },
      orderBy: { earnedAt: 'asc' },
    }),
  ]);

  const cardMap = new Map(cards.map((c) => [c.clientId, c]));
  const rewardMap = new Map(); // clientId -> primera recompensa EARNED
  for (const r of rewards) {
    if (!rewardMap.has(r.clientId)) rewardMap.set(r.clientId, r);
  }

  return withField.map((b) => {
    if (!b.client?.email || b.client.email.endsWith(INTERNAL_EMAIL_SUFFIX)) return b;
    const card = cardMap.get(b.clientId);
    const pending = rewardMap.get(b.clientId);
    // Si no hay tarjeta ni recompensa pendiente, no adjuntamos nada.
    if (!card && !pending) return b;
    return {
      ...b,
      clientLoyalty: {
        stamps: card?.stamps ?? 0,
        target: program.stampsRequired,
        active,
        rewardPending: pending ? { id: pending.id, label: rewardLabelOf(pending) } : null,
      },
    };
  });
}

module.exports = {
  rewardLabelOf,
  getAccrualContext,
  accrueStampInTx,
  emitRewardInTx,
  getProgram,
  upsertProgram,
  getMyCards,
  getCardForBusiness,
  getPublicProgram,
  listClients,
  redeemReward,
  attachLoyaltyToBookings,
};
