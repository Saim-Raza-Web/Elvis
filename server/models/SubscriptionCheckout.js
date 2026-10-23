import mongoose from 'mongoose';

/**
 * SubscriptionCheckout — tracks a payment intent / checkout session
 * created when a user initiates a plan upgrade.
 *
 * A plan is NEVER activated until the provider webhook confirms payment.
 *
 * Fields:
 *   company          — tenant owner
 *   targetPlan       — plan the user intends to upgrade to
 *   currentPlan      — plan at the time of checkout initiation
 *   amountCents      — price in minor units (EUR cents)
 *   currency         — always EUR
 *   status           — pending | succeeded | failed | cancelled | expired
 *   providerRef      — Stripe Checkout Session ID / PaymentIntent ID
 *   webhookEventId   — provider event ID that finalized this checkout (idempotency)
 *   activatedAt      — timestamp plan was activated (only when status=succeeded)
 *   expiresAt        — checkout link expiry (provider-issued)
 *   checkoutUrl      — URL to redirect user to hosted payment page
 *   initiatedBy      — user who started the checkout
 *   metadata         — arbitrary KV for provider-specific context
 */
const subscriptionCheckoutSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  targetPlan: { type: String, required: true, enum: ['starter', 'professional', 'enterprise'] },
  currentPlan: { type: String, default: 'starter' },
  amountCents: { type: Number, default: 0 },
  amount: { type: Number, default: 0 },
  currency: { type: String, default: 'EUR' },
  status: {
    type: String,
    enum: ['pending', 'succeeded', 'failed', 'cancelled', 'expired'],
    default: 'pending',
    index: true
  },
  providerRef: { type: String, default: null },       // Stripe session/intent ID
  sessionId: { type: String, default: null },         // Alias for provider session ID
  webhookEventId: { type: String, default: null },    // Provider event ID (idempotency)
  activatedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  expiresAt: { type: Date, default: null },
  checkoutUrl: { type: String, default: null },       // Hosted checkout URL
  cancelUrl: { type: String, default: null },
  successUrl: { type: String, default: null },
  initiatedBy: { type: String, default: 'unknown' },
  stripeCustomerId: { type: String, default: null },
  idempotencyKey: { type: String, default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

subscriptionCheckoutSchema.index({ company: 1, status: 1, createdAt: -1 });
subscriptionCheckoutSchema.index({ providerRef: 1 }, { sparse: true });
subscriptionCheckoutSchema.index({ webhookEventId: 1 }, { sparse: true, unique: true });

export default mongoose.model('SubscriptionCheckout', subscriptionCheckoutSchema);