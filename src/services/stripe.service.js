const prisma = require('../config/database');
const { stripe, getPriceId, findPlanByPriceId } = require('../config/stripe');

const APP_URL = process.env.APP_URL || 'http://localhost:5173';

// Returns existing stripeCustomerId or creates a new Stripe customer and persists it.
async function getOrCreateCustomer(entityType, entityId, email, name) {
  const model = entityType === 'business' ? prisma.business : prisma.professional;
  const record = await model.findUnique({ where: { id: entityId }, select: { stripeCustomerId: true } });

  if (record?.stripeCustomerId) return record.stripeCustomerId;

  const customer = await stripe.customers.create({ email, name,
    metadata: { entityType, entityId },
  });

  await model.update({ where: { id: entityId }, data: { stripeCustomerId: customer.id } });
  return customer.id;
}

async function createCheckoutSession({ plan, country, entityType, entityId, email, name }) {
  const priceId = getPriceId(plan, country);
  if (!priceId) throw new Error(`No hay precio configurado para el plan "${plan}" en ${country}. Contacta soporte.`);

  const customerId = await getOrCreateCustomer(entityType, entityId, email, name);

  // If subscription already exists in Stripe, update it instead of creating a new one.
  const existing = await prisma.subscription.findFirst({
    where: entityType === 'business' ? { businessId: entityId } : { professionalId: entityId },
    select: { stripeSubscriptionId: true, status: true, plan: true },
  });
  if (existing?.stripeSubscriptionId && !['CANCELLED', 'EXPIRED'].includes(existing.status)) {
    if (existing.plan === plan) throw new Error('Ya estás suscrito a este plan.');
    return changePlanOnStripe(existing.stripeSubscriptionId, priceId, plan);
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      trial_period_days: 14,
      metadata: { entityType, entityId, plan, country },
    },
    metadata: { entityType, entityId, plan, country },
    success_url: `${APP_URL}/dashboard?stripe=success`,
    cancel_url: `${APP_URL}/pricing?stripe=cancel`,
    allow_promotion_codes: true,
  });

  return session.url;
}

// Updates an existing Stripe subscription to a new price (upgrade/downgrade).
// Returns { updated: true } — DB is synced via customer.subscription.updated webhook.
async function changePlanOnStripe(stripeSubscriptionId, newPriceId, newPlan) {
  const stripeSub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
  const itemId = stripeSub.items.data[0]?.id;
  if (!itemId) throw new Error('No se encontró el item de la suscripción en Stripe.');

  await stripe.subscriptions.update(stripeSubscriptionId, {
    items: [{ id: itemId, price: newPriceId }],
    proration_behavior: 'create_prorations',
  });

  return { updated: true, plan: newPlan };
}

async function createPortalSession(entityType, entityId) {
  const model = entityType === 'business' ? prisma.business : prisma.professional;
  const record = await model.findUnique({ where: { id: entityId }, select: { stripeCustomerId: true } });

  if (!record?.stripeCustomerId) {
    throw new Error('No tienes una suscripción activa en Stripe. Elige un plan primero.');
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: record.stripeCustomerId,
    return_url: `${APP_URL}/dashboard`,
  });

  return session.url;
}

// ── Webhook handlers ──────────────────────────────────────────────────────────

async function handleWebhook(rawBody, signature) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET not configured');

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    throw new Error(`Webhook signature invalid: ${err.message}`);
  }

  switch (event.type) {
    case 'checkout.session.completed':
      if (event.data.object.mode === 'subscription') await onCheckoutCompleted(event.data.object);
      break;
    case 'customer.subscription.updated':
      await onSubscriptionUpdated(event.data.object);
      break;
    case 'customer.subscription.deleted':
      await onSubscriptionDeleted(event.data.object);
      break;
    case 'invoice.paid':
      await onInvoicePaid(event.data.object);
      break;
    case 'invoice.payment_failed':
      await onInvoicePaymentFailed(event.data.object);
      break;
  }
}

async function onCheckoutCompleted(session) {
  const { entityType, entityId, plan, country } = session.metadata || {};
  if (!entityType || !entityId) return;

  const stripeSub = await stripe.subscriptions.retrieve(session.subscription);
  const status = stripeStatusToLocal(stripeSub.status);
  const periodStart = new Date(stripeSub.current_period_start * 1000);
  const periodEnd   = new Date(stripeSub.current_period_end   * 1000);
  const trialEnd    = stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000) : null;

  const where = entityType === 'business' ? { businessId: entityId } : { professionalId: entityId };
  const existing = await prisma.subscription.findFirst({ where });

  if (existing) {
    await prisma.subscription.update({
      where: { id: existing.id },
      data: {
        stripeSubscriptionId: stripeSub.id,
        status, plan,
        currentPeriodStart: periodStart,
        currentPeriodEnd:   periodEnd,
        trialEndsAt:        trialEnd,
        cancelAtPeriodEnd:  false,
        paymentGateway:     'STRIPE',
      },
    });
  } else {
    await prisma.subscription.create({
      data: {
        ...(entityType === 'business' ? { businessId: entityId } : { professionalId: entityId }),
        stripeSubscriptionId: stripeSub.id,
        status, plan,
        country: country || 'CO',
        paymentGateway: 'STRIPE',
        currentPeriodStart: periodStart,
        currentPeriodEnd:   periodEnd,
        trialEndsAt:        trialEnd,
      },
    });
  }

  if (entityType === 'business') {
    await prisma.business.update({ where: { id: entityId }, data: { plan, status: 'ACTIVE' } });
  } else {
    await prisma.professional.update({ where: { id: entityId }, data: { plan } });
  }
}

async function onSubscriptionUpdated(stripeSub) {
  const sub = await prisma.subscription.findFirst({
    where: { stripeSubscriptionId: stripeSub.id },
  });
  if (!sub) return;

  const status     = stripeStatusToLocal(stripeSub.status);
  const periodStart = new Date(stripeSub.current_period_start * 1000);
  const periodEnd   = new Date(stripeSub.current_period_end   * 1000);
  const trialEnd    = stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000) : null;
  const priceId     = stripeSub.items?.data?.[0]?.price?.id;
  const plan        = findPlanByPriceId(priceId) || sub.plan;

  await prisma.subscription.update({
    where: { id: sub.id },
    data: {
      status, plan,
      currentPeriodStart: periodStart,
      currentPeriodEnd:   periodEnd,
      trialEndsAt:        trialEnd,
      cancelAtPeriodEnd:  stripeSub.cancel_at_period_end,
    },
  });

  const bizStatus = ['ACTIVE', 'TRIALING'].includes(status) ? 'ACTIVE' : 'SUSPENDED';
  if (sub.businessId) {
    await prisma.business.update({
      where: { id: sub.businessId },
      data: { status: bizStatus, ...(plan !== sub.plan && { plan }) },
    });
  }
  if (sub.professionalId && plan !== sub.plan) {
    await prisma.professional.update({ where: { id: sub.professionalId }, data: { plan } });
  }
}

async function onSubscriptionDeleted(stripeSub) {
  const sub = await prisma.subscription.findFirst({
    where: { stripeSubscriptionId: stripeSub.id },
    select: { businessId: true },
  });
  await prisma.subscription.updateMany({
    where: { stripeSubscriptionId: stripeSub.id },
    data:  { status: 'CANCELLED', cancelAtPeriodEnd: false },
  });
  if (sub?.businessId) {
    await prisma.business.update({ where: { id: sub.businessId }, data: { status: 'SUSPENDED' } });
  }
}

async function onInvoicePaid(invoice) {
  if (!invoice.subscription) return;
  const sub = await prisma.subscription.findFirst({
    where: { stripeSubscriptionId: invoice.subscription },
    select: { businessId: true },
  });
  await prisma.subscription.updateMany({
    where: { stripeSubscriptionId: invoice.subscription },
    data: {
      status:             'ACTIVE',
      currentPeriodStart: new Date(invoice.period_start * 1000),
      currentPeriodEnd:   new Date(invoice.period_end   * 1000),
    },
  });
  if (sub?.businessId) {
    await prisma.business.update({ where: { id: sub.businessId }, data: { status: 'ACTIVE' } });
  }
}

async function onInvoicePaymentFailed(invoice) {
  if (!invoice.subscription) return;
  const sub = await prisma.subscription.findFirst({
    where: { stripeSubscriptionId: invoice.subscription },
    select: { businessId: true },
  });
  await prisma.subscription.updateMany({
    where: { stripeSubscriptionId: invoice.subscription },
    data:  { status: 'PAST_DUE' },
  });
  if (sub?.businessId) {
    await prisma.business.update({ where: { id: sub.businessId }, data: { status: 'SUSPENDED' } });
  }
}

function stripeStatusToLocal(stripeStatus) {
  const map = {
    active:             'ACTIVE',
    trialing:           'TRIALING',
    past_due:           'PAST_DUE',
    canceled:           'CANCELLED',
    unpaid:             'PAST_DUE',
    incomplete:         'PAST_DUE',
    incomplete_expired: 'EXPIRED',
  };
  return map[stripeStatus] || 'ACTIVE';
}

module.exports = { createCheckoutSession, changePlanOnStripe, createPortalSession, handleWebhook };
