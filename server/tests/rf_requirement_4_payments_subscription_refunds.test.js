import assert from 'assert';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import app from '../index.js';
import User from '../models/User.js';
import Company from '../models/Company.js';
import Warehouse from '../models/Warehouse.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Return from '../models/Return.js';
import ReturnRefund from '../models/ReturnRefund.js';
import SubscriptionCheckout from '../models/SubscriptionCheckout.js';
import ActivityLog from '../models/ActivityLog.js';
import subscriptionPlanCatalog from '../services/subscriptionPlanCatalog.js';
import subscriptionPaymentService from '../services/subscriptionPaymentService.js';
import { setupTestDatabase, teardownTestDatabase } from '../test_helper.js';

process.env.NODE_ENV = 'test';
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'test_jwt_secret_req4';

const TEST_CSRF = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function authHeaders(user) {
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1d' });
  return {
    cookies: [`jwt_token=${token}`, `csrf_token=${TEST_CSRF}`],
    csrf: TEST_CSRF
  };
}

async function run() {
  console.log('\n=== ELVIS WMS — REQ #4 REAL PAYMENTS, SUBSCRIPTION & REFUNDS TESTS ===\n');
  await setupTestDatabase();
  const s = Date.now().toString();
  const pw = await bcrypt.hash('Password123!', 10);

  // Setup Tenant A (Starter plan)
  const coA = await Company.create({
    name: 'Tenant Alpha ' + s,
    plan: 'starter',
    subscriptionStatus: 'active'
  });
  const adminA = await User.create({
    email: 'adminA_' + s + '@test.com',
    password: pw,
    name: 'Admin Alpha',
    role: 'admin',
    company: coA._id
  });
  const staffA = await User.create({
    email: 'staffA_' + s + '@test.com',
    password: pw,
    name: 'Staff Alpha',
    role: 'warehouse_staff',
    company: coA._id
  });

  // Setup Tenant B (Professional plan)
  const coB = await Company.create({
    name: 'Tenant Beta ' + s,
    plan: 'professional',
    subscriptionStatus: 'active'
  });
  const adminB = await User.create({
    email: 'adminB_' + s + '@test.com',
    password: pw,
    name: 'Admin Beta',
    role: 'admin',
    company: coB._id
  });

  const hA = authHeaders(adminA);
  const hStaff = authHeaders(staffA);
  const hB = authHeaders(adminB);

  let passed = 0;
  let failed = 0;
  function ok(m) { console.log('  PASS:', m); passed++; }
  function fail(m, e) { console.log('  FAIL:', m, e && e.message ? '— ' + e.message : ''); failed++; }

  try {
    // -----------------------------------------------------------------
    // 1. PLAN CATALOG & LIMITS
    // -----------------------------------------------------------------
    try {
      const plans = subscriptionPlanCatalog.getAllPlans();
      assert.strictEqual(plans.length, 3, 'Catalog must contain 3 tiers');
      assert.strictEqual(plans[0].key, 'starter');
      assert.strictEqual(plans[0].price, 99);
      assert.strictEqual(plans[0].limits.warehouses, 2);
      assert.strictEqual(plans[1].key, 'professional');
      assert.strictEqual(plans[1].price, 299);
      assert.strictEqual(plans[1].limits.ordersPerMonth, 5000);
      assert.strictEqual(plans[2].key, 'enterprise');
      assert.strictEqual(plans[2].price, 999);
      assert.strictEqual(plans[2].limits.warehouses, null); // Unlimited
      ok('T01: subscriptionPlanCatalog returns 3 tiers with authoritative pricing and limits');
    } catch (e) { fail('T01: subscriptionPlanCatalog tiers', e); }

    try {
      const res = await request(app).get('/api/v1/subscription/plans');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.length, 3);
      assert.strictEqual(res.body.currency, 'EUR');
      ok('T02: GET /api/v1/subscription/plans returns public plan catalog');
    } catch (e) { fail('T02: GET /api/v1/subscription/plans', e); }

    // -----------------------------------------------------------------
    // 2. SUBSCRIPTION STATUS ENDPOINT
    // -----------------------------------------------------------------
    try {
      const unauth = await request(app).get('/api/v1/subscription/status');
      assert.strictEqual(unauth.status, 401, 'Must require auth');
      ok('T03: GET /api/v1/subscription/status rejects unauthenticated requests (401)');
    } catch (e) { fail('T03: GET /api/v1/subscription/status unauth', e); }

    try {
      const res = await request(app)
        .get('/api/v1/subscription/status')
        .set('Cookie', hA.cookies);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.plan, 'starter');
      assert.strictEqual(res.body.data.subscriptionStatus, 'active');
      assert.strictEqual(res.body.data.planDetails.price, 99);
      ok('T04: GET /api/v1/subscription/status returns company current plan and status');
    } catch (e) { fail('T04: GET /api/v1/subscription/status auth', e); }

    // -----------------------------------------------------------------
    // 3. AUTHORITATIVE USAGE & LIMITS METRICS (TENANT ISOLATED)
    // -----------------------------------------------------------------
    try {
      // Create Tenant A resources
      await Warehouse.create({ name: 'WH-A1', code: 'WHA1', company: coA._id });
      await Warehouse.create({ name: 'WH-A2', code: 'WHA2', company: coA._id });
      await Product.create({ name: 'Prod A1', sku: 'SKU-A1-' + s, company: coA._id });
      await Product.create({ name: 'Prod A2', sku: 'SKU-A2-' + s, company: coA._id });

      // Create Tenant B resource (should not inflate Tenant A usage)
      await Warehouse.create({ name: 'WH-B1', code: 'WHB1', company: coB._id });

      const res = await request(app)
        .get('/api/v1/subscription/usage')
        .set('Cookie', hA.cookies);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.plan, 'starter');
      assert.strictEqual(res.body.data.usage.warehouses.used, 2);
      assert.strictEqual(res.body.data.usage.warehouses.limit, 2);
      assert.strictEqual(res.body.data.usage.warehouses.percentage, 100);
      assert.strictEqual(res.body.data.usage.skus.used, 2);
      assert.strictEqual(res.body.data.usage.skus.limit, 1000);
      assert.strictEqual(res.body.data.usage.team.used, 2); // adminA + staffA
      ok('T05: GET /api/v1/subscription/usage returns authoritative tenant-isolated usage counts vs limits');
    } catch (e) { fail('T05: GET /api/v1/subscription/usage', e); }

    // -----------------------------------------------------------------
    // 4. CHECKOUT SESSION CREATION & PROVIDER GUARD
    // -----------------------------------------------------------------
    try {
      // Without STRIPE_SECRET_KEY, checkout MUST return 503 and never simulate fake success
      const prevKey = process.env.STRIPE_SECRET_KEY;
      delete process.env.STRIPE_SECRET_KEY;

      const res = await request(app)
        .post('/api/v1/subscription/checkout')
        .set('Cookie', hA.cookies)
        .set('X-CSRF-Token', hA.csrf)
        .send({ targetPlan: 'professional' });

      assert.strictEqual(res.status, 503);
      assert.strictEqual(res.body.code, 'PAYMENT_PROVIDER_NOT_CONFIGURED');

      // Verify plan was NOT upgraded
      const refreshedCo = await Company.findById(coA._id);
      assert.strictEqual(refreshedCo.plan, 'starter', 'Company plan must not change without payment');

      // Restore key if existed
      if (prevKey) process.env.STRIPE_SECRET_KEY = prevKey;
      ok('T06: POST /api/v1/subscription/checkout returns 503 and refuses to upgrade when provider is unconfigured');
    } catch (e) { fail('T06: POST /api/v1/subscription/checkout unconfigured', e); }

    try {
      // Attempting to upgrade to existing plan returns 400
      const res = await request(app)
        .post('/api/v1/subscription/checkout')
        .set('Cookie', hA.cookies)
        .set('X-CSRF-Token', hA.csrf)
        .send({ targetPlan: 'starter' });

      assert.strictEqual(res.status, 400);
      assert.match(res.body.message, /already on the Starter plan/i);
      ok('T07: POST /api/v1/subscription/checkout rejects upgrade to current plan (400)');
    } catch (e) { fail('T07: Upgrade to current plan', e); }

    try {
      // Attempting to upgrade to invalid plan returns 400
      const res = await request(app)
        .post('/api/v1/subscription/checkout')
        .set('Cookie', hA.cookies)
        .set('X-CSRF-Token', hA.csrf)
        .send({ targetPlan: 'ultra_galactic_vip' });

      assert.strictEqual(res.status, 400);
      assert.match(res.body.message, /Invalid plan/i);
      ok('T08: POST /api/v1/subscription/checkout rejects non-existent plan (400)');
    } catch (e) { fail('T08: Invalid plan upgrade', e); }

    // -----------------------------------------------------------------
    // 5. STRIPE WEBHOOK SIGNATURE & IDEMPOTENCY
    // -----------------------------------------------------------------
    const testWebhookSecret = 'whsec_test_secret_req4_' + s;
    process.env.STRIPE_WEBHOOK_SECRET = testWebhookSecret;

    try {
      // Webhook without signature is rejected
      const res = await request(app)
        .post('/api/v1/subscription/webhook')
        .send({ type: 'checkout.session.completed' });

      assert.strictEqual(res.status, 400);
      assert.match(res.body.error, /Missing stripe-signature/i);
      ok('T09: Stripe webhook rejects requests without valid signature (400)');
    } catch (e) { fail('T09: Stripe webhook missing signature', e); }

    try {
      // Create a simulated checkout session in database
      await SubscriptionCheckout.create({
        company: coA._id,
        sessionId: 'cs_test_' + s,
        providerRef: 'cs_test_' + s,
        targetPlan: 'professional',
        currentPlan: 'starter',
        amount: 299,
        amountCents: 29900,
        currency: 'EUR',
        status: 'pending',
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_test_' + s
      });

      // Construct a valid Stripe webhook payload and HMAC signature
      const eventPayload = {
        id: 'evt_test_' + s,
        object: 'event',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_' + s,
            client_reference_id: coA._id.toString(),
            customer: 'cus_test_' + s,
            metadata: {
              companyId: coA._id.toString(),
              targetPlan: 'professional'
            }
          }
        }
      };

      const rawBody = JSON.stringify(eventPayload);
      const timestamp = Math.floor(Date.now() / 1000);
      const computedSig = crypto
        .createHmac('sha256', testWebhookSecret)
        .update(`${timestamp}.${rawBody}`)
        .digest('hex');
      const sigHeader = `t=${timestamp},v1=${computedSig}`;

      const res = await request(app)
        .post('/api/v1/subscription/webhook')
        .set('stripe-signature', sigHeader)
        .set('Content-Type', 'application/json')
        .send(rawBody);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.received, true);

      // Verify Company was upgraded
      const upgradedCo = await Company.findById(coA._id);
      assert.strictEqual(upgradedCo.plan, 'professional');
      assert.strictEqual(upgradedCo.subscriptionStatus, 'active');
      assert.strictEqual(upgradedCo.stripeCustomerId, 'cus_test_' + s);

      // Verify SubscriptionCheckout status was updated
      const updatedCheckout = await SubscriptionCheckout.findOne({ sessionId: 'cs_test_' + s });
      assert.strictEqual(updatedCheckout.status, 'succeeded');
      assert.strictEqual(updatedCheckout.webhookEventId, 'evt_test_' + s);

      // Verify ActivityLog record
      const log = await ActivityLog.findOne({ action: 'SUBSCRIPTION_UPGRADE', company: coA._id });
      assert.ok(log, 'ActivityLog entry must be recorded for subscription upgrade');
      ok('T10: Stripe webhook signature verifies successfully and activates upgraded plan in database');
    } catch (e) { fail('T10: Webhook upgrade processing', e); }

    try {
      // Re-sending the identical webhook event must be idempotent
      const eventPayload = {
        id: 'evt_test_' + s, // Same event ID
        object: 'event',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_' + s,
            client_reference_id: coA._id.toString(),
            metadata: { targetPlan: 'professional' }
          }
        }
      };

      const rawBody = JSON.stringify(eventPayload);
      const timestamp = Math.floor(Date.now() / 1000);
      const computedSig = crypto
        .createHmac('sha256', testWebhookSecret)
        .update(`${timestamp}.${rawBody}`)
        .digest('hex');

      const res = await request(app)
        .post('/api/v1/subscription/webhook')
        .set('stripe-signature', `t=${timestamp},v1=${computedSig}`)
        .set('Content-Type', 'application/json')
        .send(rawBody);

      assert.strictEqual(res.status, 200);
      assert.match(res.body.message, /already processed/i);
      ok('T11: Duplicate webhook event is idempotently ignored without re-executing updates');
    } catch (e) { fail('T11: Webhook duplicate idempotency', e); }

    // -----------------------------------------------------------------
    // 6. RETURNS REFUND WORKFLOW & PAYMENT PROVIDER INTEGRATION
    // -----------------------------------------------------------------
    const returnOrder = await Return.create({
      returnId: 'RET-' + s.slice(-6),
      order: 'ORD-' + s.slice(-5),
      customer: 'Acme Corp',
      warehouse: 'WHA1',
      amount: 150.00,
      refundedAmount: 0,
      status: 'received',
      company: coA._id
    });

    try {
      // Refund when provider is unconfigured returns 503
      delete process.env.STRIPE_SECRET_KEY;

      const res = await request(app)
        .post(`/api/v1/returns/${returnOrder._id}/refund`)
        .set('Cookie', hA.cookies)
        .set('X-CSRF-Token', hA.csrf)
        .send({ amount: 50.00 });

      assert.strictEqual(res.status, 503);
      assert.strictEqual(res.body.code, 'PAYMENT_PROVIDER_NOT_CONFIGURED');

      // Verify return status was NOT altered to 'refunded'
      const unaltered = await Return.findById(returnOrder._id);
      assert.strictEqual(unaltered.status, 'received');
      assert.strictEqual(unaltered.refundedAmount, 0);
      ok('T12: POST /api/v1/returns/:id/refund returns 503 and refuses to fake refund when provider is unconfigured');
    } catch (e) { fail('T12: Refund provider unconfigured', e); }

    try {
      // Mock provider configured, but return missing stripePaymentIntentId returns 422
      process.env.STRIPE_SECRET_KEY = 'sk_test_mock_secret_' + s;

      const res = await request(app)
        .post(`/api/v1/returns/${returnOrder._id}/refund`)
        .set('Cookie', hA.cookies)
        .set('X-CSRF-Token', hA.csrf)
        .send({ amount: 50.00 });

      assert.strictEqual(res.status, 422);
      assert.strictEqual(res.body.code, 'MISSING_PAYMENT_INTENT');
      ok('T13: Refund returns 422 MISSING_PAYMENT_INTENT when return lacks original transaction reference');
    } catch (e) { fail('T13: Missing payment intent check', e); }

    try {
      // Role permission check: warehouse_staff should be blocked (403)
      const res = await request(app)
        .post(`/api/v1/returns/${returnOrder._id}/refund`)
        .set('Cookie', hStaff.cookies)
        .set('X-CSRF-Token', hStaff.csrf)
        .send({ amount: 50.00 });

      assert.strictEqual(res.status, 403);
      ok('T14: Non-ops / warehouse_staff role is forbidden from issuing refunds (403)');
    } catch (e) { fail('T14: Staff role forbidden from refund', e); }

    try {
      // Cross-tenant protection: Tenant B cannot refund Tenant A's return
      const res = await request(app)
        .post(`/api/v1/returns/${returnOrder._id}/refund`)
        .set('Cookie', hB.cookies)
        .set('X-CSRF-Token', hB.csrf)
        .send({ amount: 50.00 });

      assert.strictEqual(res.status, 404);
      ok('T15: Cross-tenant refund attempt correctly returns 404 Not Found');
    } catch (e) { fail('T15: Cross-tenant refund protection', e); }

    try {
      // Over-refund protection: Attach payment intent ID, then attempt refund > amount
      returnOrder.stripePaymentIntentId = 'pi_test_' + s;
      await returnOrder.save();

      const res = await request(app)
        .post(`/api/v1/returns/${returnOrder._id}/refund`)
        .set('Cookie', hA.cookies)
        .set('X-CSRF-Token', hA.csrf)
        .send({ amount: 200.00 }); // Exceeds balance of 150.00

      assert.strictEqual(res.status, 400);
      assert.match(res.body.message, /exceeds remaining refundable balance/i);
      ok('T16: Refund amount exceeding return total is rejected with 400 Bad Request');
    } catch (e) { fail('T16: Over-refund protection', e); }

    try {
      // Negative / zero refund amount rejected
      const res = await request(app)
        .post(`/api/v1/returns/${returnOrder._id}/refund`)
        .set('Cookie', hA.cookies)
        .set('X-CSRF-Token', hA.csrf)
        .send({ amount: -10.00 });

      assert.strictEqual(res.status, 400);
      assert.match(res.body.message, /greater than zero/i);
      ok('T17: Non-positive refund amount is rejected with 400 Bad Request');
    } catch (e) { fail('T17: Non-positive refund rejected', e); }

    try {
      // Mock createRefund in subscriptionPaymentService to test end-to-end DB updates
      const origCreateRefund = subscriptionPaymentService.createRefund;
      let mockCalled = false;

      subscriptionPaymentService.createRefund = async ({ paymentIntentId, amountCents, idempotencyKey }) => {
        mockCalled = true;
        return {
          id: 're_test_' + s,
          status: 'succeeded',
          amount: amountCents,
          currency: 'eur',
          payment_intent: paymentIntentId
        };
      };

      const refundKey = 'ref_idemp_' + s;
      const res = await request(app)
        .post(`/api/v1/returns/${returnOrder._id}/refund`)
        .set('Cookie', hA.cookies)
        .set('X-CSRF-Token', hA.csrf)
        .set('idempotency-key', refundKey)
        .send({ amount: 150.00, reason: 'Defective item' });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(mockCalled, true);
      assert.strictEqual(res.body.data.refund.amount, 150.00);
      assert.strictEqual(res.body.data.refund.status, 'succeeded');

      // Verify Return was updated to 'refunded'
      const refundedReturn = await Return.findById(returnOrder._id);
      assert.strictEqual(refundedReturn.status, 'refunded');
      assert.strictEqual(refundedReturn.refundedAmount, 150.00);

      // Verify ReturnRefund record created
      const refundRecord = await ReturnRefund.findOne({ refundId: 're_test_' + s });
      assert.ok(refundRecord, 'ReturnRefund record must exist in DB');
      assert.strictEqual(refundRecord.idempotencyKey, refundKey);

      // Verify ActivityLog
      const log = await ActivityLog.findOne({ action: 'RETURN_REFUND', company: coA._id });
      assert.ok(log, 'ActivityLog must log RETURN_REFUND');

      // Test idempotency replay
      const replayRes = await request(app)
        .post(`/api/v1/returns/${returnOrder._id}/refund`)
        .set('Cookie', hA.cookies)
        .set('X-CSRF-Token', hA.csrf)
        .set('idempotency-key', refundKey)
        .send({ amount: 150.00 });

      assert.strictEqual(replayRes.status, 200);
      assert.match(replayRes.body.message, /idempotent replay/i);

      // Restore original method
      subscriptionPaymentService.createRefund = origCreateRefund;
      ok('T18: Successful real refund records ReturnRefund, updates Return status to refunded, and replays idempotently');
    } catch (e) { fail('T18: End-to-end refund workflow', e); }

    try {
      // Attempting refund on already fully refunded return is rejected
      const res = await request(app)
        .post(`/api/v1/returns/${returnOrder._id}/refund`)
        .set('Cookie', hA.cookies)
        .set('X-CSRF-Token', hA.csrf)
        .send({ amount: 10.00 });

      assert.strictEqual(res.status, 400);
      assert.match(res.body.message, /already been fully refunded/i);
      ok('T19: Refund on already fully refunded return is rejected (400)');
    } catch (e) { fail('T19: Already refunded rejection', e); }

  } finally {
    await teardownTestDatabase();
  }

  console.log(`\nREQ #4 TEST RESULTS: ${passed} PASSED, ${failed} FAILED\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test run error:', err);
  process.exit(1);
});
