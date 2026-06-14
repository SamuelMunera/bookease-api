const prisma = require('../config/database');

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

  throw new Error('Código de referido inválido');
}

// Marks a courtesy code as redeemed by the given business/professional.
// Accepts an optional Prisma transaction client so the redemption can be
// committed atomically with the record that consumes the code.
async function redeemCourtesyCode(courtesyCodeId, { businessId, professionalId }, client = prisma) {
  await client.courtesyCode.update({
    where: { id: courtesyCodeId },
    data: {
      status: 'USED',
      usedAt: new Date(),
      redeemedByType: businessId ? 'BUSINESS' : 'PROFESSIONAL',
      redeemedBusinessId: businessId || null,
      redeemedProfessionalId: professionalId || null,
    },
  });
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

module.exports = { resolveReferralCode, redeemCourtesyCode, recordPromoterConversion };
