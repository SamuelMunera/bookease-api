const prisma = require('../config/database');
const { getDefaultGateway } = require('../config/gateways');

const TRIAL_DAYS = 14;
const PERIOD_DAYS = 30;

function periodDates(fromDate = new Date()) {
  const start = new Date(fromDate);
  const end   = new Date(fromDate);
  end.setDate(end.getDate() + PERIOD_DAYS);
  return { currentPeriodStart: start, currentPeriodEnd: end };
}

function trialEndDate(fromDate = new Date()) {
  const d = new Date(fromDate);
  d.setDate(d.getDate() + TRIAL_DAYS);
  return d;
}

async function createForBusiness(businessId, plan, country) {
  const paymentGateway = getDefaultGateway(country);
  return prisma.subscription.create({
    data: {
      businessId,
      plan,
      country,
      paymentGateway,
      status: 'TRIALING',
      trialEndsAt: trialEndDate(),
      ...periodDates(),
    },
  });
}

async function createForProfessional(professionalId, plan, country) {
  const paymentGateway = getDefaultGateway(country);
  return prisma.subscription.create({
    data: {
      professionalId,
      plan,
      country,
      paymentGateway,
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

// Called by cron: advance period for subscriptions due for renewal
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

// Called by cron: expire TRIALING subscriptions whose trial ended
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

// Called by cron: mark ACTIVE subscriptions past period as PAST_DUE
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
