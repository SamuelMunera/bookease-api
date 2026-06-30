const prisma = require('../config/database');

// Respeta la preferencia del negocio: si el dueño marcó las reseñas como
// privadas (reviewsPublic = false), la vista pública no recibe ninguna reseña.
async function getBusinessReviews(businessId) {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { reviewsPublic: true },
  });
  if (business && business.reviewsPublic === false) return [];
  return prisma.review.findMany({
    where: { businessId },
    include: { author: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

async function getProfessionalReviews(professionalId) {
  return prisma.review.findMany({
    where: { professionalId },
    include: { author: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

async function canReviewBusiness(userId, businessId) {
  const booking = await prisma.booking.findFirst({
    where: {
      clientId: userId,
      status: 'CONFIRMED',
      professional: { businessId },
    },
  });
  return !!booking;
}

async function canReviewProfessional(userId, professionalId) {
  const booking = await prisma.booking.findFirst({
    where: { clientId: userId, professionalId, status: 'CONFIRMED' },
  });
  return !!booking;
}

async function createBusinessReview(userId, businessId, { rating, comment }) {
  if (!rating || rating < 1 || rating > 5) throw new Error('rating debe ser entre 1 y 5');
  const allowed = await canReviewBusiness(userId, businessId);
  if (!allowed) throw new Error('Solo puedes reseñar negocios donde tengas una reserva confirmada');
  return prisma.review.create({
    data: {
      rating: parseInt(rating, 10),
      comment: comment ? String(comment).slice(0, 1000) : null,
      authorId: userId,
      businessId,
    },
    include: { author: { select: { id: true, name: true } } },
  });
}

async function createProfessionalReview(userId, professionalId, { rating, comment }) {
  if (!rating || rating < 1 || rating > 5) throw new Error('rating debe ser entre 1 y 5');
  const allowed = await canReviewProfessional(userId, professionalId);
  if (!allowed) throw new Error('Solo puedes reseñar profesionales con quienes tengas una reserva confirmada');
  return prisma.review.create({
    data: {
      rating: parseInt(rating, 10),
      comment: comment ? String(comment).slice(0, 1000) : null,
      authorId: userId,
      professionalId,
    },
    include: { author: { select: { id: true, name: true } } },
  });
}

async function getBusinessStats(businessId) {
  const [business, reviews, bookingCount] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId }, select: { reviewsPublic: true } }),
    prisma.review.findMany({ where: { businessId }, select: { rating: true } }),
    prisma.booking.count({
      where: { professional: { businessId }, status: { not: 'CANCELLED' } },
    }),
  ]);
  const reviewsPublic = business ? business.reviewsPublic !== false : true;
  // Si las reseñas son privadas, ocultamos rating y contador de forma coherente
  // (no se filtra el número aunque se oculte el listado). bookingCount se mantiene.
  if (!reviewsPublic) {
    return { avgRating: null, reviewCount: 0, bookingCount, reviewsPublic: false };
  }
  const avgRating = reviews.length
    ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10
    : null;
  return { avgRating, reviewCount: reviews.length, bookingCount, reviewsPublic: true };
}

async function getProfessionalStats(professionalId) {
  const [reviews, bookingCount] = await Promise.all([
    prisma.review.findMany({ where: { professionalId }, select: { rating: true } }),
    prisma.booking.count({ where: { professionalId, status: { not: 'CANCELLED' } } }),
  ]);
  const avgRating = reviews.length
    ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10
    : null;
  return { avgRating, reviewCount: reviews.length, bookingCount };
}

module.exports = {
  getBusinessReviews,
  getProfessionalReviews,
  canReviewBusiness,
  canReviewProfessional,
  createBusinessReview,
  createProfessionalReview,
  getBusinessStats,
  getProfessionalStats,
};
