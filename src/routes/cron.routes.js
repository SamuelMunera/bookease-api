const router = require('express').Router();
const prisma  = require('../config/database');
const { sendBookingReminder } = require('../services/email.service');
const { tomorrowInTimezone } = require('../utils/timezone');
const { parseLocalDate } = require('../services/slot.service');

router.get('/reminders', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers['authorization'] !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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

module.exports = router;
