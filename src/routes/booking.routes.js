const router = require('express').Router();
const bookingController = require('../controllers/booking.controller');
const { authenticate, requireRole } = require('../middleware/auth');

router.post('/', authenticate, bookingController.create);
router.get('/me', authenticate, bookingController.myBookings);
router.patch('/:id/cancel', authenticate, bookingController.cancel);
router.patch('/:id/confirm', authenticate, requireRole('BUSINESS_OWNER'), bookingController.confirm);

module.exports = router;
