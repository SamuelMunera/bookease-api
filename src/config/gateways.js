// Source of truth for payment gateway by country.
// Add new countries here — nowhere else.
const DEFAULT_GATEWAY_BY_COUNTRY = {
  CO: 'WOMPI',
  US: null,   // gateway pendiente para EEUU
};

function getDefaultGateway(country) {
  return DEFAULT_GATEWAY_BY_COUNTRY[country] ?? null;
}

module.exports = { DEFAULT_GATEWAY_BY_COUNTRY, getDefaultGateway };
