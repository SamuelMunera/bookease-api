const prisma = require('../config/database');
const { getPlanById } = require('../config/plans');
const {
  getBillingState,
  getDisplayState,
  isBillingActive,
} = require('./subscription.service');

// Finanzas admin (Slotly). Todos los importes se reportan en CENTAVOS para
// evitar problemas de coma flotante. Los precios de lista vienen de
// `getPlanById(plan, country).price` (unidad mayor) → *100 = centavos.
//
// MONEDAS: las finanzas se reportan SIEMPRE para un solo país/moneda a la vez
// (CO→COP, US→USD), elegido con el parámetro `country`. NO se suman ni convierten
// monedas distintas (no hay tasa de cambio en el sistema): cada cifra es exacta
// en su moneda. El dashboard tiene un selector CO/US que pasa este parámetro.

const COUNTRY_CURRENCY = { CO: 'COP', US: 'USD' };
function normalizeCountry(c) { return c === 'US' ? 'US' : 'CO'; }
function currencyFor(country) { return COUNTRY_CURRENCY[normalizeCountry(country)]; }

function priceCentsFor(plan, country) {
  const def = getPlanById(plan, country);
  if (!def || def.price == null) return 0;
  return Math.round(def.price * 100);
}

function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function startOfNextMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0);
}

// ── getOverview ──────────────────────────────────────────────────────────────
// KPIs del dashboard de finanzas. Solo SUSCRIPCIONES DE NEGOCIO (businessId !=
// null) cuentan para MRR y conteos: las suscripciones de profesionales
// independientes no se incluyen aquí (este overview es de billing de negocios).
async function getOverview({ country } = {}) {
  const ctry = normalizeCountry(country);
  const currency = currencyFor(ctry);
  const subs = await prisma.subscription.findMany({
    where: { businessId: { not: null }, country: ctry },
  });

  let mrrCents = 0;          // MRR real: solo ACTIVE con billingPlan (pagas)
  let mrrPotentialCents = 0; // MRR si TODOS los trials actuales convirtieran
  let active = 0;            // billing activo + pago real (active_paid)
  let trial = 0;             // trial vigente
  let pastDue = 0;           // PAST_DUE
  let cancelledOrExpired = 0;// CANCELLED | EXPIRED

  // byPlan: { [plan]: { active, mrrCents } }
  const byPlan = {};
  // byCountry: { [country]: { active, mrrCents, currency } }
  const byCountry = {};

  function bumpPlan(plan, addActive, addMrr) {
    if (!byPlan[plan]) byPlan[plan] = { active: 0, mrrCents: 0 };
    byPlan[plan].active += addActive;
    byPlan[plan].mrrCents += addMrr;
  }
  function bumpCountry(country, currency, addActive, addMrr) {
    if (!byCountry[country]) byCountry[country] = { active: 0, mrrCents: 0, currency };
    byCountry[country].active += addActive;
    byCountry[country].mrrCents += addMrr;
  }

  for (const sub of subs) {
    const billingState = getBillingState(sub);
    const country = sub.country;
    const def = getPlanById(sub.billingPlan || sub.plan, country);
    const currency = def?.currency ?? 'COP';

    // Conteos por estado raw (los estados son excluyentes).
    if (sub.status === 'PAST_DUE') pastDue++;
    else if (sub.status === 'CANCELLED' || sub.status === 'EXPIRED') cancelledOrExpired++;
    else if (billingState === 'trial_active') trial++;
    // (trial_expired/payment_required de un TRIALING vencido no cuenta como
    //  trial vigente ni como activo — queda fuera de los 4 buckets a propósito.)

    // MRR real: ACTIVE + billingPlan != null (paga).
    if (sub.status === 'ACTIVE' && sub.billingPlan) {
      const cents = priceCentsFor(sub.billingPlan, country);
      mrrCents += cents;
      active++;
      bumpPlan(sub.billingPlan, 1, cents);
      bumpCountry(country, currency, 1, cents);
    }

    // MRR potencial: por cada trial vigente, su precio de lista del plan
    // seleccionado (lo que pagaría si convierte).
    if (billingState === 'trial_active') {
      mrrPotentialCents += priceCentsFor(sub.plan, country);
    }
  }

  // Revenue del mes en curso: Payment APPROVED creados este mes.
  const monthStart = startOfMonth();
  const nextMonthStart = startOfNextMonth();
  const payments = await prisma.payment.aggregate({
    _sum: { amountInCents: true },
    where: {
      status: 'APPROVED',
      currency,
      createdAt: { gte: monthStart, lt: nextMonthStart },
    },
  });
  const revenueThisMonthCents = payments._sum.amountInCents ?? 0;

  // Trial conversion rate (heurística sobre el snapshot actual de negocios):
  //   activos / (activos + trials + cancelados/expirados)
  // Mide qué fracción del embudo terminó pagando vs. en prueba o perdida.
  // No es una cohorte temporal — es barata y orientativa. 0 si no hay base.
  const conversionBase = active + trial + cancelledOrExpired;
  const trialConversionRate = conversionBase > 0 ? active / conversionBase : 0;

  return {
    country: ctry,
    currency,
    mrrCents,
    arrCents: mrrCents * 12,
    mrrPotentialCents,
    revenueThisMonthCents,
    counts: {
      active,
      trial,
      pastDue,
      cancelledOrExpired,
    },
    byPlan,
    byCountry,
    trialConversionRate,
  };
}

// ── getSubscriptions ─────────────────────────────────────────────────────────
// Lista para la tabla de suscripciones. Filtros opcionales por status (raw),
// plan y country. Solo suscripciones de negocio (tienen businessId + business).
async function getSubscriptions({ status, plan, country } = {}) {
  const where = { businessId: { not: null } };
  if (status) where.status = status;
  if (plan) where.plan = plan;
  if (country) where.country = country;

  const subs = await prisma.subscription.findMany({
    where,
    include: { business: { select: { id: true, name: true, status: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return subs.map(sub => {
    const entityActive = sub.business ? sub.business.status === 'ACTIVE' : null;
    const priceCents = priceCentsFor(sub.billingPlan || sub.plan, sub.country);
    return {
      businessId: sub.businessId,
      businessName: sub.business?.name ?? null,
      country: sub.country,
      plan: sub.plan,
      billingPlan: sub.billingPlan ?? null,
      status: sub.status,
      displayState: getDisplayState(sub, entityActive),
      priceCents,
      // Próxima fecha de cobro: el fin del periodo actual cuando la sub es
      // facturable (activa pagada o trial vigente); null en otros estados.
      nextChargeAt: isBillingActive(getBillingState(sub)) ? sub.currentPeriodEnd : null,
    };
  });
}

module.exports = {
  getOverview,
  getSubscriptions,
};
