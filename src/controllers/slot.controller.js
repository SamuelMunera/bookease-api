const slotService = require('../services/slot.service');

async function getAvailableSlots(req, res) {
  const { professionalId, serviceId, date } = req.query;

  if (!professionalId || !serviceId || !date) {
    return res.status(400).json({ error: 'professionalId, serviceId and date are required' });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }

  try {
    const slots = await slotService.getAvailableSlots(professionalId, serviceId, date);
    res.json({ date, professionalId, serviceId, slots });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

module.exports = { getAvailableSlots };
