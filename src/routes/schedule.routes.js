const router = require('express').Router({ mergeParams: true });
const scheduleController = require('../controllers/schedule.controller');
const { authenticate, requireRole } = require('../middleware/auth');

// Weekly schedules
router.get('/', scheduleController.getSchedules);
router.post('/', authenticate, requireRole('BUSINESS_OWNER'), scheduleController.setSchedule);
router.delete('/:id', authenticate, requireRole('BUSINESS_OWNER'), scheduleController.deleteSchedule);

// Exceptions (date blocks)
router.get('/exceptions', scheduleController.getExceptions);
router.post('/exceptions', authenticate, requireRole('BUSINESS_OWNER'), scheduleController.createException);
router.delete('/exceptions/:id', authenticate, requireRole('BUSINESS_OWNER'), scheduleController.deleteException);

module.exports = router;
