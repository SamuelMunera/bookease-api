const svc = require('../services/analytics.service');

async function businessAnalytics(req, res) {
  try {
    const { period = 'month' } = req.query;
    if (!['today', 'week', 'month'].includes(period))
      return res.status(400).json({ error: 'period must be today|week|month' });
    res.json(await svc.getBusinessAnalytics(req.user.id, period));
  } catch (err) { res.status(400).json({ error: err.message }); }
}

async function professionalAnalytics(req, res) {
  try {
    const { period = 'month' } = req.query;
    if (!['today', 'week', 'month'].includes(period))
      return res.status(400).json({ error: 'period must be today|week|month' });
    res.json(await svc.getProfessionalAnalytics(req.user.id, period));
  } catch (err) { res.status(400).json({ error: err.message }); }
}

module.exports = { businessAnalytics, professionalAnalytics };
