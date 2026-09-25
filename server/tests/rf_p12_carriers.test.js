import mongoose from 'mongoose';
import assert from 'assert';
import request from 'supertest';
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
import { generateThermalShippingLabelPdf } from '../services/carriers/labelPdfGenerator.js';

let company, adminUser, adminToken;

async function runTests() {
  console.log('--- RF-P12 Carrier Integrations Architecture Test Suite ---');
  await setupTestDatabase();

  const suffix = Date.now().toString();
  company = await Company.create({
    name: `Carrier Test Co ${suffix}`,
    code: `CTC_${suffix.slice(-4)}`
  });

  adminUser = await User.create({
    email: `admin_${suffix}@carrier.test`,
    password: 'password123',
    role: 'admin',
    company: company._id
  });

  const jwtModule = await import('jsonwebtoken');
  const jwt = jwtModule.default;
  const secret = process.env.JWT_SECRET || 'fallback_secret_key';
  adminToken = jwt.sign({ id: adminUser._id }, secret, { expiresIn: '1h' });

  // ── TEST 1: Adapter Registry & Supported Carriers ──
  console.log('\n=== TEST 1: Carrier Adapter Registry & Architecture ===');
  const availableCarriers = carrierAdapterRegistry.getAvailableCarriers();
  assert(availableCarriers.length >= 6, 'Should support at least 6 carriers (CTT, Correos, GLS, DHL, SEUR, MRW)');

  const cttCode = availableCarriers.find(c => c.code === 'CTT');
  const correosCode = availableCarriers.find(c => c.code === 'CORREOS');
  assert(cttCode, 'CTT adapter must be registered');
  assert(correosCode, 'Correos adapter must be registered');
  assert(availableCarriers.find(c => c.code === 'GLS'), 'GLS adapter must be registered');
  assert(availableCarriers.find(c => c.code === 'DHL'), 'DHL adapter must be registered');
  assert(availableCarriers.find(c => c.code === 'SEUR'), 'SEUR adapter must be registered');
  assert(availableCarriers.find(c => c.code === 'MRW'), 'MRW adapter must be registered');
  console.log('✓ All 6 carrier adapters registered in CarrierAdapterRegistry');

  // ── TEST 2: Common Carrier Interface Adherence ──
  console.log('\n=== TEST 2: Common Carrier Interface Adherence ===');
  const cttAdapter = new CttCarrierAdapter();
  const correosAdapter = new CorreosCarrierAdapter();

  const requiredMethods = ['confirmShipment', 'generateLabel', 'getTracking', 'calculateRates', 'cancelShipment', 'getStatus'];
  for (const method of requiredMethods) {
    assert(typeof cttAdapter[method] === 'function', `CTT must implement ${method}`);
    assert(typeof correosAdapter[method] === 'function', `Correos must implement ${method}`);
  }
  console.log('✓ CTT and Correos strictly adhere to BaseCarrierAdapter interface');

  // ── TEST 3: Hermetic Status Reporting (BLOCKED at external boundary without credentials) ──
  console.log('\n=== TEST 3: External Credential Boundary Check ===');
  const cttStatus = cttAdapter.getStatus();
  assert.strictEqual(cttStatus.code, 'CTT');
  assert.strictEqual(typeof cttStatus.configured, 'boolean');
  if (!process.env.CTT_API_KEY) {
    assert.strictEqual(cttStatus.status, 'BLOCKED', 'CTT should be reported as BLOCKED without live credentials');
    assert.strictEqual(cttStatus.mode, 'SANDBOX', 'Should fallback to hermetic sandbox');
  }
  console.log('✓ External credential boundary safely reported as BLOCKED without fake credentials');

  // ── TEST 4: Hermetic Label Generation (4x6 Thermal PDF with Barcode) ──
  console.log('\n=== TEST 4: Thermal Label PDF Generation ===');
  const pdfBuffer = await generateThermalShippingLabelPdf({
    carrierName: 'CTT Express',
    trackingNumber: 'CTT-ES-123456789',
    orderNumber: 'ORD-999001',
    serviceType: 'EXPRESS 24H',
    shipper: { name: 'House Logistic 3PL', address: 'Pol. Ind. Delta 4', city: 'Barcelona', postalCode: '08020' },
    recipient: { name: 'Juan Perez', address: 'Calle Mayor 10', city: 'Madrid', postalCode: '28013', phone: '600112233' },
    weightKg: 2.5,
    packagesCount: 1
  });
  assert(Buffer.isBuffer(pdfBuffer), 'Label output must be a valid Buffer');
  assert(pdfBuffer.length > 500, 'Label buffer must contain valid PDF bytes');
  // Check PDF magic header %PDF
  const magic = pdfBuffer.slice(0, 4).toString('ascii');
  assert.strictEqual(magic, '%PDF', 'Buffer must start with %PDF header');
  console.log(`✓ Generated standard 4x6" thermal PDF shipping label (${pdfBuffer.length} bytes)`);

  // ── TEST 5: Rate Calculation & Quotes ──
  console.log('\n=== TEST 5: Carrier Rate Quotes ===');
  const cttQuote = await cttAdapter.calculateRates({
    senderPostalCode: '08020',
    recipientPostalCode: '28013',
    weightKg: 3.5
  });
  assert(cttQuote.rate > 0, 'CTT rate should be calculated');
  assert(cttQuote.currency === 'EUR', 'Currency should be EUR');

  const correosQuote = await correosAdapter.calculateRates({
    senderPostalCode: '08020',
    recipientPostalCode: '46001',
    weightKg: 1.2
  });
  assert(correosQuote.rate > 0, 'Correos rate should be calculated');
  console.log(`✓ Rate quotes calculated: CTT €${cttQuote.rate.toFixed(2)}, Correos €${correosQuote.rate.toFixed(2)}`);

  // ── TEST 6: Tracking Status & Event History ──
  console.log('\n=== TEST 6: Tracking Status & Event History ===');
  const trackingRes = await cttAdapter.getTracking('CTT-TEST-TRACK-99');
  assert.strictEqual(trackingRes.trackingNumber, 'CTT-TEST-TRACK-99');
  const checkpoints = trackingRes.events || trackingRes.history;
  assert(Array.isArray(checkpoints), 'Tracking checkpoints should be an array');
  assert(checkpoints.length >= 1, 'Should have at least 1 tracking checkpoint');
  console.log('✓ Tracking lookup returns structured event checkpoints');

  // ── TEST 7: API Endpoints Integration ──
  console.log('\n=== TEST 7: API Endpoints (GET /methods, POST /rate-quote) ===');
  // GET /api/v1/shipping/methods
  const methodsRes = await request(app)
    .get('/api/v1/shipping/methods')
    .set('Authorization', `Bearer ${adminToken}`);
  assert.strictEqual(methodsRes.status, 200);
  const methods = methodsRes.body.methods || methodsRes.body;
  assert(Array.isArray(methods));
  assert(methods.length >= 6);

  // POST /api/v1/shipping/rate-quote
  const quoteRes = await request(app)
    .post('/api/v1/shipping/rate-quote')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      carrier: 'CTT',
      senderPostalCode: '08001',
      recipientPostalCode: '28001',
      weightKg: 4.0
    });
  assert.strictEqual(quoteRes.status, 200);
  assert.strictEqual(quoteRes.body.carrier, 'CTT');
  assert(quoteRes.body.rate > 0);
  console.log('✓ Shipping methods and rate-quote endpoints respond successfully');

  // ── TEST 8: Live Shipment Label Generation Endpoint ──
  console.log('\n=== TEST 8: POST /api/v1/shipping/:id/generate-label ===');
  const order = await Order.create({
    orderId: `ORD-SHIP-${suffix}`,
    customer: 'Destinatario Demo',
    company: company._id,
    owner: 'Test Client',
    order_type: 'B2C',
    delivery_address: { street: 'Gran Via 45', city: 'Madrid', postcode: '28013', country: 'ES' },
    product_lines: [{ sku: 'PROD-01', product_name: 'Item A', qty: 2, unit_price: 15, line_total: 30 }],
    items: 2,
    subtotal: 30,
    total: 36.3
  });

  const shipment = await Shipment.create({
    shipmentId: `SHIP-${suffix}`,
    orderId: order.orderId,
    order: order.orderId,
    customer: order.customer,
    company: company._id,
    carrier: 'CTT',
    status: 'pending',
    shipping_address: order.delivery_address
  });

  const labelRes = await request(app)
    .post(`/api/v1/shipping/${shipment._id}/generate-label`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ carrier: 'CTT', weightKg: 1.5 });

  assert.strictEqual(labelRes.status, 200);
  assert(labelRes.body.trackingNumber, 'Should return generated tracking number');
  assert(labelRes.body.labelBase64 || labelRes.body.labelPdfBase64, 'Should return base64 label PDF stream');
  const updatedShipment = await Shipment.findById(shipment._id);
  assert.strictEqual(updatedShipment.tracking, labelRes.body.trackingNumber);
  console.log('✓ Label generated and shipment updated with tracking number');

  console.log('\n========================================');
  console.log('✓✓✓ ALL RF-P12 CARRIER TESTS PASSED ✓✓✓');
  console.log('========================================\n');
}

runTests()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('❌ RF-P12 Test Failure:', err);
    await teardownTestDatabase();
    process.exit(1);
  });
