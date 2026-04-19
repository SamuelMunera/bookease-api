const feedbackService = require('../services/feedback.service');

async function create(req, res) {
  try {
    const report = await feedbackService.create(req.body);
    res.status(201).json(report);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

module.exports = { create };
