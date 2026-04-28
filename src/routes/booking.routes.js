const router = require('express').Router();
const bookingController = require('../controllers/booking.controller');
const { authenticate, requireRole } = require('../middleware/auth');

router.post('/', authenticate, bookingController.create);
router.get('/me', authenticate, bookingController.myBookings);
router.patch('/:id/cancel', authenticate, bookingController.cancel);
router.patch('/:id/cancel-owner', authenticate, requireRole('BUSINESS_OWNER'), bookingController.cancelAsOwner);
router.patch('/:id/confirm', authenticate, requireRole('BUSINESS_OWNER'), bookingController.confirm);
router.patch('/:id/reschedule', authenticate, bookingController.reschedule);
router.patch('/:id/no-show', authenticate, bookingController.noShow);
router.patch('/:id/complete', authenticate, bookingController.complete);

// Client lookup for manual booking UI
router.get('/clients/search', authenticate, async (req, res) => {
  const { email } = req.query;
  if (!email) return res.json(null);
  const prisma = require('../config/database');
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    select: { id: true, name: true, email: true, phone: true, role: true },
  });
  res.json(user && user.role === 'CLIENT' ? user : null);
});

module.exports = router;
