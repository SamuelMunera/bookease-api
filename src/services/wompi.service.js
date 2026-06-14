const crypto = require('crypto');
const wompi = require('../config/wompi');

function generateReference() {
  return `SLOTLY-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

// Wompi Web Checkout integrity signature: SHA256(reference + amountInCents + currency + integritySecret)
function buildIntegritySignature({ reference, amountInCents, currency }) {
  const raw = `${reference}${amountInCents}${currency}${wompi.INTEGRITY_KEY}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function getTransaction(transactionId) {
  const res = await fetch(`${wompi.BASE_URL}/transactions/${transactionId}`, {
    headers: { Authorization: `Bearer ${wompi.PRIVATE_KEY}` },
  });
  if (!res.ok) throw new Error('No se pudo consultar la transacción en Wompi');
  const body = await res.json();
  return body.data;
}

async function getAcceptanceToken() {
  const res = await fetch(`${wompi.BASE_URL}/merchants/${wompi.PUBLIC_KEY}`);
  if (!res.ok) throw new Error('No se pudo obtener el token de aceptación de Wompi');
  const body = await res.json();
  return body.data.presigned_acceptance.acceptance_token;
}

// Cobra un ciclo de renovación mensual usando un payment_source_id guardado
// (tarjeta tokenizada en un pago previo APPROVED). Cobro server-to-server,
// sin interacción del cliente — es lo que hace real la auto-renovación.
async function chargeRecurring({ paymentSourceId, amountInCents, currency, reference }) {
  const acceptanceToken = await getAcceptanceToken();
  const res = await fetch(`${wompi.BASE_URL}/transactions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${wompi.PRIVATE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      acceptance_token: acceptanceToken,
      amount_in_cents: amountInCents,
      currency,
      reference,
      payment_source_id: paymentSourceId,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.reason || 'Error al cobrar la renovación en Wompi');
  return body.data;
}

function getValueByPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

// Wompi webhook checksum: SHA256(concat(properties values in order) + timestamp + eventsKey)
function verifyWebhookSignature(body) {
  const { signature, timestamp, data } = body || {};
  if (!signature?.checksum || !Array.isArray(signature?.properties) || !timestamp || !data) return false;

  const concatenated = signature.properties.map(p => getValueByPath(data, p)).join('') + timestamp + wompi.EVENTS_KEY;
  const expected = crypto.createHash('sha256').update(concatenated).digest('hex');
  return expected === signature.checksum;
}

module.exports = {
  generateReference, buildIntegritySignature, getTransaction, verifyWebhookSignature,
  getAcceptanceToken, chargeRecurring,
};
