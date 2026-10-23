import express from 'express';
import mongoose from 'mongoose';
import { protect, csrfProtection } from '../middleware/auth.js';
import Company from '../models/Company.js';
import User from '../models/User.js';
import Warehouse from '../models/Warehouse.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import ActivityLog from '../models/ActivityLog.js';
import SubscriptionCheckout from '../models/SubscriptionCheckout.js';
import subscriptionPlanCatalog from '../services/subscriptionPlanCatalog.js';
import subscriptionPaymentService from '../services/subscriptionPaymentService.js';

const router = express.Router();

/**
 * GET /api/v1/subscription/plans
 * Returns catalog of all available plans and their authoritative limits
 */
router.get('/plans', async (req, res, next) => {
  try {
    const plans = subscriptionPlanCatalog.getAllPlans();
    res.json({
      success: true,
      data: plans,
      currency: subscriptionPlanCatalog.CURRENCY,
      providerConfigured: subscriptionPaymentService.isConfigured()
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/subscription/status
 * Returns company's current subscription status, plan, period, and payment provider setup
 */
router.get('/status', protect, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({ message: 'Company context required' });
    }

    const company = await Company.findById(req.user.company).select(
      'name plan subscriptionStatus stripeCustomerId currentPeriodEnd subscriptionCheckoutId'
    );

    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }

    const currentPlanConfig = subscriptionPlanCatalog.getPlan(company.plan);

    res.json({
      success: true,
      data: {
        plan: company.plan || 'starter',
        planDetails: currentPlanConfig,
        subscriptionStatus: company.subscriptionStatus || 'active',
        stripeCustomerId: company.stripeCustomerId || null,
        currentPeriodEnd: company.currentPeriodEnd || null,
        providerConfigured: subscriptionPaymentService.isConfigured()
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/subscription/usage
 * Authoritative server-side plan usage metrics vs limits
 */
router.get('/usage', protect, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({ message: 'Company context required' });
    }

    const company = await Company.findById(req.user.company);
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }

    const currentPlanKey = company.plan || 'starter';
    const planConfig = subscriptionPlanCatalog.getPlan(currentPlanKey);
    const limits = planConfig.limits;

    // Start of current month in UTC
    const now = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    // Parallel count queries with company tenant isolation
    const [warehouseCount, userCount, orderCount, skuCount] = await Promise.all([
      Warehouse.countDocuments({ company: req.user.company }),
      User.countDocuments({ company: req.user.company }),
      Order.countDocuments({ company: req.user.company, createdAt: { $gte: startOfMonth } }),
      Product.countDocuments({ company: req.user.company })
    ]);

    const calculatePct = (used, limit) => {
      if (limit === null || limit === undefined) return 0; // Unlimited
      if (limit <= 0) return 100;
      return Math.min(100, Math.round((used / limit) * 100));
    };

    const usage = {
      warehouses: {
        used: warehouseCount,
        limit: limits.warehouses,
        percentage: calculatePct(warehouseCount, limits.warehouses),
        unlimited: limits.warehouses === null
      },
      orders: {
        used: orderCount,
        limit: limits.ordersPerMonth,
        percentage: calculatePct(orderCount, limits.ordersPerMonth),
        unlimited: limits.ordersPerMonth === null
      },
      team: {
        used: userCount,
        limit: limits.teamMembers,
        percentage: calculatePct(userCount, limits.teamMembers),
        unlimited: limits.teamMembers === null
      },
      skus: {
        used: skuCount,
        limit: limits.skus,
        percentage: calculatePct(skuCount, limits.skus),
        unlimited: limits.skus === null
      }
    };

    res.json({
      success: true,
      data: {
        plan: currentPlanKey,
        planName: planConfig.name,
        limits,
        usage,
        periodStart: startOfMonth,
        periodEnd: company.currentPeriodEnd || null
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/subscription/checkout
 * Create real payment checkout session with payment provider
 */
router.post('/checkout', protect, csrfProtection, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({ message: 'Company context required' });
    }

    const { targetPlan, successUrl, cancelUrl } = req.body;
    if (!targetPlan) {
      return res.status(400).json({ message: 'targetPlan is required' });
    }

    const planConfig = subscriptionPlanCatalog.getPlan(targetPlan);
    if (!planConfig) {
      return res.status(400).json({ message: `Invalid plan: ${targetPlan}` });
    }

    const company = await Company.findById(req.user.company);
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }

    if (company.plan === targetPlan) {
      return res.status(400).json({
        message: `Company is already on the ${planConfig.name} plan`
      });
    }

    // Require real payment provider - never simulate success if unconfigured
    if (!subscriptionPaymentService.isConfigured()) {
      return res.status(503).json({
        code: 'PAYMENT_PROVIDER_NOT_CONFIGURED',
        message: 'Payment provider is not configured. Real payment credentials (STRIPE_SECRET_KEY) are required to upgrade subscription.'
      });
    }

    const idempotencyKey = req.headers['idempotency-key'] || `sub_chk_${req.user.company}_${Date.now()}`;

    // Create session in Stripe
    const session = await subscriptionPaymentService.createCheckoutSession({
      companyId: company._id,
      companyEmail: company.email || req.user.email,
      companyName: company.name,
      planKey: targetPlan,
      planName: planConfig.name,
      amountCents: planConfig.priceCents,
      currency: subscriptionPlanCatalog.CURRENCY.toLowerCase(),
      successUrl: successUrl || `${req.protocol}://${req.get('host')}/settings/subscription?session_id={CHECKOUT_SESSION_ID}&success=true`,
      cancelUrl: cancelUrl || `${req.protocol}://${req.get('host')}/settings/subscription?canceled=true`,
      stripePriceId: planConfig.stripePriceId || null,
      idempotencyKey
    });

    // Save pending checkout session
    const checkoutRecord = await SubscriptionCheckout.create({
      company: company._id,
      sessionId: session.id,
      providerRef: session.id,
      targetPlan,
      currentPlan: company.plan || 'starter',
      amount: planConfig.price,
      amountCents: planConfig.priceCents || Math.round(planConfig.price * 100),
      currency: subscriptionPlanCatalog.CURRENCY,
      status: 'pending',
      checkoutUrl: session.url,
      idempotencyKey,
      initiatedBy: req.user.email || req.user.name || 'user',
      metadata: {
        userId: req.user._id,
        userEmail: req.user.email
      }
    });

    res.status(201).json({
      success: true,
      data: {
        sessionId: session.id,
        checkoutUrl: session.url,
        checkoutId: checkoutRecord._id,
        plan: targetPlan
      }
    });
  } catch (err) {
    if (err.code === 'PAYMENT_PROVIDER_NOT_CONFIGURED') {
      return res.status(503).json({
        code: 'PAYMENT_PROVIDER_NOT_CONFIGURED',
        message: err.message
      });
    }
    next(err);
  }
});

/**
 * GET /api/v1/subscription/checkout/:sessionId
 * Poll checkout status
 */
router.get('/checkout/:sessionId', protect, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({ message: 'Company context required' });
    }

    const checkout = await SubscriptionCheckout.findOne({
      sessionId: req.params.sessionId,
      company: req.user.company
    });

    if (!checkout) {
      return res.status(404).json({ message: 'Checkout session not found' });
    }

    // If still pending and provider is configured, check status with Stripe
    if (checkout.status === 'pending' && subscriptionPaymentService.isConfigured()) {
      try {
        const stripeSession = await subscriptionPaymentService.retrieveCheckoutSession(checkout.sessionId);
        if (stripeSession.payment_status === 'paid' || stripeSession.status === 'complete') {
          checkout.status = 'succeeded';
          checkout.completedAt = new Date();
          if (stripeSession.customer) checkout.stripeCustomerId = stripeSession.customer;
          await checkout.save();

          // Also activate company plan if not already updated by webhook
          await Company.findByIdAndUpdate(checkout.company, {
            plan: checkout.targetPlan,
            subscriptionStatus: 'active',
            subscriptionCheckoutId: checkout._id,
            ...(stripeSession.customer ? { stripeCustomerId: stripeSession.customer } : {})
          });
        }
      } catch (stripeErr) {
        console.warn('Could not poll Stripe session status:', stripeErr.message);
      }
    }

    res.json({
      success: true,
      data: checkout
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/subscription/webhook
 * Stripe webhook handler for subscription lifecycle events
 * Uses raw body HMAC verification and idempotency protection
 */
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    if (!req.rawBody) {
      return res.status(400).json({ error: 'Missing raw request body for signature verification' });
    }

    if (!webhookSecret) {
      console.warn('⚠️ STRIPE_WEBHOOK_SECRET not configured. Rejecting webhook.');
      return res.status(503).json({ error: 'Webhook secret not configured' });
    }

    event = subscriptionPaymentService.verifyWebhookSignature(req.rawBody.toString('utf8'), sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // Idempotency check for event processing
  const existingCheckout = await SubscriptionCheckout.findOne({ webhookEventId: event.id });
  if (existingCheckout) {
    return res.json({ received: true, message: 'Event already processed' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const companyId = session.client_reference_id || session.metadata?.companyId;
        const targetPlan = session.metadata?.targetPlan;

        if (companyId && targetPlan) {
          const checkout = await SubscriptionCheckout.findOneAndUpdate(
            { sessionId: session.id },
            {
              status: 'succeeded',
              webhookEventId: event.id,
              stripeCustomerId: session.customer || null,
              completedAt: new Date()
            },
            { new: true }
          );

          await Company.findByIdAndUpdate(companyId, {
            plan: targetPlan,
            subscriptionStatus: 'active',
            ...(session.customer ? { stripeCustomerId: session.customer } : {}),
            ...(checkout ? { subscriptionCheckoutId: checkout._id } : {})
          });

          await ActivityLog.create({
            logId: 'ACT-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
            action: 'SUBSCRIPTION_UPGRADE',
            module: 'billing',
            user: 'stripe_webhook',
            detail: `Plan upgraded to ${targetPlan} (Stripe session: ${session.id})`,
            company: companyId
          });
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        if (customerId) {
          await Company.updateMany(
            { stripeCustomerId: customerId },
            { subscriptionStatus: 'canceled' }
          );
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const customerId = invoice.customer;
        if (customerId) {
          await Company.updateMany(
            { stripeCustomerId: customerId },
            { subscriptionStatus: 'past_due' }
          );
        }
        break;
      }

      default:
        // Ignore unhandled event types
        break;
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Error processing Stripe webhook event:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;
