const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.EMAIL_FROM || 'Bookease <noreply@bookease.com>';

module.exports = { resend, FROM };
