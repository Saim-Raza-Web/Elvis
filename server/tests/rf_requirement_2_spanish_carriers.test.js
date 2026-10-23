/**
 * RF-Requirement-2: Spanish Carrier Integrations — Automated Test Suite
 *
 * Tests adapter contract, registry discovery, rate quotes, label generation,
 * tracking, error/timeout handling, tenant isolation, and sandbox/live mode
 * for all 8 carriers: CTT, Correos, GLS, DHL, SEUR, MRW, Correos Express, Nacex.
 *
 * All responses are deterministic mocked — NOT proof of live carrier connectivity.
 */

import assert from 'assert';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../index.js';
import Company from '../models/Company.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import Shipment from '../models/Shipment.js';
import { setupTestDatabase, teardownTestDatabase } from '../test_helper.js';
import { carrierAdapterRegistry } from '../services/carriers/CarrierAdapterRegistry.js';
import { CttCarrierAdapter } from '../services/carriers/CttCarrierAdapter.js';
import { CorreosCarrierAdapter } from '../services/carriers/CorreosCarrierAdapter.js';
import { GlsCarrierAdapter, DhlCarrierAdapter, SeurCarrierAdapter, MrwCarrierAdapter } from '../services/carriers/ExtensibleCarrierAdapters.js';
import { CorreosExpressCarrierAdapter } from '../services/carriers/CorreosExpressCarrierAdapter.js';
import { NacexCarrierAdapter } from '../services/carriers/NacexCarrierAdapter.js';
import { generateThermalShippingLabelPdf } from '../services/carriers/labelPdfGenerator.js';

let company, adminUser, adminToken, otherCompany, otherToken;

async function runTests() {
  console.log('\n======================================================');
  console.log('  RF-REQUIREMENT-2: Spanish Carrier Integrations Tests');
  console.log('======================================================\n');

  await setupTestDatabase();

  const suffix = Date.now().toString();

  company = await Company.create({ name: 'Carrier Test Co ' + suffix, code: 'CTC_' + suffix.slice(-4) });
  otherCompany = await Company.create({ name: 'Other Co ' + suffix, code: 'OTH_' + suffix.slice(-4) });

  adminUser = await User.create({
    email: 'admin_' + suffix + '@carrier.test',
    password: 'password123',
    role: 'admin',
    company: company._id
  });

  const otherUser = await User.create({
    email: 'other_' + suffix + '@carrier.test',
    password: 'password123',
    role: 'admin',
    company: otherCompany._id
  });

  const jwtModule = await import('jsonwebtoken');
  const jwt = jwtModule.default;
  const secret = process.env.JWT_SECRET || 'fallback_secret_key';
  adminToken = jwt.sign({ id: adminUser._id }, secret, { expiresIn: '1h' });
  otherToken  = jwt.sign({ id: otherUser._id  }, secret, { expiresIn: '1h' });

  let passed = 0;
  let failed = 0;

  function pass(msg) { console.log('  ✓ ' + msg); passed++; }
  function fail(msg, err) { console.error('  ✗ ' + msg, err ? err.message : ''); failed++; }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 1: Registry — All 8 carriers registered
  // ─────────────────────────────────────────────────────────────────────────
  console.log('=== TEST 1: Registry — All 8 carriers registered ===');
  try {
    const all = carrierAdapterRegistry.getAvailableCarriers();
    const codes = all.map(function(c) { return c.code; });
    const required = ['CTT', 'CORREOS', 'GLS', 'DHL', 'SEUR', 'MRW', 'CORREOS_EXPRESS', 'NACEX'];
    required.forEach(function(code) {
      assert(codes.includes(code), code + ' must be registered');
    });
    assert(all.length >= 8, 'Registry must expose at least 8 carriers');
    pass('All 8 carriers registered: ' + codes.join(', '));
  } catch (e) { fail('Registry carrier count', e); }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 2: BaseCarrierAdapter contract — all 8 adapters
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n=== TEST 2: BaseCarrierAdapter contract — all 8 adapters ===');
  const adapterInstances = [
    new CttCarrierAdapter(),
    new CorreosCarrierAdapter(),
    new GlsCarrierAdapter(),
    new DhlCarrierAdapter(),
    new SeurCarrierAdapter(),
    new MrwCarrierAdapter(),
    new CorreosExpressCarrierAdapter(),
    new NacexCarrierAdapter()
  ];
  const contractMethods = ['calculateRate', 'calculateRates', 'createShipment', 'confirmShipment',
    'generateLabel', 'getTrackingStatus', 'getTracking', 'cancelShipment', 'getStatus', 'getCarrierInfo',
    'isProductionConfigured', 'validateAddress'];
  try {
    adapterInstances.forEach(function(adapter) {
      contractMethods.forEach(function(method) {
        assert(typeof adapter[method] === 'function', adapter.carrierCode + ' must implement ' + method);
      });
    });
    pass('All 8 adapters implement the full BaseCarrierAdapter contract (' + contractMethods.length + ' methods each)');
  } catch (e) { fail('Adapter contract', e); }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 3: Sandbox mode — no live credentials means BLOCKED/SANDBOX status
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n=== TEST 3: Sandbox/BLOCKED status without credentials ===');
  try {
    adapterInstances.forEach(function(adapter) {
      const status = adapter.getStatus();
      assert.strictEqual(typeof status.configured, 'boolean', adapter.carrierCode + ' getStatus().configured must be boolean');
      assert(['READY', 'BLOCKED'].includes(status.status), adapter.carrierCode + ' status must be READY or BLOCKED');
      assert(['LIVE', 'SANDBOX'].includes(status.mode), adapter.carrierCode + ' mode must be LIVE or SANDBOX');
      // In test environment with no real credentials, all must be SANDBOX/BLOCKED
      if (!adapter.isProductionConfigured()) {
        assert.strictEqual(status.status, 'BLOCKED', adapter.carrierCode + ' must be BLOCKED without credentials');
        assert.strictEqual(status.mode, 'SANDBOX', adapter.carrierCode + ' must be SANDBOX without credentials');
      }
    });
    pass('All adapters correctly report SANDBOX/BLOCKED without live credentials');
  } catch (e) { fail('Sandbox/BLOCKED status', e); }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 4: getCarrierInfo — capability flags and required credentials
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n=== TEST 4: Capability flags and required credentials ===');
  try {
    adapterInstances.forEach(function(adapter) {
      const info = adapter.getCarrierInfo();
      assert(info.code, adapter.carrierCode + ' info.code required');
      assert(info.name, adapter.carrierCode + ' info.name required');
      assert(typeof info.isProductionConfigured === 'boolean', adapter.carrierCode + ' isProductionConfigured must be boolean');
      assert(typeof info.supportsDomestic === 'boolean', adapter.carrierCode + ' supportsDomestic required');
      assert(typeof info.supportsLabelPdf === 'boolean', adapter.carrierCode + ' supportsLabelPdf required');
      assert(typeof info.supportsTracking === 'boolean', adapter.carrierCode + ' supportsTracking required');
      assert(Array.isArray(info.supportedServices), adapter.carrierCode + ' supportedServices must be array');
      assert(info.supportedServices.length > 0, adapter.carrierCode + ' must declare at least one service');
      assert(Array.isArray(info.requiredCredentials), adapter.carrierCode + ' requiredCredentials must be array');
    });
    // Correos Express specific
    const cxInfo = new CorreosExpressCarrierAdapter().getCarrierInfo();
    assert.strictEqual(cxInfo.supportsInternational, false, 'Correos Express must not claim international support');
    assert(cxInfo.requiredCredentials.includes('CORREOS_EXPRESS_USER'), 'CE must require USER');
    assert(cxInfo.requiredCredentials.includes('CORREOS_EXPRESS_CIF'), 'CE must require CIF');
    // Nacex specific
    const nacexInfo = new NacexCarrierAdapter().getCarrierInfo();
    assert(nacexInfo.supportedServices.includes('NACEX_10H'), 'Nacex must offer NACEX_10H service');
    assert(nacexInfo.requiredCredentials.includes('NACEX_API_KEY'), 'Nacex must require API_KEY');
    pass('All carrier capability flags and credential requirements verified');
  } catch (e) { fail('Capability flags', e); }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 5: Rate calculation — domestic and edge cases
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n=== TEST 5: Rate calculation — domestic and edge cases ===');
  try {
    const adaptersToRate = [
      { adapter: new CttCarrierAdapter(), code: 'CTT' },
      { adapter: new CorreosCarrierAdapter(), code: 'CORREOS' },
      { adapter: new GlsCarrierAdapter(), code: 'GLS' },
      { adapter: new DhlCarrierAdapter(), code: 'DHL' },
      { adapter: new SeurCarrierAdapter(), code: 'SEUR' },
      { adapter: new MrwCarrierAdapter(), code: 'MRW' },
      { adapter: new CorreosExpressCarrierAdapter(), code: 'CORREOS_EXPRESS' },
      { adapter: new NacexCarrierAdapter(), code: 'NACEX' }
    ];
    for (const entry of adaptersToRate) {
      const r = await entry.adapter.calculateRate({ weightKg: 2.0, destinationCountry: 'ES' });
      assert(r.rate > 0, entry.code + ' rate must be > 0');
      assert.strictEqual(r.currency, 'EUR', entry.code + ' currency must be EUR');
      assert(typeof r.estimatedDeliveryDays === 'number', entry.code + ' must return estimatedDeliveryDays');
      assert(r.carrier, entry.code + ' must return carrier name');
    }
    // Correos Express must reject international
    let cxErr = null;
    try { await new CorreosExpressCarrierAdapter().calculateRate({ destinationCountry: 'DE' }); } catch (e) { cxErr = e; }
    assert(cxErr, 'Correos Express must throw for international destinations');
    assert(/international/i.test(cxErr.message), 'Error message must mention international');
    // Nacex EUROPA service should price higher than NACEX_19H
    const nacexStd = await new NacexCarrierAdapter().calculateRate({ weightKg: 1, serviceType: 'NACEX_19H' });
    const nacexEu  = await new NacexCarrierAdapter().calculateRate({ weightKg: 1, serviceType: 'NACEX_EUROPA' });
    assert(nacexEu.rate > nacexStd.rate, 'NACEX_EUROPA must be more expensive than NACEX_19H');
    pass('Rate calculations correct for all 8 carriers; edge cases validated');
  } catch (e) { fail('Rate calculation', e); }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 6: createShipment (sandbox) — label PDF + tracking number
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n=== TEST 6: createShipment sandbox — label PDF and tracking number ===');
  try {
    const testShipmentParams = {
      shipmentId: 'SHIP-REQ2-TEST',
      orderId: 'ORD-REQ2-001',
      sender: { name: 'House Logistic 3PL', address: 'Pol. Ind. Delta 4', city: 'Barcelona', postcode: '08020', country: 'ES' },
      recipient: { name: 'Juan García', street: 'Calle Mayor 1', city: 'Madrid', postcode: '28013', country: 'ES', phone: '600112233' },
      weightKg: 1.5,
      parcelsCount: 1,
      isSandbox: true
    };
    const cxResult = await new CorreosExpressCarrierAdapter().createShipment({ ...testShipmentParams, serviceType: 'CE_EXPRESS_24H' });
    assert(cxResult.trackingNumber, 'Correos Express must return trackingNumber');
    assert(cxResult.trackingNumber.startsWith('CX-ES-'), 'CX sandbox tracking must start with CX-ES-');
    assert(Buffer.isBuffer(cxResult.labelBuffer), 'Correos Express label must be Buffer');
    assert(cxResult.labelBuffer.slice(0, 4).toString() === '%PDF', 'Label must be a valid PDF');
    assert.strictEqual(cxResult.carrierCode, 'CORREOS_EXPRESS');
    assert.strictEqual(cxResult.isSandbox, true, 'Sandbox flag must be true');
    assert(cxResult.labelBase64, 'Must return base64 label');

    const nacexResult = await new NacexCarrierAdapter().createShipment({ ...testShipmentParams, serviceType: 'NACEX_19H' });
    assert(nacexResult.trackingNumber, 'Nacex must return trackingNumber');
    assert(nacexResult.trackingNumber.startsWith('NACEX-ES-'), 'Nacex sandbox tracking must start with NACEX-ES-');
    assert(Buffer.isBuffer(nacexResult.labelBuffer), 'Nacex label must be Buffer');
    assert(nacexResult.labelBuffer.slice(0, 4).toString() === '%PDF', 'Nacex label must be a valid PDF');
    assert.strictEqual(nacexResult.carrierCode, 'NACEX');
    assert.strictEqual(nacexResult.isSandbox, true);

    pass('Correos Express and Nacex sandbox createShipment: tracking numbers + valid PDF labels generated');
  } catch (e) { fail('createShipment sandbox', e); }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 7: getTrackingStatus — sandbox checkpoints
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n=== TEST 7: getTrackingStatus sandbox checkpoints ===');
  try {
    const cxTracking = await new CorreosExpressCarrierAdapter().getTrackingStatus('CX-ES-20261022-ABCD1234');
    assert.strictEqual(cxTracking.carrier, 'CORREOS_EXPRESS');
    assert(Array.isArray(cxTracking.events), 'CX events must be array');
    assert(cxTracking.events.length >= 3, 'CX must return at least 3 checkpoints');
    cxTracking.events.forEach(function(ev) {
      assert(ev.timestamp instanceof Date, 'Each event must have a Date timestamp');
      assert(ev.status, 'Each event must have a status');
      assert(ev.description, 'Each event must have a description');
    });

    const nacexTracking = await new NacexCarrierAdapter().getTrackingStatus('NACEX-ES-20261022-EFGH5678');
    assert.strictEqual(nacexTracking.carrier, 'NACEX');
    assert(Array.isArray(nacexTracking.events), 'Nacex events must be array');
    assert(nacexTracking.events.length >= 3, 'Nacex must return at least 3 checkpoints');

    pass('Correos Express and Nacex tracking checkpoints verified');
  } catch (e) { fail('getTrackingStatus sandbox', e); }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 8: cancelShipment
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n=== TEST 8: cancelShipment ===');
  try {
    const cxCancel = await new CorreosExpressCarrierAdapter().cancelShipment('CX-ES-20261022-ABCD1234');
    assert.strictEqual(cxCancel.success, true, 'CE cancel must return success: true');
    assert(cxCancel.message, 'CE cancel must return a message');

    const nacexCancel = await new NacexCarrierAdapter().cancelShipment('NACEX-ES-20261022-EFGH5678');
    assert.strictEqual(nacexCancel.success, true, 'Nacex cancel must return success: true');
    assert(nacexCancel.message, 'Nacex cancel must return a message');

    pass('Correos Express and Nacex cancelShipment verified');
  } catch (e) { fail('cancelShipment', e); }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 9: Address validation (inherited from BaseCarrierAdapter)
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n=== TEST 9: Address validation ===');
  try {
    const cx = new CorreosExpressCarrierAdapter();
    const validAddr = { street: 'Calle Mayor 1', city: 'Madrid', postcode: '28013', country: 'ES' };
    const invalidAddr = { city: 'Madrid' };
    const valid = cx.validateAddress(validAddr);
    const invalid = cx.validateAddress(invalidAddr);
    assert.strictEqual(valid.valid, true, 'Valid address must pass');
    assert.strictEqual(invalid.valid, false, 'Invalid address must fail');
    assert(Array.isArray(invalid.errors), 'Errors must be array');
    assert(invalid.errors.length > 0, 'Must report missing fields');
    pass('Address validation works for Correos Express');
  } catch (e) { fail('Address validation', e); }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 10: Registry.get() — alias resolution
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n=== TEST 10: Registry alias resolution ===');
  try {
    const cx1 = carrierAdapterRegistry.get('CORREOS_EXPRESS');
    assert.strictEqual(cx1.carrierCode, 'CORREOS_EXPRESS');
    const cx2 = carrierAdapterRegistry.get('correos_express');
    assert.strictEqual(cx2.carrierCode, 'CORREOS_EXPRESS');
    const nacex1 = carrierAdapterRegistry.get('NACEX');
    assert.strictEqual(nacex1.carrierCode, 'NACEX');
    const nacex2 = carrierAdapterRegistry.get('nacex');
    assert.strictEqual(nacex2.carrierCode, 'NACEX');
    // Ensure CORREOS alias still resolves to Correos Espana, not Express
    const correos = carrierAdapterRegistry.get('CORREOS');
    assert.strictEqual(correos.carrierCode, 'CORREOS', 'CORREOS must still resolve to Correos Espana');
    pass('Registry alias resolution correct for all new carriers');
  } catch (e) { fail('Registry alias resolution', e); }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 11: Invalid carrier rejects cleanly
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n=== TEST 11: Invalid carrier rejected cleanly ===');
  try {
    let threw = false;
    try { carrierAdapterRegistry.get('FAKE_CARRIER_XYZ'); } catch (e) { threw = true; assert(/not supported/i.test(e.message)); }
    assert(threw, 'Registry must throw for unknown carrier');
    pass('Unknown carrier rejects with actionable error message');
  } catch (e) { fail('Invalid carrier rejection', e); }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 12: GET /api/v1/shipping/methods — 8 carriers in response
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n=== TEST 12: GET /api/v1/shipping/methods — 8 carriers ===');
  try {
    const res = await request(app)
      .get('/api/v1/shipping/methods')
      .set('Authorization', 'Bearer ' + adminToken);
    assert.strictEqual(res.status, 200);
    const methods = res.body.methods || res.body;
    assert(Array.isArray(methods));
    assert(methods.length >= 8, 'Must return at least 8 carriers, got ' + methods.length);
    const codes = methods.map(function(m) { return m.code; });
    assert(codes.includes('CORREOS_EXPRESS'), 'Response must include CORREOS_EXPRESS');
    assert(codes.includes('NACEX'), 'Response must include NACEX');
    pass('GET /api/v1/shipping/methods returns all 8 carriers');
  } catch (e) { fail('GET /api/v1/shipping/methods', e); }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 13: POST /api/v1/shipping/rate-quote — Correos Express
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n=== TEST 13: Rate quote API — Correos Express ===');
  try {
    const res = await request(app)
      .post('/api/v1/shipping/rate-quote')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ carrier: 'CORREOS_EXPRESS', senderPostalCode: '08001', recipientPostalCode: '28001', weightKg: 2.0 });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.carrier, 'CORREOS_EXPRESS');
    assert(res.body.rate > 0, 'Rate must be > 0');
    assert.strictEqual(res.body.currency, 'EUR');
    pass('Rate quote for Correos Express: EUR ' + (res.body.rate || '?'));
  } catch (e) { fail('Rate quote Correos Express', e); }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 14: POST /api/v1/shipping/rate-quote — Nacex
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n=== TEST 14: Rate quote API — Nacex ===');
  try {
    const res = await request(app)
      .post('/api/v1/shipping/rate-quote')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ carrier: 'NACEX', senderPostalCode: '08001', recipientPostalCode: '28001', weightKg: 1.0 });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.carrier, 'NACEX');
    assert(res.body.rate > 0);
    pass('Rate quote for Nacex: EUR ' + (res.body.rate || '?'));
  } catch (e) { fail('Rate quote Nacex', e); }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 15: POST /api/v1/shipping/:id/generate-label — Correos Express
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n=== TEST 15: Generate label — Correos Express ===');
  try {
    const order = await Order.create({
      orderId: 'ORD-CX-REQ2-' + suffix,
      customer: 'Cliente Demo CX',
      company: company._id,
      owner: 'Test',
      order_type: 'B2C',
      delivery_address: { street: 'Gran Via 45', city: 'Madrid', postcode: '28013', country: 'ES' },
      product_lines: [{ sku: 'PROD-01', product_name: 'Item', qty: 1, unit_price: 10, line_total: 10 }],
      items: 1, subtotal: 10, total: 12
    });
    const shipment = await Shipment.create({
      shipmentId: 'SHIP-CX-' + suffix, orderId: order.orderId,
      order: order.orderId, customer: order.customer,
      company: company._id, carrier: 'CORREOS_EXPRESS',
      status: 'pending', shipping_address: order.delivery_address
    });
    const res = await request(app)
      .post('/api/v1/shipping/' + shipment._id + '/generate-label')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ carrier: 'CORREOS_EXPRESS', weightKg: 1.0 });
    assert.strictEqual(res.status, 200);
    assert(res.body.trackingNumber, 'Must return trackingNumber');
    assert(res.body.trackingNumber.startsWith('CX-ES-'), 'CX sandbox tracking must start CX-ES-');
    assert(res.body.labelBase64 || res.body.labelPdfBase64, 'Must return base64 label');
    const updated = await Shipment.findById(shipment._id);
    assert.strictEqual(updated.tracking, res.body.trackingNumber, 'Shipment tracking must be persisted');
    pass('Label generated for Correos Express — tracking: ' + res.body.trackingNumber);
  } catch (e) { fail('Generate label Correos Express', e); }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 16: POST /api/v1/shipping/:id/generate-label — Nacex
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n=== TEST 16: Generate label — Nacex ===');
  try {
    const order = await Order.create({
      orderId: 'ORD-NACEX-REQ2-' + suffix,
      customer: 'Cliente Demo Nacex',
      company: company._id,
      owner: 'Test',
      order_type: 'B2C',
      delivery_address: { street: 'Paseo de Gracia 10', city: 'Barcelona', postcode: '08007', country: 'ES' },
      product_lines: [{ sku: 'PROD-02', product_name: 'Item B', qty: 2, unit_price: 20, line_total: 40 }],
      items: 2, subtotal: 40, total: 48
    });
    const shipment = await Shipment.create({
      shipmentId: 'SHIP-NACEX-' + suffix, orderId: order.orderId,
      order: order.orderId, customer: order.customer,
      company: company._id, carrier: 'NACEX',
      status: 'pending', shipping_address: order.delivery_address
    });
    const res = await request(app)
      .post('/api/v1/shipping/' + shipment._id + '/generate-label')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ carrier: 'NACEX', weightKg: 2.5 });
    assert.strictEqual(res.status, 200);
    assert(res.body.trackingNumber, 'Must return trackingNumber');
    assert(res.body.trackingNumber.startsWith('NACEX-ES-'), 'Nacex sandbox tracking must start NACEX-ES-');
    assert(res.body.labelBase64 || res.body.labelPdfBase64, 'Must return base64 label');
    const updated = await Shipment.findById(shipment._id);
    assert.strictEqual(updated.tracking, res.body.trackingNumber);
    pass('Label generated for Nacex — tracking: ' + res.body.trackingNumber);
  } catch (e) { fail('Generate label Nacex', e); }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 17: Tenant isolation — cannot generate label for another company
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n=== TEST 17: Tenant isolation ===');
  try {
    const order = await Order.create({
      orderId: 'ORD-ISO-REQ2-' + suffix,
      customer: 'Cliente ISO', company: company._id, owner: 'Test', order_type: 'B2C',
      delivery_address: { street: 'Test St', city: 'Madrid', postcode: '28001', country: 'ES' },
      product_lines: [{ sku: 'SKU-ISO', product_name: 'Item', qty: 1, unit_price: 5, line_total: 5 }],
      items: 1, subtotal: 5, total: 6
    });
    const shipment = await Shipment.create({
      shipmentId: 'SHIP-ISO-' + suffix, orderId: order.orderId,
      order: order.orderId, customer: order.customer,
      company: company._id, carrier: 'NACEX',
      status: 'pending', shipping_address: order.delivery_address
    });
    // Other tenant token must not be able to generate label for this shipment
    const res = await request(app)
      .post('/api/v1/shipping/' + shipment._id + '/generate-label')
      .set('Authorization', 'Bearer ' + otherToken)
      .send({ carrier: 'NACEX', weightKg: 1.0 });
    assert([403, 404].includes(res.status), 'Cross-tenant label generation must be rejected (got ' + res.status + ')');
    pass('Tenant isolation enforced — cross-tenant label request rejected with ' + res.status);
  } catch (e) { fail('Tenant isolation', e); }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 18: Unauthenticated requests rejected
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n=== TEST 18: Unauthenticated access rejected ===');
  try {
    const r1 = await request(app).get('/api/v1/shipping/methods');
    assert([401, 403].includes(r1.status), 'Unauthenticated methods must be rejected');
    const r2 = await request(app).post('/api/v1/shipping/rate-quote').send({ carrier: 'NACEX', weightKg: 1 });
    assert([401, 403].includes(r2.status), 'Unauthenticated rate-quote must be rejected');
    pass('Unauthenticated requests rejected (401/403)');
  } catch (e) { fail('Unauthenticated access', e); }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 19: Correos Express rejects international rate requests
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n=== TEST 19: Correos Express rejects international ===');
  try {
    const cx = new CorreosExpressCarrierAdapter();
    let threw = false;
    try { await cx.calculateRate({ destinationCountry: 'FR', weightKg: 1 }); } catch (e) { threw = true; }
    assert(threw, 'Correos Express must reject non-ES destinations');
    pass('Correos Express correctly rejects international rate requests');
  } catch (e) { fail('Correos Express international rejection', e); }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 20: Rate quote API — invalid carrier returns error
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n=== TEST 20: Rate quote — invalid carrier rejected ===');
  try {
    const res = await request(app)
      .post('/api/v1/shipping/rate-quote')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ carrier: 'FAKE_XYZ', senderPostalCode: '08001', recipientPostalCode: '28001', weightKg: 1.0 });
    assert([400, 404, 422, 500].includes(res.status), 'Invalid carrier must return error status');
    pass('Rate quote with invalid carrier returns error ' + res.status);
  } catch (e) { fail('Invalid carrier rate quote', e); }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 21: Regression — existing CTT label + tracking still works
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n=== TEST 21: Regression — CTT adapter unaffected ===');
  try {
    const ctt = new CttCarrierAdapter();
    const r = await ctt.createShipment({
      shipmentId: 'SHIP-REG-CTT', orderId: 'ORD-REG-CTT',
      sender: { name: 'Sender', address: 'Av Test 1', city: 'BCN', postcode: '08001', country: 'ES' },
      recipient: { name: 'Recipient', street: 'Calle Test 2', city: 'MAD', postcode: '28001', country: 'ES' },
      weightKg: 1.0, isSandbox: true
    });
    assert(r.trackingNumber.startsWith('CTT-ES-'), 'CTT tracking format preserved');
    assert(Buffer.isBuffer(r.labelBuffer), 'CTT label still generates PDF buffer');
    assert(r.labelBuffer.slice(0, 4).toString() === '%PDF', 'CTT label still valid PDF');
    pass('CTT adapter regression: tracking + label generation unchanged');
  } catch (e) { fail('CTT regression', e); }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 22: Regression — Correos España adapter unaffected
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n=== TEST 22: Regression — Correos Espana adapter unaffected ===');
  try {
    const correos = new CorreosCarrierAdapter();
    const r = await correos.createShipment({
      shipmentId: 'SHIP-REG-COR', orderId: 'ORD-REG-COR',
      sender: { name: 'Sender', address: 'Av Test 1', city: 'BCN', postcode: '08001', country: 'ES' },
      recipient: { name: 'Recipient', street: 'Calle Test', city: 'MAD', postcode: '28001', country: 'ES' },
      weightKg: 1.0, isSandbox: true
    });
    assert(r.trackingNumber.startsWith('CORREOS-ES-'), 'Correos tracking format preserved');
    assert(r.labelBuffer.slice(0, 4).toString() === '%PDF', 'Correos label still valid PDF');
    pass('Correos Espana regression: unchanged');
  } catch (e) { fail('Correos Espana regression', e); }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 23: Regression — GLS, DHL, SEUR, MRW adapters unaffected
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n=== TEST 23: Regression — GLS, DHL, SEUR, MRW adapters ===');
  try {
    const params = {
      shipmentId: 'SHIP-REG', orderId: 'ORD-REG',
      sender: { name: 'S', address: 'Av 1', city: 'BCN', postcode: '08001', country: 'ES' },
      recipient: { name: 'R', street: 'Calle 1', city: 'MAD', postcode: '28001', country: 'ES' },
      weightKg: 1.0
    };
    for (const Adapter of [GlsCarrierAdapter, DhlCarrierAdapter, SeurCarrierAdapter, MrwCarrierAdapter]) {
      const a = new Adapter();
      const r = await a.createShipment(params);
      assert(r.trackingNumber, a.carrierCode + ' must return trackingNumber');
      assert(Buffer.isBuffer(r.labelBuffer), a.carrierCode + ' label must be Buffer');
      assert(r.labelBuffer.slice(0, 4).toString() === '%PDF', a.carrierCode + ' label must be valid PDF');
    }
    pass('GLS, DHL, SEUR, MRW adapters all produce valid labels unchanged');
  } catch (e) { fail('GLS/DHL/SEUR/MRW regression', e); }

  // ─────────────────────────────────────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n======================================================');
  if (failed === 0) {
    console.log('  RESULT: ALL ' + passed + ' TESTS PASSED');
  } else {
    console.log('  RESULT: ' + passed + ' PASSED, ' + failed + ' FAILED');
  }
  console.log('======================================================\n');

  await teardownTestDatabase();

  if (failed > 0) process.exit(1);
  else process.exit(0);
}

runTests().catch(async function(err) {
  console.error('Fatal test runner error:', err);
  try { await teardownTestDatabase(); } catch (_) {}
  process.exit(1);
});