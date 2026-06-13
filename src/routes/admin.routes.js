const crypto = require('crypto');
const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const prisma = require('../config/database');
const { getPlanLimit } = require('../config/plans');
const subscriptionService = require('../services/subscription.service');

const VALID_PLANS = ['solo', 'team', 'studio', 'enterprise'];

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

router.get('/businesses', async (_req, res) => {
  try {
    const businesses = await prisma.business.findMany({
      include: {
        _count: { select: { services: true, professionals: true } },
        professionals: { select: { _count: { select: { bookings: true } } } },
      },
      orderBy: { createdAt: 'desc' },
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

router.get('/professionals', async (_req, res) => {
  try {
    const professionals = await prisma.professional.findMany({
      include: {
        business: { select: { id: true, name: true, category: true } },
        user: { select: { id: true, name: true, email: true } },
        _count: { select: { bookings: true, services: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(professionals);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Plan management ──────────────────────────────────────────────────────────

router.patch('/businesses/:id/plan', async (req, res) => {
  try {
    const { plan } = req.body;
    if (!VALID_PLANS.includes(plan)) return res.status(400).json({ error: 'Plan inválido' });

    const biz = await prisma.business.findUnique({
      where: { id: req.params.id },
      include: { professionals: { select: { id: true } } },
    });
    if (!biz) return res.status(404).json({ error: 'Negocio no encontrado' });

    const updated = await prisma.business.update({ where: { id: req.params.id }, data: { plan } });

    // Keep subscription in sync
    const sub = await subscriptionService.getByBusiness(req.params.id);
    if (sub) await subscriptionService.changePlan(sub.id, plan);

    const newLimit   = getPlanLimit(plan);
    const currentCount = biz.professionals.length;
    const response   = { plan: updated.plan };

    if (newLimit !== Infinity && currentCount > newLimit) {
      response.downgradeWarning = `El negocio tiene ${currentCount} profesionales activos pero el plan "${plan}" permite ${newLimit}. Los profesionales existentes no fueron eliminados; nuevas vinculaciones quedarán bloqueadas hasta regularizar.`;
    }

    console.log(`[admin] plan cambio: business=${req.params.id} oldPlan=${biz.plan} newPlan=${plan} by=${req.user.id}`);
    res.json(response);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/professionals/:id/plan', async (req, res) => {
  try {
    const { plan } = req.body;
    if (!VALID_PLANS.includes(plan)) return res.status(400).json({ error: 'Plan inválido' });

    const pro = await prisma.professional.findUnique({ where: { id: req.params.id } });
    if (!pro) return res.status(404).json({ error: 'Profesional no encontrado' });

    const updated = await prisma.professional.update({ where: { id: req.params.id }, data: { plan } });

    // Keep subscription in sync for solo professionals
    const sub = await subscriptionService.getByProfessional(req.params.id);
    if (sub) await subscriptionService.changePlan(sub.id, plan);

    console.log(`[admin] plan cambio: professional=${req.params.id} oldPlan=${pro.plan} newPlan=${plan} by=${req.user.id}`);
    res.json({ plan: updated.plan });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Referral codes: Promotores ──────────────────────────────────────────────

router.get('/promoters', async (_req, res) => {
  try {
    const promoters = await prisma.promoter.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(promoters);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/promoters', async (req, res) => {
  try {
    const { firstName, lastName, email, phone } = req.body;
    if (!firstName?.trim() || !lastName?.trim() || !email?.trim()) {
      return res.status(400).json({ error: 'Nombre, apellido y email son requeridos' });
    }
    const cleanEmail = String(email).trim().toLowerCase();
    const existing = await prisma.promoter.findUnique({ where: { email: cleanEmail } });
    if (existing) return res.status(400).json({ error: 'Ya existe un promotor con ese email' });

    const code = await generateUniqueCode('PROMO', 'promoter');
    const promoter = await prisma.promoter.create({
      data: {
        firstName: String(firstName).trim().slice(0, 100),
        lastName: String(lastName).trim().slice(0, 100),
        email: cleanEmail,
        phone: phone ? String(phone).trim().slice(0, 30) : null,
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

router.get('/courtesy-codes', async (_req, res) => {
  try {
    const codes = await prisma.courtesyCode.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(codes);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/courtesy-codes', async (req, res) => {
  try {
    const code = await generateUniqueCode('CORTESIA', 'courtesyCode');
    const courtesy = await prisma.courtesyCode.create({ data: { code } });
    console.log(`[admin] código de cortesía creado: ${courtesy.code} by=${req.user.id}`);
    res.status(201).json(courtesy);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Error al generar código' });
  }
});

router.patch('/courtesy-codes/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['UNUSED', 'USED'].includes(status)) return res.status(400).json({ error: 'Estado inválido' });

    const courtesy = await prisma.courtesyCode.update({
      where: { id: req.params.id },
      data: { status, usedAt: status === 'USED' ? new Date() : null },
    });
    console.log(`[admin] código de cortesía estado: ${courtesy.code} -> ${status} by=${req.user.id}`);
    res.json(courtesy);
  } catch {
    res.status(400).json({ error: 'Error al actualizar código' });
  }
});

module.exports = router;
