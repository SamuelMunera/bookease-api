const professionalService = require('../services/professional.service');
const prisma = require('../config/database');
const { uploadFile } = require('../config/storage');

async function register(req, res) {
  try {
    const { name, email, password, phone, specialty, bio, experience, businessId } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: 'name, email and password are required' });
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

async function getMyServices(req, res) {
  try {
    const services = await professionalService.getMyServices(req.user.id);
    res.json(services);
  } catch (err) { res.status(500).json({ error: err.message }); }
}

async function setMyServices(req, res) {
  try {
    const { serviceIds } = req.body;
    if (!Array.isArray(serviceIds)) return res.status(400).json({ error: 'serviceIds must be an array' });
    const services = await professionalService.setMyServices(req.user.id, serviceIds);
    res.json(services);
  } catch (err) { res.status(400).json({ error: err.message }); }
}

async function getMySchedule(req, res) {
  try {
    const schedule = await professionalService.getMySchedule(req.user.id);
    res.json(schedule);
  } catch (err) { res.status(500).json({ error: err.message }); }
}

async function setMySchedule(req, res) {
  try {
    const { days } = req.body;
    if (!Array.isArray(days)) return res.status(400).json({ error: 'days must be an array' });
    const result = await professionalService.setMySchedule(req.user.id, days);
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
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
    const professional = await professionalService.update(req.params.id, req.user.id, req.body);
    res.json(professional);
  } catch (err) {
    const status = err.message === 'Forbidden' ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
}

async function remove(req, res) {
  try {
    await professionalService.remove(req.params.id, req.user.id);
    res.status(204).send();
  } catch (err) {
    const status = err.message === 'Forbidden' ? 403 : 400;
    res.status(status).json({ error: err.message });
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

async function getWeekSchedule(req, res) {
  try {
    const data = await professionalService.getWeekSchedule(req.user.id, req.params.weekStart);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
}

async function setWeekSchedule(req, res) {
  try {
    const { days } = req.body;
    if (!Array.isArray(days)) return res.status(400).json({ error: 'days must be an array' });
    const result = await professionalService.setWeekSchedule(req.user.id, req.params.weekStart, days);
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
}

async function deleteWeekSchedule(req, res) {
  try {
    await professionalService.deleteWeekSchedule(req.user.id, req.params.weekStart);
    res.status(204).send();
  } catch (err) { res.status(400).json({ error: err.message }); }
}

async function getProfessionalServices(req, res) {
  try {
    const prof = await prisma.professional.findUnique({
      where: { id: req.params.id },
      select: { services: { select: { id: true, name: true, duration: true, price: true } } },
    });
    if (!prof) return res.status(404).json({ error: 'Professional not found' });
    res.json(prof.services);
  } catch (err) { res.status(500).json({ error: err.message }); }
}

async function getServiceConfigs(req, res) {
  try {
    const configs = await professionalService.getServiceConfigs(req.user.id);
    res.json(configs);
  } catch (err) { res.status(400).json({ error: err.message }); }
}

async function saveServiceConfigs(req, res) {
  try {
    const configs = await professionalService.saveServiceConfigs(req.user.id, req.body.configs ?? []);
    res.json(configs);
  } catch (err) { res.status(400).json({ error: err.message }); }
}

async function updateBufferTime(req, res) {
  try {
    const pro = await professionalService.updateBufferTime(req.user.id, req.body.bufferTime);
    res.json({ bufferTime: pro.bufferTime });
  } catch (err) { res.status(400).json({ error: err.message }); }
}

async function updateProfile(req, res) {
  try {
    const prof = await professionalService.updateProfile(req.user.id, req.body);
    res.json(prof);
  } catch (err) { res.status(400).json({ error: err.message }); }
}

async function uploadAvatar(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });
    const ext = req.file.mimetype.split('/')[1] || 'jpg';
    const path = `professionals/${req.user.id}/avatar.${ext}`;
    const url = await uploadFile(req.file.buffer, req.file.mimetype, path);
    const prof = await professionalService.updateProfile(req.user.id, { avatarUrl: url });
    res.json({ url, professional: prof });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

async function getPhotos(req, res) {
  try {
    const photos = await professionalService.getPhotos(req.user.id);
    res.json(photos);
  } catch (err) { res.status(500).json({ error: err.message }); }
}

async function uploadPhoto(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });
    const ext = req.file.mimetype.split('/')[1] || 'jpg';
    const path = `professionals/${req.user.id}/gallery/${Date.now()}.${ext}`;
    const url = await uploadFile(req.file.buffer, req.file.mimetype, path);
    const photo = await professionalService.addPhoto(req.user.id, url, req.body.caption);
    res.status(201).json(photo);
  } catch (err) { res.status(500).json({ error: err.message }); }
}

async function deletePhoto(req, res) {
  try {
    await professionalService.deletePhoto(req.user.id, req.params.photoId);
    res.status(204).send();
  } catch (err) { res.status(400).json({ error: err.message }); }
}

async function unlinkBusiness(req, res) {
  try {
    const prof = await professionalService.unlinkBusiness(req.user.id);
    res.json(prof);
  } catch (err) { res.status(400).json({ error: err.message }); }
}

module.exports = { register, getMe, getMyBookings, getMyServices, setMyServices, getMySchedule, setMySchedule, getWeekSchedule, setWeekSchedule, deleteWeekSchedule, getProfessionalServices, create, findByBusiness, findById, update, remove, getServiceConfigs, saveServiceConfigs, updateBufferTime, updateProfile, uploadAvatar, unlinkBusiness, getPhotos, uploadPhoto, deletePhoto };
