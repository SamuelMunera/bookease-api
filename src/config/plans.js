// Source of truth for subscription plans.
// Add payment provider IDs here later (stripe_price_id, etc.)

const PLAN_LIMITS = {
  solo:       1,
  team:       3,
  studio:     5,
  enterprise: Infinity,
};

const PLANS_BY_COUNTRY = {
  CO: [
    {
      id: 'solo',
      name: 'Independiente',
      tagline: 'Para profesionales que trabajan solos',
      professionals: 1,
      price: 49000,
      currency: 'COP',
      priceLabel: '$49.000',
      interval: 'mes',
      enterprise: false,
      forType: 'professional',
      features: ['1 profesional', 'Reservas online ilimitadas', 'Agenda digital', 'Notificaciones por email'],
    },
    {
      id: 'team',
      name: 'Equipo',
      tagline: 'Para negocios con pequeño equipo',
      professionals: 3,
      price: 89000,
      currency: 'COP',
      priceLabel: '$89.000',
      interval: 'mes',
      enterprise: false,
      forType: 'business',
      features: ['Hasta 3 profesionales', 'Reservas online ilimitadas', 'Agenda digital', 'Panel de negocio', 'Código de vinculación'],
    },
    {
      id: 'studio',
      name: 'Estudio',
      tagline: 'Para negocios en crecimiento',
      professionals: 5,
      price: 149000,
      currency: 'COP',
      priceLabel: '$149.000',
      interval: 'mes',
      enterprise: false,
      forType: 'business',
      popular: true,
      features: ['Hasta 5 profesionales', 'Reservas online ilimitadas', 'Agenda digital', 'Panel de negocio', 'Analytics avanzados', 'Servicios a domicilio'],
    },
    {
      id: 'enterprise',
      name: 'Empresarial',
      tagline: 'Para cadenas y equipos grandes',
      professionals: null,
      price: null,
      currency: 'COP',
      priceLabel: 'A convenir',
      interval: null,
      enterprise: true,
      forType: 'business',
      features: ['6 o más profesionales', 'Todo del plan Estudio', 'Soporte prioritario', 'Onboarding personalizado', 'Precio a convenir'],
    },
  ],
  US: [
    {
      id: 'solo',
      name: 'Independent',
      tagline: 'For solo professionals',
      professionals: 1,
      price: 14,
      currency: 'USD',
      priceLabel: '$14',
      interval: 'mo',
      enterprise: false,
      forType: 'professional',
      features: ['1 professional', 'Unlimited online bookings', 'Digital calendar', 'Email notifications'],
    },
    {
      id: 'team',
      name: 'Team',
      tagline: 'For small business teams',
      professionals: 3,
      price: 29,
      currency: 'USD',
      priceLabel: '$29',
      interval: 'mo',
      enterprise: false,
      forType: 'business',
      features: ['Up to 3 professionals', 'Unlimited online bookings', 'Digital calendar', 'Business dashboard', 'Team join code'],
    },
    {
      id: 'studio',
      name: 'Studio',
      tagline: 'For growing businesses',
      professionals: 5,
      price: 49,
      currency: 'USD',
      priceLabel: '$49',
      interval: 'mo',
      enterprise: false,
      forType: 'business',
      popular: true,
      features: ['Up to 5 professionals', 'Unlimited online bookings', 'Digital calendar', 'Business dashboard', 'Advanced analytics', 'Home services'],
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      tagline: 'For chains and large teams',
      professionals: null,
      price: null,
      currency: 'USD',
      priceLabel: 'Custom pricing',
      interval: null,
      enterprise: true,
      forType: 'business',
      features: ['6+ professionals', 'Everything in Studio', 'Priority support', 'Custom onboarding', 'Custom pricing'],
    },
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

module.exports = { PLAN_LIMITS, PLANS_BY_COUNTRY, getPlanLimit, getPlansForCountry, getPlanById };
