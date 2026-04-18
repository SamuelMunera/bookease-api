const { getResend, FROM } = require('../config/email');

function formatDate(date) {
  return new Date(date).toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function clientConfirmHtml({ clientName, professionalName, serviceName, date, startTime, endTime }) {
  return `<div style="font-family:sans-serif;max-width:520px;margin:auto">
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

function proConfirmHtml({ professionalName, clientName, serviceName, date, startTime, endTime }) {
  return `<div style="font-family:sans-serif;max-width:520px;margin:auto">
  <h2 style="color:#1a1a1a">Nueva reserva agendada</h2>
  <p>Hola <strong>${professionalName}</strong>, tienes una nueva reserva.</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr><td style="padding:8px;color:#555">Cliente</td><td style="padding:8px"><strong>${clientName}</strong></td></tr>
    <tr style="background:#f9f9f9"><td style="padding:8px;color:#555">Servicio</td><td style="padding:8px"><strong>${serviceName}</strong></td></tr>
    <tr><td style="padding:8px;color:#555">Fecha</td><td style="padding:8px"><strong>${formatDate(date)}</strong></td></tr>
    <tr style="background:#f9f9f9"><td style="padding:8px;color:#555">Hora</td><td style="padding:8px"><strong>${startTime} – ${endTime}</strong></td></tr>
  </table>
</div>`;
}

function clientCancelHtml({ clientName, professionalName, serviceName, date, startTime }) {
  return `<div style="font-family:sans-serif;max-width:520px;margin:auto">
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

function proCancelHtml({ professionalName, clientName, serviceName, date, startTime }) {
  return `<div style="font-family:sans-serif;max-width:520px;margin:auto">
  <h2 style="color:#c0392b">Reserva cancelada</h2>
  <p>Hola <strong>${professionalName}</strong>, la siguiente reserva fue cancelada.</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr><td style="padding:8px;color:#555">Cliente</td><td style="padding:8px">${clientName}</td></tr>
    <tr style="background:#f9f9f9"><td style="padding:8px;color:#555">Servicio</td><td style="padding:8px">${serviceName}</td></tr>
    <tr><td style="padding:8px;color:#555">Fecha</td><td style="padding:8px">${formatDate(date)}</td></tr>
    <tr style="background:#f9f9f9"><td style="padding:8px;color:#555">Hora</td><td style="padding:8px">${startTime}</td></tr>
  </table>
</div>`;
}

async function sendConfirmation(booking, clientEmail, proEmail) {
  const data = {
    clientName: booking.clientName,
    professionalName: booking.professional.name,
    serviceName: booking.service.name,
    date: booking.date,
    startTime: booking.startTime,
    endTime: booking.endTime,
  };
  const sends = [
    getResend().emails.send({ from: FROM, to: clientEmail, subject: `Reserva confirmada – ${data.serviceName}`, html: clientConfirmHtml(data) }),
  ];
  if (proEmail) {
    sends.push(
      getResend().emails.send({ from: FROM, to: proEmail, subject: `Nueva reserva – ${data.serviceName}`, html: proConfirmHtml(data) })
    );
  }
  await Promise.all(sends);
}

async function sendCancellation(booking, clientEmail, proEmail) {
  const data = {
    clientName: booking.clientName,
    professionalName: booking.professional.name,
    serviceName: booking.service.name,
    date: booking.date,
    startTime: booking.startTime,
  };
  const sends = [
    getResend().emails.send({ from: FROM, to: clientEmail, subject: `Reserva cancelada – ${data.serviceName}`, html: clientCancelHtml(data) }),
  ];
  if (proEmail) {
    sends.push(
      getResend().emails.send({ from: FROM, to: proEmail, subject: `Reserva cancelada – ${data.serviceName}`, html: proCancelHtml(data) })
    );
  }
  await Promise.all(sends);
}

module.exports = { sendConfirmation, sendCancellation };
