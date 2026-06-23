const crypto = require('crypto');
const professionalService = require('../services/professional.service');
const prisma = require('../config/database');
const { uploadFile } = require('../config/storage');
const upload = require('../middleware/upload');

async function register(req, res) {
  try {
    const { name, email, password, phone, specialty, bio, experience, businessId, offersHomeService, homeServiceArea, country, timezone, state, zipCode, referralCode } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: 'name, email and password are required' });
    const result = await professionalService.registerProfessional({ name, email, password, phone, specialty, bio, experience, businessId, offersHomeService, homeServiceArea, country, timezone, state, zipCode, referralCode });
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
    res.status(500).json({ error: "Internal server error" });
  }
}

async function getMyBookings(req, res) {
  try {
    const bookings = await professionalService.getMyBookings(req.user.id);
    res.json(bookings);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
}

async function getMyServices(req, res) {
  try {
    const services = await professionalService.getMyServices(req.user.id);
    res.json(services);
  } catch (err) { res.status(500).json({ error: "Internal server error" }); }
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
  } catch (err) { res.status(500).json({ error: "Internal server error" }); }
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
    res.status(500).json({ error: "Internal server error" });
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
    res.status(500).json({ error: "Internal server error" });
  }
}

async function getWeekSchedule(req, res) {
  try {
    const data = await professionalService.getWeekSchedule(req.user.id, req.params.weekStart);
    res.json(data);
  } catch (err) { res.status(500).json({ error: "Internal server error" }); }
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
      select: {
        services: { select: { id: true, name: true, description: true, duration: true, price: true, categoryId: true } },
        serviceConfigs: { select: { serviceId: true, customDuration: true } },
      },
    });
    if (!prof) return res.status(404).json({ error: 'Professional not found' });
    // La duración real de un servicio la define cada profesional. Si tiene un
    // customDuration configurado, ese es el tiempo; si no, cae al valor base.
    const cfg = new Map(prof.serviceConfigs.map(c => [c.serviceId, c.customDuration]));
    const services = prof.services.map(s => ({
      ...s,
      duration: cfg.get(s.id) ?? s.duration,
    }));
    res.json(services);
  } catch (err) { res.status(500).json({ error: "Internal server error" }); }
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

async function updateCancelPolicy(req, res) {
  try {
    const pro = await professionalService.updateCancelPolicy(req.user.id, req.body.cancelMinHours);
    res.json({ cancelMinHours: pro.cancelMinHours });
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
    const ext = upload.safeExt(req.file.mimetype);
    const path = `professionals/${req.user.id}/avatar.${ext}`;
    const url = await uploadFile(req.file.buffer, req.file.mimetype, path);
    const prof = await professionalService.updateProfile(req.user.id, { avatarUrl: url });
    res.json({ url, professional: prof });
  } catch (err) { res.status(500).json({ error: "Internal server error" }); }
}

async function getPhotos(req, res) {
  try {
    const photos = await professionalService.getPhotos(req.user.id);
    res.json(photos);
  } catch (err) { res.status(500).json({ error: "Internal server error" }); }
}

async function uploadPhoto(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });
    const ext = upload.safeExt(req.file.mimetype);
    const path = `professionals/${req.user.id}/gallery/${crypto.randomUUID()}.${ext}`;
    const url = await uploadFile(req.file.buffer, req.file.mimetype, path);
    const caption = req.body.caption ? String(req.body.caption).slice(0, 200) : undefined;
    const photo = await professionalService.addPhoto(req.user.id, url, caption);
    res.status(201).json(photo);
  } catch (err) { res.status(500).json({ error: "Internal server error" }); }
}

async function deletePhoto(req, res) {
  try {
    await professionalService.deletePhoto(req.user.id, req.params.photoId);
    res.status(204).send();
  } catch (err) { res.status(400).json({ error: err.message }); }
}

async function findHomeProfessionals(req, res) {
  try {
    const { city, country } = req.query;
    const data = await professionalService.findHomeProfessionals({ city, country });
    res.json(data);
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
}

async function unlinkBusiness(req, res) {
  try {
    const prof = await professionalService.unlinkBusiness(req.user.id);
    res.json(prof);
  } catch (err) { res.status(400).json({ error: err.message }); }
}

module.exports = { register, getMe, getMyBookings, getMyServices, setMyServices, getMySchedule, setMySchedule, getWeekSchedule, setWeekSchedule, deleteWeekSchedule, getProfessionalServices, create, findByBusiness, findById, findHomeProfessionals, update, remove, getServiceConfigs, saveServiceConfigs, updateBufferTime, updateCancelPolicy, updateProfile, uploadAvatar, unlinkBusiness, getPhotos, uploadPhoto, deletePhoto };
