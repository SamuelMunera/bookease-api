const svc = require('../services/joinRequest.service');

async function getJoinCode(req, res) {
  try {
    const business = await svc.getOrCreateJoinCode(req.user.id);
    res.json({ joinCode: business.joinCode, businessId: business.id, name: business.name });
  } catch (err) { res.status(400).json({ error: err.message }); }
}

async function submitJoinRequest(req, res) {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'El código es obligatorio' });
    const result = await svc.submitJoinRequest(req.user.id, code);
    res.status(201).json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
}

async function getMyJoinRequest(req, res) {
  try {
    const result = await svc.getMyJoinRequest(req.user.id);
    res.json(result ?? null);
  } catch (err) { res.status(500).json({ error: "Internal server error" }); }
}

async function getBusinessJoinRequests(req, res) {
  try {
    const requests = await svc.getBusinessJoinRequests(req.user.id);
    res.json(requests);
  } catch (err) { res.status(500).json({ error: "Internal server error" }); }
}

async function approveRequest(req, res) {
  try {
    const result = await svc.approveRequest(req.user.id, req.params.id);
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
}

async function rejectRequest(req, res) {
  try {
    const result = await svc.rejectRequest(req.user.id, req.params.id);
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
}

module.exports = { getJoinCode, submitJoinRequest, getMyJoinRequest, getBusinessJoinRequests, approveRequest, rejectRequest };
