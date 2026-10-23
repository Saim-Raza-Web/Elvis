/**
 * Subscription Plan Catalog
 *
 * Single source of truth for all plan definitions, prices, limits, and features.
 * Referenced by the server-side subscription service, usage endpoints, and UI.
 *
 * IMPORTANT: These are the authoritative plan definitions.
 * Client-supplied plan names, prices, or upgrade confirmations are NEVER trusted.
 * All upgrades must be verified through the payment provider before activation.
 */

export const CURRENCY = 'EUR';

export const PLAN_CATALOG = {
  starter: {
    id: 'starter',
    key: 'starter',
    name: 'Starter',
    price: 99,
    priceMonthly: 99,
    priceCents: 9900,
    period: 'month',
    currency: 'EUR',
    description: 'Perfect for small operations and getting started',
    limits: {
      warehouses: 2,
      ordersPerMonth: 500,
      skus: 1000,
      teamMembers: 2,
      apiAccess: false,
      multiCompany: false,
      slaGuarantee: false,
      customIntegrations: false
    },
    features: [
      'Up to 2 warehouses',
      '500 orders / month',
      '1,000 SKUs',
      'Basic analytics',
      'Email support',
      '2 team members'
    ],
    stripePriceId: process.env.STRIPE_PRICE_STARTER || null
  },
  professional: {
    id: 'professional',
    key: 'professional',
    name: 'Professional',
    price: 299,
    priceMonthly: 299,
    priceCents: 29900,
    period: 'month',
    currency: 'EUR',
    description: 'For growing businesses with multiple locations',
    limits: {
      warehouses: 10,
      ordersPerMonth: 5000,
      skus: null,           // unlimited
      teamMembers: 10,
      apiAccess: true,
      multiCompany: true,
      slaGuarantee: false,
      customIntegrations: false
    },
    features: [
      'Up to 10 warehouses',
      '5,000 orders / month',
      'Unlimited SKUs',
      'Advanced analytics & reports',
      'Priority support',
      '10 team members',
      'API access',
      'Multi-company'
    ],
    stripePriceId: process.env.STRIPE_PRICE_PROFESSIONAL || null
  },
  enterprise: {
    id: 'enterprise',
    key: 'enterprise',
    name: 'Enterprise',
    price: 999,
    priceMonthly: 999,
    priceCents: 99900,
    period: 'month',
    currency: 'EUR',
    description: 'Full-scale logistics management for large enterprises',
    limits: {
      warehouses: null,     // unlimited
      ordersPerMonth: null, // unlimited
      skus: null,           // unlimited
      teamMembers: null,    // unlimited
      apiAccess: true,
      multiCompany: true,
      slaGuarantee: true,
      customIntegrations: true
    },
    features: [
      'Unlimited warehouses',
      'Unlimited orders',
      'Unlimited SKUs',
      'Custom analytics',
      'Dedicated support manager',
      'Unlimited team members',
      'Full API access',
      'Custom integrations',
      'SLA guarantee',
      'White-label option'
    ],
    stripePriceId: process.env.STRIPE_PRICE_ENTERPRISE || null
  }
};

export const PLAN_IDS = Object.keys(PLAN_CATALOG);

export function getPlan(planId) {
  if (!planId) return null;
  return PLAN_CATALOG[String(planId).toLowerCase()] || null;
}

export function getAllPlans() {
  return Object.values(PLAN_CATALOG);
}

export default {
  CURRENCY,
  PLAN_CATALOG,
  PLAN_IDS,
  getPlan,
  getAllPlans
};