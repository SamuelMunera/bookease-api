const router = require('express').Router();
const crypto  = require('crypto');
const prisma  = require('../config/database');
const { sendBookingReminder, sendAppointmentVerification } = require('../services/email.service');
const { tomorrowInTimezone, bookingToUTCMs } = require('../utils/timezone');
const { parseLocalDate } = require('../services/slot.service');
const subscriptionService = require('../services/subscription.service');

// Constant-time comparison to avoid leaking the secret via timing. Returns
// false as soon as lengths differ (timingSafeEqual throws on unequal lengths),
// keeping the check fail-closed.
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function cronAuth(req, res) {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers['authorization'];
  if (!secret || typeof provided !== 'string' || !safeEqual(provided, `Bearer ${secret}`)) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Reusable task bodies. Each returns a plain result object and NEVER writes to
// res, so they can be invoked from their individual endpoint or from the
// consolidated /daily endpoint (Vercel Hobby only allows 2 daily crons).
// ---------------------------------------------------------------------------

async function runReminders() {
  // Collect unique "tomorrow" dates across all timezones we support
  const timezones = [
    'America/Bogota', 'America/New_York', 'America/Chicago',
    'America/Denver', 'America/Los_Angeles', 'America/Phoenix',
    'America/Anchorage', 'Pacific/Honolulu',
  ];
  const tomorrowDates = [...new Set(timezones.map(tz => tomorrowInTimezone(tz)))];

  const bookings = await prisma.booking.findMany({
    where: {
      date: { in: tomorrowDates.map(d => parseLocalDate(d)) },
      status: 'CONFIRMED',
    },
    include: {
      client:       { select: { id: true, name: true, email: true } },
      professional: { select: { id: true, name: true, timezone: true, user: { select: { email: true } } } },
      service:      { select: { id: true, name: true } },
      homeService:  { select: { id: true, name: true } },
    },
  });

  // Only send to bookings whose date equals "tomorrow" in the professional's timezone
  const relevant = bookings.filter(b => {
    const tz = b.professional?.timezone || 'America/Bogota';
    return new Date(b.date).toISOString().slice(0, 10) === tomorrowInTimezone(tz);
  });

  let sent = 0, failed = 0;
  for (const b of relevant) {
    try { await sendBookingReminder(b); sent++; }
    catch (err) { console.error(`[cron] reminder ${b.id}:`, err.message); failed++; }
  }

  return { ok: true, sent, failed, total: relevant.length };
}

// Appointment verifications — asks the client to confirm an upcoming booking.
// For businesses with apptVerifyEnabled, sends a verification email to bookings
// whose local start time falls within [now, now + apptVerifyHoursBefore] and
// that have not been sent one yet (verificationSentAt = null). Idempotent.
async function runAppointmentVerifications() {
  const now = Date.now();

  // Candidate bookings: CONFIRMED, not yet notified, whose business opted in.
  // Restrict by date to today/tomorrow (local windows of a few hours never span
  // more than two calendar dates across our supported timezones).
  const timezones = [
    'America/Bogota', 'America/New_York', 'America/Chicago',
    'America/Denver', 'America/Los_Angeles', 'America/Phoenix',
    'America/Anchorage', 'Pacific/Honolulu',
  ];
  const dateStrs = new Set();
  for (const tz of timezones) {
    const today = tomorrowInTimezone(tz); // tomorrow
    dateStrs.add(today);
    // also include "today" = day before tomorrow
    const d = new Date(today + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    dateStrs.add(d.toISOString().slice(0, 10));
  }
  const dates = [...dateStrs].map(d => parseLocalDate(d));

  const candidates = await prisma.booking.findMany({
    where: {
      date: { in: dates },
      status: 'CONFIRMED',
      verificationSentAt: null,
      professional: { is: { business: { is: { apptVerifyEnabled: true } } } },
    },
    include: {
      client:       { select: { id: true, name: true, email: true } },
      professional: {
        select: {
          id: true, name: true, timezone: true,
          user: { select: { email: true } },
          business: { select: { name: true, timezone: true, apptVerifyEnabled: true, apptVerifyHoursBefore: true } },
        },
      },
      service:     { select: { id: true, name: true } },
      homeService: { select: { id: true, name: true } },
    },
  });

  // Keep only bookings whose local start time is within the business window.
  const relevant = candidates.filter(b => {
    const biz = b.professional?.business;
    if (!biz?.apptVerifyEnabled) return false;
    const tz = b.professional?.timezone || biz.timezone || 'America/Bogota';
    const hours = Math.min(72, Math.max(1, biz.apptVerifyHoursBefore || 2));
    const startMs = bookingToUTCMs(b.date, b.startTime, tz);
    return startMs >= now && startMs <= now + hours * 3600000;
  });

  let sent = 0, failed = 0;
  for (const b of relevant) {
    try {
      await sendAppointmentVerification(b);
      await prisma.booking.update({ where: { id: b.id }, data: { verificationSentAt: new Date() } });
      sent++;
    } catch (err) {
      console.error(`[cron] verification ${b.id}:`, err.message);
      failed++;
    }
  }

  return { ok: true, sent, failed, total: relevant.length };
}

// Subscription lifecycle — runs daily
async function runSubscriptions() {
  const [trials, cancelled, renewed, expiredPastDue] = await Promise.all([
    subscriptionService.expireTrials(),
    subscriptionService.cancelDue(),
    subscriptionService.renewDue(),
    subscriptionService.markPastDue(),
  ]);
  return { ok: true, ...trials, ...cancelled, ...renewed, ...expiredPastDue };
}

// ---------------------------------------------------------------------------
// Individual endpoints — kept operational for manual invocation.
// ---------------------------------------------------------------------------

router.get('/reminders', async (req, res) => {
  if (!cronAuth(req, res)) return;
  try {
    const result = await runReminders();
    res.json(result);
  } catch (err) {
    console.error('[cron] reminders:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/appointment-verifications', async (req, res) => {
  if (!cronAuth(req, res)) return;
  try {
    const result = await runAppointmentVerifications();
    res.json(result);
  } catch (err) {
    console.error('[cron] appointment-verifications:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/subscriptions', async (req, res) => {
  if (!cronAuth(req, res)) return;
  try {
    const result = await runSubscriptions();
    res.json(result);
  } catch (err) {
    console.error('[cron] subscriptions:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Consolidated daily cron. Vercel Hobby allows a maximum of 2 daily cron jobs,
// so the three daily tasks are executed sequentially here from a single cron.
// Each task is isolated so a failure in one does not abort the others.
// ---------------------------------------------------------------------------
router.get('/daily', async (req, res) => {
  if (!cronAuth(req, res)) return;

  const results = {};
  let hadError = false;

  const tasks = [
    ['reminders', runReminders],
    ['subscriptions', runSubscriptions],
    ['appointmentVerifications', runAppointmentVerifications],
  ];

  for (const [name, fn] of tasks) {
    try {
      results[name] = await fn();
    } catch (err) {
      hadError = true;
      console.error(`[cron] daily/${name}:`, err.message);
      results[name] = { ok: false, error: err.message };
    }
  }

  res.status(hadError ? 500 : 200).json({ ok: !hadError, ...results });
});

module.exports = router;
