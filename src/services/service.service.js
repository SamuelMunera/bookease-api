const prisma = require('../config/database');

async function create(businessId, data) {
  return prisma.service.create({ data: { ...data, businessId } });
}

async function findByBusiness(businessId) {
  return prisma.service.findMany({ where: { businessId } });
}

async function update(id, data) {
  return prisma.service.update({ where: { id }, data });
}

async function remove(id) {
  return prisma.service.delete({ where: { id } });
}

module.exports = { create, findByBusiness, update, remove };
