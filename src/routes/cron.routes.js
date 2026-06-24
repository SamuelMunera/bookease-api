const router = require('express').Router();
const prisma  = require('../config/database');
const { sendBookingReminder, sendAppointmentVerification } = require('../services/email.service');
const { tomorrowInTimezone, bookingToUTCMs } = require('../utils/timezone');
const { parseLocalDate } = require('../services/slot.service');
const subscriptionService = require('../services/subscription.service');

function cronAuth(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

router.get('/reminders', async (req, res) => {
  if (!cronAuth(req, res)) return;

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

  // Only send to bookings where "tomorrow" matches the professional's timezone
  const relevant = bookings.filter(b => {
    const tz = b.professional?.timezone || 'America/Bogota';
    return tomorrowInTimezone(tz) === tomorrowDates.find(d => d === tomorrowInTimezone(tz));
  });

  let sent = 0, failed = 0;
  for (const b of relevant) {
    try { await sendBookingReminder(b); sent++; }
    catch (err) { console.error(`[cron] reminder ${b.id}:`, err.message); failed++; }
  }

  res.json({ ok: true, sent, failed, total: relevant.length });
});

// Appointment verifications — asks the client to confirm an upcoming booking.
// For businesses with apptVerifyEnabled, sends a verification email to bookings
// whose local start time falls within [now, now + apptVerifyHoursBefore] and
// that have not been sent one yet (verificationSentAt = null). Idempotent.
router.get('/appointment-verifications', async (req, res) => {
  if (!cronAuth(req, res)) return;

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

  res.json({ ok: true, sent, failed, total: relevant.length });
});

// Subscription lifecycle — runs daily
router.get('/subscriptions', async (req, res) => {
  if (!cronAuth(req, res)) return;
  try {
    const [trials, cancelled, renewed, expiredPastDue] = await Promise.all([
      subscriptionService.expireTrials(),
      subscriptionService.cancelDue(),
      subscriptionService.renewDue(),
      subscriptionService.markPastDue(),
    ]);
    res.json({ ok: true, ...trials, ...cancelled, ...renewed, ...expiredPastDue });
  } catch (err) {
    console.error('[cron] subscriptions:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
