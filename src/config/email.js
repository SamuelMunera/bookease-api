const { Resend } = require('resend');

const FROM = process.env.EMAIL_FROM || 'Bookease <noreply@bookease.com>';

let _resend;
function getResend() {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY || 'placeholder');
  return _resend;
}

module.exports = { getResend, FROM };
