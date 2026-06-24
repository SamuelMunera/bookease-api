const router = require('express').Router();
const prisma = require('../config/database');
const { authenticate } = require('../middleware/auth');
const wompi = require('../config/wompi');
const wompiService = require('../services/wompi.service');
const { getPlanById } = require('../config/plans');
const subscriptionService = require('../services/subscription.service');
const referralService = require('../services/referral.service');

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

    // Mes gratis del referidor (etapa 1): si el negocio tiene meses gratis
    // disponibles, esta suscripción se activa 30 días GRATIS sin pasar por la
    // pasarela. Tiene prioridad sobre el crédito de 20% (etapa 2).
    if (businessId) {
      const bizRef = await prisma.business.findUnique({
        where: { id: businessId },
        select: { freeMonthsEarned: true, freeMonthsUsed: true },
      });
      if (bizRef && bizRef.freeMonthsEarned > bizRef.freeMonthsUsed) {
        const sub = await subscriptionService.getByBusiness(businessId);
        if (sub) {
          await subscriptionService.applyFreeMonth(sub.id, plan);
          await prisma.business.update({
            where: { id: businessId },
            data: { freeMonthsUsed: { increment: 1 }, plan },
          });
          return res.json({ freeMonthApplied: true, plan });
        }
      }
    }

    let amountInCents = Math.round(planDef.price * 100);
    const currency = planDef.currency;

    // First-month promoter discount: 10% off the very first payment if this
    // entity registered with a promoter code and hasn't redeemed it yet.
    const conversion = await prisma.promoterConversion.findFirst({
      where: {
        status: 'PENDING_PAYMENT',
        ...(businessId ? { businessId } : { professionalId }),
      },
    });
    let promoterDiscountApplied = false;
    if (conversion && conversion.discountType === 'PERCENT') {
      amountInCents = Math.round(amountInCents * (1 - conversion.discountValue / 100));
      promoterDiscountApplied = true;
    }

    // Descuentos del programa de referidos negocio→negocio. NO ACUMULABLE:
    // se aplica como máximo UN descuento por factura. Si ya hubo descuento de
    // promotor, no se apila ningún descuento de referidos.
    let referrerCreditApplied = false;
    let referredDiscountApplied = false;
    if (businessId && !promoterDiscountApplied) {
      // (a) 20% primer mes para el negocio REFERIDO (aún sin aplicar).
      const referredRecord = await prisma.businessReferral.findUnique({
        where: { referredBusinessId: businessId },
        select: { id: true, referredDiscountApplied: true },
      });
      if (referredRecord && !referredRecord.referredDiscountApplied) {
        amountInCents = Math.round(amountInCents * (1 - referralService.REFERRED_DISCOUNT / 100));
        referredDiscountApplied = true;
      } else {
        // (b) crédito de 20% del REFERIDOR (etapa 2). Solo uno por factura.
        const biz = await prisma.business.findUnique({
          where: { id: businessId },
          select: { discountCreditsEarned: true, discountCreditsUsed: true },
        });
        if (biz && biz.discountCreditsEarned > biz.discountCreditsUsed) {
          amountInCents = Math.round(amountInCents * (1 - referralService.REFERRER_DISCOUNT / 100));
          referrerCreditApplied = true;
        }
      }
    }

    const reference = wompiService.generateReference();
    const signature = wompiService.buildIntegritySignature({ reference, amountInCents, currency });

    await prisma.payment.create({
      data: { reference, businessId, professionalId, plan, amountInCents, currency, promoterDiscountApplied, referrerCreditApplied },
    });

    const customer = await prisma.user.findUnique({ where: { id: req.user.id }, select: { email: true } });

    res.json({
      reference,
      amountInCents,
      currency,
      signature,
      promoterDiscountApplied,
      referredDiscountApplied,
      referrerCreditApplied,
      publicKey: wompi.PUBLIC_KEY,
      checkoutUrl: wompi.CHECKOUT_URL,
      env: wompi.ENV,
      customerEmail: customer?.email,
      plan,
    });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Error al iniciar el pago' });
  }
});

router.get('/wompi/transactions/:reference', authenticate, async (req, res) => {
  try {
    const payment = await prisma.payment.findUnique({ where: { reference: req.params.reference } });
    if (!payment) return res.status(404).json({ error: 'Pago no encontrado' });

    // Verifica pertenencia: el pago debe ser del negocio del usuario (owner) o
    // de su perfil profesional. Si no pertenece, se responde 404 para no filtrar
    // la existencia de referencias ajenas.
    let owns = false;
    if (payment.businessId) {
      const biz = await prisma.business.findUnique({ where: { id: payment.businessId }, select: { ownerId: true } });
      owns = biz?.ownerId === req.user.id;
    } else if (payment.professionalId) {
      const pro = await prisma.professional.findUnique({ where: { id: payment.professionalId }, select: { userId: true } });
      owns = pro?.userId === req.user.id;
    }
    if (!owns) return res.status(404).json({ error: 'Pago no encontrado' });

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

    // Solo un estado APPROVED real de Wompi activa la suscripción. PENDING,
    // DECLINED, VOIDED o ERROR dejan el negocio/profesional sin cambios
    // (sigue en su estado de billing actual: trial, payment_required, etc.)
    if (newStatus === 'APPROVED') {
      // payment_source_id solo viene si el cliente aceptó guardar el método de
      // pago en el widget de Wompi — es lo que habilita la auto-renovación
      // mensual real (sin esto, la suscripción no se cobra automáticamente).
      const paymentSourceId = txn.payment_source_id != null ? String(txn.payment_source_id) : undefined;

      if (payment.businessId) {
        const sub = await subscriptionService.getByBusiness(payment.businessId);
        if (sub) await subscriptionService.activate(sub.id, payment.plan, { paymentSourceId });
        await prisma.business.update({ where: { id: payment.businessId }, data: { plan: payment.plan, paymentGateway: 'wompi' } });
      } else if (payment.professionalId) {
        const sub = await subscriptionService.getByProfessional(payment.professionalId);
        if (sub) await subscriptionService.activate(sub.id, payment.plan, { paymentSourceId });
        await prisma.professional.update({ where: { id: payment.professionalId }, data: { plan: payment.plan } });
      }

      if (payment.promoterDiscountApplied) {
        await prisma.promoterConversion.updateMany({
          where: {
            status: 'PENDING_PAYMENT',
            ...(payment.businessId ? { businessId: payment.businessId } : { professionalId: payment.professionalId }),
          },
          data: { status: 'DISCOUNT_APPLIED' },
        });
      }

      if (payment.businessId) {
        // El pago real del negocio referido marca la referencia como EXITOSA y
        // dispara la recompensa del referidor (mes gratis o crédito 20%).
        // Idempotente ante webhooks duplicados de Wompi.
        await referralService.markReferralSuccessful(payment.businessId).catch(err =>
          console.error('[wompi webhook] referral reward error:', err.message));

        // Si este pago consumió un crédito 20% del referidor, recién ahora
        // (pago aprobado) se descuenta del saldo — nunca en pagos fallidos.
        if (payment.referrerCreditApplied) {
          await prisma.business.update({
            where: { id: payment.businessId },
            data: { discountCreditsUsed: { increment: 1 } },
          });
        }
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
