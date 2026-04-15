const router = require('express').Router();
const professionalController = require('../controllers/professional.controller');
const { authenticate, requireRole } = require('../middleware/auth');

// Public
router.post('/register', professionalController.register);

// Authenticated professional
router.get('/me',          authenticate, requireRole('PROFESSIONAL'), professionalController.getMe);
router.get('/me/bookings', authenticate, requireRole('PROFESSIONAL'), professionalController.getMyBookings);

module.exports = router;
