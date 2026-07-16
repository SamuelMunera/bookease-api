const prisma = require('../config/database');
const { isLoyaltyEligiblePlan } = require('../config/plans');

// Gating server-side de la fidelización. Debe ir DESPUÉS de authenticate y de
// requireRole('BUSINESS_OWNER'). Resuelve el negocio del owner, exige plan
// elegible (Estudio o superior) y deja el negocio en req.business para que el
// controlador no lo vuelva a consultar. El frontend solo esconde la UI; la
// verdad es este 403.
async function requireStudioPlan(req, res, next) {
  try {
    const business = await prisma.business.findFirst({ where: { ownerId: req.user.id } });
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });
    if (!isLoyaltyEligiblePlan(business.plan ?? 'team')) {
      console.warn('[loyalty] 403 plan no elegible', JSON.stringify({
        userId: req.user.id, businessId: business.id, plan: business.plan,
        path: req.originalUrl, method: req.method, ts: new Date().toISOString(),
      }));
      return res.status(403).json({
        error: 'Esta función requiere el plan Estudio',
        code: 'PLAN_UPGRADE_REQUIRED',
        requiredPlan: 'studio',
      });
    }
    req.business = business;
    next();
  } catch (err) {
    console.error('[loyalty] requireStudioPlan error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { requireStudioPlan };
