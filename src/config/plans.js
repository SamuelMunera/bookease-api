
const PLAN_LIMITS = {
  solo:       1,
  team:       3,
  studio:     5,
  enterprise: Infinity,
};

// Orden de tiers para validar upgrades/downgrades. Un upgrade (rank mayor)
// solo se activa tras pago aprobado vía webhook Wompi; downgrade/igual sí se
// permite directamente. 'solo' es el plan de profesional independiente.
const PLAN_RANK = {
  solo:       0,
  team:       1,
  studio:     2,
  enterprise: 3,
};

function getPlanRank(planId) {
  return PLAN_RANK[planId] ?? 0;
}

const BASE_FEATURES = [
  'Reservas online ilimitadas',
  'Agenda digital',
  'Notificaciones por email',
  'Panel de negocio',
  'Código de vinculación',
  'Analytics avanzados',
  'Servicios a domicilio',
];

const PLANS_BY_COUNTRY = {
  CO: [
    { id: 'solo',       name: 'Independiente', tagline: 'Para profesionales que trabajan solos',  professionals: 1,    price: 30000,  currency: 'COP', priceLabel: '$30.000',  interval: 'mes', enterprise: false, forType: 'professional', features: ['1 profesional',          ...BASE_FEATURES] },
    { id: 'team',       name: 'Equipo',        tagline: 'Para negocios con pequeño equipo',       professionals: 3,    price: 45000,  currency: 'COP', priceLabel: '$45.000',  interval: 'mes', enterprise: false, forType: 'business',      features: ['Hasta 3 profesionales',  ...BASE_FEATURES] },
    { id: 'studio',     name: 'Estudio',       tagline: 'Para negocios en crecimiento',           professionals: 5,    price: 60000,  currency: 'COP', priceLabel: '$60.000',  interval: 'mes', enterprise: false, forType: 'business',      features: ['Hasta 5 profesionales',  ...BASE_FEATURES], popular: true },
    { id: 'enterprise', name: 'Empresarial',   tagline: 'Para cadenas y equipos grandes',         professionals: null, price: null,   currency: 'COP', priceLabel: 'A convenir', interval: null, enterprise: true,  forType: 'business',      features: ['6 o más profesionales', ...BASE_FEATURES, 'Soporte prioritario', 'Onboarding personalizado'] },
  ],
  US: [
    { id: 'solo',       name: 'Independiente', tagline: 'Para profesionales que trabajan solos',  professionals: 1,    price: 15,  currency: 'USD', priceLabel: '$15', interval: 'mes', enterprise: false, forType: 'professional', features: ['1 profesional',          ...BASE_FEATURES] },
    { id: 'team',       name: 'Equipo',        tagline: 'Para negocios con pequeño equipo',       professionals: 3,    price: 20,  currency: 'USD', priceLabel: '$20', interval: 'mes', enterprise: false, forType: 'business',      features: ['Hasta 3 profesionales',  ...BASE_FEATURES] },
    { id: 'studio',     name: 'Estudio',       tagline: 'Para negocios en crecimiento',           professionals: 5,    price: 25,  currency: 'USD', priceLabel: '$25', interval: 'mes', enterprise: false, forType: 'business',      features: ['Hasta 5 profesionales',  ...BASE_FEATURES], popular: true },
    { id: 'enterprise', name: 'Empresarial',   tagline: 'Para cadenas y equipos grandes',         professionals: null, price: null, currency: 'USD', priceLabel: 'A convenir', interval: null, enterprise: true,  forType: 'business',      features: ['6 o más profesionales', ...BASE_FEATURES, 'Soporte prioritario', 'Onboarding personalizado'] },
  ],
};

function getPlanLimit(planId) {
  return PLAN_LIMITS[planId] ?? Infinity;
}

function getPlansForCountry(country) {
  return PLANS_BY_COUNTRY[country] ?? PLANS_BY_COUNTRY.CO;
}

function getPlanById(planId, country) {
  return getPlansForCountry(country).find(p => p.id === planId) ?? null;
}

module.exports = { PLAN_LIMITS, PLAN_RANK, PLANS_BY_COUNTRY, getPlanLimit, getPlanRank, getPlansForCountry, getPlanById };
