const prisma = require('../config/database');
const wompiService = require('./wompi.service');
const { getPlanById } = require('../config/plans');

const TRIAL_DAYS = 15;
const PERIOD_DAYS = 30;
// Courtesy subscriptions get a 100-year period so renewal/expiration crons
// never touch them — effectively free forever.
const COURTESY_PERIOD_DAYS = 365 * 100;

function periodDates(fromDate = new Date(), days = PERIOD_DAYS) {
  const start = new Date(fromDate);
  const end   = new Date(fromDate);
  end.setDate(end.getDate() + days);
  return { currentPeriodStart: start, currentPeriodEnd: end };
}

function trialEndDate(fromDate = new Date()) {
  const d = new Date(fromDate);
  d.setDate(d.getDate() + TRIAL_DAYS);
  return d;
}

// Maps the raw SubscriptionStatus + trialEndsAt to the billing state the
// product surfaces to the user. Computed live (not just from `status`) so
// the frontend reflects reality even before the expiration cron has run.
function getBillingState(sub) {
  if (!sub) return 'no_subscription';
  if (sub.status === 'CANCELLED') return 'cancelled';
  if (sub.status === 'PAST_DUE') return 'past_due';
  if (sub.status === 'ACTIVE') return 'active_paid';
  if (sub.status === 'EXPIRED') return 'payment_required';
  if (sub.status === 'TRIALING') {
    return sub.trialEndsAt && sub.trialEndsAt <= new Date() ? 'payment_required' : 'trial_active';
  }
  return 'no_subscription';
}

// Human-facing "current status" for admin views — splits the TRIALING
// billingState into 'trial_active' vs 'trial_expired' (which getBillingState
// collapses into 'payment_required'), and otherwise reflects whether the
// entity is operational right now. Distinct from `getBillingState`, which
// drives in-app billing gates.
function getDisplayState(sub, entityActive) {
  if (!sub) return 'registered';
  const billingState = getBillingState(sub);
  if (sub.status === 'TRIALING') {
    return billingState === 'trial_active' ? 'trial_active' : 'trial_expired';
  }
  const active = entityActive != null ? entityActive : isBillingActive(billingState);
  return active ? 'active' : 'inactive';
}

// Days left in the trial (0 if expired or not trialing).
function trialDaysRemaining(sub) {
  if (!sub?.trialEndsAt) return 0;
  const ms = new Date(sub.trialEndsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

// A business/professional is operational only while it has a running trial
// or a subscription that's actually been paid — every other billing state
// (payment_required, past_due, cancelled, no_subscription) is "inactive".
function isBillingActive(billingState) {
  return billingState === 'trial_active' || billingState === 'active_paid';
}

// Derives the Business.status that should be persisted for a given subscription.
function deriveBusinessStatus(sub) {
  return isBillingActive(getBillingState(sub)) ? 'ACTIVE' : 'INACTIVE';
}

// Keeps Business.status in sync with the subscription's real billing state.
// Never touches SUSPENDED (admin-set) businesses.
async function syncBusinessStatus(businessId, sub, tx = prisma) {
  if (!businessId) return;
  const biz = await tx.business.findUnique({ where: { id: businessId }, select: { status: true } });
  if (!biz || biz.status === 'SUSPENDED') return;
  const next = deriveBusinessStatus(sub);
  if (biz.status !== next) {
    await tx.business.update({ where: { id: businessId }, data: { status: next } });
  }
}

// Throws PAYMENT_REQUIRED when the business/professional behind this
// professional no longer has an active trial or paid subscription —
// used to stop new bookings from landing on accounts that owe payment.
async function assertBillingActive(professionalId) {
  const pro = await prisma.professional.findUnique({
    where: { id: professionalId },
    select: {
      businessId: true,
      subscription: true,
      business: { select: { status: true, subscription: true } },
    },
  });
  if (!pro) return;
  const sub = pro.businessId ? pro.business?.subscription : pro.subscription;
  const businessInactive = pro.businessId && pro.business?.status === 'SUSPENDED';
  if (businessInactive || !isBillingActive(getBillingState(sub))) {
    const err = new Error('Este negocio no puede recibir nuevas reservas: el periodo de prueba terminó o el negocio está inactivo. Pídele al propietario que agregue un método de pago.');
    err.code = 'PAYMENT_REQUIRED';
    throw err;
  }
}

// Marks a subscription as paid/active after a successful gateway payment
// (Wompi transaction status === 'APPROVED'). Records activatedAt, sets
// billingPlan to the plan the client actually chose and paid for at
// checkout, resets the billing period, and syncs the linked business's
// status. If Wompi returned a payment_source_id (card saved), autoRenew
// turns on — this is the ONLY place autoRenew can become true.
async function activate(subscriptionId, plan, { paymentSourceId } = {}) {
  const sub = await prisma.subscription.update({
    where: { id: subscriptionId },
    data: {
      status: 'ACTIVE',
      plan,
      billingPlan: plan,
      activatedAt: new Date(),
      ...(paymentSourceId ? { paymentSourceId, autoRenew: true } : {}),
      ...periodDates(),
    },
  });
  await syncBusinessStatus(sub.businessId, sub);
  return sub;
}

// Attempts a recurring monthly charge against the saved payment_source.
// Records the attempt as a Payment row (mirrors the initial-checkout flow)
// and returns true only if Wompi approved it.
async function chargeRenewal(sub) {
  const planDef = getPlanById(sub.billingPlan, sub.country);
  if (!planDef?.price) return false;

  const amountInCents = Math.round(planDef.price * 100);
  const reference = wompiService.generateReference();

  let txn;
  try {
    txn = await wompiService.chargeRecurring({
      paymentSourceId: sub.paymentSourceId,
      amountInCents,
      currency: planDef.currency,
      reference,
    });
  } catch (err) {
    console.error(`[subscription] renovación fallida sub=${sub.id}:`, err.message);
    return false;
  }

  const VALID_STATUSES = ['PENDING', 'APPROVED', 'DECLINED', 'VOIDED', 'ERROR'];
  const status = VALID_STATUSES.includes(txn.status) ? txn.status : 'ERROR';

  await prisma.payment.create({
    data: {
      reference, businessId: sub.businessId, professionalId: sub.professionalId,
      plan: sub.billingPlan, amountInCents, currency: planDef.currency,
      status, wompiTransactionId: String(txn.id),
    },
  });

  return status === 'APPROVED';
}

// `courtesy: true` creates a subscription that is already ACTIVE (no trial)
// with a period far in the future, so the renewal/expiration crons never
// flag it as due and it never requires payment.
async function createForBusiness(businessId, plan, country, { courtesy = false } = {}, tx = prisma) {
  if (courtesy) {
    return tx.subscription.create({
      data: {
        businessId,
        plan,
        country,
        status: 'ACTIVE',
        billingPlan: plan,
        activatedAt: new Date(),
        trialEndsAt: null,
        ...periodDates(new Date(), COURTESY_PERIOD_DAYS),
      },
    });
  }
  return tx.subscription.create({
    data: {
      businessId,
      plan,
      country,
      status: 'TRIALING',
      trialEndsAt: trialEndDate(),
      ...periodDates(),
    },
  });
}

// Applies a courtesy plan to a professional's existing subscription (created
// at registration with the default 'solo' plan/TRIALING status). Mirrors the
// `courtesy: true` branch of createForBusiness: marks it ACTIVE with the
// gifted plan as both `plan` and `billingPlan`, no trial, no payment needed.
async function applyCourtesySubscription(professionalId, plan, client = prisma) {
  await client.professional.update({ where: { id: professionalId }, data: { plan } });
  return client.subscription.update({
    where: { professionalId },
    data: {
      plan,
      billingPlan: plan,
      status: 'ACTIVE',
      activatedAt: new Date(),
      trialEndsAt: null,
      ...periodDates(new Date(), COURTESY_PERIOD_DAYS),
    },
  });
}

async function createForProfessional(professionalId, plan, country, tx = prisma) {
  return tx.subscription.create({
    data: {
      professionalId,
      plan,
      country,
      status: 'TRIALING',
      trialEndsAt: trialEndDate(),
      ...periodDates(),
    },
  });
}

async function getByBusiness(businessId) {
  return prisma.subscription.findUnique({ where: { businessId } });
}

async function getByProfessional(professionalId) {
  return prisma.subscription.findUnique({ where: { professionalId } });
}

async function changePlan(subscriptionId, newPlan) {
  return prisma.subscription.update({
    where: { id: subscriptionId },
    data: { plan: newPlan },
  });
}

async function cancel(subscriptionId) {
  return prisma.subscription.update({
    where: { id: subscriptionId },
    data: { cancelAtPeriodEnd: true },
  });
}

async function reactivate(subscriptionId) {
  return prisma.subscription.update({
    where: { id: subscriptionId },
    data: { cancelAtPeriodEnd: false },
  });
}

// Called by cron when a billing period ends. Only subscriptions with
// autoRenew + paymentSourceId (real card-on-file from a prior APPROVED
// payment) get an actual recurring charge attempt. Everyone else — no
// saved method, abandoned checkout, never paid — goes straight to
// PAST_DUE, which is not isBillingActive and immediately makes the
// business inactive (item 12/13: no indefinite "active" without a
// successful real charge).
async function renewDue() {
  const now = new Date();
  const due = await prisma.subscription.findMany({
    where: {
      status: { in: ['ACTIVE', 'PAST_DUE'] },
      currentPeriodEnd: { lte: now },
      cancelAtPeriodEnd: false,
    },
  });

  let renewed = 0, markedPastDue = 0;
  for (const sub of due) {
    const canAutoCharge = sub.autoRenew && sub.paymentSourceId && sub.billingPlan;
    const approved = canAutoCharge && await chargeRenewal(sub);

    const updated = approved
      ? await prisma.subscription.update({
          where: { id: sub.id },
          data: { status: 'ACTIVE', ...periodDates(sub.currentPeriodEnd) },
        })
      : await prisma.subscription.update({
          where: { id: sub.id },
          data: { status: 'PAST_DUE' },
        });

    await syncBusinessStatus(updated.businessId, updated);
    approved ? renewed++ : markedPastDue++;
  }

  return { renewed, markedPastDue };
}

// Called by cron: cancel subscriptions past their period end with cancelAtPeriodEnd=true
async function cancelDue() {
  const now = new Date();
  const due = await prisma.subscription.findMany({
    where: {
      cancelAtPeriodEnd: true,
      currentPeriodEnd: { lte: now },
    },
  });

  const results = await Promise.allSettled(
    due.map(async sub => {
      const updated = await prisma.subscription.update({
        where: { id: sub.id },
        data: { status: 'CANCELLED', autoRenew: false },
      });
      await syncBusinessStatus(updated.businessId, updated);
      return updated;
    })
  );

  return { cancelled: results.filter(r => r.status === 'fulfilled').length };
}

async function expireTrials() {
  const now = new Date();
  const due = await prisma.subscription.findMany({
    where: {
      status: 'TRIALING',
      trialEndsAt: { lte: now },
    },
  });

  const results = await Promise.allSettled(
    due.map(async sub => {
      const updated = await prisma.subscription.update({
        where: { id: sub.id },
        data: { status: 'EXPIRED' },
      });
      await syncBusinessStatus(updated.businessId, updated);
      return updated;
    })
  );

  return { expired: results.filter(r => r.status === 'fulfilled').length };
}

// Called by cron: PAST_DUE subscriptions that failed renewal and have had
// GRACE_DAYS to fix payment without success move to EXPIRED. They were
// already non-billing-active (and the business already INACTIVE) the
// moment they hit PAST_DUE — this just stops renewDue from retrying them
// forever and reflects the real lapsed state.
const GRACE_DAYS = 5;

async function markPastDue() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - GRACE_DAYS);

  const due = await prisma.subscription.findMany({
    where: { status: 'PAST_DUE', updatedAt: { lte: cutoff } },
  });

  const results = await Promise.allSettled(
    due.map(async sub => {
      const updated = await prisma.subscription.update({
        where: { id: sub.id },
        data: { status: 'EXPIRED', autoRenew: false },
      });
      await syncBusinessStatus(updated.businessId, updated);
      return updated;
    })
  );

  return { expiredAfterGrace: results.filter(r => r.status === 'fulfilled').length };
}

module.exports = {
  createForBusiness,
  createForProfessional,
  getByBusiness,
  getByProfessional,
  changePlan,
  cancel,
  reactivate,
  renewDue,
  cancelDue,
  expireTrials,
  markPastDue,
  getBillingState,
  trialDaysRemaining,
  assertBillingActive,
  isBillingActive,
  deriveBusinessStatus,
  syncBusinessStatus,
  activate,
  getDisplayState,
  applyCourtesySubscription,
};
