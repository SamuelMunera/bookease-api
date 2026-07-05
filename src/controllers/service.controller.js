const serviceService = require('../services/service.service');

async function create(req, res) {
  try {
    const { name, price } = req.body;
    // La duración real la define cada profesional; este valor base es solo un
    // fallback (referencia) usado hasta que el profesional configure el suyo.
    const duration = (req.body.duration === undefined || req.body.duration === null || req.body.duration === '')
      ? 30
      : Number(req.body.duration);
    const professionalIds = Array.isArray(req.body.professionalIds) ? req.body.professionalIds : [];
    if (!name || price === undefined || price === '') {
      return res.status(400).json({ error: 'name and price are required' });
    }
    if (!Number.isFinite(duration) || duration < 5 || duration % 5 !== 0) {
      return res.status(400).json({ error: 'duration must be a positive multiple of 5 (minutes)' });
    }
    if (Number(price) < 0) {
      return res.status(400).json({ error: 'price must be >= 0' });
    }
    const service = await serviceService.create(req.params.businessId, req.user.id, {
      name, duration, price,
      description: req.body.description,
      categoryId: req.body.categoryId || null,
      professionalIds,
    });
    res.status(201).json(service);
  } catch (err) {
    const status = err.message === 'Forbidden' ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
}

async function findByBusiness(req, res) {
  try {
    const services = await serviceService.findByBusiness(req.params.businessId);
    res.json(services);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
}

async function update(req, res) {
  try {
    const service = await serviceService.update(req.params.id, req.user.id, req.body);
    res.json(service);
  } catch (err) {
    const status = err.message === 'Forbidden' ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
}

async function remove(req, res) {
  try {
    await serviceService.remove(req.params.id, req.user.id);
    res.status(204).send();
  } catch (err) {
    const status = err.message === 'Forbidden' ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
}

module.exports = { create, findByBusiness, update, remove };
