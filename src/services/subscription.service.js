const prisma = require('../config/database');

const TRIAL_DAYS = 14;
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

// `courtesy: true` creates a subscription that is already ACTIVE (no trial)
// with a period far in the future, so the renewal/expiration crons never
// flag it as due and it never requires payment.
async function createForBusiness(businessId, plan, country, { courtesy = false } = {}) {
  if (courtesy) {
    return prisma.subscription.create({
      data: {
        businessId,
        plan,
        country,
        status: 'ACTIVE',
        trialEndsAt: null,
        ...periodDates(new Date(), COURTESY_PERIOD_DAYS),
      },
    });
  }
  return prisma.subscription.create({
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

async function createForProfessional(professionalId, plan, country) {
  return prisma.subscription.create({
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

async function renewDue() {
  const now = new Date();
  const due = await prisma.subscription.findMany({
    where: {
      status: { in: ['ACTIVE', 'PAST_DUE'] },
      currentPeriodEnd: { lte: now },
      cancelAtPeriodEnd: false,
    },
  });

  const results = await Promise.allSettled(
    due.map(sub =>
      prisma.subscription.update({
        where: { id: sub.id },
        data: {
          status: 'ACTIVE',
          ...periodDates(sub.currentPeriodEnd),
        },
      })
    )
  );

  return { renewed: results.filter(r => r.status === 'fulfilled').length };
}

// Called by cron: cancel subscriptions past their period end with cancelAtPeriodEnd=true
async function cancelDue() {
  const now = new Date();
  const { count } = await prisma.subscription.updateMany({
    where: {
      cancelAtPeriodEnd: true,
      currentPeriodEnd: { lte: now },
    },
    data: { status: 'CANCELLED' },
  });
  return { cancelled: count };
}

async function expireTrials() {
  const now = new Date();
  const { count } = await prisma.subscription.updateMany({
    where: {
      status: 'TRIALING',
      trialEndsAt: { lte: now },
    },
    data: { status: 'EXPIRED' },
  });
  return { expired: count };
}

async function markPastDue() {
  const now = new Date();
  const { count } = await prisma.subscription.updateMany({
    where: {
      status: 'ACTIVE',
      currentPeriodEnd: { lte: now },
      cancelAtPeriodEnd: false,
    },
    data: { status: 'PAST_DUE' },
  });
  return { markedPastDue: count };
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
};
