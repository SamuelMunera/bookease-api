const router = require('express').Router();
const prisma  = require('../config/database');
const { sendBookingReminder } = require('../services/email.service');
const { parseLocalDate } = require('../services/slot.service');

// Protected with CRON_SECRET — only Vercel cron or trusted callers can hit this
router.get('/reminders', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers['authorization'] !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Find all CONFIRMED bookings for tomorrow
  const now      = new Date();
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

  const bookings = await prisma.booking.findMany({
    where: { date: tomorrow, status: 'CONFIRMED' },
    include: {
      client:       { select: { id: true, name: true, email: true } },
      professional: { select: { id: true, name: true, user: { select: { email: true } } } },
      service:      { select: { id: true, name: true } },
      homeService:  { select: { id: true, name: true } },
    },
  });

  let sent = 0, failed = 0;
  for (const b of bookings) {
    try {
      await sendBookingReminder(b);
      sent++;
    } catch (err) {
      console.error(`[cron] reminder failed booking ${b.id}:`, err.message);
      failed++;
    }
  }

  res.json({ ok: true, sent, failed, total: bookings.length });
});

module.exports = router;
