const crypto = require('crypto');
const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const prisma = require('../config/database');
const subscriptionService = require('../services/subscription.service');
const adminFinanceService = require('../services/adminFinance.service');

const VALID_COURTESY_PLANS = ['solo', 'team', 'studio', 'enterprise'];
// Una suscripción activada hace menos de este tiempo se marca "Recién pagó".
const RECENT_PAYMENT_HOURS = 48;

// Paginación OPT-IN de listados admin. Los paneles admin no tienen UI de
// paginación hoy, así que por defecto NO se aplica límite (se preserva el
// comportamiento actual de devolver todo). Solo cuando el cliente pasa
// ?take= y/o ?skip= se aplican; take se capa a MAX_PAGE_SIZE.
const MAX_PAGE_SIZE = 200;

function parsePagination(query = {}) {
  let take;
  if (query.take !== undefined) {
    const rawTake = Number(query.take);
    if (Number.isFinite(rawTake) && rawTake > 0) {
      take = Math.min(Math.floor(rawTake), MAX_PAGE_SIZE);
    }
  }
  let skip;
  if (query.skip !== undefined) {
    const rawSkip = Number(query.skip);
    if (Number.isFinite(rawSkip) && rawSkip >= 0) {
      skip = Math.floor(rawSkip);
    }
  }
  return { take, skip };
}

function generateCode(prefix) {
  const random = crypto.randomBytes(5).toString('hex').toUpperCase().slice(0, 8);
  return `${prefix}-${random}`;
}

async function generateUniqueCode(prefix, model) {
  for (let i = 0; i < 5; i++) {
    const code = generateCode(prefix);
    const existing = await prisma[model].findUnique({ where: { code } });
    if (!existing) return code;
  }
  throw new Error('No se pudo generar un código único, intenta de nuevo');
}

router.use(authenticate, requireRole('ADMIN'));

router.get('/stats', async (_req, res) => {
  try {
    const [businesses, professionals, bookings, users] = await Promise.all([
      prisma.business.count(),
      prisma.professional.count(),
      prisma.booking.count(),
      prisma.user.count(),
    ]);
    res.json({ businesses, professionals, bookings, users });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/businesses', async (req, res) => {
  try {
    const { take, skip } = parsePagination(req.query);
    const businesses = await prisma.business.findMany({
      include: {
        _count: { select: { services: true, professionals: true } },
        professionals: { select: { _count: { select: { bookings: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      ...(take !== undefined ? { take } : {}),
      ...(skip !== undefined ? { skip } : {}),
    });
    res.json(businesses.map(b => ({
      id: b.id,
      name: b.name,
      category: b.category,
      city: b.city,
      country: b.country,
      phone: b.phone,
      address: b.address,
      plan: b.plan ?? 'team',
      paymentGateway: b.paymentGateway ?? null,
      serviceCount: b._count.services,
      professionalCount: b._count.professionals,
      bookingCount: b.professionals.reduce((s, p) => s + p._count.bookings, 0),
      createdAt: b.createdAt,
    })));
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/categories', async (_req, res) => {
  try {
    const cats = await prisma.category.findMany({ orderBy: { name: 'asc' } });
    res.json(cats);
  } catch { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/categories', async (req, res) => {
  try {
    const { name, slug, icon } = req.body;
    if (!name || !slug) return res.status(400).json({ error: 'name y slug son requeridos' });
    const safeSlug = String(slug).toLowerCase().trim().replace(/[^a-z0-9-]/g, '');
    if (!safeSlug) return res.status(400).json({ error: 'slug inválido' });
    const existing = await prisma.category.findUnique({ where: { slug: safeSlug } });
    if (existing) return res.status(400).json({ error: 'Ya existe una categoría con ese slug' });
    const cat = await prisma.category.create({ data: { name: String(name).trim().slice(0, 100), slug: safeSlug, icon: icon ? String(icon).slice(0, 10) : null } });
    res.status(201).json(cat);
  } catch { res.status(400).json({ error: 'Error al crear categoría' }); }
});

router.delete('/categories/:id', async (req, res) => {
  try {
    await prisma.category.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch { res.status(400).json({ error: 'Error al eliminar categoría' }); }
});

router.get('/professionals', async (req, res) => {
  try {
    const { take, skip } = parsePagination(req.query);
    const professionals = await prisma.professional.findMany({
      include: {
        business: { select: { id: true, name: true, category: true } },
        user: { select: { id: true, name: true, email: true } },
        _count: { select: { bookings: true, services: true } },
      },
      orderBy: { createdAt: 'desc' },
      ...(take !== undefined ? { take } : {}),
      ...(skip !== undefined ? { skip } : {}),
    });
    res.json(professionals);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Referral codes: Promotores ──────────────────────────────────────────────
// El tipo de suscripción/plan NO se puede editar desde admin (ni por UI ni
// por API): es de solo lectura aquí. El plan real solo cambia a través del
// flujo de billing/checkout (ver payment.routes.js /wompi/webhook).

router.get('/promoters', async (req, res) => {
  try {
    const { take, skip } = parsePagination(req.query);
    const promoters = await prisma.promoter.findMany({
      orderBy: { createdAt: 'desc' },
      ...(take !== undefined ? { take } : {}),
      ...(skip !== undefined ? { skip } : {}),
      include: {
        businesses: {
          select: { id: true, plan: true, status: true, subscription: { select: { status: true } } },
        },
        professionals: {
          where: { businessId: null },
          select: { id: true, plan: true, subscription: { select: { status: true } } },
        },
        conversions: { select: { status: true } },
      },
    });

    res.json(promoters.map(p => {
      const activeBusinesses = p.businesses.filter(b => b.status === 'ACTIVE' && b.subscription?.status === 'ACTIVE');
      const activeProfessionals = p.professionals.filter(pr => pr.subscription?.status === 'ACTIVE');

      const planBreakdown = { solo: 0, team: 0, studio: 0, enterprise: 0 };
      for (const b of activeBusinesses) planBreakdown[b.plan] = (planBreakdown[b.plan] ?? 0) + 1;
      for (const pr of activeProfessionals) planBreakdown[pr.plan] = (planBreakdown[pr.plan] ?? 0) + 1;

      const { businesses, professionals, conversions, ...rest } = p;
      return {
        ...rest,
        businessesLinked: businesses.length,
        independentsLinked: professionals.length,
        activeCount: activeBusinesses.length + activeProfessionals.length,
        paidConversions: conversions.filter(c => c.status === 'DISCOUNT_APPLIED').length,
        planBreakdown,
      };
    }));
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// KPIs generales del programa de referidos — para el overview de
// admin/referral-codes (pestaña Conversiones).
router.get('/referrals/stats', async (_req, res) => {
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [totalPromoters, referredBusinesses, referredProfessionals, totalPaid, totalPending, recentConversions] = await Promise.all([
      prisma.promoter.count(),
      prisma.business.count({ where: { promoterId: { not: null } } }),
      prisma.professional.count({ where: { promoterId: { not: null }, businessId: null } }),
      prisma.promoterConversion.count({ where: { status: 'DISCOUNT_APPLIED' } }),
      prisma.promoterConversion.count({ where: { status: 'PENDING_PAYMENT' } }),
      prisma.promoterConversion.count({ where: { usedAt: { gte: since } } }),
    ]);
    res.json({
      totalPromoters,
      totalReferred: referredBusinesses + referredProfessionals,
      totalPaid,
      totalPending,
      recentConversions,
    });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Detalle de un promotor: todos los negocios/independientes que entraron con
// su código, con su estado actual y de pago. Es la vista 2 del flujo
// promotores → detalle del admin de conversiones.
router.get('/promoters/:id', async (req, res) => {
  try {
    const promoter = await prisma.promoter.findUnique({
      where: { id: req.params.id },
      include: {
        businesses: {
          orderBy: { createdAt: 'desc' },
          include: { owner: { select: { email: true } }, subscription: true },
        },
        professionals: {
          where: { businessId: null },
          orderBy: { createdAt: 'desc' },
          include: { user: { select: { email: true } }, subscription: true },
        },
      },
    });
    if (!promoter) return res.status(404).json({ error: 'Promotor no encontrado' });

    const now = Date.now();
    function mapEntity(entity, type, email) {
      const sub = entity.subscription;
      const entityActive = type === 'BUSINESS' ? entity.status === 'ACTIVE' : null;
      return {
        id: entity.id,
        type,
        name: entity.name,
        email: email ?? null,
        createdAt: entity.createdAt,
        plan: entity.plan,
        billingPlan: sub?.billingPlan ?? null,
        currentStatus: subscriptionService.getDisplayState(sub, entityActive),
        paymentStatus: sub?.billingPlan ? 'paid' : 'pending',
        justPaid: !!(sub?.activatedAt && (now - new Date(sub.activatedAt).getTime()) < RECENT_PAYMENT_HOURS * 60 * 60 * 1000),
      };
    }

    const items = [
      ...promoter.businesses.map(b => mapEntity(b, 'BUSINESS', b.owner?.email)),
      ...promoter.professionals.map(p => mapEntity(p, 'PROFESSIONAL', p.user?.email)),
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const { businesses, professionals, ...promoterInfo } = promoter;
    res.json({ promoter: promoterInfo, items });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/promoters', async (req, res) => {
  try {
    const { firstName, lastName, email, phone, country } = req.body;
    if (!firstName?.trim() || !lastName?.trim() || !email?.trim()) {
      return res.status(400).json({ error: 'Nombre, apellido y email son requeridos' });
    }
    const cleanEmail = String(email).trim().toLowerCase();
    const cleanCountry = country === 'US' ? 'US' : 'CO'; // país del promotor → moneda de su comisión
    const existing = await prisma.promoter.findUnique({ where: { email: cleanEmail } });
    if (existing) return res.status(400).json({ error: 'Ya existe un promotor con ese email' });

    const code = await generateUniqueCode('PROMO', 'promoter');
    const promoter = await prisma.promoter.create({
      data: {
        firstName: String(firstName).trim().slice(0, 100),
        lastName: String(lastName).trim().slice(0, 100),
        email: cleanEmail,
        phone: phone ? String(phone).trim().slice(0, 30) : null,
        country: cleanCountry,
        code,
      },
    });
    console.log(`[admin] promotor creado: ${promoter.id} (${promoter.email}) by=${req.user.id}`);
    res.status(201).json(promoter);
  } catch {
    res.status(400).json({ error: 'Error al crear promotor' });
  }
});

router.patch('/promoters/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['ACTIVE', 'INACTIVE'].includes(status)) return res.status(400).json({ error: 'Estado inválido' });

    const promoter = await prisma.promoter.update({ where: { id: req.params.id }, data: { status } });
    console.log(`[admin] promotor estado: ${promoter.id} -> ${status} by=${req.user.id}`);
    res.json(promoter);
  } catch {
    res.status(400).json({ error: 'Error al actualizar promotor' });
  }
});

// ── Referral codes: Cortesías ───────────────────────────────────────────────

router.get('/courtesy-codes', async (req, res) => {
  try {
    const { take, skip } = parsePagination(req.query);
    const codes = await prisma.courtesyCode.findMany({
      orderBy: { createdAt: 'desc' },
      ...(take !== undefined ? { take } : {}),
      ...(skip !== undefined ? { skip } : {}),
      include: {
        redeemedBusiness: { select: { name: true } },
        redeemedProfessional: { select: { name: true } },
      },
    });
    res.json(codes.map(c => ({
      id: c.id,
      code: c.code,
      label: c.label,
      plan: c.plan,
      status: c.status,
      createdAt: c.createdAt,
      usedAt: c.usedAt,
      redeemedByType: c.redeemedByType,
      redeemedByName: c.redeemedBusiness?.name ?? c.redeemedProfessional?.name ?? null,
    })));
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/courtesy-codes', async (req, res) => {
  try {
    const { plan, label } = req.body;
    if (!VALID_COURTESY_PLANS.includes(plan)) {
      return res.status(400).json({ error: 'Plan inválido. Elige Independiente, Equipo, Estudio o Empresarial.' });
    }
    const code = await generateUniqueCode('CORTESIA', 'courtesyCode');
    const courtesy = await prisma.courtesyCode.create({
      data: { code, plan, label: label ? String(label).trim().slice(0, 100) : null },
    });
    console.log(`[admin] código de cortesía creado: ${courtesy.code} plan=${plan} by=${req.user.id}`);
    res.status(201).json(courtesy);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Error al generar código' });
  }
});

// ── Finanzas & Billing ──────────────────────────────────────────────────────
// Dashboard de finanzas admin: MRR/ARR, suscripciones, descuentos por
// referidos y comisiones a promotores (estas últimas SOLO informativas — no
// hay cobro ni pasarela hacia promotores).

// country (CO|US) selecciona el país/moneda; default CO. Las finanzas nunca
// mezclan ni convierten monedas: cada vista es de un solo país.
router.get('/finance/overview', async (req, res) => {
  try {
    res.json(await adminFinanceService.getOverview({ country: req.query.country }));
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/finance/subscriptions', async (req, res) => {
  try {
    res.json(await adminFinanceService.getSubscriptions(req.query));
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/finance/discounts', async (req, res) => {
  try {
    const commissionService = require('../services/commission.service');
    res.json(await commissionService.getDiscountBreakdown({ from: req.query.from, to: req.query.to, country: req.query.country }));
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/finance/commissions', async (req, res) => {
  try {
    const commissionService = require('../services/commission.service');
    res.json(await commissionService.getPromoterCommissions({
      year: Number(req.query.year) || undefined,
      month: Number(req.query.month) || undefined,
      country: req.query.country,
    }));
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
