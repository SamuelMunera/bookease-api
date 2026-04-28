// Retries fn on Prisma serialization failures (P2034 / SSI conflict).
// On exhaustion, translates to SLOT_CONFLICT for the caller.
async function retryOnConflict(fn, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err?.code === 'P2034') {
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 40 * attempt + Math.random() * 80));
          continue;
        }
        const conflict = new Error('Slot is no longer available');
        conflict.code = 'SLOT_CONFLICT';
        throw conflict;
      }
      throw err;
    }
  }
}

module.exports = { retryOnConflict };
