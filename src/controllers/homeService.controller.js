const prisma = require('../config/database');
const homeServiceService = require('../services/homeService.service');
const homeBookingService = require('../services/homeBooking.service');

async function getProId(userId) {
  const pro = await prisma.professional.findUnique({ where: { userId }, select: { id: true } });
  if (!pro) throw new Error('Professional profile not found');
  return pro.id;
}

// ─── Home config ─────────────────────────────────────────────────────────────

async function getHomeConfig(req, res) {
  try {
    const profId = await getProId(req.user.id);
    const config = await homeServiceService.getHomeConfig(profId);
    res.json(config);
  } catch (err) { res.status(400).json({ error: err.message }); }
}

async function updateHomeConfig(req, res) {
  try {
    const profId = await getProId(req.user.id);
    const config = await homeServiceService.updateHomeConfig(profId, req.body);
    res.json(config);
  } catch (err) { res.status(400).json({ error: err.message }); }
}

// ─── Home services catalog ────────────────────────────────────────────────────

async function listHomeServices(req, res) {
  try {
    const profId = await getProId(req.user.id);
    const svcs = await homeServiceService.listHomeServices(profId);
    res.json(svcs);
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
}

async function createHomeService(req, res) {
  try {
    const profId = await getProId(req.user.id);
    const svc = await homeServiceService.createHomeService(profId, req.body);
    res.status(201).json(svc);
  } catch (err) { res.status(400).json({ error: err.message }); }
}

async function updateHomeService(req, res) {
  try {
    const profId = await getProId(req.user.id);
    const svc = await homeServiceService.updateHomeService(profId, req.params.id, req.body);
    res.json(svc);
  } catch (err) { res.status(400).json({ error: err.message }); }
}

async function deleteHomeService(req, res) {
  try {
    const profId = await getProId(req.user.id);
    await homeServiceService.deleteHomeService(profId, req.params.id);
    res.status(204).send();
  } catch (err) { res.status(400).json({ error: err.message }); }
}

// ─── Home schedule ────────────────────────────────────────────────────────────

async function getHomeSchedule(req, res) {
  try {
    const profId = await getProId(req.user.id);
    const schedule = await homeServiceService.getHomeSchedule(profId);
    res.json(schedule);
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
}

async function setHomeSchedule(req, res) {
  try {
    const { days } = req.body;
    if (!Array.isArray(days)) return res.status(400).json({ error: 'days must be an array' });
    const profId = await getProId(req.user.id);
    const schedule = await homeServiceService.setHomeSchedule(profId, days);
    res.json(schedule);
  } catch (err) { res.status(400).json({ error: err.message }); }
}

// ─── Public: list home services for a professional ────────────────────────────

async function publicListHomeServices(req, res) {
  try {
    const svcs = await homeServiceService.listHomeServices(req.params.professionalId);
    res.json(svcs.filter(s => s.isActive));
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
}

// ─── Home bookings ────────────────────────────────────────────────────────────

async function createHomeBooking(req, res) {
  try {
    const { professionalId, homeServiceId, date, startTime, clientAddress, clientCity } = req.body;
    if (!professionalId || !homeServiceId || !date || !startTime || !clientAddress)
      return res.status(400).json({ error: 'professionalId, homeServiceId, date, startTime and clientAddress are required' });
    const booking = await homeBookingService.createHomeBooking({
      clientId: req.user.id,
      professionalId,
      homeServiceId,
      date,
      startTime,
      clientAddress,
      clientCity,
    });
    res.status(201).json(booking);
  } catch (err) {
    const status = err.code === 'SLOT_CONFLICT' ? 409 : 400;
    res.status(status).json({ error: err.message, code: err.code });
  }
}

async function cancelHomeBooking(req, res) {
  try {
    const booking = await homeBookingService.cancelHomeBooking(req.params.id, req.user.id);
    res.json(booking);
  } catch (err) {
    const status = err.message === 'Forbidden' ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
}

module.exports = {
  getHomeConfig, updateHomeConfig,
  listHomeServices, createHomeService, updateHomeService, deleteHomeService,
  getHomeSchedule, setHomeSchedule,
  publicListHomeServices,
  createHomeBooking, cancelHomeBooking,
};
