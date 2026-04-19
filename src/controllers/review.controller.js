const reviewService = require('../services/review.service');

async function getBusinessReviews(req, res) {
  try {
    const reviews = await reviewService.getBusinessReviews(req.params.businessId);
    res.json(reviews);
  } catch { res.status(500).json({ error: 'Internal server error' }); }
}

async function createBusinessReview(req, res) {
  try {
    const review = await reviewService.createBusinessReview(req.user.id, req.params.businessId, req.body);
    res.status(201).json(review);
  } catch (err) {
    const status = err.message?.includes('Solo') ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
}

async function canReviewBusiness(req, res) {
  try {
    const can = await reviewService.canReviewBusiness(req.user.id, req.params.businessId);
    res.json({ canReview: can });
  } catch { res.status(500).json({ error: 'Internal server error' }); }
}

async function getProfessionalReviews(req, res) {
  try {
    const reviews = await reviewService.getProfessionalReviews(req.params.professionalId);
    res.json(reviews);
  } catch { res.status(500).json({ error: 'Internal server error' }); }
}

async function createProfessionalReview(req, res) {
  try {
    const review = await reviewService.createProfessionalReview(req.user.id, req.params.professionalId, req.body);
    res.status(201).json(review);
  } catch (err) {
    const status = err.message?.includes('Solo') ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
}

async function canReviewProfessional(req, res) {
  try {
    const can = await reviewService.canReviewProfessional(req.user.id, req.params.professionalId);
    res.json({ canReview: can });
  } catch { res.status(500).json({ error: 'Internal server error' }); }
}

async function getBusinessStats(req, res) {
  try {
    const stats = await reviewService.getBusinessStats(req.params.businessId);
    res.json(stats);
  } catch { res.status(500).json({ error: 'Internal server error' }); }
}

async function getProfessionalStats(req, res) {
  try {
    const stats = await reviewService.getProfessionalStats(req.params.professionalId);
    res.json(stats);
  } catch { res.status(500).json({ error: 'Internal server error' }); }
}

module.exports = {
  getBusinessReviews, createBusinessReview, canReviewBusiness,
  getProfessionalReviews, createProfessionalReview, canReviewProfessional,
  getBusinessStats, getProfessionalStats,
};
