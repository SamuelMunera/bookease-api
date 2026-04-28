const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
]);

function validateAddress({ country, address, city, state, zipCode }) {
  const errors = [];
  const c = (country || 'CO').toUpperCase();

  if (!address || address.trim().length < 5)
    errors.push('La dirección debe tener al menos 5 caracteres.');
  if (!city || city.trim().length < 2)
    errors.push('La ciudad es obligatoria.');

  if (c === 'US') {
    if (!state || !US_STATES.has(state.trim().toUpperCase()))
      errors.push('Se requiere un estado válido de EE. UU. (ej: FL, NY, TX).');
    if (!zipCode || !/^\d{5}(-\d{4})?$/.test(zipCode.trim()))
      errors.push('El ZIP code debe tener 5 dígitos (ej: 33101).');
  }

  return errors;
}

module.exports = { validateAddress };
