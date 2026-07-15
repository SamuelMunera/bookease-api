const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const prisma = require('../config/database');
const bookingController = require('../controllers/booking.controller');
const { authenticate, requireRole } = require('../middleware/auth');

// Dedicated limiter for the client lookup endpoint: it accepts an email and
// reveals whether a matching CLIENT account exists, so it is an enumeration
// vector. Cap it tightly to curb abuse while leaving room for the legitimate
// autocomplete of the manual-booking modal.
const clientSearchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas búsquedas. Intenta en unos minutos.' },
});

router.post('/', authenticate, bookingController.create);
router.get('/me', authenticate, bookingController.myBookings);
router.patch('/:id/cancel', authenticate, bookingController.cancel);
router.patch('/:id/cancel-owner', authenticate, requireRole('BUSINESS_OWNER'), bookingController.cancelAsOwner);
router.patch('/:id/cancel-professional', authenticate, requireRole('PROFESSIONAL'), bookingController.cancelAsProfessional);
// Confirmar: dueño del negocio o el propio profesional de la cita (la
// validación de propiedad exacta la hace confirmBooking en el servicio).
router.patch('/:id/confirm', authenticate, requireRole('BUSINESS_OWNER', 'PROFESSIONAL'), bookingController.confirm);
router.patch('/:id/reschedule', authenticate, bookingController.reschedule);
router.patch('/:id/no-show', authenticate, bookingController.noShow);
router.patch('/:id/complete', authenticate, bookingController.complete);

// Client lookup for manual booking UI
router.get('/clients/search', clientSearchLimiter, authenticate, requireRole('BUSINESS_OWNER', 'PROFESSIONAL'), async (req, res) => {
  try {
    const raw = typeof req.query.email === 'string' ? req.query.email.toLowerCase().trim() : '';
    // Require a minimum query length so the endpoint can't be walked cheaply and
    // won't fire on every keystroke of the autocomplete.
    if (raw.length < 3) return res.json(null);

    const user = await prisma.user.findUnique({
      where: { email: raw },
      // Only fields the manual-booking modal needs to prefill; no role/id leaked
      // beyond what is required to attach the client to a booking.
      select: { id: true, name: true, email: true, phone: true, role: true },
    });
    // Only expose accounts that are actually clients; anything else looks like
    // "no match" so business/pro users can't probe non-client accounts.
    return res.json(user && user.role === 'CLIENT' ? user : null);
  } catch (err) {
    console.error('[bookings] clients/search:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
