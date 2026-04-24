const prisma = require('../config/database');
const { haversine, geocodeAddress } = require('../utils/geo');

const BUSINESS_EDITABLE = ['name', 'description', 'address', 'city', 'phone', 'category', 'country', 'timezone', 'state', 'zipCode', 'cancelMinHours'];

async function create(ownerId, data) {
  const clean = Object.fromEntries(Object.entries(data).filter(([k]) => BUSINESS_EDITABLE.includes(k)));
  const business = await prisma.business.create({ data: { ...clean, ownerId } });
  // geocode asynchronously, don't block response
  geocodeAddress(business.address, business.city).then(coords => {
    if (coords) prisma.business.update({ where: { id: business.id }, data: coords }).catch(() => {});
  });
  return business;
}

async function findAll({ category, city, lat, lng, radius } = {}) {
  const userLat = lat ? parseFloat(lat) : null;
  const userLng = lng ? parseFloat(lng) : null;
  const maxRadius = radius ? parseFloat(radius) : null;

  const businesses = await prisma.business.findMany({
    where: {
      ...(category && { category }),
      // city filter only when no coordinates provided
      ...(city && !userLat && { city: { contains: city, mode: 'insensitive' } }),
    },
    include: { professionals: true, services: true },
  });

  if (!userLat || !userLng) return businesses;

  const withDistance = businesses.map(b => {
    if (b.lat != null && b.lng != null) {
      const dist = haversine(userLat, userLng, b.lat, b.lng);
      return { ...b, distance: Math.round(dist * 10) / 10 };
    }
    return { ...b, distance: null };
  });

  const filtered = maxRadius
    ? withDistance.filter(b => b.distance === null || b.distance <= maxRadius)
    : withDistance;

  return filtered.sort((a, b) => {
    if (a.distance === null && b.distance === null) return 0;
    if (a.distance === null) return 1;
    if (b.distance === null) return -1;
    return a.distance - b.distance;
  });
}

async function findById(id) {
  return prisma.business.findUnique({
    where: { id },
    include: { professionals: true, services: true },
  });
}

async function getMyBusiness(ownerId) {
  return prisma.business.findFirst({
    where: { ownerId },
    include: { professionals: true, services: true },
  });
}

async function updateProfile(ownerId, data) {
  const business = await prisma.business.findFirst({ where: { ownerId } });
  if (!business) throw new Error('Negocio no encontrado');
  const allowed = ['name', 'description', 'address', 'city', 'phone', 'category', 'logoUrl', 'cancelMinHours', 'country', 'timezone', 'state', 'zipCode'];
  const clean = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)));
  const updated = await prisma.business.update({ where: { id: business.id }, data: clean });
  // re-geocode if address or city changed
  if (clean.address || clean.city) {
    const addr = clean.address || updated.address;
    const city = clean.city || updated.city;
    geocodeAddress(addr, city).then(coords => {
      if (coords) prisma.business.update({ where: { id: updated.id }, data: coords }).catch(() => {});
    });
  }
  return updated;
}

async function update(id, ownerId, data) {
  const clean = Object.fromEntries(Object.entries(data).filter(([k]) => BUSINESS_EDITABLE.includes(k)));
  return prisma.business.update({ where: { id, ownerId }, data: clean });
}

async function remove(id, ownerId) {
  return prisma.business.delete({ where: { id, ownerId } });
}

module.exports = { create, findAll, findById, getMyBusiness, updateProfile, update, remove };
