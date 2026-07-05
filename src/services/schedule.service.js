const prisma = require('../config/database');

// --- Schedules (weekly recurring) ---

async function setSchedule(professionalId, { dayOfWeek, startTime, endTime, isActive, scheduleType, secondStartTime, secondEndTime }) {
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

async function deleteSchedule(id) {
  return prisma.schedule.delete({ where: { id } });
}

// --- Schedule exceptions (date blocks) ---

async function createException(professionalId, { date, startTime, endTime, reason }) {
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

async function deleteException(id) {
  return prisma.scheduleException.delete({ where: { id } });
}

module.exports = { setSchedule, getSchedules, deleteSchedule, createException, getExceptions, deleteException };
