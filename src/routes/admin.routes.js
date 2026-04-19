const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const prisma = require('../config/database');

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
  } catch (err) {
    res.status(500).json({ error: err.message });
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
      phone: b.phone,
      address: b.address,
      serviceCount: b._count.services,
      professionalCount: b._count.professionals,
      bookingCount: b.professionals.reduce((s, p) => s + p._count.bookings, 0),
      createdAt: b.createdAt,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/categories', async (_req, res) => {
  try {
    const cats = await prisma.category.findMany({ orderBy: { name: 'asc' } });
    res.json(cats);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/categories', async (req, res) => {
  try {
    const { name, slug, icon } = req.body;
    if (!name || !slug) return res.status(400).json({ error: 'name y slug son requeridos' });
    const existing = await prisma.category.findUnique({ where: { slug } });
    if (existing) return res.status(400).json({ error: 'Ya existe una categoría con ese slug' });
    const cat = await prisma.category.create({ data: { name, slug: slug.toLowerCase().trim(), icon } });
    res.status(201).json(cat);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/categories/:id', async (req, res) => {
  try {
    await prisma.category.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) { res.status(400).json({ error: err.message }); }
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
