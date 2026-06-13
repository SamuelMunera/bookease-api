// Wompi sandbox/test configuration — fail fast, never fall back to production.
const REQUIRED_VARS = ['WOMPI_ENV', 'WOMPI_PUBLIC_KEY', 'WOMPI_PRIVATE_KEY', 'WOMPI_EVENTS_KEY', 'WOMPI_INTEGRITY_KEY'];

for (const name of REQUIRED_VARS) {
  if (!process.env[name]) {
    console.error(`FATAL: ${name} environment variable is not set. Refusing to start.`);
    process.exit(1);
  }
}

if (process.env.WOMPI_ENV !== 'test') {
  console.error(`FATAL: WOMPI_ENV must be "test" (sandbox). Got "${process.env.WOMPI_ENV}". Refusing to start.`);
  process.exit(1);
}

// Sandbox key prefixes — actively reject production-looking keys.
const SANDBOX_PREFIXES = {
  WOMPI_PUBLIC_KEY: 'pub_test_',
  WOMPI_PRIVATE_KEY: 'prv_test_',
  WOMPI_EVENTS_KEY: 'test_events_',
  WOMPI_INTEGRITY_KEY: 'test_integrity_',
};

for (const [name, prefix] of Object.entries(SANDBOX_PREFIXES)) {
  if (!process.env[name].startsWith(prefix)) {
    console.error(`FATAL: ${name} does not look like a Wompi sandbox key (expected prefix "${prefix}"). Refusing to start.`);
    process.exit(1);
  }
}

module.exports = {
  ENV: 'test',
  BASE_URL: 'https://sandbox.wompi.co/v1',
  CHECKOUT_URL: 'https://checkout.wompi.co/p/',
  WIDGET_SCRIPT_URL: 'https://checkout.wompi.co/widget.js',
  PUBLIC_KEY: process.env.WOMPI_PUBLIC_KEY,
  PRIVATE_KEY: process.env.WOMPI_PRIVATE_KEY,
  EVENTS_KEY: process.env.WOMPI_EVENTS_KEY,
  INTEGRITY_KEY: process.env.WOMPI_INTEGRITY_KEY,
};
