// Pricing utilities: applies active promotions to a service price.
//
// A promotion is "active" when isActive=true and now is within
// [startDate, endDate]. A promotion applies to a service when its
// serviceIds array is empty (applies to all services) or contains the
// service id. When several promotions apply, the one that yields the
// LOWEST final price wins.

function num(v) {
  if (v == null) return null;
  // Handle Prisma Decimal (has toNumber/toString) and plain numbers/strings.
  if (typeof v === 'object' && typeof v.toNumber === 'function') return v.toNumber();
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Returns the subset of promotions that are active and in-date at `now`.
function getActivePromotions(promotions, now = new Date()) {
  if (!Array.isArray(promotions)) return [];
  const t = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return promotions.filter((p) => {
    if (!p || p.isActive === false) return false;
    const start = new Date(p.startDate).getTime();
    const end = new Date(p.endDate).getTime();
    return start <= t && t <= end;
  });
}

// Computes the final price of a single promotion for a given original price.
// Returns null if the promotion can't produce a valid price.
function promoFinalPrice(promo, originalPrice) {
  switch (promo.discountType) {
    case 'PERCENTAGE': {
      const pct = num(promo.discountValue);
      if (pct == null) return null;
      return originalPrice * (1 - pct / 100);
    }
    case 'FIXED': {
      const amount = num(promo.discountValue);
      if (amount == null) return null;
      return originalPrice - amount;
    }
    case 'CUSTOM_PRICE': {
      const cp = num(promo.customPrice);
      if (cp == null) return null;
      return cp;
    }
    default:
      return null;
  }
}

// Returns true if a promotion applies to a service id.
function appliesToService(promo, serviceId) {
  const ids = promo.serviceIds;
  if (!Array.isArray(ids) || ids.length === 0) return true;
  return ids.includes(serviceId);
}

/**
 * Computes pricing for a service given a list of business promotions.
 * @param {{id:string, price:any}} service
 * @param {Array} promotions  promotions of the business (any state)
 * @param {Date} now
 * @returns {{price:number, originalPrice:number, finalPrice:number,
 *   hasPromo:boolean, discountType:?string, promoTitle:?string, promoId:?string}}
 */
function computeServicePricing(service, promotions, now = new Date()) {
  const originalPrice = round2(num(service?.price) ?? 0);

  const active = getActivePromotions(promotions, now).filter((p) =>
    appliesToService(p, service?.id)
  );

  let best = null; // { finalPrice, promo }
  for (const promo of active) {
    let fp = promoFinalPrice(promo, originalPrice);
    if (fp == null) continue;
    if (fp < 0) fp = 0;
    fp = round2(fp);
    if (best == null || fp < best.finalPrice) best = { finalPrice: fp, promo };
  }

  if (!best || best.finalPrice >= originalPrice) {
    return {
      price: originalPrice,
      originalPrice,
      finalPrice: originalPrice,
      hasPromo: false,
      discountType: null,
      promoTitle: null,
      promoId: null,
    };
  }

  return {
    price: originalPrice,
    originalPrice,
    finalPrice: best.finalPrice,
    hasPromo: true,
    discountType: best.promo.discountType,
    promoTitle: best.promo.title ?? null,
    promoId: best.promo.id ?? null,
  };
}

module.exports = { computeServicePricing, getActivePromotions };
