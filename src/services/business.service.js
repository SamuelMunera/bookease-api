const crypto = require('crypto');
const prisma = require('../config/database');
const { haversine, geocodeAddress } = require('../utils/geo');
const { normalizeName, normalizePhone, normalizeAddress } = require('../utils/normalize');
const { validateAddress } = require('../utils/addressValidation');
const { getResend, FROM } = require('../config/email');
const { businessVerifyEmail } = require('../utils/emailTemplates');
const subscriptionService = require('./subscription.service');

const APP_URL = process.env.APP_URL || 'http://localhost:5173';

// Safe fields for public-facing responses.
// Excluded: joinCode, emailVerifyToken, emailVerifyExpiry, nameNorm, phoneNorm, addressNorm
const PUBLIC_BUSINESS_SELECT = {
  id: true, name: true, description: true, address: true, city: true,
  phone: true, category: true, logoUrl: true, coverUrl: true, accentColor: true,
  country: true, timezone: true, state: true, zipCode: true, lat: true, lng: true,
  emailVerified: true, cancelMinHours: true, createdAt: true,
  ownerId: true, plan: true, paymentGateway: true, showRevenueToProf: true,
  professionals: {
    select: { id: true, name: true, bio: true, specialty: true, avatarUrl: true, userId: true },
  },
  services: {
    select: { id: true, name: true, description: true, duration: true, price: true, categoryId: true },
    orderBy: { name: 'asc' },
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

  const business = await prisma.business.create({
    data: { ...clean, ownerId, nameNorm, phoneNorm, addressNorm, paymentGateway: 'STRIPE' },
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

// Validates HH:MM format
function isValidTime(t) {
  return typeof t === 'string' && /^\d{2}:\d{2}$/.test(t);
}

// Returns IDs of businesses whose city matches the search term
// using unaccent + ILIKE so "Bogota" matches "Bogotá" (accent-insensitive, case-insensitive)
async function findCityIds(city, status = 'ACTIVE') {
  const rows = await prisma.$queryRaw`
    SELECT id FROM "Business"
    WHERE status = ${status}::"BusinessStatus"
    AND unaccent(lower("city")) ILIKE unaccent(lower(${`%${city}%`}))
  `;
  return rows.map(r => r.id);
}

async function findAll({ category, city, lat, lng, radius, time } = {}) {
  const userLat = lat ? parseFloat(lat) : null;
  const userLng = lng ? parseFloat(lng) : null;
  const maxRadius = radius ? parseFloat(radius) : null;
  const validTime = isValidTime(time) ? time : null;

  // Accent-insensitive city matching via unaccent — runs only when no geo search
  let cityIds = null;
  if (city && !userLat) {
    cityIds = await findCityIds(city);
  }

  const businesses = await prisma.business.findMany({
    where: {
      status: 'ACTIVE',
      ...(category && { category }),
      ...(cityIds !== null ? { id: { in: cityIds } } : city && userLat ? { city: { contains: city, mode: 'insensitive' } } : {}),
      // Filter by time: business must have at least one professional whose schedule covers the time
      ...(validTime && {
        professionals: {
          some: {
            schedules: {
              some: {
                isActive: true,
                OR: [
                  // Fulltime or first block of part_time covers the time
                  { startTime: { lte: validTime }, endTime: { gt: validTime } },
                  // Second block of part_time covers the time
                  {
                    scheduleType: 'part_time',
                    secondStartTime: { lte: validTime },
                    secondEndTime:   { gt: validTime },
                  },
                ],
              },
            },
          },
        },
      }),
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
  return prisma.business.findFirst({
    where: { id, status: 'ACTIVE' },
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
    clean.paymentGateway = 'STRIPE';
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

// Newest ACTIVE businesses ordered by creation date
async function getNewest(limit = 8) {
  return prisma.business.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: PUBLIC_BUSINESS_SELECT,
  });
}

// Top ACTIVE businesses by total non-cancelled bookings across all their professionals
async function getTopBooked(limit = 8) {
  const rows = await prisma.$queryRaw`
    SELECT b.id, COUNT(bk.id)::int AS "bookingCount"
    FROM "Business" b
    INNER JOIN "Professional" p ON p."businessId" = b.id
    INNER JOIN "Booking" bk ON bk."professionalId" = p.id
    WHERE b.status = 'ACTIVE'::"BusinessStatus"
      AND bk.status != 'CANCELLED'::"BookingStatus"
    GROUP BY b.id
    ORDER BY "bookingCount" DESC
    LIMIT ${limit}
  `;
  if (!rows.length) return [];

  const idOrder = rows.map(r => r.id);
  const countMap = Object.fromEntries(rows.map(r => [r.id, r.bookingCount]));

  const businesses = await prisma.business.findMany({
    where: { id: { in: idOrder }, status: 'ACTIVE' },
    select: PUBLIC_BUSINESS_SELECT,
  });

  return idOrder
    .map(id => businesses.find(b => b.id === id))
    .filter(Boolean)
    .map(b => ({ ...b, bookingCount: countMap[b.id] }));
}

module.exports = {
  create, findAll, findById, getMyBusiness,
  updateProfile, update, remove,
  sendVerificationEmail, verifyEmailToken,
  checkDuplicate, getNewest, getTopBooked,
};
