import https from 'https';
import crypto from 'crypto';

/**
 * Subscription & Refund Payment Provider Service
 * Direct Stripe REST API integration via Node.js native https module (zero external dependencies).
 * Fully server-verified, idempotency-protected, sandbox-safe fallback when unconfigured.
 */

function isConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.trim() !== '');
}

/**
 * Serialize JavaScript objects to x-www-form-urlencoded for Stripe API,
 * handling nested keys (e.g. metadata[companyId], line_items[0][price_data][...])
 */
function serializeFormData(obj, prefix = '') {
  const parts = [];
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined || val === null) continue;
    const propName = prefix ? `${prefix}[${key}]` : key;
    if (typeof val === 'object' && !Array.isArray(val)) {
      parts.push(serializeFormData(val, propName));
    } else if (Array.isArray(val)) {
      val.forEach((item, index) => {
        if (typeof item === 'object') {
          parts.push(serializeFormData(item, `${propName}[${index}]`));
        } else {
          parts.push(`${encodeURIComponent(`${propName}[${index}]`)}=${encodeURIComponent(item)}`);
        }
      });
    } else {
      parts.push(`${encodeURIComponent(propName)}=${encodeURIComponent(val)}`);
    }
  }
  return parts.filter(Boolean).join('&');
}

/**
 * Execute HTTPS request to Stripe API
 */
function stripeRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    if (!isConfigured()) {
      const err = new Error('Payment provider is not configured. STRIPE_SECRET_KEY is missing.');
      err.code = 'PAYMENT_PROVIDER_NOT_CONFIGURED';
      return reject(err);
    }

    const postData = body ? (typeof body === 'string' ? body : serializeFormData(body)) : '';

    const options = {
      hostname: 'api.stripe.com',
      port: 443,
      path: path,
      method: method.toUpperCase(),
      headers: {
        'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY.trim()}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Elvis-WMS/1.0',
        ...headers
      },
      timeout: 15000
    };

    if (postData && (method === 'POST' || method === 'PUT')) {
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            const err = new Error(parsed.error?.message || `Stripe API error (${res.statusCode})`);
            err.statusCode = res.statusCode;
            err.stripeError = parsed.error;
            err.code = parsed.error?.code || 'STRIPE_API_ERROR';
            reject(err);
          }
        } catch (e) {
          const err = new Error(`Failed to parse Stripe response: ${data.slice(0, 200)}`);
          err.statusCode = res.statusCode;
          reject(err);
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      const err = new Error('Stripe API request timed out');
      err.code = 'STRIPE_TIMEOUT';
      reject(err);
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (postData && (method === 'POST' || method === 'PUT')) {
      req.write(postData);
    }
    req.end();
  });
}

/**
 * Create Stripe Checkout Session for plan subscription upgrade
 */
async function createCheckoutSession({
  companyId,
  companyEmail,
  companyName,
  planKey,
  planName,
  amountCents,
  currency = 'eur',
  successUrl,
  cancelUrl,
  stripePriceId = null,
  idempotencyKey = null
}) {
  if (!isConfigured()) {
    const err = new Error('Payment provider is not configured. STRIPE_SECRET_KEY is missing.');
    err.code = 'PAYMENT_PROVIDER_NOT_CONFIGURED';
    throw err;
  }

  const payload = {
    payment_method_types: ['card'],
    mode: 'subscription',
    client_reference_id: companyId.toString(),
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      companyId: companyId.toString(),
      companyName: companyName || '',
      targetPlan: planKey
    },
    subscription_data: {
      metadata: {
        companyId: companyId.toString(),
        targetPlan: planKey
      }
    }
  };

  if (companyEmail) {
    payload.customer_email = companyEmail;
  }

  if (stripePriceId) {
    payload.line_items = [
      {
        price: stripePriceId,
        quantity: 1
      }
    ];
  } else {
    // Dynamic recurring price definition if specific Price ID not created in Stripe dashboard
    payload.line_items = [
      {
        price_data: {
          currency: currency.toLowerCase(),
          product_data: {
            name: `ELVIS WMS - ${planName} Plan`,
            description: `Monthly subscription to ${planName} plan`
          },
          unit_amount: amountCents,
          recurring: {
            interval: 'month'
          }
        },
        quantity: 1
      }
    ];
  }

  const headers = {};
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }

  return await stripeRequest('POST', '/v1/checkout/sessions', payload, headers);
}

/**
 * Retrieve Checkout Session from Stripe
 */
async function retrieveCheckoutSession(sessionId) {
  if (!isConfigured()) {
    const err = new Error('Payment provider is not configured. STRIPE_SECRET_KEY is missing.');
    err.code = 'PAYMENT_PROVIDER_NOT_CONFIGURED';
    throw err;
  }
  return await stripeRequest('GET', `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`);
}

/**
 * Verify Stripe webhook signature manually with HMAC-SHA256
 */
function verifyWebhookSignature(rawBody, signatureHeader, secret, toleranceSeconds = 300) {
  if (!secret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
  }
  if (!signatureHeader) {
    throw new Error('Missing stripe-signature header');
  }

  // Header format: t=1614000000,v1=xxx,v0=yyy
  const parts = signatureHeader.split(',').reduce((acc, part) => {
    const [k, v] = part.split('=');
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});

  const timestamp = parts.t;
  const signature = parts.v1;

  if (!timestamp || !signature) {
    throw new Error('Invalid stripe-signature header format');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - parseInt(timestamp, 10)) > toleranceSeconds) {
    throw new Error('Stripe webhook signature timestamp outside tolerance window');
  }

  const payloadToSign = `${timestamp}.${rawBody}`;
  const computedSignature = crypto
    .createHmac('sha256', secret)
    .update(payloadToSign, 'utf8')
    .digest('hex');

  const sigBuf = Buffer.from(signature, 'utf8');
  const compBuf = Buffer.from(computedSignature, 'utf8');

  if (sigBuf.length !== compBuf.length || !crypto.timingSafeEqual(sigBuf, compBuf)) {
    throw new Error('Stripe webhook signature verification failed');
  }

  return JSON.parse(rawBody);
}

/**
 * Execute real refund via Stripe REST API
 */
async function createRefund({
  paymentIntentId,
  amountCents = null,
  reason = 'requested_by_customer',
  idempotencyKey = null,
  metadata = {}
}) {
  if (!isConfigured()) {
    const err = new Error('Payment provider is not configured. STRIPE_SECRET_KEY is missing.');
    err.code = 'PAYMENT_PROVIDER_NOT_CONFIGURED';
    throw err;
  }

  if (!paymentIntentId) {
    const err = new Error('Original paymentIntentId is required to issue a real refund');
    err.code = 'PAYMENT_INTENT_REQUIRED';
    throw err;
  }

  const payload = {
    payment_intent: paymentIntentId,
    reason: reason,
    metadata: metadata
  };

  if (amountCents && amountCents > 0) {
    payload.amount = Math.round(amountCents);
  }

  const headers = {};
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }

  return await stripeRequest('POST', '/v1/refunds', payload, headers);
}

export default {
  isConfigured,
  createCheckoutSession,
  retrieveCheckoutSession,
  verifyWebhookSignature,
  createRefund,
  serializeFormData
};
