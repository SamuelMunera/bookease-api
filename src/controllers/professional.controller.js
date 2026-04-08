const professionalService = require('../services/professional.service');

async function create(req, res) {
  try {
    const professional = await professionalService.create(req.params.businessId, req.body);
    res.status(201).json(professional);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function findByBusiness(req, res) {
  try {
    const professionals = await professionalService.findByBusiness(req.params.businessId);
    res.json(professionals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function update(req, res) {
  try {
    const professional = await professionalService.update(req.params.id, req.body);
    res.json(professional);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function remove(req, res) {
  try {
    await professionalService.remove(req.params.id);
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

module.exports = { create, findByBusiness, update, remove };
