const svc = require('../services/revenue.service');

async function getBusinessRevenue(req, res) {
  try {
    res.json(await svc.getBusinessRevenue(req.user.id));
  } catch (err) { res.status(400).json({ error: err.message }); }
}

async function getProfessionalRevenue(req, res) {
  try {
    res.json(await svc.getProfessionalRevenue(req.user.id));
  } catch (err) {
    const status = err.message === 'Revenue not visible' ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
}

async function updateBusinessSettings(req, res) {
  try {
    const { showRevenueToProf } = req.body;
    if (showRevenueToProf === undefined) return res.status(400).json({ error: 'showRevenueToProf required' });
    res.json(await svc.updateBusinessSettings(req.user.id, { showRevenueToProf }));
  } catch (err) { res.status(400).json({ error: err.message }); }
}

module.exports = { getBusinessRevenue, getProfessionalRevenue, updateBusinessSettings };
