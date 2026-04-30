const serviceService = require('../services/service.service');

async function create(req, res) {
  try {
    const { name, duration, price } = req.body;
    if (!name || !duration || price === undefined) {
      return res.status(400).json({ error: 'name, duration and price are required' });
    }
    if (typeof duration !== 'number' || duration <= 0) {
      return res.status(400).json({ error: 'duration must be a positive number (minutes)' });
    }
    if (Number(price) < 0) {
      return res.status(400).json({ error: 'price must be >= 0' });
    }
    const service = await serviceService.create(req.params.businessId, { name, duration, price, description: req.body.description, categoryId: req.body.categoryId || null });
    res.status(201).json(service);
  } catch (err) {
    res.status(400).json({ error: err.message });
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
