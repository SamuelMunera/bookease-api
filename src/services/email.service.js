const { getResend, FROM } = require('../config/email');

const APP_URL = process.env.CLIENT_URL || 'https://slotly.app';

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isReal(email) {
  return email && typeof email === 'string' && !email.endsWith('@slotly.internal');
}

function fmtDate(d) {
  return new Date(String(d).slice(0, 10) + 'T00:00:00')
    .toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function extract(booking) {
  const isHome    = booking.type === 'HOME_SERVICE';
  return {
    clientName:  booking.client?.name || booking.guestName || 'Cliente',
    clientEmail: booking.client?.email,
    proName:     booking.professional?.name || '—',
    proEmail:    booking.professional?.user?.email,
    service:     booking.service?.name || booking.homeService?.name || '—',
    date:        fmtDate(booking.date),
    startTime:   booking.startTime,
    endTime:     booking.endTime,
    isHome,
    address:     isHome ? booking.clientAddress : null,
    city:        isHome ? booking.clientCity    : null,
  };
}

/* ── Shared layout wrapper ────────────────────────────────── */
function layout(content) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;padding:0;background:#0D0D1E;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
  .wrap{max-width:520px;margin:32px auto;background:#16162A;border:1px solid #2A2A4A;border-radius:16px;overflow:hidden}
  .header{padding:28px 32px 24px;border-bottom:1px solid #2A2A4A;background:linear-gradient(135deg,#1A1A30,#1E1E35)}
  .logo{font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.03em}
  .logo span{color:#D4A853}
  .body{padding:28px 32px}
  .title{font-size:20px;font-weight:700;margin:0 0 8px;color:#fff}
  .sub{font-size:14px;color:#9090B0;margin:0 0 24px;line-height:1.5}
  .detail-table{width:100%;border-collapse:collapse;margin:0 0 24px}
  .detail-table td{padding:11px 14px;font-size:14px;border-bottom:1px solid #2A2A4A}
  .detail-table tr:last-child td{border-bottom:none}
  .label{color:#6060A0;width:38%}
  .value{color:#E0E0F0;font-weight:600}
  .badge{display:inline-block;padding:3px 10px;border-radius:99px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
  .badge-confirmed{background:rgba(212,168,83,.15);color:#D4A853;border:1px solid rgba(212,168,83,.3)}
  .badge-cancelled{background:rgba(239,68,68,.12);color:#f87171;border:1px solid rgba(239,68,68,.25)}
  .badge-reminder{background:rgba(124,92,252,.15);color:#A78BFA;border:1px solid rgba(124,92,252,.3)}
  .cta{display:block;margin:24px 0 0;padding:13px 24px;background:#D4A853;color:#0A0808 !important;text-decoration:none;border-radius:10px;font-weight:700;font-size:14px;text-align:center}
  .footer{padding:20px 32px;border-top:1px solid #2A2A4A;font-size:12px;color:#50507A;text-align:center;line-height:1.6}
  @media(prefers-color-scheme:light){body{background:#F4F4F8}.wrap{background:#fff;border-color:#E4E4F0}.header{background:linear-gradient(135deg,#F8F8FF,#F0F0FA)}.logo{color:#1A1A30}.title{color:#1A1A30}.sub{color:#6060A0}.detail-table td{border-color:#E8E8F4}.label{color:#8080A0}.value{color:#1A1A30}.footer{color:#9090B0;border-color:#E8E8F4}}
</style></head><body>
<div class="wrap">${content}</div>
</body></html>`;
}

/* ── Confirmation ─────────────────────────────────────────── */
function confirmHtml({ to, name, service, date, startTime, endTime, proOrClient, isHome, address }) {
  const isClient = to === 'client';
  const heading  = isClient ? '¡Reserva confirmada!' : 'Nueva reserva agendada';
  const sub      = isClient
    ? `Hola <strong style="color:#E0E0F0">${escHtml(name)}</strong>, tu cita quedó registrada.`
    : `Hola <strong style="color:#E0E0F0">${escHtml(name)}</strong>, tienes una nueva cita.`;

  const rows = [
    [isClient ? 'Profesional' : 'Cliente', escHtml(proOrClient)],
    ['Servicio',  escHtml(service)],
    ['Fecha',     escHtml(date)],
    ['Hora',      endTime ? `${escHtml(startTime)} – ${escHtml(endTime)}` : escHtml(startTime)],
    ...(isHome && address ? [['Dirección', escHtml(address)]] : []),
    ['Modalidad', isHome ? '🏠 A domicilio' : '🏢 En local'],
  ];

  return layout(`
    <div class="header">
      <div class="logo">Slot<span>ly</span></div>
    </div>
    <div class="body">
      <span class="badge badge-confirmed">Confirmada</span>
      <h1 class="title" style="margin-top:12px">${heading}</h1>
      <p class="sub">${sub}</p>
      <table class="detail-table">${rows.map(([l,v]) => `<tr><td class="label">${l}</td><td class="value">${v}</td></tr>`).join('')}</table>
      <a href="${APP_URL}/my-bookings" class="cta">Ver mis reservas</a>
    </div>
    <div class="footer">Slotly · No respondas a este correo.<br>Si no hiciste esta reserva, <a href="${APP_URL}" style="color:#D4A853">ingresa a la app</a> y cancélala.</div>
  `);
}

/* ── Cancellation ─────────────────────────────────────────── */
function cancelHtml({ to, name, service, date, startTime, proOrClient }) {
  const isClient = to === 'client';
  const heading  = isClient ? 'Tu reserva fue cancelada' : 'Reserva cancelada';
  const sub      = isClient
    ? `Hola <strong style="color:#E0E0F0">${escHtml(name)}</strong>, la siguiente cita ya no está activa.`
    : `Hola <strong style="color:#E0E0F0">${escHtml(name)}</strong>, la siguiente cita fue cancelada.`;

  const rows = [
    [isClient ? 'Profesional' : 'Cliente', escHtml(proOrClient)],
    ['Servicio', escHtml(service)],
    ['Fecha',    escHtml(date)],
    ['Hora',     escHtml(startTime)],
  ];

  return layout(`
    <div class="header">
      <div class="logo">Slot<span>ly</span></div>
    </div>
    <div class="body">
      <span class="badge badge-cancelled">Cancelada</span>
      <h1 class="title" style="margin-top:12px;color:#f87171">${heading}</h1>
      <p class="sub">${sub}</p>
      <table class="detail-table">${rows.map(([l,v]) => `<tr><td class="label">${l}</td><td class="value">${v}</td></tr>`).join('')}</table>
      ${isClient ? `<a href="${APP_URL}" class="cta">Reservar de nuevo</a>` : ''}
    </div>
    <div class="footer">Slotly · No respondas a este correo.</div>
  `);
}

/* ── Reminder ─────────────────────────────────────────────── */
function reminderHtml({ name, service, date, startTime, endTime, proOrClient, isHome, address }) {
  const rows = [
    ['Profesional', escHtml(proOrClient)],
    ['Servicio',    escHtml(service)],
    ['Fecha',       escHtml(date)],
    ['Hora',        endTime ? `${escHtml(startTime)} – ${escHtml(endTime)}` : escHtml(startTime)],
    ...(isHome && address ? [['Dirección', escHtml(address)]] : []),
    ['Modalidad',   isHome ? '🏠 A domicilio' : '🏢 En local'],
  ];

  return layout(`
    <div class="header">
      <div class="logo">Slot<span>ly</span></div>
    </div>
    <div class="body">
      <span class="badge badge-reminder">Recordatorio — mañana</span>
      <h1 class="title" style="margin-top:12px">Tu cita es mañana</h1>
      <p class="sub">Hola <strong style="color:#E0E0F0">${escHtml(name)}</strong>, te recordamos que tienes una cita programada para mañana.</p>
      <table class="detail-table">${rows.map(([l,v]) => `<tr><td class="label">${l}</td><td class="value">${v}</td></tr>`).join('')}</table>
      <a href="${APP_URL}/my-bookings" class="cta">Ver mis reservas</a>
    </div>
    <div class="footer">Slotly · No respondas a este correo.<br>¿No puedes asistir? <a href="${APP_URL}/my-bookings" style="color:#D4A853">Cancela con tiempo</a>.</div>
  `);
}

/* ── Appointment verification ─────────────────────────────── */
// Neutral, inline-styled template. Uses a fixed light background with dark
// text so it stays legible regardless of the email client's light/dark mode,
// without relying on prefers-color-scheme.
function verificationHtml({ clientName, business, service, proName, date, startTime, endTime, isHome, address }) {
  const rows = [
    ['Negocio',     escHtml(business)],
    ['Servicio',    escHtml(service)],
    ['Profesional', escHtml(proName)],
    ['Fecha',       escHtml(date)],
    ['Hora',        endTime ? `${escHtml(startTime)} – ${escHtml(endTime)}` : escHtml(startTime)],
    ...(isHome && address ? [['Dirección', escHtml(address)]] : []),
    ['Modalidad',   isHome ? 'A domicilio' : 'En local'],
  ];
  const rowHtml = rows.map(([l, v], i) =>
    `<tr><td style="padding:10px 14px;font-size:14px;color:#6b7280;width:38%;${i ? 'border-top:1px solid #e5e7eb;' : ''}">${l}</td>`
    + `<td style="padding:10px 14px;font-size:14px;color:#111827;font-weight:600;${i ? 'border-top:1px solid #e5e7eb;' : ''}">${v}</td></tr>`
  ).join('');

  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f8;">
<div style="max-width:520px;margin:32px auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <div style="padding:24px 32px;border-bottom:1px solid #e5e7eb;background:#ffffff;">
    <div style="font-size:22px;font-weight:800;color:#111827;letter-spacing:-0.03em;">Slot<span style="color:#b8860b;">ly</span></div>
  </div>
  <div style="padding:28px 32px;">
    <span style="display:inline-block;padding:4px 12px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;background:#fef3c7;color:#92400e;border:1px solid #fde68a;">Confirma tu asistencia</span>
    <h1 style="font-size:20px;font-weight:700;margin:14px 0 8px;color:#111827;">Tu cita está próxima</h1>
    <p style="font-size:14px;color:#4b5563;margin:0 0 22px;line-height:1.5;">Hola <strong style="color:#111827;">${escHtml(clientName)}</strong>, confirma que asistirás a tu próxima cita. Si no puedes asistir, por favor cancélala con tiempo.</p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 24px;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">${rowHtml}</table>
    <a href="${APP_URL}/my-bookings" style="display:block;padding:13px 24px;background:#b8860b;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:700;font-size:14px;text-align:center;">Ver mis reservas</a>
  </div>
  <div style="padding:20px 32px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;text-align:center;line-height:1.6;">Slotly · No respondas a este correo.</div>
</div>
</body></html>`;
}

async function sendAppointmentVerification(booking) {
  const { clientName, clientEmail, proName, service, date, startTime, endTime, isHome, address } = extract(booking);
  const business = booking.professional?.business?.name || booking.business?.name || '—';
  const jobs = [];
  if (isReal(clientEmail)) {
    jobs.push({
      bookingId: booking.id, kind: 'verification:client', recipient: clientEmail,
      subject: `Confirma tu cita de ${service}`,
      html: verificationHtml({ clientName, business, service, proName, date, startTime, endTime, isHome, address }),
    });
  }
  await runBatch('verification', booking.id, jobs);
}

/* ── Feedback / PQRS ──────────────────────────────────────── */
const FEEDBACK_EMAIL = process.env.FEEDBACK_EMAIL || 'slotly22@gmail.com';

function feedbackHtml({ type, description, page, userEmail }) {
  const rows = [
    ['Tipo',          escHtml(type)],
    ['Página',        escHtml(page || '—')],
    ['Email usuario', escHtml(userEmail || '—')],
  ];

  return layout(`
    <div class="header">
      <div class="logo">Slot<span>ly</span></div>
    </div>
    <div class="body">
      <h1 class="title">Nuevo feedback / PQRS</h1>
      <table class="detail-table">${rows.map(([l,v]) => `<tr><td class="label">${l}</td><td class="value">${v}</td></tr>`).join('')}</table>
      <p class="sub" style="white-space:pre-wrap;color:#E0E0F0">${escHtml(description)}</p>
    </div>
    <div class="footer">Slotly · Notificación interna de feedback.</div>
  `);
}

async function sendFeedbackNotification(report) {
  await sendOne({
    bookingId: report.id,
    kind: 'feedback',
    recipient: FEEDBACK_EMAIL,
    subject: `Nuevo feedback (${report.type}) – Slotly`,
    html: feedbackHtml(report),
  });
}

/* ── Send helpers ─────────────────────────────────────────── */

/**
 * Sends one email via Resend and turns the SDK's non-throwing
 * {data, error} response into a logged, traceable result.
 * Resolves to { ok, recipient, subject } and NEVER throws —
 * callers collect the results and decide whether to raise.
 */
async function sendOne({ bookingId, kind, recipient, subject, html }) {
  const meta = { bookingId, kind, to: recipient, subject, ts: new Date().toISOString() };
  try {
    const result = await getResend().emails.send({ from: FROM, to: recipient, subject, html });
    if (result?.error) {
      console.error('[email] FAILED', JSON.stringify({ ...meta, from: FROM, error: result.error }));
      return { ok: false, recipient, subject, error: result.error };
    }
    console.log('[email] SENT', JSON.stringify({ ...meta, from: FROM, messageId: result?.data?.id }));
    return { ok: true, recipient, subject, messageId: result?.data?.id };
  } catch (err) {
    console.error('[email] EXCEPTION', JSON.stringify({ ...meta, from: FROM, error: err.message }));
    return { ok: false, recipient, subject, error: err.message };
  }
}

/**
 * Runs a batch of sendOne() calls and throws if any failed, so the
 * outer .catch() in booking/homeBooking services logs a real error
 * instead of silently swallowing Resend failures.
 */
async function runBatch(kind, bookingId, jobs) {
  if (!jobs.length) {
    console.log('[email] SKIPPED', JSON.stringify({ bookingId, kind, ts: new Date().toISOString(), reason: 'no real recipients' }));
    return;
  }
  const results = await Promise.all(jobs.map(sendOne));
  const failed = results.filter(r => !r.ok);
  if (failed.length) {
    throw new Error(`[email] ${kind} failed for booking ${bookingId}: ${JSON.stringify(failed.map(f => ({ to: f.recipient, error: f.error })))}`);
  }
}

async function sendBookingConfirmation(booking) {
  const { clientName, clientEmail, proName, proEmail, service, date, startTime, endTime, isHome, address } = extract(booking);
  const jobs = [];

  if (isReal(clientEmail)) {
    jobs.push({
      bookingId: booking.id, kind: 'confirmation:client', recipient: clientEmail,
      subject: `Reserva confirmada – ${service}`,
      html: confirmHtml({ to:'client', name:clientName, service, date, startTime, endTime, proOrClient:proName, isHome, address }),
    });
  }
  if (isReal(proEmail)) {
    jobs.push({
      bookingId: booking.id, kind: 'confirmation:pro', recipient: proEmail,
      subject: `Nueva reserva – ${service}`,
      html: confirmHtml({ to:'pro', name:proName, service, date, startTime, endTime, proOrClient:clientName, isHome, address }),
    });
  }
  await runBatch('confirmation', booking.id, jobs);
}

async function sendBookingCancellation(booking) {
  const { clientName, clientEmail, proName, proEmail, service, date, startTime } = extract(booking);
  const jobs = [];

  if (isReal(clientEmail)) {
    jobs.push({
      bookingId: booking.id, kind: 'cancellation:client', recipient: clientEmail,
      subject: `Reserva cancelada – ${service}`,
      html: cancelHtml({ to:'client', name:clientName, service, date, startTime, proOrClient:proName }),
    });
  }
  if (isReal(proEmail)) {
    jobs.push({
      bookingId: booking.id, kind: 'cancellation:pro', recipient: proEmail,
      subject: `Reserva cancelada – ${service}`,
      html: cancelHtml({ to:'pro', name:proName, service, date, startTime, proOrClient:clientName }),
    });
  }
  await runBatch('cancellation', booking.id, jobs);
}

async function sendBookingReminder(booking) {
  const { clientName, clientEmail, proName, service, date, startTime, endTime, isHome, address } = extract(booking);
  const jobs = [];
  if (isReal(clientEmail)) {
    jobs.push({
      bookingId: booking.id, kind: 'reminder:client', recipient: clientEmail,
      subject: `Recordatorio: tu cita de ${service} es mañana`,
      html: reminderHtml({ name:clientName, service, date, startTime, endTime, proOrClient:proName, isHome, address }),
    });
  }
  await runBatch('reminder', booking.id, jobs);
}

module.exports = { sendBookingConfirmation, sendBookingCancellation, sendBookingReminder, sendFeedbackNotification, sendAppointmentVerification };
