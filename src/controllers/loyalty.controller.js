const prisma = require('../config/database');
const { isLoyaltyEligiblePlan } = require('../config/plans');
const loyaltyService = require('../services/loyalty.service');

// GET /api/loyalty/me — config del programa del owner. SIN gate de plan para
// que el frontend pueda mostrar el upsell si el plan no es elegible.
async function getMyProgram(req, res) {
  try {
    const business = await prisma.business.findFirst({ where: { ownerId: req.user.id } });
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });
    const program = await loyaltyService.getProgram(business.id);
    res.json({ planEligible: isLoyaltyEligiblePlan(business.plan ?? 'team'), program });
  } catch (err) {
    console.error('[loyalty] getMyProgram:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// PUT /api/loyalty/me — upsert de config (owner + requireStudioPlan). El
// middleware deja el negocio en req.business.
async function updateMyProgram(req, res) {
  try {
    const business = req.business; // provisto por requireStudioPlan
    const result = await loyaltyService.upsertProgram(business, req.body);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ program: result.program, rewardsEmitted: result.rewardsEmitted });
  } catch (err) {
    console.error('[loyalty] updateMyProgram:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// GET /api/loyalty/me/clients — listado de clientes con progreso (owner + gate).
async function getMyClients(req, res) {
  try {
    const business = req.business;
    const data = await loyaltyService.listClients(business.id, {
      search: req.query.search,
      page: req.query.page,
      limit: req.query.limit,
    });
    res.json(data);
  } catch (err) {
    console.error('[loyalty] getMyClients:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// GET /api/loyalty/me/cards — todas las tarjetas del cliente autenticado.
async function getMyCards(req, res) {
  try {
    const cards = await loyaltyService.getMyCards(req.user.id);
    res.json({ cards });
  } catch (err) {
    console.error('[loyalty] getMyCards:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// GET /api/loyalty/businesses/:businessId/card — tarjeta del cliente en un
// negocio. clientId SIEMPRE de req.user.id (nunca de params): evita IDOR.
async function getMyCardForBusiness(req, res) {
  try {
    const data = await loyaltyService.getCardForBusiness(req.user.id, req.params.businessId);
    res.json(data);
  } catch (err) {
    console.error('[loyalty] getMyCardForBusiness:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// GET /api/loyalty/businesses/:businessId/program — público (marketing).
async function getPublicProgram(req, res) {
  try {
    const data = await loyaltyService.getPublicProgram(req.params.businessId);
    res.json(data);
  } catch (err) {
    console.error('[loyalty] getPublicProgram:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// POST /api/loyalty/rewards/:rewardId/redeem — redime en mostrador (owner o
// profesional del mismo negocio). SIN gate de plan: lo ganado se redime siempre.
async function redeemReward(req, res) {
  try {
    const reward = await loyaltyService.redeemReward(req.params.rewardId, req.user.id);
    res.json(reward);
  } catch (err) {
    if (err.message === 'NOT_FOUND') return res.status(404).json({ error: 'Recompensa no encontrada' });
    if (err.message === 'FORBIDDEN') return res.status(403).json({ error: 'No autorizado' });
    if (err.message === 'ALREADY_REDEEMED') return res.status(409).json({ error: 'La recompensa ya fue redimida' });
    console.error('[loyalty] redeemReward:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  getMyProgram,
  updateMyProgram,
  getMyClients,
  getMyCards,
  getMyCardForBusiness,
  getPublicProgram,
  redeemReward,
};
