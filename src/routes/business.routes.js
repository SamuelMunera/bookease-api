const router = require('express').Router();
const businessController     = require('../controllers/business.controller');
const bookingController      = require('../controllers/booking.controller');
const joinRequestController  = require('../controllers/joinRequest.controller');
const revenueController      = require('../controllers/revenue.controller');
const { authenticate, requireRole } = require('../middleware/auth');
const upload = require('../middleware/upload');

// Owner endpoints (must be before /:id)
router.get('/me',                             authenticate, requireRole('BUSINESS_OWNER'), businessController.getMe);
router.patch('/me/profile',                   authenticate, requireRole('BUSINESS_OWNER'), businessController.updateProfile);
router.post('/me/logo',                       authenticate, requireRole('BUSINESS_OWNER'), upload.single('file'), businessController.uploadLogo);
router.get('/me/join-code',                   authenticate, requireRole('BUSINESS_OWNER'), joinRequestController.getJoinCode);
router.get('/me/join-requests',               authenticate, requireRole('BUSINESS_OWNER'), joinRequestController.getBusinessJoinRequests);
router.patch('/me/join-requests/:id/approve', authenticate, requireRole('BUSINESS_OWNER'), joinRequestController.approveRequest);
router.patch('/me/join-requests/:id/reject',  authenticate, requireRole('BUSINESS_OWNER'), joinRequestController.rejectRequest);
router.get('/me/revenue',                     authenticate, requireRole('BUSINESS_OWNER'), revenueController.getBusinessRevenue);
router.patch('/me/settings',                  authenticate, requireRole('BUSINESS_OWNER'), revenueController.updateBusinessSettings);

router.get('/', businessController.findAll);
router.get('/:id', businessController.findById);
router.post('/', authenticate, requireRole('BUSINESS_OWNER'), businessController.create);
router.put('/:id', authenticate, requireRole('BUSINESS_OWNER'), businessController.update);
router.delete('/:id', authenticate, requireRole('BUSINESS_OWNER'), businessController.remove);
router.get('/:id/bookings', authenticate, requireRole('BUSINESS_OWNER'), bookingController.businessBookings);

module.exports = router;
