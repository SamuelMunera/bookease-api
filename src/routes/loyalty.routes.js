const router = require('express').Router();
const ctrl = require('../controllers/loyalty.controller');
const { authenticate, requireRole } = require('../middleware/auth');
const { requireStudioPlan } = require('../middleware/plan');

// ─── Owner (config y clientes) ──────────────────────────────────────────────
// GET sin gate de plan: el front necesita saber planEligible para el upsell.
router.get('/me',          authenticate, requireRole('BUSINESS_OWNER'), ctrl.getMyProgram);
router.put('/me',          authenticate, requireRole('BUSINESS_OWNER'), requireStudioPlan, ctrl.updateMyProgram);
router.get('/me/clients',  authenticate, requireRole('BUSINESS_OWNER'), requireStudioPlan, ctrl.getMyClients);

// ─── Tarjeta del usuario (cualquier rol) ────────────────────────────────────
// Sin requireRole: los sellos se ganan por identidad (clientId = req.user.id) sea
// cual sea el rol activo — un ADMIN, BUSINESS_OWNER o PROFESSIONAL que reserva en
// un negocio también acumula. Gatear por 'CLIENT' devolvía 403 al ver la tarjeta
// propia (podías ganar sellos pero no verlos). El controller usa SIEMPRE
// req.user.id como clientId, así que no hay IDOR: cada quien ve solo su tarjeta.
router.get('/me/cards',                    authenticate, ctrl.getMyCards);
router.get('/businesses/:businessId/card', authenticate, ctrl.getMyCardForBusiness);

// ─── Redención en mostrador (owner o profesional del mismo negocio) ─────────
router.post('/rewards/:rewardId/redeem', authenticate, requireRole('BUSINESS_OWNER', 'PROFESSIONAL'), ctrl.redeemReward);

// ─── Público (marketing en la ficha del negocio) ────────────────────────────
router.get('/businesses/:businessId/program', ctrl.getPublicProgram);

module.exports = router;
