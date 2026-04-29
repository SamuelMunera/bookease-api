const crypto = require('crypto');
const prisma = require('../config/database');
const { haversine, geocodeAddress } = require('../utils/geo');
const { normalizeName, normalizePhone, normalizeAddress } = require('../utils/normalize');
const { validateAddress } = require('../utils/addressValidation');
const { getResend, FROM } = require('../config/email');
const { businessVerifyEmail } = require('../utils/emailTemplates');
const { getDefaultGateway } = require('../config/gateways');
const subscriptionService = require('./subscription.service');

const APP_URL = process.env.APP_URL || 'http://localhost:5173';

// Safe fields for public-facing responses.
// Excluded: joinCode, emailVerifyToken, emailVerifyExpiry, nameNorm, phoneNorm, addressNorm
const PUBLIC_BUSINESS_SELECT = {
  id: true, name: true, description: true, address: true, city: true,
  phone: true, category: true, logoUrl: true, country: true, timezone: true,
  state: true, zipCode: true, lat: true, lng: true,
  emailVerified: true, cancelMinHours: true, createdAt: true,
  ownerId: true, plan: true, paymentGateway: true, showRevenueToProf: true,
  professionals: {
    select: { id: true, name: true, bio: true, specialty: true, avatarUrl: true, userId: true },
  },
  services: {
    select: { id: true, name: true, description: true, duration: true, price: true },
  },
};

const BUSINESS_EDITABLE = [
  'name', 'description', 'address', 'city', 'phone', 'category',
  'country', 'timezone', 'state', 'zipCode', 'cancelMinHours',
];

function buildNorms(data) {
  return {
    nameNorm:    data.name    ? normalizeName(data.name)       : undefined,
    phoneNorm:   data.phone   ? normalizePhone(data.phone)     : undefined,
    addressNorm: data.address ? normalizeAddress(data.address) : undefined,
  };
}

async function sendVerifyEmailFor(businessId, ownerEmail) {
  const token  = crypto.randomBytes(32).toString('hex');
  const expiry = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const biz = await prisma.business.update({
    where: { id: businessId },
    data: { emailVerifyToken: token, emailVerifyExpiry: expiry },
    select: { name: true },
  });
  const url = `${APP_URL}/verify-business-email?token=${token}`;
  const tpl = businessVerifyEmail(biz.name, url);
  getResend().emails.send({ from: FROM, to: ownerEmail, ...tpl }).catch(() => {});
}

async function create(ownerId, data) {
  const clean = Object.fromEntries(
    Object.entries(data).filter(([k]) => BUSINESS_EDITABLE.includes(k))
  );

  // Address validation
  const addrErrors = validateAddress({
    country: clean.country, address: clean.address,
    city: clean.city, state: clean.state, zipCode: clean.zipCode,
  });
  if (addrErrors.length) throw new Error(addrErrors[0]);

  // Duplicate detection
  const nameNorm    = normalizeName(clean.name || '');
  const phoneNorm   = clean.phone ? normalizePhone(clean.phone) : null;
  const addressNorm = clean.address ? normalizeAddress(clean.address) : null;

  if (nameNorm) {
    const candidate = await prisma.business.findFirst({
      where: {
        nameNorm,
        OR: [
          ...(phoneNorm   ? [{ phoneNorm }]   : []),
          ...(addressNorm ? [{ addressNorm }]  : []),
        ],
      },
      select: { id: true },
    });
    if (candidate) {
      throw new Error(
        'Ya existe un negocio con un nombre y datos similares. Revisa si ya lo registraste o ajusta la información.',
      );
    }
  }

  const paymentGateway = getDefaultGateway(clean.country || 'CO');
  const business = await prisma.business.create({
    data: { ...clean, ownerId, nameNorm, phoneNorm, addressNorm, paymentGateway },
  });

  geocodeAddress(business.address, business.city).then(coords => {
    if (coords) prisma.business.update({ where: { id: business.id }, data: coords }).catch(() => {});
  });

  subscriptionService.createForBusiness(business.id, business.plan, business.country).catch(() => {});

  const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { email: true } });
  if (owner) sendVerifyEmailFor(business.id, owner.email).catch(() => {});

  return business;
}

async function sendVerificationEmail(ownerId) {
  const business = await prisma.business.findFirst({
    where: { ownerId },
    select: { id: true, emailVerified: true },
  });
  if (!business) throw new Error('Negocio no encontrado');
  if (business.emailVerified) throw new Error('El email ya está verificado');

  const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { email: true } });
  await sendVerifyEmailFor(business.id, owner.email);
  return { sent: true };
}

async function verifyEmailToken(token) {
  if (!token) throw new Error('Token inválido');
  const business = await prisma.business.findUnique({ where: { emailVerifyToken: token } });
  if (!business) throw new Error('Enlace inválido o ya utilizado');
  if (business.emailVerified) return { alreadyVerified: true };
  if (new Date() > business.emailVerifyExpiry) {
    throw new Error('El enlace expiró. Solicita uno nuevo desde tu panel.');
  }
  await prisma.business.update({
    where: { id: business.id },
    data: { emailVerified: true, emailVerifyToken: null, emailVerifyExpiry: null },
  });
  return { verified: true };
}

async function checkDuplicate({ name, phone, address }) {
  const nameNorm    = name    ? normalizeName(name)       : null;
  const phoneNorm   = phone   ? normalizePhone(phone)     : null;
  const addressNorm = address ? normalizeAddress(address) : null;
  if (!nameNorm) return { isDuplicate: false };
  const candidate = await prisma.business.findFirst({
    where: {
      nameNorm,
      OR: [
        ...(phoneNorm   ? [{ phoneNorm }]   : []),
        ...(addressNorm ? [{ addressNorm }]  : []),
      ],
    },
    select: { id: true },
  });
  return { isDuplicate: !!candidate };
}

async function findAll({ category, city, lat, lng, radius } = {}) {
  const userLat = lat ? parseFloat(lat) : null;
  const userLng = lng ? parseFloat(lng) : null;
  const maxRadius = radius ? parseFloat(radius) : null;

  const businesses = await prisma.business.findMany({
    where: {
      ...(category && { category }),
      ...(city && !userLat && { city: { contains: city, mode: 'insensitive' } }),
    },
    select: { ...PUBLIC_BUSINESS_SELECT, lat: true, lng: true },
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
    select: PUBLIC_BUSINESS_SELECT,
  });
}

async function getMyBusiness(ownerId) {
  return prisma.business.findFirst({
    where: { ownerId },
    include: {
      professionals: { select: { id: true, name: true, bio: true, specialty: true, avatarUrl: true, userId: true } },
      services: true,
    },
  });
}

async function updateProfile(ownerId, data) {
  const business = await prisma.business.findFirst({ where: { ownerId } });
  if (!business) throw new Error('Negocio no encontrado');

  const allowed = [
    'name', 'description', 'address', 'city', 'phone', 'category', 'logoUrl',
    'cancelMinHours', 'country', 'timezone', 'state', 'zipCode',
  ];
  const clean = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)));

  // Address validation when address-related fields change
  if (clean.address || clean.city || clean.country || clean.state || clean.zipCode) {
    const merged = {
      country:  clean.country  || business.country,
      address:  clean.address  || business.address,
      city:     clean.city     || business.city,
      state:    clean.state    || business.state,
      zipCode:  clean.zipCode  || business.zipCode,
    };
    const addrErrors = validateAddress(merged);
    if (addrErrors.length) throw new Error(addrErrors[0]);
  }

  const norms = {};
  if (clean.name)    norms.nameNorm    = normalizeName(clean.name);
  if (clean.phone)   norms.phoneNorm   = normalizePhone(clean.phone);
  if (clean.address) norms.addressNorm = normalizeAddress(clean.address);

  if (clean.country) {
    clean.paymentGateway = getDefaultGateway(clean.country);
  }

  const updated = await prisma.business.update({ where: { id: business.id }, data: { ...clean, ...norms } });

  if (clean.address || clean.city) {
    const addr = clean.address || updated.address;
    const city = clean.city    || updated.city;
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

module.exports = {
  create, findAll, findById, getMyBusiness,
  updateProfile, update, remove,
  sendVerificationEmail, verifyEmailToken,
  checkDuplicate,
};
