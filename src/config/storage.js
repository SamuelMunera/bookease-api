const SUPABASE_URL = process.env.SUPABASE_URL;
const BUCKET = 'profiles';

function getKey() {
  // Service role key bypasses RLS — required for backend uploads
  return process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
}

async function uploadFile(buffer, mimeType, storagePath) {
  const key = getKey();
  if (!SUPABASE_URL || !key) {
    throw new Error('Storage not configured: set SUPABASE_SERVICE_KEY in env vars');
  }
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': mimeType,
      'x-upsert': 'true',
    },
    body: buffer,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Upload failed: ${err}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`;
}

module.exports = { uploadFile };
