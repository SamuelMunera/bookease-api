const router = require('express').Router();
const businessController     = require('../controllers/business.controller');
const bookingController      = require('../controllers/booking.controller');
const joinRequestController  = require('../controllers/joinRequest.controller');
const revenueController      = require('../controllers/revenue.controller');
const analyticsController    = require('../controllers/analytics.controller');
const { authenticate, requireRole } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { uploadLimiter } = require('../middleware/rateLimiters');
const { DEFAULT_GATEWAY_BY_COUNTRY } = require('../config/gateways');
const prisma = require('../config/database');

// Plans (public — country via query param)
router.get('/plans', (req, res) => {
  const { getPlansForCountry } = require('../config/plans');
  const country = (['CO','US'].includes(req.query.country)) ? req.query.country : 'CO';
  res.json(getPlansForCountry(country));
});

// Owner endpoints (must be before /:id)
router.get('/me',                             authenticate, requireRole('BUSINESS_OWNER'), businessController.getMe);
router.patch('/me/profile',                   authenticate, requireRole('BUSINESS_OWNER'), businessController.updateProfile);
router.post('/me/logo',                       authenticate, requireRole('BUSINESS_OWNER'), uploadLimiter, upload.single('file'), businessController.uploadLogo);
router.get('/me/join-code',                   authenticate, requireRole('BUSINESS_OWNER'), joinRequestController.getJoinCode);
router.get('/me/join-requests',               authenticate, requireRole('BUSINESS_OWNER'), joinRequestController.getBusinessJoinRequests);
router.patch('/me/join-requests/:id/approve', authenticate, requireRole('BUSINESS_OWNER'), joinRequestController.approveRequest);
router.patch('/me/join-requests/:id/reject',  authenticate, requireRole('BUSINESS_OWNER'), joinRequestController.rejectRequest);
router.get('/me/revenue',                     authenticate, requireRole('BUSINESS_OWNER'), revenueController.getBusinessRevenue);
router.post('/me/verify-email/send',          authenticate, requireRole('BUSINESS_OWNER'), businessController.sendVerifyEmail);
router.get('/verify-email/:token',            businessController.confirmVerifyEmail);
router.get('/me/analytics',                   authenticate, requireRole('BUSINESS_OWNER'), analyticsController.businessAnalytics);
router.patch('/me/settings',                  authenticate, requireRole('BUSINESS_OWNER'), revenueController.updateBusinessSettings);
router.patch('/me/plan',                      authenticate, requireRole('BUSINESS_OWNER'), businessController.updatePlan);
router.get('/me/gateway', authenticate, requireRole('BUSINESS_OWNER'), async (req, res) => {
  try {
    const business = await prisma.business.findFirst({
      where: { ownerId: req.user.id },
      select: { country: true, paymentGateway: true },
    });
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });
    res.json({
      country: business.country,
      paymentGateway: business.paymentGateway,
      defaultForCountry: DEFAULT_GATEWAY_BY_COUNTRY[business.country] ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/check-duplicate', authenticate, requireRole('BUSINESS_OWNER'), businessController.checkDuplicate);
router.get('/', businessController.findAll);
router.get('/:id', businessController.findById);
router.post('/', authenticate, requireRole('BUSINESS_OWNER'), businessController.create);
router.put('/:id', authenticate, requireRole('BUSINESS_OWNER'), businessController.update);
router.delete('/:id', authenticate, requireRole('BUSINESS_OWNER'), businessController.remove);
router.get('/:id/bookings',        authenticate, requireRole('BUSINESS_OWNER'), bookingController.businessBookings);
router.post('/:id/bookings/manual', authenticate, requireRole('BUSINESS_OWNER'), bookingController.manualCreate);

module.exports = router;
