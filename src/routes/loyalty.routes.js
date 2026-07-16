const router = require('express').Router();
const ctrl = require('../controllers/loyalty.controller');
const { authenticate, requireRole } = require('../middleware/auth');
const { requireStudioPlan } = require('../middleware/plan');

// ─── Owner (config y clientes) ──────────────────────────────────────────────
// GET sin gate de plan: el front necesita saber planEligible para el upsell.
router.get('/me',          authenticate, requireRole('BUSINESS_OWNER'), ctrl.getMyProgram);
router.put('/me',          authenticate, requireRole('BUSINESS_OWNER'), requireStudioPlan, ctrl.updateMyProgram);
router.get('/me/clients',  authenticate, requireRole('BUSINESS_OWNER'), requireStudioPlan, ctrl.getMyClients);

// ─── Cliente ────────────────────────────────────────────────────────────────
router.get('/me/cards',                    authenticate, requireRole('CLIENT'), ctrl.getMyCards);
router.get('/businesses/:businessId/card', authenticate, requireRole('CLIENT'), ctrl.getMyCardForBusiness);

// ─── Redención en mostrador (owner o profesional del mismo negocio) ─────────
router.post('/rewards/:rewardId/redeem', authenticate, requireRole('BUSINESS_OWNER', 'PROFESSIONAL'), ctrl.redeemReward);

// ─── Público (marketing en la ficha del negocio) ────────────────────────────
router.get('/businesses/:businessId/program', ctrl.getPublicProgram);

module.exports = router;
