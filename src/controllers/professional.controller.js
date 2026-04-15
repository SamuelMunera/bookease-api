const professionalService = require('../services/professional.service');

async function register(req, res) {
  try {
    const { name, email, password, phone, specialty, bio, experience, businessId } = req.body;
    if (!name || !email || !password || !businessId)
      return res.status(400).json({ error: 'name, email, password and businessId are required' });
    const result = await professionalService.registerProfessional({ name, email, password, phone, specialty, bio, experience, businessId });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function getMe(req, res) {
  try {
    const prof = await professionalService.getMyProfile(req.user.id);
    if (!prof) return res.status(404).json({ error: 'Profile not found' });
    res.json(prof);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getMyBookings(req, res) {
  try {
    const bookings = await professionalService.getMyBookings(req.user.id);
    res.json(bookings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

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

async function findById(req, res) {
  try {
    const prof = await professionalService.findById(req.params.id);
    if (!prof) return res.status(404).json({ error: 'Professional not found' });
    res.json(prof);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { register, getMe, getMyBookings, create, findByBusiness, findById, update, remove };
