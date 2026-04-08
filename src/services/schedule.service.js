const prisma = require('../config/database');

// --- Schedules (weekly recurring) ---

async function setSchedule(professionalId, { dayOfWeek, startTime, endTime, isActive }) {
  return prisma.schedule.upsert({
    where: { professionalId_dayOfWeek: { professionalId, dayOfWeek } },
    update: { startTime, endTime, isActive: isActive ?? true },
    create: { professionalId, dayOfWeek, startTime, endTime },
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
