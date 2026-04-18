const router = require('express').Router();
const professionalController = require('../controllers/professional.controller');
const joinRequestController  = require('../controllers/joinRequest.controller');
const { authenticate, requireRole } = require('../middleware/auth');

// Public
router.post('/register', professionalController.register);

// Authenticated professional
router.get('/me',                authenticate, requireRole('PROFESSIONAL'), professionalController.getMe);
router.get('/me/bookings',       authenticate, requireRole('PROFESSIONAL'), professionalController.getMyBookings);
router.get('/me/services',       authenticate, requireRole('PROFESSIONAL'), professionalController.getMyServices);
router.put('/me/services',       authenticate, requireRole('PROFESSIONAL'), professionalController.setMyServices);
router.get('/me/schedule',                    authenticate, requireRole('PROFESSIONAL'), professionalController.getMySchedule);
router.put('/me/schedule',                    authenticate, requireRole('PROFESSIONAL'), professionalController.setMySchedule);
router.get('/me/schedule/week/:weekStart',    authenticate, requireRole('PROFESSIONAL'), professionalController.getWeekSchedule);
router.put('/me/schedule/week/:weekStart',    authenticate, requireRole('PROFESSIONAL'), professionalController.setWeekSchedule);
router.delete('/me/schedule/week/:weekStart', authenticate, requireRole('PROFESSIONAL'), professionalController.deleteWeekSchedule);

// Service duration configs
router.get('/me/service-configs',  authenticate, requireRole('PROFESSIONAL'), professionalController.getServiceConfigs);
router.put('/me/service-configs',  authenticate, requireRole('PROFESSIONAL'), professionalController.saveServiceConfigs);
router.patch('/me/buffer',         authenticate, requireRole('PROFESSIONAL'), professionalController.updateBufferTime);

// Join requests
router.post('/join',             authenticate, requireRole('PROFESSIONAL'), joinRequestController.submitJoinRequest);
router.get('/me/join-request',   authenticate, requireRole('PROFESSIONAL'), joinRequestController.getMyJoinRequest);

// Revenue (only if business allows it)
const revenueController = require('../controllers/revenue.controller');
router.get('/me/revenue', authenticate, requireRole('PROFESSIONAL'), revenueController.getProfessionalRevenue);

module.exports = router;
