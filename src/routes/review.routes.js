const router = require('express').Router({ mergeParams: true });
const { authenticate, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/review.controller');

// Business reviews
router.get('/businesses/:businessId/reviews', ctrl.getBusinessReviews);
router.get('/businesses/:businessId/stats', ctrl.getBusinessStats);
router.post('/businesses/:businessId/reviews', authenticate, requireRole('CLIENT'), ctrl.createBusinessReview);
router.get('/businesses/:businessId/reviews/can-review', authenticate, ctrl.canReviewBusiness);

// Professional reviews
router.get('/professionals/:professionalId/reviews', ctrl.getProfessionalReviews);
router.get('/professionals/:professionalId/stats', ctrl.getProfessionalStats);
router.post('/professionals/:professionalId/reviews', authenticate, requireRole('CLIENT'), ctrl.createProfessionalReview);
router.get('/professionals/:professionalId/reviews/can-review', authenticate, ctrl.canReviewProfessional);

module.exports = router;
