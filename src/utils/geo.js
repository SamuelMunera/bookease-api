// Haversine distance in km between two lat/lng points
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const COUNTRY_CODE = { CO: 'co', US: 'us' };

const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_KEY || '';
const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN || '';

// Geocode con Google Geocoding API. Proveedor principal de la ubicación del
// negocio. Usa `components` para acotar por país/código postal y valida el país
// devuelto para no persistir una ubicación de otro país.
async function geocodeGoogle(address, city, { state, zipCode, cc }) {
  const parts = [address, city, state, zipCode].filter(Boolean).join(', ');
  const params = new URLSearchParams({ address: parts, key: GOOGLE_MAPS_KEY, language: 'es' });
  const components = [];
  if (cc)      components.push(`country:${cc.toUpperCase()}`);
  if (zipCode) components.push(`postal_code:${zipCode}`);
  if (components.length) params.set('components', components.join('|'));

  const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`);
  const data = await res.json();
  const r = data.results?.[0];
  if (!r?.geometry?.location) return null;

  // Rechaza resultados que cayeron en un país distinto al esperado.
  const gotCC = r.address_components?.find(c => c.types?.includes('country'))?.short_name?.toLowerCase();
  if (cc && gotCC && gotCC !== cc.toLowerCase()) return null;

  const { lat, lng } = r.geometry.location;
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  return null;
}

// Geocode with Mapbox Geocoding v6 using STRUCTURED input (address_line1 /
// place / region / postcode / country), which is far more precise than a free
// string. Validates the returned country so we never persist an absurd
// cross-country location (e.g. Rionegro → Miami).
async function geocodeMapbox(address, city, { state, zipCode, cc }) {
  const params = new URLSearchParams({
    access_token: MAPBOX_TOKEN,
    limit: '1',
    language: 'es',
  });
  if (address) params.set('address_line1', address);
  if (city)    params.set('place', city);
  if (state)   params.set('region', state);
  if (zipCode) params.set('postcode', zipCode);
  if (cc)      params.set('country', cc);

  const res = await fetch(`https://api.mapbox.com/search/geocode/v6/forward?${params.toString()}`);
  const data = await res.json();
  const f = data.features?.[0];
  if (!f?.geometry?.coordinates) return null;

  // Reject results that landed in a different country than expected.
  const gotCC = f.properties?.context?.country?.country_code?.toLowerCase();
  if (cc && gotCC && gotCC !== cc) return null;

  const [lng, lat] = f.geometry.coordinates;
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  return null;
}

// Fallback when MAPBOX_TOKEN is not configured: structured Nominatim query
// with the same country restriction/validation.
async function geocodeNominatim(address, city, { state, zipCode, cc }) {
  const params = new URLSearchParams({
    street: address || '',
    city: city || '',
    format: 'json',
    addressdetails: '1',
    limit: '1',
  });
  if (state)   params.set('state', state);
  if (zipCode) params.set('postalcode', zipCode);
  if (cc)      params.set('countrycodes', cc);

  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?${params.toString()}`,
    { headers: { 'User-Agent': 'Slotly/1.0 (slotly.app)' } }
  );
  const data = await res.json();
  if (Array.isArray(data) && data.length > 0) {
    const r = data[0];
    const gotCC = r.address?.country_code?.toLowerCase();
    if (cc && gotCC && gotCC !== cc) return null;
    const lat = parseFloat(r.lat), lng = parseFloat(r.lon);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  return null;
}

// Geocode an address with full geographic context. Prioridad: Google (proveedor
// principal de la ubicación del negocio) → Mapbox → Nominatim, según qué
// credencial esté configurada. Best-effort: devuelve null ante cualquier fallo
// para no bloquear la operación principal.
async function geocodeAddress(address, city, opts = {}) {
  try {
    const { state, country, zipCode } = opts;
    const cc = COUNTRY_CODE[(country || 'CO').toUpperCase()];
    const args = { state, zipCode, cc };
    if (GOOGLE_MAPS_KEY) return await geocodeGoogle(address, city, args);
    if (MAPBOX_TOKEN)    return await geocodeMapbox(address, city, args);
    return await geocodeNominatim(address, city, args);
  } catch {
    return null;
  }
}

module.exports = { haversine, geocodeAddress };
