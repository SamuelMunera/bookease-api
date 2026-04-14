const prisma = require('../config/database');

async function create(businessId, data) {
  return prisma.professional.create({ data: { ...data, businessId } });
}

async function findByBusiness(businessId) {
  return prisma.professional.findMany({ where: { businessId } });
}

async function findById(id) {
  return prisma.professional.findUnique({
    where: { id },
    include: { business: { select: { id: true, name: true } } },
  });
}

async function update(id, data) {
  return prisma.professional.update({ where: { id }, data });
}

async function remove(id) {
  return prisma.professional.delete({ where: { id } });
}

module.exports = { create, findByBusiness, findById, update, remove };
