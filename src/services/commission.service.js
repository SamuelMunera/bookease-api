const prisma = require('../config/database');
const { getPlanById } = require('../config/plans');

// =============================================================================
// commission.service.js  —  Subagente F3 (Descuentos & Comisiones)
//
// Provee números INFORMATIVOS para el dashboard de finanzas admin de Slotly:
//   1) Comisiones de promotores (calculadas en vivo desde pagos APROBADOS).
//   2) Desglose de descuentos otorgados (cortesía / promotor / referidos).
//
// DECISIÓN DE PRODUCTO: la comisión a promotores NUNCA pasa por pasarela; es
// puramente un cálculo de lectura para mostrar cuánto "se le debería" a cada
// promotor. Por eso se deriva siempre de Payment(status='APPROVED'), que son
// los pagos reales cobrados vía Wompi.
//
// CONVENCIÓN DE MONTOS: todos los *Cents son enteros en centavos.
//   - Payment.amountInCents ya viene en centavos (lo cobrado de verdad).
//   - getPlanById(plan, country).price es precio LISTA en unidades de moneda
//     (ej. 30000 COP, 15 USD) → se multiplica por 100 para llevarlo a centavos.
// Los Decimal de Prisma se normalizan con Number() antes de operar.
// =============================================================================

// Porcentaje de comisión que gana el promotor sobre lo cobrado a sus referidos.
const COMMISSION_PCT = 40;

// % de descuento de cada programa (alineados con el modelo Prisma y demás
// servicios; se mantienen aquí como constantes locales por claridad de cálculo).
const PROMOTER_DISCOUNT_PCT = 10; // PromoterConversion.discountValue (primer mes)
const REFERRAL_DISCOUNT_PCT = 20; // BusinessReferral 20% primer mes al referido

const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

// ---- helpers ---------------------------------------------------------------

// Precio lista del plan en CENTAVOS según el país de la entidad.
// Si el plan no existe o no tiene precio (ej. 'enterprise' = "A convenir"),
// se asume 0: no podemos imputar un descuento sobre un precio desconocido.
function listPriceCents(plan, country) {
  const p = getPlanById(plan, country);
  if (!p || p.price == null) return 0;
  return Math.round(Number(p.price) * 100);
}

// Rango UTC [start, end) para el mes dado. month es 1-12.
function monthRangeUTC(year, month) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { start, end };
}

// =============================================================================
// 1) COMISIONES DE PROMOTORES
// =============================================================================
//
// Para cada promotor reunimos sus entidades referidas (Business.promoterId y
// Professional.promoterId con businessId null → profesionales independientes,
// para no contar dos veces a un pro que pertenece a un negocio referido).
//
// monthlyRevenueCents  = Σ Payment.amountInCents (APPROVED) de esas entidades
//                        cuyo createdAt cae dentro del mes (UTC).
// monthlyCommissionCents = round(monthlyRevenueCents * 40 / 100).
// allTime*              = lo mismo, sin filtro de fecha.
// referredPaid          = nº de entidades con >= 1 pago APPROVED (histórico).
//
// Nota: se filtra por businessId/professionalId del Payment (no por su propio
// promoterId, porque Payment no tiene promoterId). La atribución vive en la
// entidad referida, que es la fuente de verdad del programa de promotores.
async function getPromoterCommissions({ year, month } = {}) {
  const now = new Date();
  const y = year ?? now.getUTCFullYear();
  const m = month ?? now.getUTCMonth() + 1; // getUTCMonth es 0-11
  const { start, end } = monthRangeUTC(y, m);
  const periodLabel = `${MONTHS[m - 1]} ${y}`;

  const promoters = await prisma.promoter.findMany({
    include: {
      businesses: { select: { id: true } },
      // Solo profesionales INDEPENDIENTES (sin negocio): un pro dentro de un
      // negocio referido ya queda cubierto por los pagos del negocio.
      professionals: { where: { businessId: null }, select: { id: true } },
    },
  });

  const result = [];
  let totalsMonthlyRevenue = 0;
  let totalsMonthlyCommission = 0;

  for (const promoter of promoters) {
    const businessIds = promoter.businesses.map((b) => b.id);
    const professionalIds = promoter.professionals.map((p) => p.id);

    // Sin entidades referidas → todos los números en 0.
    if (businessIds.length === 0 && professionalIds.length === 0) {
      result.push({
        id: promoter.id,
        name: `${promoter.firstName} ${promoter.lastName}`.trim(),
        code: promoter.code,
        status: promoter.status,
        referredPaid: 0,
        monthlyRevenueCents: 0,
        monthlyCommissionCents: 0,
        allTimeRevenueCents: 0,
        allTimeCommissionCents: 0,
      });
      continue;
    }

    // Filtro OR sobre las entidades del promotor. Un Payment pertenece a un
    // business O a un professional (nunca ambos), así que el OR no duplica.
    const entityFilter = {
      OR: [
        ...(businessIds.length ? [{ businessId: { in: businessIds } }] : []),
        ...(professionalIds.length ? [{ professionalId: { in: professionalIds } }] : []),
      ],
    };

    // Pagos aprobados del mes.
    const monthlyAgg = await prisma.payment.aggregate({
      _sum: { amountInCents: true },
      where: { status: 'APPROVED', createdAt: { gte: start, lt: end }, ...entityFilter },
    });

    // Pagos aprobados histórico.
    const allTimeAgg = await prisma.payment.aggregate({
      _sum: { amountInCents: true },
      where: { status: 'APPROVED', ...entityFilter },
    });

    const monthlyRevenueCents = monthlyAgg._sum.amountInCents ?? 0;
    const allTimeRevenueCents = allTimeAgg._sum.amountInCents ?? 0;
    const monthlyCommissionCents = Math.round((monthlyRevenueCents * COMMISSION_PCT) / 100);
    const allTimeCommissionCents = Math.round((allTimeRevenueCents * COMMISSION_PCT) / 100);

    // referredPaid: nº de entidades distintas con al menos un pago APPROVED.
    const paidGroups = await prisma.payment.groupBy({
      by: ['businessId', 'professionalId'],
      where: { status: 'APPROVED', ...entityFilter },
    });
    const referredPaid = paidGroups.length;

    totalsMonthlyRevenue += monthlyRevenueCents;
    totalsMonthlyCommission += monthlyCommissionCents;

    result.push({
      id: promoter.id,
      name: `${promoter.firstName} ${promoter.lastName}`.trim(),
      code: promoter.code,
      status: promoter.status,
      referredPaid,
      monthlyRevenueCents,
      monthlyCommissionCents,
      allTimeRevenueCents,
      allTimeCommissionCents,
    });
  }

  // Orden por comisión mensual descendente (los más rentables arriba).
  result.sort((a, b) => b.monthlyCommissionCents - a.monthlyCommissionCents);

  return {
    periodLabel,
    commissionPct: COMMISSION_PCT,
    promoters: result,
    totals: {
      monthlyRevenueCents: totalsMonthlyRevenue,
      monthlyCommissionCents: totalsMonthlyCommission,
    },
  };
}

// =============================================================================
// 2) DESGLOSE DE DESCUENTOS
// =============================================================================
//
// Cuánto dinero "regaló" Slotly por cada programa. Es informativo: el descuento
// se calcula contra el precio LISTA del plan, no contra lo realmente cobrado.
//
// Rango opcional { from, to } (Date | string ISO). Default: todo el histórico.
// El filtro de fecha se aplica al evento que materializa el descuento:
//   - courtesy : CourtesyCode.usedAt / Business.coveredByCourtesy
//   - promoter : PromoterConversion.usedAt (cuando pasó a DISCOUNT_APPLIED)
//   - referral : BusinessReferral.updatedAt (momento del SUCCESSFUL/aplicado)
async function getDiscountBreakdown({ from, to } = {}) {
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;

  // Helper de rango de fecha para campos opcionales (devuelve undefined si no
  // hay límites → Prisma ignora el filtro).
  const dateFilter = (field) => {
    if (!fromDate && !toDate) return undefined;
    const f = {};
    if (fromDate) f.gte = fromDate;
    if (toDate) f.lte = toDate;
    return { [field]: f };
  };

  // ---- courtesy -----------------------------------------------------------
  // Negocios/pros con plan regalado. Se consideran dos fuentes (admin puede
  // marcar coveredByCourtesy directamente, o canjear un CourtesyCode):
  //   - CourtesyCode con status USED  → conocemos plan y país de la entidad.
  //   - Business.coveredByCourtesy=true que NO haya canjeado un código (para
  //     no contarlo dos veces).
  // forgoneCents = precio lista (en centavos) del plan no cobrado, primer mes.
  // SUPUESTO: cortesía = 1 mes regalado por defecto. Si en el futuro la
  // cortesía cubre múltiples meses, habría que multiplicar por esos meses.
  const usedCourtesyCodes = await prisma.courtesyCode.findMany({
    where: { status: 'USED', ...(dateFilter('usedAt') ?? {}) },
    include: {
      redeemedBusiness: { select: { id: true, country: true } },
      redeemedProfessional: { select: { id: true, country: true } },
    },
  });

  let courtesyCount = 0;
  let courtesyForgoneCents = 0;
  const courtesyBusinessIds = new Set();

  for (const c of usedCourtesyCodes) {
    const entity = c.redeemedBusiness || c.redeemedProfessional;
    const country = entity?.country ?? 'CO';
    courtesyCount += 1;
    courtesyForgoneCents += listPriceCents(c.plan, country);
    if (c.redeemedBusiness) courtesyBusinessIds.add(c.redeemedBusiness.id);
  }

  // Negocios marcados coveredByCourtesy que NO pasaron por un CourtesyCode.
  // (Si pasaron por código, ya están contados arriba.) Solo se filtra por
  // fecha si hay rango, usando createdAt como mejor proxy disponible — el
  // modelo Business no guarda "cuándo se otorgó la cortesía".
  const coveredBusinesses = await prisma.business.findMany({
    where: { coveredByCourtesy: true, ...(dateFilter('createdAt') ?? {}) },
    select: { id: true, plan: true, country: true },
  });
  for (const b of coveredBusinesses) {
    if (courtesyBusinessIds.has(b.id)) continue; // ya contado vía CourtesyCode
    courtesyCount += 1;
    courtesyForgoneCents += listPriceCents(b.plan, b.country);
  }

  // ---- promoter -----------------------------------------------------------
  // Conversiones de promotor que ya aplicaron el 10% del primer mes.
  // discountCents = 10% del precio lista del primer mes de cada entidad.
  const promoterConversions = await prisma.promoterConversion.findMany({
    where: { status: 'DISCOUNT_APPLIED', ...(dateFilter('usedAt') ?? {}) },
    include: {
      business: { select: { plan: true, country: true } },
      professional: { select: { plan: true, country: true } },
    },
  });

  let promoterCount = 0;
  let promoterDiscountCents = 0;
  for (const conv of promoterConversions) {
    const entity = conv.business || conv.professional;
    if (!entity) continue; // conversión sin entidad resuelta → se ignora
    const country = entity.country ?? 'CO';
    // Usa el discountValue persistido si existe (=10), si no la constante.
    const pct = Number(conv.discountValue ?? PROMOTER_DISCOUNT_PCT);
    promoterCount += 1;
    promoterDiscountCents += Math.round((listPriceCents(entity.plan, country) * pct) / 100);
  }

  // ---- referral (negocio → negocio) --------------------------------------
  // Referidos exitosos donde se aplicó el 20% al referido. El descuento total
  // imputado tiene DOS componentes:
  //   (a) 20% del primer mes del negocio REFERIDO  (referredDiscountApplied).
  //   (b) Valor de los meses gratis que el REFERIDOR ya CONSUMIÓ por referir
  //       (Business.freeMonthsUsed × precio lista de su plan). Solo se cuentan
  //       los consumidos, no los ganados-pero-no-usados, para reflejar dinero
  //       efectivamente regalado.
  //
  // ALCANCE / SUPUESTOS:
  //   - rewardType puede ser FREE_MONTH o DISCOUNT_20. El componente (b) cubre
  //     SOLO los meses gratis ya usados (freeMonthsUsed). Los créditos 20% del
  //     referidor (rewardType DISCOUNT_20 → discountCreditsUsed) se calcularían
  //     contra el precio del referidor; se documenta pero NO se incluye aquí
  //     para evitar doble conteo ambiguo, ya que un crédito 20% consumido
  //     también aparece como un pago con descuento que no se modela por monto.
  //   - El filtro de fecha del rango usa updatedAt del BusinessReferral como
  //     proxy del momento en que el descuento/recompensa se materializó.
  const referrals = await prisma.businessReferral.findMany({
    where: {
      OR: [{ status: 'SUCCESSFUL' }, { referredDiscountApplied: true }],
      ...(dateFilter('updatedAt') ?? {}),
    },
    include: {
      referred: { select: { plan: true, country: true } },
      referrer: { select: { plan: true, country: true, freeMonthsUsed: true } },
    },
  });

  let referralCount = 0;
  let referralDiscountCents = 0;
  const countedReferrers = new Set();

  for (const ref of referrals) {
    referralCount += 1;

    // (a) 20% primer mes del referido.
    if (ref.referredDiscountApplied && ref.referred) {
      const country = ref.referred.country ?? 'CO';
      referralDiscountCents += Math.round(
        (listPriceCents(ref.referred.plan, country) * REFERRAL_DISCOUNT_PCT) / 100,
      );
    }

    // (b) Meses gratis ya consumidos por el referidor. freeMonthsUsed vive en
    // el negocio referidor (no por-referral), así que se cuenta UNA sola vez
    // por referidor aunque haya referido a varios negocios.
    if (ref.referrer && !countedReferrers.has(ref.referrerBusinessId)) {
      countedReferrers.add(ref.referrerBusinessId);
      const country = ref.referrer.country ?? 'CO';
      const freeMonthsUsed = Number(ref.referrer.freeMonthsUsed ?? 0);
      referralDiscountCents += freeMonthsUsed * listPriceCents(ref.referrer.plan, country);
    }
  }

  const courtesy = { count: courtesyCount, forgoneCents: courtesyForgoneCents };
  const promoter = { count: promoterCount, discountCents: promoterDiscountCents };
  const referral = { count: referralCount, discountCents: referralDiscountCents };

  const totalDiscountCents =
    courtesy.forgoneCents + promoter.discountCents + referral.discountCents;

  return {
    byType: { courtesy, promoter, referral },
    totalDiscountCents,
  };
}

module.exports = {
  COMMISSION_PCT,
  getPromoterCommissions,
  getDiscountBreakdown,
};
