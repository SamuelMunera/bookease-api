const prisma = require('../config/database');

// Reglas del programa de referidos negocio→negocio (single source of truth).
const MAX_FREE_MONTHS = 3;     // tope de meses gratis por la etapa 1
const REFERRED_DISCOUNT = 20;  // % de descuento al negocio referido (primer mes)
const REFERRER_DISCOUNT = 20;  // % de descuento al referidor (etapa 2, no acumulable)

// Alfabeto sin caracteres confusos (sin O/0, I/l/1) — buena práctica para
// códigos de referido legibles y compartibles.
const SAFE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateReferralCode() {
  const body = Array.from({ length: 6 }, () => SAFE_ALPHABET[Math.floor(Math.random() * SAFE_ALPHABET.length)]).join('');
  return `SLOT-${body}`;
}

// Validates a referral/courtesy code provided at registration time and
// returns how it should be applied. Does not mutate anything yet, so the
// caller can run this before creating the new account.
async function resolveReferralCode(rawCode) {
  if (!rawCode) return null;
  const code = String(rawCode).trim().toUpperCase();
  if (!code) return null;

  if (code.startsWith('PROMO-')) {
    const promoter = await prisma.promoter.findUnique({ where: { code } });
    if (!promoter) throw new Error('El código de promotor no existe');
    if (promoter.status !== 'ACTIVE') throw new Error('Este código de promotor ya no está activo');
    return { type: 'PROMOTER', promoterId: promoter.id, promoterCode: promoter.code };
  }

  if (code.startsWith('CORTESIA-')) {
    const courtesy = await prisma.courtesyCode.findUnique({ where: { code } });
    if (!courtesy) throw new Error('El código de cortesía no existe');
    if (courtesy.status === 'USED') throw new Error('Este código de cortesía ya fue utilizado');
    return { type: 'COURTESY', courtesyCodeId: courtesy.id };
  }

  // Código de referido de otro negocio (formato SLOT-XXXXXX).
  const referrer = await prisma.business.findUnique({
    where: { referralCode: code },
    select: { id: true, ownerId: true },
  });
  if (referrer) {
    return { type: 'BUSINESS_REFERRAL', referrerBusinessId: referrer.id, referrerOwnerId: referrer.ownerId, referredByCode: code };
  }

  throw new Error('Código de referido inválido');
}

// Lazily assigns a unique referralCode to the owner's business (migración no
// destructiva: los negocios existentes lo obtienen la primera vez que abren
// el apartado de Referidos). Nunca se basa en el nombre del negocio.
async function getOrCreateReferralCode(ownerId) {
  const business = await prisma.business.findFirst({ where: { ownerId } });
  if (!business) throw new Error('No se encontró un negocio para este usuario');
  if (business.referralCode) return business.referralCode;

  let code;
  let attempts = 0;
  do {
    code = generateReferralCode();
    if (++attempts > 10) throw new Error('No se pudo generar un código de referido único');
  } while (await prisma.business.findUnique({ where: { referralCode: code } }));

  await prisma.business.update({ where: { id: business.id }, data: { referralCode: code } });
  return code;
}

// Records a PENDING referral when a new business registers with a business
// code. Runs inside the registration transaction. Anti-abuso: el referidor no
// puede ser el mismo dueño (autoreferido) — eso se valida antes de llamar.
async function recordBusinessReferral({ referrerBusinessId, referredBusinessId, referredByCode }, client = prisma) {
  await client.business.update({
    where: { id: referredBusinessId },
    data: { referrerBusinessId, referredByCode },
  });
  await client.businessReferral.create({
    data: { referrerBusinessId, referredBusinessId, referredByCode },
  });
}

// Disparador de recompensa: se llama cuando el negocio REFERIDO completa su
// primer pago real (Wompi APPROVED). Idempotente — un referido solo dispara
// recompensa una vez. Decide la etapa del referidor:
//   etapa 1: mientras freeMonthsEarned < 3  → +1 mes gratis
//   etapa 2: ya con 3 meses gratis          → +1 crédito de 20% (no acumulable)
async function markReferralSuccessful(referredBusinessId, client = prisma) {
  const referral = await client.businessReferral.findUnique({
    where: { referredBusinessId },
  });
  if (!referral || referral.status === 'SUCCESSFUL') return null; // idempotencia

  const referrer = await client.business.findUnique({
    where: { id: referral.referrerBusinessId },
    select: { id: true, freeMonthsEarned: true },
  });
  if (!referrer) return null;

  const inFreeStage = referrer.freeMonthsEarned < MAX_FREE_MONTHS;
  const rewardType  = inFreeStage ? 'FREE_MONTH' : 'DISCOUNT_20';
  const rewardValue = inFreeStage ? 100 : REFERRER_DISCOUNT;

  await client.business.update({
    where: { id: referrer.id },
    data: inFreeStage
      ? { freeMonthsEarned: { increment: 1 } }
      : { discountCreditsEarned: { increment: 1 } },
  });

  // Guard de idempotencia: solo marca si seguía PENDING (evita doble recompensa
  // ante webhooks duplicados de Wompi).
  const updated = await client.businessReferral.updateMany({
    where: { id: referral.id, status: 'PENDING' },
    data: { status: 'SUCCESSFUL', referredDiscountApplied: true, rewardType, rewardValue, rewardAppliedAt: new Date() },
  });
  if (updated.count === 0) return null; // ya lo procesó otro evento

  return { rewardType, rewardValue };
}

// Datos para el apartado "Referidos" del dashboard del negocio.
async function getReferralSummary(ownerId) {
  const business = await prisma.business.findFirst({
    where: { ownerId },
    select: {
      id: true, referralCode: true,
      freeMonthsEarned: true, freeMonthsUsed: true,
      discountCreditsEarned: true, discountCreditsUsed: true,
    },
  });
  if (!business) throw new Error('No se encontró un negocio para este usuario');

  const code = business.referralCode || await getOrCreateReferralCode(ownerId);

  const referrals = await prisma.businessReferral.findMany({
    where: { referrerBusinessId: business.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, status: true, rewardType: true, rewardValue: true, rewardAppliedAt: true, createdAt: true,
      referred: { select: { name: true, city: true } },
    },
  });

  const successful = referrals.filter(r => r.status === 'SUCCESSFUL').length;

  return {
    referralCode: code,
    rules: {
      referredDiscountPct: REFERRED_DISCOUNT,
      maxFreeMonths: MAX_FREE_MONTHS,
      referrerDiscountPct: REFERRER_DISCOUNT,
    },
    totalReferred: referrals.length,
    successfulReferred: successful,
    freeMonthsEarned: business.freeMonthsEarned,
    freeMonthsUsed: business.freeMonthsUsed,
    freeMonthsAvailable: Math.max(0, business.freeMonthsEarned - business.freeMonthsUsed),
    reachedFreeMonthsCap: business.freeMonthsEarned >= MAX_FREE_MONTHS,
    discountCreditsEarned: business.discountCreditsEarned,
    discountCreditsUsed: business.discountCreditsUsed,
    discountCreditsAvailable: Math.max(0, business.discountCreditsEarned - business.discountCreditsUsed),
    history: referrals.map(r => ({
      id: r.id,
      businessName: r.referred?.name ?? 'Negocio',
      city: r.referred?.city ?? null,
      status: r.status,
      rewardType: r.rewardType,
      rewardValue: r.rewardValue,
      rewardAppliedAt: r.rewardAppliedAt,
      createdAt: r.createdAt,
    })),
  };
}

// Marks a courtesy code as redeemed by the given business/professional.
// Accepts an optional Prisma transaction client so the redemption can be
// committed atomically with the record that consumes the code.
// Returns the plan that was selected when the code was generated, so the
// caller can apply that exact plan to the redeemer.
async function redeemCourtesyCode(courtesyCodeId, { businessId, professionalId }, client = prisma) {
  const courtesy = await client.courtesyCode.update({
    where: { id: courtesyCodeId },
    data: {
      status: 'USED',
      usedAt: new Date(),
      redeemedByType: businessId ? 'BUSINESS' : 'PROFESSIONAL',
      redeemedBusinessId: businessId || null,
      redeemedProfessionalId: professionalId || null,
    },
  });
  return courtesy.plan;
}

// Logs the use of a promoter code so it shows up immediately in the admin
// conversions list and carries the first-month-discount entitlement that
// the checkout flow will later apply and mark as redeemed.
async function recordPromoterConversion({ promoterId, promoterCode, businessId, professionalId }, client = prisma) {
  await client.promoterConversion.create({
    data: {
      promoterId,
      promoterCode,
      usedByType: businessId ? 'BUSINESS' : 'PROFESSIONAL',
      businessId: businessId || null,
      professionalId: professionalId || null,
    },
  });
}

module.exports = {
  resolveReferralCode, redeemCourtesyCode, recordPromoterConversion,
  generateReferralCode, getOrCreateReferralCode, recordBusinessReferral,
  markReferralSuccessful, getReferralSummary,
  MAX_FREE_MONTHS, REFERRED_DISCOUNT, REFERRER_DISCOUNT,
};
