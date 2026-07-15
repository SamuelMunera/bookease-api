const prisma = require('../config/database');

// Estados válidos de una multa. PENDING se permite en update para poder
// revertir un "Cobrada"/"Perdonada" marcado por error.
const VALID_STATUSES = ['PENDING', 'PAID', 'FORGIVEN'];

async function getProfessional(userId) {
  const prof = await prisma.professional.findUnique({ where: { userId } });
  if (!prof) throw new Error('Professional profile not found');
  return prof;
}

// Multas del profesional autenticado: listado (opcionalmente filtrado por
// status) + resumen SIEMPRE global (el resumen no cambia con el filtro, es el
// estado real de la deuda). Decimal → Number en todos los montos.
async function listMyDebts(userId, { status } = {}) {
  const prof = await getProfessional(userId);
  const where = { professionalId: prof.id };
  if (status && VALID_STATUSES.includes(status)) where.status = status;

  const [fees, groups, pendingDebtors] = await Promise.all([
    prisma.cancellationFee.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        client: { select: { id: true, name: true, email: true, phone: true } },
        booking: {
          select: {
            id: true, date: true, startTime: true,
            service:     { select: { name: true } },
            homeService: { select: { name: true } },
          },
        },
      },
    }),
    prisma.cancellationFee.groupBy({
      by: ['status'],
      where: { professionalId: prof.id },
      _count: { _all: true },
      _sum:   { amount: true },
    }),
    prisma.cancellationFee.groupBy({
      by: ['clientId'],
      where: { professionalId: prof.id, status: 'PENDING' },
    }),
  ]);

  const by = Object.fromEntries(groups.map((g) => [g.status, g]));

  return {
    summary: {
      pendingCount:  by.PENDING?._count._all ?? 0,
      pendingTotal:  Number(by.PENDING?._sum.amount ?? 0),
      paidTotal:     Number(by.PAID?._sum.amount ?? 0),
      forgivenTotal: Number(by.FORGIVEN?._sum.amount ?? 0),
      debtors:       pendingDebtors.length,
    },
    debts: fees.map((f) => ({
      id: f.id,
      amount: Number(f.amount),
      status: f.status,
      reason: f.reason,
      createdAt: f.createdAt,
      resolvedAt: f.resolvedAt,
      client: f.client,
      booking: {
        id: f.booking.id,
        date: f.booking.date,
        startTime: f.booking.startTime,
        serviceName: f.booking.service?.name ?? f.booking.homeService?.name ?? null,
      },
    })),
  };
}

// Cambia el estado de una multa validando que pertenezca al profesional.
// resolvedAt marca cuándo se cobró/perdonó; volver a PENDING lo limpia.
async function updateDebtStatus(userId, feeId, status) {
  if (!VALID_STATUSES.includes(status)) {
    const err = new Error('Estado inválido. Usa PENDING, PAID o FORGIVEN.');
    err.status = 400;
    throw err;
  }
  const prof = await getProfessional(userId);
  const fee = await prisma.cancellationFee.findUnique({ where: { id: feeId } });
  if (!fee || fee.professionalId !== prof.id) {
    const err = new Error('Multa no encontrada');
    err.status = 404;
    throw err;
  }
  const updated = await prisma.cancellationFee.update({
    where: { id: feeId },
    data: { status, resolvedAt: status === 'PENDING' ? null : new Date() },
  });
  return { ...updated, amount: Number(updated.amount) };
}

module.exports = { listMyDebts, updateDebtStatus };
