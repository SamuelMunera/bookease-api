const router = require('express').Router();
const businessController     = require('../controllers/business.controller');
const bookingController      = require('../controllers/booking.controller');
const joinRequestController  = require('../controllers/joinRequest.controller');
const { authenticate, requireRole } = require('../middleware/auth');

// Owner join-code & requests (must be before /:id)
router.get('/me/join-code',                   authenticate, requireRole('BUSINESS_OWNER'), joinRequestController.getJoinCode);
router.get('/me/join-requests',               authenticate, requireRole('BUSINESS_OWNER'), joinRequestController.getBusinessJoinRequests);
router.patch('/me/join-requests/:id/approve', authenticate, requireRole('BUSINESS_OWNER'), joinRequestController.approveRequest);
router.patch('/me/join-requests/:id/reject',  authenticate, requireRole('BUSINESS_OWNER'), joinRequestController.rejectRequest);

router.get('/', businessController.findAll);
router.get('/:id', businessController.findById);
router.post('/', authenticate, requireRole('BUSINESS_OWNER'), businessController.create);
router.put('/:id', authenticate, requireRole('BUSINESS_OWNER'), businessController.update);
router.delete('/:id', authenticate, requireRole('BUSINESS_OWNER'), businessController.remove);
router.get('/:id/bookings', authenticate, requireRole('BUSINESS_OWNER'), bookingController.businessBookings);

module.exports = router;
