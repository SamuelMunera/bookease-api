const router = require('express').Router();
const prisma = require('../config/database');
const { authenticate } = require('../middleware/auth');
const stripeService = require('../services/stripe.service');

const VALID_PLANS = ['solo', 'team', 'studio'];

async function resolveEntity(user) {
  if (user.role === 'BUSINESS_OWNER') {
    const biz = await prisma.business.findFirst({ where: { ownerId: user.id }, select: { id: true } });
    if (!biz) throw Object.assign(new Error('Negocio no encontrado'), { status: 404 });
    return { entityType: 'business', entityId: biz.id };
  }
  if (user.role === 'PROFESSIONAL') {
    const pro = await prisma.professional.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!pro) throw Object.assign(new Error('Perfil profesional no encontrado'), { status: 404 });
    return { entityType: 'professional', entityId: pro.id };
  }
  throw Object.assign(new Error('Forbidden'), { status: 403 });
}

// POST /api/stripe/checkout-session
// Creates a Stripe Checkout session for a new subscription.
router.post('/checkout-session', authenticate, async (req, res) => {
  try {
    const { plan, country = 'CO' } = req.body;
    if (!VALID_PLANS.includes(plan)) return res.status(400).json({ error: 'Plan inválido' });

    const { entityType, entityId } = await resolveEntity(req.user);
    const url = await stripeService.createCheckoutSession({
      plan, country, entityType, entityId,
      email: req.user.email,
      name:  req.user.name,
    });

    res.json({ url });
  } catch (err) {
    const status = err.status || 400;
    res.status(status).json({ error: err.message });
  }
});

// POST /api/stripe/portal-session
// Creates a Stripe Customer Portal session to manage an existing subscription.
router.post('/portal-session', authenticate, async (req, res) => {
  try {
    const { entityType, entityId } = await resolveEntity(req.user);
    const url = await stripeService.createPortalSession(entityType, entityId);
    res.json({ url });
  } catch (err) {
    const status = err.status || 400;
    res.status(status).json({ error: err.message });
  }
});

// POST /api/stripe/webhook  (raw body — mounted before express.json in index.js)
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  try {
    await stripeService.handleWebhook(req.body, sig);
    res.json({ received: true });
  } catch (err) {
    console.error('[stripe/webhook]', err.message);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
