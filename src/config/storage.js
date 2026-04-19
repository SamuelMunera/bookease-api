const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const BUCKET = 'profiles';

async function uploadFile(buffer, mimeType, storagePath) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Storage not configured');
  }
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
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
