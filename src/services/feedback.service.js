const prisma = require('../config/database');
const emailService = require('./email.service');

const ALLOWED_TYPES = ['bug', 'suggestion', 'ux', 'other'];

async function create({ type, description, page, userEmail }) {
  if (!type || !ALLOWED_TYPES.includes(type)) throw new Error('Tipo inválido');
  if (!description || String(description).trim().length < 10) throw new Error('Descripción muy corta');
  const report = await prisma.feedbackReport.create({
    data: {
      type: String(type),
      description: String(description).trim().slice(0, 2000),
      page: page ? String(page).slice(0, 200) : null,
      userEmail: userEmail ? String(userEmail).slice(0, 200) : null,
    },
  });
  emailService.sendFeedbackNotification(report).catch(err =>
    console.error('[feedback] email notification failed', err.message)
  );
  return report;
}

module.exports = { create };
