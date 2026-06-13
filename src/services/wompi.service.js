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

module.exports = { generateReference, buildIntegritySignature, getTransaction, verifyWebhookSignature };
