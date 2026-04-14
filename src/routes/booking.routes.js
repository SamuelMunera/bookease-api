const router = require('express').Router();
const bookingController = require('../controllers/booking.controller');
const { authenticate, requireRole } = require('../middleware/auth');

router.post('/', authenticate, bookingController.create);
router.get('/me', authenticate, bookingController.myBookings);
router.patch('/:id/cancel', authenticate, bookingController.cancel);
router.patch('/:id/cancel-owner', authenticate, requireRole('BUSINESS_OWNER'), bookingController.cancelAsOwner);
router.patch('/:id/confirm', authenticate, requireRole('BUSINESS_OWNER'), bookingController.confirm);
router.patch('/:id/reschedule', authenticate, bookingController.reschedule);

module.exports = router;
