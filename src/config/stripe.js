const Stripe = require('stripe');

// Lazy init so the app boots even without Stripe keys (routes will return 503 on call)
let _stripe = null;
function getStripe() {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY no está configurado');
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-04-10' });
  }
  return _stripe;
}

// Proxy object so existing code using `stripe.xxx` still works
const stripe = new Proxy({}, { get: (_, prop) => getStripe()[prop] });

// One price per plan per currency. Create these in the Stripe dashboard and set the env vars.
const STRIPE_PRICES = {
  CO: {
    solo:   process.env.STRIPE_PRICE_SOLO_CO,
    team:   process.env.STRIPE_PRICE_TEAM_CO,
    studio: process.env.STRIPE_PRICE_STUDIO_CO,
  },
  US: {
    solo:   process.env.STRIPE_PRICE_SOLO_US,
    team:   process.env.STRIPE_PRICE_TEAM_US,
    studio: process.env.STRIPE_PRICE_STUDIO_US,
  },
};

function getPriceId(plan, country) {
  const prices = STRIPE_PRICES[country] || STRIPE_PRICES.CO;
  return prices[plan] || null;
}

function findPlanByPriceId(priceId) {
  if (!priceId) return null;
  for (const plans of Object.values(STRIPE_PRICES)) {
    for (const [plan, id] of Object.entries(plans)) {
      if (id && id === priceId) return plan;
    }
  }
  return null;
}

module.exports = { stripe, STRIPE_PRICES, getPriceId, findPlanByPriceId };
