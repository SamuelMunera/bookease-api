const { getResend, FROM } = require('../config/email');

function formatDate(date) {
  return new Date(date).toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function confirmationHtml({ clientName, professionalName, serviceName, date, startTime, endTime }) {
  return `
<div style="font-family:sans-serif;max-width:520px;margin:auto">
  <h2 style="color:#1a1a1a">Reserva confirmada ✓</h2>
  <p>Hola <strong>${clientName}</strong>, tu reserva fue creada exitosamente.</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr><td style="padding:8px;color:#555">Servicio</td><td style="padding:8px"><strong>${serviceName}</strong></td></tr>
    <tr style="background:#f9f9f9"><td style="padding:8px;color:#555">Profesional</td><td style="padding:8px"><strong>${professionalName}</strong></td></tr>
    <tr><td style="padding:8px;color:#555">Fecha</td><td style="padding:8px"><strong>${formatDate(date)}</strong></td></tr>
    <tr style="background:#f9f9f9"><td style="padding:8px;color:#555">Hora</td><td style="padding:8px"><strong>${startTime} – ${endTime}</strong></td></tr>
  </table>
  <p style="color:#666;font-size:13px">Si necesitas cancelar, hazlo desde la app con anticipación.</p>
</div>`;
}

function cancellationHtml({ clientName, professionalName, serviceName, date, startTime }) {
  return `
<div style="font-family:sans-serif;max-width:520px;margin:auto">
  <h2 style="color:#c0392b">Reserva cancelada</h2>
  <p>Hola <strong>${clientName}</strong>, tu reserva fue cancelada.</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr><td style="padding:8px;color:#555">Servicio</td><td style="padding:8px">${serviceName}</td></tr>
    <tr style="background:#f9f9f9"><td style="padding:8px;color:#555">Profesional</td><td style="padding:8px">${professionalName}</td></tr>
    <tr><td style="padding:8px;color:#555">Fecha</td><td style="padding:8px">${formatDate(date)}</td></tr>
    <tr style="background:#f9f9f9"><td style="padding:8px;color:#555">Hora</td><td style="padding:8px">${startTime}</td></tr>
  </table>
</div>`;
}

async function sendConfirmation(booking, clientEmail) {
  await getResend().emails.send({
    from: FROM,
    to: clientEmail,
    subject: `Reserva confirmada – ${booking.service.name}`,
    html: confirmationHtml({
      clientName: booking.clientName,
      professionalName: booking.professional.name,
      serviceName: booking.service.name,
      date: booking.date,
      startTime: booking.startTime,
      endTime: booking.endTime,
    }),
  });
}

async function sendCancellation(booking, clientEmail) {
  await getResend().emails.send({
    from: FROM,
    to: clientEmail,
    subject: `Reserva cancelada – ${booking.service.name}`,
    html: cancellationHtml({
      clientName: booking.clientName,
      professionalName: booking.professional.name,
      serviceName: booking.service.name,
      date: booking.date,
      startTime: booking.startTime,
    }),
  });
}

module.exports = { sendConfirmation, sendCancellation };
