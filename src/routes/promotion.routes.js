const router = require('express').Router();
const ctrl = require('../controllers/promotion.controller');
const { authenticate, requireRole } = require('../middleware/auth');

// Owner routes
router.get('/me',         authenticate, requireRole('BUSINESS_OWNER'), ctrl.getMyPromotions);
router.post('/me',        authenticate, requireRole('BUSINESS_OWNER'), ctrl.createPromotion);
router.patch('/me/:id',   authenticate, requireRole('BUSINESS_OWNER'), ctrl.updatePromotion);
router.delete('/me/:id',  authenticate, requireRole('BUSINESS_OWNER'), ctrl.deletePromotion);

// Public route
router.get('/:id/active', ctrl.getPublicPromotions);

module.exports = router;
