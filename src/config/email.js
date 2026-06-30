const { Resend } = require('resend');

const FROM = process.env.EMAIL_FROM || 'Slotly <noreply@slotly.app>';

let _resend;
function getResend() {
  if (!_resend) {
    if (!process.env.RESEND_API_KEY) {
      // No silenciar: si falta la key, los envíos fallarán en Resend y quedará
      // registrado, pero avisamos explícitamente una vez al arrancar.
      console.error('[email] CONFIG MISSING: RESEND_API_KEY no está definida; los correos NO se enviarán.');
    }
    _resend = new Resend(process.env.RESEND_API_KEY || 'placeholder');
  }
  return _resend;
}

module.exports = { getResend, FROM };
