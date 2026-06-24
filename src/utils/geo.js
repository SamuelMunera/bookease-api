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

// Geocode an address with full geographic context (Nominatim, OpenStreetMap).
// Uses a STRUCTURED query (street/city/state/country/postal) instead of a free
// string, restricts to the business country (`countrycodes`), and VALIDATES that
// the returned result is actually in that country — otherwise it returns null so
// we never persist an absurd cross-country location (e.g. Rionegro → Miami).
async function geocodeAddress(address, city, opts = {}) {
  try {
    const { state, country, zipCode } = opts;
    const cc = COUNTRY_CODE[(country || 'CO').toUpperCase()];

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
      // Reject results that landed in a different country than expected.
      const gotCC = r.address?.country_code?.toLowerCase();
      if (cc && gotCC && gotCC !== cc) return null;
      const lat = parseFloat(r.lat), lng = parseFloat(r.lon);
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    }
  } catch {
    // geocoding is best-effort; don't block the main operation
  }
  return null;
}

module.exports = { haversine, geocodeAddress };
