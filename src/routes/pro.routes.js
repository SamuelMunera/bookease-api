const router = require('express').Router();
const professionalController = require('../controllers/professional.controller');
const joinRequestController  = require('../controllers/joinRequest.controller');
const { authenticate, requireRole } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { uploadLimiter } = require('../middleware/rateLimiters');

// Public
router.post('/register', professionalController.register);

// Authenticated professional
router.get('/me',                authenticate, requireRole('PROFESSIONAL'), professionalController.getMe);
router.patch('/me/profile',            authenticate, requireRole('PROFESSIONAL'), professionalController.updateProfile);
router.post('/me/avatar',              authenticate, requireRole('PROFESSIONAL'), uploadLimiter, upload.single('file'), professionalController.uploadAvatar);
router.delete('/me/business',          authenticate, requireRole('PROFESSIONAL'), professionalController.unlinkBusiness);
router.get('/me/photos',               authenticate, requireRole('PROFESSIONAL'), professionalController.getPhotos);
router.post('/me/photos',              authenticate, requireRole('PROFESSIONAL'), uploadLimiter, upload.single('file'), professionalController.uploadPhoto);
router.delete('/me/photos/:photoId',   authenticate, requireRole('PROFESSIONAL'), professionalController.deletePhoto);
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
router.patch('/me/buffer',          authenticate, requireRole('PROFESSIONAL'), professionalController.updateBufferTime);
router.patch('/me/cancel-policy',  authenticate, requireRole('PROFESSIONAL'), professionalController.updateCancelPolicy);

// Join requests
router.post('/join',             authenticate, requireRole('PROFESSIONAL'), joinRequestController.submitJoinRequest);
router.get('/me/join-request',   authenticate, requireRole('PROFESSIONAL'), joinRequestController.getMyJoinRequest);

// Manual booking
const bookingController = require('../controllers/booking.controller');
router.post('/me/bookings/manual', authenticate, requireRole('PROFESSIONAL'), bookingController.manualCreate);

// Revenue
const revenueController = require('../controllers/revenue.controller');
router.get('/me/revenue', authenticate, requireRole('PROFESSIONAL'), revenueController.getProfessionalRevenue);

// Analytics
const analyticsController = require('../controllers/analytics.controller');
router.get('/me/analytics', authenticate, requireRole('PROFESSIONAL'), analyticsController.professionalAnalytics);

// Multas / deudas de clientes (cancelación tardía y no-show)
const cancellationFeeController = require('../controllers/cancellationFee.controller');
router.get('/me/debts',        authenticate, requireRole('PROFESSIONAL'), cancellationFeeController.listMyDebts);
router.patch('/me/debts/:id',  authenticate, requireRole('PROFESSIONAL'), cancellationFeeController.updateDebtStatus);

// Home service
const homeServiceController = require('../controllers/homeService.controller');
router.get('/me/home-config',              authenticate, requireRole('PROFESSIONAL'), homeServiceController.getHomeConfig);
router.patch('/me/home-config',            authenticate, requireRole('PROFESSIONAL'), homeServiceController.updateHomeConfig);
router.get('/me/home-services',            authenticate, requireRole('PROFESSIONAL'), homeServiceController.listHomeServices);
router.post('/me/home-services',           authenticate, requireRole('PROFESSIONAL'), homeServiceController.createHomeService);
router.patch('/me/home-services/:id',      authenticate, requireRole('PROFESSIONAL'), homeServiceController.updateHomeService);
router.delete('/me/home-services/:id',     authenticate, requireRole('PROFESSIONAL'), homeServiceController.deleteHomeService);
router.get('/me/home-schedule',            authenticate, requireRole('PROFESSIONAL'), homeServiceController.getHomeSchedule);
router.put('/me/home-schedule',            authenticate, requireRole('PROFESSIONAL'), homeServiceController.setHomeSchedule);

module.exports = router;
