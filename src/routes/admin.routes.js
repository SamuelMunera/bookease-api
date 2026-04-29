const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const prisma = require('../config/database');
const { getPlanLimit } = require('../config/plans');

const VALID_PLANS = ['solo', 'team', 'studio', 'enterprise'];

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
    console.log(`[admin] plan cambio: professional=${req.params.id} oldPlan=${pro.plan} newPlan=${plan} by=${req.user.id}`);
    res.json({ plan: updated.plan });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
