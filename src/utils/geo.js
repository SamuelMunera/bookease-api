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

const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN || '';

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

// Geocode an address with full geographic context. Uses Mapbox when the token
// is configured, Nominatim otherwise. Best-effort: returns null on any failure
// so it never blocks the main operation.
async function geocodeAddress(address, city, opts = {}) {
  try {
    const { state, country, zipCode } = opts;
    const cc = COUNTRY_CODE[(country || 'CO').toUpperCase()];
    const args = { state, zipCode, cc };
    return MAPBOX_TOKEN
      ? await geocodeMapbox(address, city, args)
      : await geocodeNominatim(address, city, args);
  } catch {
    return null;
  }
}

module.exports = { haversine, geocodeAddress };
