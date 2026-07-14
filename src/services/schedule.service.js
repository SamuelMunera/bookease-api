const prisma = require('../config/database');

// IDOR guard: requireRole('BUSINESS_OWNER') valida el rol pero NO la
// pertenencia — sin este check cualquier dueño podía escribir o borrar
// horarios/excepciones de profesionales de otros negocios.
async function assertProfessionalOwnership(professionalId, callerId) {
  const prof = await prisma.professional.findUnique({
    where: { id: professionalId },
    select: { business: { select: { ownerId: true } } },
  });
  if (!prof?.business || prof.business.ownerId !== callerId) throw new Error('Forbidden');
}

// --- Schedules (weekly recurring) ---

async function setSchedule(callerId, professionalId, { dayOfWeek, startTime, endTime, isActive, scheduleType, secondStartTime, secondEndTime }) {
  await assertProfessionalOwnership(professionalId, callerId);
  // Persiste turno partido (part_time) e isActive de forma consistente con
  // setMySchedule. Spread condicional: si el caller no envía scheduleType/segundo
  // bloque, el update PRESERVA lo existente (no lo resetea a fulltime) y el create
  // cae a los defaults del schema; si los envía, se guardan.
  const data = {
    startTime, endTime, isActive: isActive ?? true,
    ...(scheduleType    !== undefined ? { scheduleType }    : {}),
    ...(secondStartTime !== undefined ? { secondStartTime } : {}),
    ...(secondEndTime   !== undefined ? { secondEndTime }   : {}),
  };
  return prisma.schedule.upsert({
    where: { professionalId_dayOfWeek: { professionalId, dayOfWeek } },
    update: data,
    create: { professionalId, dayOfWeek, ...data },
  });
}

async function getSchedules(professionalId) {
  return prisma.schedule.findMany({
    where: { professionalId },
    orderBy: { dayOfWeek: 'asc' },
  });
}

async function deleteSchedule(callerId, id) {
  const row = await prisma.schedule.findUnique({ where: { id }, select: { professionalId: true } });
  if (!row) throw new Error('Schedule not found');
  await assertProfessionalOwnership(row.professionalId, callerId);
  return prisma.schedule.delete({ where: { id } });
}

// --- Schedule exceptions (date blocks) ---

async function createException(callerId, professionalId, { date, startTime, endTime, reason }) {
  await assertProfessionalOwnership(professionalId, callerId);
  return prisma.scheduleException.create({
    data: { professionalId, date: new Date(date), startTime, endTime, reason },
  });
}

async function getExceptions(professionalId) {
  return prisma.scheduleException.findMany({
    where: { professionalId },
    orderBy: { date: 'asc' },
  });
}

async function deleteException(callerId, id) {
  const row = await prisma.scheduleException.findUnique({ where: { id }, select: { professionalId: true } });
  if (!row) throw new Error('Exception not found');
  await assertProfessionalOwnership(row.professionalId, callerId);
  return prisma.scheduleException.delete({ where: { id } });
}

module.exports = { setSchedule, getSchedules, deleteSchedule, createException, getExceptions, deleteException };
