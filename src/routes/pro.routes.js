const router = require('express').Router();
const professionalController = require('../controllers/professional.controller');
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

module.exports = router;
