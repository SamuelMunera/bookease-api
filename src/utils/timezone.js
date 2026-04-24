const ALLOWED_TIMEZONES = new Set([
  'America/Bogota',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
]);

const ALLOWED_COUNTRIES = new Set(['CO', 'US']);

const DEFAULT_TIMEZONE = { CO: 'America/Bogota', US: 'America/New_York' };

function validateCountry(country) {
  if (!ALLOWED_COUNTRIES.has(country)) throw new Error(`País no válido: ${country}`);
}

function validateTimezone(timezone) {
  if (!ALLOWED_TIMEZONES.has(timezone)) throw new Error(`Zona horaria no válida: ${timezone}`);
}

function resolveTimezone(country, timezone) {
  if (timezone) { validateTimezone(timezone); return timezone; }
  return DEFAULT_TIMEZONE[country] || 'America/Bogota';
}

// Returns UTC offset in hours for a timezone at a given moment (handles DST)
function getUTCOffsetHours(timezone) {
  const now = new Date();
  const utcStr = now.toLocaleString('en-CA', { timeZone: 'UTC' });
  const tzStr  = now.toLocaleString('en-CA', { timeZone: timezone });
  return (new Date(tzStr) - new Date(utcStr)) / 3600000;
}

// Returns UTC ms of a booking's local start time
function bookingToUTCMs(dateISO, startTime, timezone) {
  const [h, m] = startTime.split(':').map(Number);
  const utcMidnight = new Date(String(dateISO).slice(0, 10) + 'T00:00:00Z').getTime();
  const offsetHours = getUTCOffsetHours(timezone);
  return utcMidnight + (h * 60 + m) * 60000 - offsetHours * 3600000;
}

// "Tomorrow" date string in a given timezone
function tomorrowInTimezone(timezone) {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const todayLocal = formatter.format(now);
  const d = new Date(todayLocal + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

module.exports = { validateCountry, validateTimezone, resolveTimezone, getUTCOffsetHours, bookingToUTCMs, tomorrowInTimezone, ALLOWED_TIMEZONES, ALLOWED_COUNTRIES };
