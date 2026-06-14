const router = require('express').Router();
const prisma = require('../config/database');
const { authenticate } = require('../middleware/auth');
const wompi = require('../config/wompi');
const wompiService = require('../services/wompi.service');
const { getPlanById } = require('../config/plans');
const subscriptionService = require('../services/subscription.service');

const VALID_BUSINESS_PLANS = ['team', 'studio', 'enterprise'];
const VALID_PRO_PLANS = ['solo'];

// Public config for the client checkout widget — never exposes the private/integrity/events keys.
router.get('/wompi/config', (_req, res) => {
  res.json({
    env: wompi.ENV,
    publicKey: wompi.PUBLIC_KEY,
    checkoutUrl: wompi.CHECKOUT_URL,
    widgetScriptUrl: wompi.WIDGET_SCRIPT_URL,
  });
});

router.post('/wompi/checkout', authenticate, async (req, res) => {
  try {
    const { plan } = req.body;
    let businessId = null;
    let professionalId = null;
    let country;

    if (req.user.role === 'BUSINESS_OWNER') {
      if (!VALID_BUSINESS_PLANS.includes(plan)) return res.status(400).json({ error: 'Plan inválido para negocio' });
      const biz = await prisma.business.findFirst({ where: { ownerId: req.user.id }, select: { id: true, country: true, coveredByCourtesy: true } });
      if (!biz) return res.status(404).json({ error: 'Negocio no encontrado' });
      if (biz.coveredByCourtesy) return res.status(400).json({ error: 'Este negocio está cubierto por un código de cortesía y no requiere pago.' });
      businessId = biz.id;
      country = biz.country;
    } else if (req.user.role === 'PROFESSIONAL') {
      if (!VALID_PRO_PLANS.includes(plan)) return res.status(400).json({ error: 'Plan inválido para profesional' });
      const pro = await prisma.professional.findUnique({ where: { userId: req.user.id }, select: { id: true, country: true } });
      if (!pro) return res.status(404).json({ error: 'Perfil profesional no encontrado' });
      professionalId = pro.id;
      country = pro.country;
    } else {
      return res.status(403).json({ error: 'Rol no autorizado para pagos' });
    }

    const planDef = getPlanById(plan, country);
    if (!planDef || !planDef.price) return res.status(400).json({ error: 'Este plan no admite pago en línea' });

    const amountInCents = Math.round(planDef.price * 100);
    const currency = planDef.currency;
    const reference = wompiService.generateReference();
    const signature = wompiService.buildIntegritySignature({ reference, amountInCents, currency });

    await prisma.payment.create({
      data: { reference, businessId, professionalId, plan, amountInCents, currency },
    });

    res.json({
      reference,
      amountInCents,
      currency,
      signature,
      publicKey: wompi.PUBLIC_KEY,
      checkoutUrl: wompi.CHECKOUT_URL,
      env: wompi.ENV,
    });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Error al iniciar el pago' });
  }
});

router.get('/wompi/transactions/:reference', authenticate, async (req, res) => {
  try {
    const payment = await prisma.payment.findUnique({ where: { reference: req.params.reference } });
    if (!payment) return res.status(404).json({ error: 'Pago no encontrado' });
    res.json({ reference: payment.reference, plan: payment.plan, status: payment.status });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/wompi/webhook', async (req, res) => {
  try {
    if (!wompiService.verifyWebhookSignature(req.body)) {
      console.warn('[wompi webhook] firma inválida, evento descartado');
      return res.status(400).json({ error: 'Firma inválida' });
    }

    const txn = req.body?.data?.transaction;
    if (!txn?.reference || !txn?.status) return res.status(400).json({ error: 'Evento sin datos de transacción' });

    const payment = await prisma.payment.findUnique({ where: { reference: txn.reference } });
    if (!payment) return res.status(404).json({ error: 'Pago no encontrado' });

    const VALID_STATUSES = ['PENDING', 'APPROVED', 'DECLINED', 'VOIDED', 'ERROR'];
    const newStatus = VALID_STATUSES.includes(txn.status) ? txn.status : 'ERROR';

    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: newStatus, wompiTransactionId: String(txn.id) },
    });

    if (newStatus === 'APPROVED') {
      if (payment.businessId) {
        const sub = await subscriptionService.getByBusiness(payment.businessId);
        if (sub) await subscriptionService.changePlan(sub.id, payment.plan);
        await prisma.business.update({ where: { id: payment.businessId }, data: { plan: payment.plan, paymentGateway: 'wompi' } });
      } else if (payment.professionalId) {
        const sub = await subscriptionService.getByProfessional(payment.professionalId);
        if (sub) await subscriptionService.changePlan(sub.id, payment.plan);
        await prisma.professional.update({ where: { id: payment.professionalId }, data: { plan: payment.plan } });
      }
    }

    console.log(`[wompi webhook] reference=${txn.reference} status=${newStatus}`);
    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[wompi webhook] error procesando evento:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
