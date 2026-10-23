import api from './api';

export interface PlanLimit {
  warehouses: number | null;
  ordersPerMonth: number | null;
  skus: number | null;
  teamMembers: number | null;
  apiAccess: boolean;
  multiCompany: boolean;
  slaGuarantee: boolean;
  customIntegrations: boolean;
}

export interface PlanConfig {
  key: string;
  name: string;
  price: number;
  priceCents: number;
  period: string;
  description: string;
  features: string[];
  limits: PlanLimit;
  recommended?: boolean;
}

export interface UsageMetric {
  used: number;
  limit: number | null;
  percentage: number;
  unlimited: boolean;
}

export interface SubscriptionUsage {
  plan: string;
  planName: string;
  limits: PlanLimit;
  usage: {
    warehouses: UsageMetric;
    orders: UsageMetric;
    team: UsageMetric;
    skus: UsageMetric;
  };
  periodStart: string;
  periodEnd: string | null;
}

export interface SubscriptionStatus {
  plan: string;
  planDetails: PlanConfig;
  subscriptionStatus: 'active' | 'past_due' | 'canceled' | 'trialing' | 'incomplete' | 'unpaid';
  stripeCustomerId: string | null;
  currentPeriodEnd: string | null;
  providerConfigured: boolean;
}

export const subscriptionService = {
  getPlans: async () => {
    const response = await api.get('/subscription/plans');
    return response.data;
  },

  getStatus: async () => {
    const response = await api.get('/subscription/status');
    return response.data;
  },

  getUsage: async () => {
    const response = await api.get('/subscription/usage');
    return response.data;
  },

  createCheckoutSession: async (payload: { targetPlan: string; successUrl?: string; cancelUrl?: string }, idempotencyKey?: string) => {
    const headers: Record<string, string> = {};
    if (idempotencyKey) {
      headers['idempotency-key'] = idempotencyKey;
    }
    const response = await api.post('/subscription/checkout', payload, { headers });
    return response.data;
  },

  getCheckoutStatus: async (sessionId: string) => {
    const response = await api.get(`/subscription/checkout/${encodeURIComponent(sessionId)}`);
    return response.data;
  }
};
