const serviceService = require('../services/service.service');

async function create(req, res) {
  try {
    const service = await serviceService.create(req.params.businessId, req.body);
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
    res.status(500).json({ error: err.message });
  }
}

async function update(req, res) {
  try {
    const service = await serviceService.update(req.params.id, req.body);
    res.json(service);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function remove(req, res) {
  try {
    await serviceService.remove(req.params.id);
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

module.exports = { create, findByBusiness, update, remove };
