const router = require('express').Router();
const businessController = require('../controllers/business.controller');
const bookingController = require('../controllers/booking.controller');
const { authenticate, requireRole } = require('../middleware/auth');

router.get('/', businessController.findAll);
router.get('/:id', businessController.findById);
router.post('/', authenticate, requireRole('BUSINESS_OWNER'), businessController.create);
router.put('/:id', authenticate, requireRole('BUSINESS_OWNER'), businessController.update);
router.delete('/:id', authenticate, requireRole('BUSINESS_OWNER'), businessController.remove);
router.get('/:id/bookings', authenticate, requireRole('BUSINESS_OWNER'), bookingController.businessBookings);

module.exports = router;
