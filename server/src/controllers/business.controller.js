const businessService = require('../services/business.service');

async function create(req, res) {
  try {
    const business = await businessService.create(req.user.id, req.body);
    res.status(201).json(business);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function findAll(req, res) {
  try {
    const businesses = await businessService.findAll(req.query);
    res.json(businesses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function findById(req, res) {
  try {
    const business = await businessService.findById(req.params.id);
    if (!business) return res.status(404).json({ error: 'Not found' });
    res.json(business);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function update(req, res) {
  try {
    const business = await businessService.update(req.params.id, req.user.id, req.body);
    res.json(business);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function remove(req, res) {
  try {
    await businessService.remove(req.params.id, req.user.id);
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

module.exports = { create, findAll, findById, update, remove };
