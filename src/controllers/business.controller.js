const businessService = require('../services/business.service');
const { uploadFile } = require('../config/storage');
const upload = require('../middleware/upload');

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
    res.status(500).json({ error: "Internal server error" });
  }
}

async function findById(req, res) {
  try {
    const business = await businessService.findById(req.params.id);
    if (!business) return res.status(404).json({ error: 'Not found' });
    res.json(business);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
}

async function getMe(req, res) {
  try {
    const business = await businessService.getMyBusiness(req.user.id);
    if (!business) return res.status(404).json({ error: 'No tienes un negocio registrado' });
    res.json(business);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
}

async function updateProfile(req, res) {
  try {
    const business = await businessService.updateProfile(req.user.id, req.body);
    res.json(business);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function uploadLogo(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });
    const ext = upload.safeExt(req.file.mimetype);
    const path = `businesses/${req.user.id}/logo.${ext}`;
    const url = await uploadFile(req.file.buffer, req.file.mimetype, path);
    const business = await businessService.updateProfile(req.user.id, { logoUrl: url });
    res.json({ url, business });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
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

async function sendVerifyEmail(req, res) {
  try {
    const result = await businessService.sendVerificationEmail(req.user.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function confirmVerifyEmail(req, res) {
  try {
    const result = await businessService.verifyEmailToken(req.params.token);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

module.exports = { create, findAll, findById, getMe, updateProfile, uploadLogo, update, remove, sendVerifyEmail, confirmVerifyEmail };
