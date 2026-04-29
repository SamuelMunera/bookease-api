const prisma = require('../config/database');
const { getPlanLimit } = require('../config/plans');

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

async function getOrCreateJoinCode(ownerId) {
  const business = await prisma.business.findFirst({ where: { ownerId } });
  if (!business) throw new Error('No se encontró un negocio para este usuario');
  if (business.joinCode) return business;

  let code;
  let attempts = 0;
  do {
    code = generateCode();
    if (++attempts > 10) throw new Error('No se pudo generar un código único');
  } while (await prisma.business.findUnique({ where: { joinCode: code } }));

  return prisma.business.update({ where: { id: business.id }, data: { joinCode: code } });
}

async function submitJoinRequest(userId, code) {
  const prof = await prisma.professional.findUnique({ where: { userId } });
  if (!prof) throw new Error('Perfil profesional no encontrado');
  if (prof.businessId) throw new Error('Ya estás vinculado a un negocio');

  const business = await prisma.business.findUnique({ where: { joinCode: code.trim().toUpperCase() } });
  if (!business) throw new Error('Código inválido. Verifica con el dueño del negocio.');

  const existing = await prisma.joinRequest.findUnique({
    where: { professionalId_businessId: { professionalId: prof.id, businessId: business.id } },
  });

  if (existing) {
    if (existing.status === 'PENDING') throw new Error('Ya tienes una solicitud pendiente para este negocio');
    if (existing.status === 'APPROVED') throw new Error('Ya fuiste aprobado en este negocio');
    return prisma.joinRequest.update({
      where: { id: existing.id },
      data: { status: 'PENDING' },
      include: { business: { select: { id: true, name: true } } },
    });
  }

  return prisma.joinRequest.create({
    data: { professionalId: prof.id, businessId: business.id },
    include: { business: { select: { id: true, name: true } } },
  });
}

async function getMyJoinRequest(userId) {
  const prof = await prisma.professional.findUnique({ where: { userId } });
  if (!prof) throw new Error('Perfil profesional no encontrado');
  return prisma.joinRequest.findFirst({
    where: { professionalId: prof.id },
    orderBy: { createdAt: 'desc' },
    include: { business: { select: { id: true, name: true, city: true, category: true } } },
  });
}

async function getBusinessJoinRequests(ownerId) {
  const business = await prisma.business.findFirst({ where: { ownerId } });
  if (!business) throw new Error('No se encontró un negocio para este usuario');
  return prisma.joinRequest.findMany({
    where: { businessId: business.id, status: 'PENDING' },
    include: {
      professional: { select: { id: true, name: true, specialty: true, phone: true, bio: true, experience: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
}

async function approveRequest(ownerId, requestId) {
  const business = await prisma.business.findFirst({
    where: { ownerId },
    include: { professionals: { select: { id: true } } },
  });
  if (!business) throw new Error('No se encontró un negocio para este usuario');

  const limit = getPlanLimit(business.plan ?? 'team');
  if (business.professionals.length >= limit) {
    const planNames = { solo:'Independiente', team:'Equipo', studio:'Estudio', enterprise:'Empresarial' };
    const err = new Error(
      `Tu plan ${planNames[business.plan] ?? business.plan} permite máximo ${limit} profesional${limit !== 1 ? 'es' : ''}. Actualiza tu plan para agregar más.`
    );
    err.code = 'PLAN_LIMIT_EXCEEDED';
    throw err;
  }

  const joinReq = await prisma.joinRequest.findFirst({ where: { id: requestId, businessId: business.id } });
  if (!joinReq) throw new Error('Solicitud no encontrada');
  if (joinReq.status !== 'PENDING') throw new Error('La solicitud ya fue procesada');

  const [updated] = await prisma.$transaction([
    prisma.joinRequest.update({ where: { id: requestId }, data: { status: 'APPROVED' } }),
    prisma.professional.update({ where: { id: joinReq.professionalId }, data: { businessId: business.id } }),
  ]);
  return updated;
}

async function rejectRequest(ownerId, requestId) {
  const business = await prisma.business.findFirst({ where: { ownerId } });
  if (!business) throw new Error('No se encontró un negocio para este usuario');

  const joinReq = await prisma.joinRequest.findFirst({ where: { id: requestId, businessId: business.id } });
  if (!joinReq) throw new Error('Solicitud no encontrada');
  if (joinReq.status !== 'PENDING') throw new Error('La solicitud ya fue procesada');

  return prisma.joinRequest.update({ where: { id: requestId }, data: { status: 'REJECTED' } });
}

module.exports = { getOrCreateJoinCode, submitJoinRequest, getMyJoinRequest, getBusinessJoinRequests, approveRequest, rejectRequest };
