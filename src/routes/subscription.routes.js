const router = require('express').Router();
const prisma = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const subscriptionService = require('../services/subscription.service');
const { getPlanLimit, getPlanRank } = require('../config/plans');

const VALID_BUSINESS_PLANS = ['team', 'studio', 'enterprise'];
const VALID_PRO_PLANS     = ['solo'];

// ── Business owner ────────────────────────────────────────────────────────────

router.get('/business/me', authenticate, requireRole('BUSINESS_OWNER'), async (req, res) => {
  try {
    const biz = await prisma.business.findFirst({ where: { ownerId: req.user.id }, select: { id: true, status: true } });
    if (!biz) return res.status(404).json({ error: 'Negocio no encontrado' });
    const sub = await subscriptionService.getByBusiness(biz.id);
    if (!sub) return res.status(404).json({ error: 'Suscripción no encontrada' });
    const { paymentSourceId, ...subPublic } = sub;
    res.json({
      ...subPublic,
      billingState: subscriptionService.getBillingState(sub),
      trialDaysRemaining: subscriptionService.trialDaysRemaining(sub),
      businessStatus: biz.status,
    });
  } catch { res.status(500).json({ error: 'Internal server error' }); }
});

router.patch('/business/me/plan', authenticate, requireRole('BUSINESS_OWNER'), async (req, res) => {
  try {
    const { plan } = req.body;
    if (!VALID_BUSINESS_PLANS.includes(plan)) return res.status(400).json({ error: 'Plan inválido para negocio. Elige Equipo, Estudio o Empresarial.' });

    const biz = await prisma.business.findFirst({
      where: { ownerId: req.user.id },
      include: { professionals: { select: { id: true } }, subscription: true },
    });
    if (!biz) return res.status(404).json({ error: 'Negocio no encontrado' });

    // Subir a un tier superior requiere pago aprobado (webhook Wompi). Este
    // endpoint solo permite downgrade o mantener el mismo tier; el upgrade real
    // se aplica cuando el pago se confirma.
    if (getPlanRank(plan) > getPlanRank(biz.plan)) {
      return res.status(400).json({ error: 'Para subir de plan debes completar el pago. El plan superior se activa al confirmarse el pago.' });
    }

    const newLimit = getPlanLimit(plan);
    const currentCount = biz.professionals.length;
    if (newLimit !== Infinity && currentCount > newLimit) {
      return res.status(400).json({
        error: `El plan "${plan}" permite ${newLimit} profesional${newLimit !== 1 ? 'es' : ''} y tienes ${currentCount}. Desvincula profesionales antes de hacer downgrade.`,
      });
    }

    // Update plan on Business and Subscription atomically
    const [updatedBiz, updatedSub] = await prisma.$transaction([
      prisma.business.update({ where: { id: biz.id }, data: { plan } }),
      ...(biz.subscription
        ? [prisma.subscription.update({ where: { id: biz.subscription.id }, data: { plan } })]
        : []
      ),
    ]);

    res.json({ plan: updatedBiz.plan, subscription: updatedSub ?? null });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/business/me/cancel', authenticate, requireRole('BUSINESS_OWNER'), async (req, res) => {
  try {
    const biz = await prisma.business.findFirst({
      where: { ownerId: req.user.id },
      include: { subscription: true },
    });
    if (!biz?.subscription) return res.status(404).json({ error: 'Suscripción no encontrada' });
    if (biz.subscription.status === 'CANCELLED') {
      return res.status(400).json({ error: 'La suscripción ya está cancelada' });
    }
    const sub = await subscriptionService.cancel(biz.subscription.id);
    res.json({ subscription: sub });
  } catch { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/business/me/reactivate', authenticate, requireRole('BUSINESS_OWNER'), async (req, res) => {
  try {
    const biz = await prisma.business.findFirst({
      where: { ownerId: req.user.id },
      include: { subscription: true },
    });
    if (!biz?.subscription) return res.status(404).json({ error: 'Suscripción no encontrada' });
    if (!biz.subscription.cancelAtPeriodEnd) {
      return res.status(400).json({ error: 'La suscripción no está marcada para cancelar' });
    }
    const sub = await subscriptionService.reactivate(biz.subscription.id);
    res.json({ subscription: sub });
  } catch { res.status(500).json({ error: 'Internal server error' }); }
});

// ── Solo professional ─────────────────────────────────────────────────────────

router.get('/professional/me', authenticate, requireRole('PROFESSIONAL'), async (req, res) => {
  try {
    const pro = await prisma.professional.findUnique({ where: { userId: req.user.id }, select: { id: true } });
    if (!pro) return res.status(404).json({ error: 'Perfil profesional no encontrado' });
    const sub = await subscriptionService.getByProfessional(pro.id);
    if (!sub) return res.status(404).json({ error: 'Suscripción no encontrada' });
    const { paymentSourceId, ...subPublic } = sub;
    res.json({
      ...subPublic,
      billingState: subscriptionService.getBillingState(sub),
      trialDaysRemaining: subscriptionService.trialDaysRemaining(sub),
    });
  } catch { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/professional/me/cancel', authenticate, requireRole('PROFESSIONAL'), async (req, res) => {
  try {
    const pro = await prisma.professional.findUnique({
      where: { userId: req.user.id },
      include: { subscription: true },
    });
    if (!pro?.subscription) return res.status(404).json({ error: 'Suscripción no encontrada' });
    if (pro.subscription.status === 'CANCELLED') {
      return res.status(400).json({ error: 'La suscripción ya está cancelada' });
    }
    const sub = await subscriptionService.cancel(pro.subscription.id);
    res.json({ subscription: sub });
  } catch { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/professional/me/reactivate', authenticate, requireRole('PROFESSIONAL'), async (req, res) => {
  try {
    const pro = await prisma.professional.findUnique({
      where: { userId: req.user.id },
      include: { subscription: true },
    });
    if (!pro?.subscription) return res.status(404).json({ error: 'Suscripción no encontrada' });
    if (!pro.subscription.cancelAtPeriodEnd) {
      return res.status(400).json({ error: 'La suscripción no está marcada para cancelar' });
    }
    const sub = await subscriptionService.reactivate(pro.subscription.id);
    res.json({ subscription: sub });
  } catch { res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
