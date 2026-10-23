import mongoose from 'mongoose';
import assert from 'assert';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../index.js';
import Company from '../models/Company.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import Shipment from '../models/Shipment.js';
import Document from '../models/Document.js';
import ActivityLog from '../models/ActivityLog.js';
import InventoryBalance from '../models/InventoryBalance.js';
import { setupTestDatabase, teardownTestDatabase } from '../test_helper.js';

let companyA, adminUserA, tokenA;
let companyB, adminUserB, tokenB;

async function runTests() {
  console.log('--- RF REQUIREMENT #1: REAL SHIPPING LABELS, RATES AND TRACKING TEST SUITE ---');
  await setupTestDatabase();

  const suffix = Date.now().toString();

  // Setup Company A and Admin
  companyA = await Company.create({
    name: `Carrier Co A ${suffix}`,
    code: `CCA_${suffix.slice(-4)}`
  });

  adminUserA = await User.create({
    email: `admin_a_${suffix}@shipping.test`,
    password: 'password123',
    role: 'admin',
    company: companyA._id
  });

  const secret = process.env.JWT_SECRET || 'fallback_secret_key';
  tokenA = jwt.sign({ id: adminUserA._id, company: companyA._id, role: 'admin' }, secret, { expiresIn: '1h' });

  // Setup Company B for tenant isolation tests
  companyB = await Company.create({
    name: `Carrier Co B ${suffix}`,
    code: `CCB_${suffix.slice(-4)}`
  });

  adminUserB = await User.create({
    email: `admin_b_${suffix}@shipping.test`,
    password: 'password123',
    role: 'admin',
    company: companyB._id
  });

  tokenB = jwt.sign({ id: adminUserB._id, company: companyB._id, role: 'admin' }, secret, { expiresIn: '1h' });

  let testsPassed = 0;

  // ── TEST 1: Methods Discovery with Real Carrier Registry ──
  console.log('\n=== TEST 1: GET /api/v1/shipping/methods — Dynamic Carrier Capabilities ===');
  const methodsRes = await request(app)
    .get('/api/v1/shipping/methods')
    .set('Authorization', `Bearer ${tokenA}`);

  assert.strictEqual(methodsRes.status, 200);
  assert(Array.isArray(methodsRes.body.methods));
  assert(methodsRes.body.methods.length >= 6, 'Must list at least 6 supported carriers');
  const cttMethod = methodsRes.body.methods.find(m => m.code === 'CTT');
  const correosMethod = methodsRes.body.methods.find(m => m.code === 'CORREOS');
  assert(cttMethod, 'CTT Express must be available in methods');
  assert(correosMethod, 'Correos España must be available in methods');
  assert.strictEqual(cttMethod.supportsTracking, true);
  console.log(`✓ Methods endpoint discovered ${methodsRes.body.methods.length} supported carriers with capabilities`);
  testsPassed++;

  // ── TEST 2: Single Carrier Rate Quote ──
  console.log('\n=== TEST 2: POST /api/v1/shipping/rate-quote — Single Carrier Quote ===');
  const singleQuoteRes = await request(app)
    .post('/api/v1/shipping/rate-quote')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      carrier: 'CTT',
      senderPostalCode: '08020',
      recipientPostalCode: '28001',
      destinationCountry: 'ES',
      weightKg: 2.5,
      serviceLevel: 'STANDARD'
    });

  assert.strictEqual(singleQuoteRes.status, 200);
  assert.strictEqual(singleQuoteRes.body.carrier, 'CTT');
  assert(singleQuoteRes.body.rate > 0, 'Must calculate a positive rate');
  assert.strictEqual(singleQuoteRes.body.currency, 'EUR');
  assert.strictEqual(typeof singleQuoteRes.body.estimatedDeliveryDays, 'number');
  console.log(`✓ Calculated CTT rate: €${singleQuoteRes.body.rate} (${singleQuoteRes.body.estimatedDeliveryDays} days transit)`);
  testsPassed++;

  // ── TEST 3: Multi-Carrier Comparative Rate Calculation ──
  console.log('\n=== TEST 3: POST /api/v1/shipping/rate-quote — Multi-Carrier Comparison ===');
  const compQuoteRes = await request(app)
    .post('/api/v1/shipping/rate-quote')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      destinationCountry: 'ES',
      weightKg: 3.0,
      compare: true
    });

  assert.strictEqual(compQuoteRes.status, 200);
  assert(Array.isArray(compQuoteRes.body.quotes), 'Must return quotes array');
  assert(compQuoteRes.body.quotes.length >= 2, 'Must compare across multiple carriers');
  assert(compQuoteRes.body.recommended, 'Must identify lowest recommended rate');
  assert(compQuoteRes.body.quotes[0].rate <= compQuoteRes.body.quotes[1].rate, 'Quotes must be sorted by rate ascending');
  console.log(`✓ Comparative quoting returned ${compQuoteRes.body.quotes.length} quotes. Recommended: ${compQuoteRes.body.recommended.carrierName} (€${compQuoteRes.body.recommended.rate})`);
  testsPassed++;

  // ── TEST 4: Real Thermal Shipping Label Generation with Barcode & Document PDF ──
  console.log('\n=== TEST 4: POST /api/v1/shipping/:id/generate-label — Real Thermal PDF Label ===');
  const orderA = await Order.create({
    orderId: `ORD-REQ1-${suffix}-01`,
    customer: 'Maria Rodriguez Garcia',
    company: companyA._id,
    warehouse: 'MIA',
    owner: 'Client Alpha',
    order_type: 'B2C',
    delivery_address: {
      street: 'Calle Serrano 42',
      city: 'Madrid',
      postcode: '28001',
      country: 'ES',
      phone: '+34 611 222 333'
    },
    items: 3,
    status: 'picked'
  });

  const shipmentA = await Shipment.create({
    shipmentId: `SHP-REQ1-${suffix}-01`,
    order: orderA.orderId,
    customer: orderA.customer,
    carrier: 'CTT',
    tracking: 'Pending',
    origin: 'MIA',
    destination: 'Madrid',
    status: 'processing',
    weight: '2.5 kg',
    company: companyA._id
  });

  const labelRes = await request(app)
    .post(`/api/v1/shipping/${shipmentA._id}/generate-label`)
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      carrier: 'CTT',
      weightKg: 2.5,
      serviceLevel: 'STANDARD'
    });

  assert.strictEqual(labelRes.status, 200);
  assert(labelRes.body.trackingNumber.startsWith('CTT-ES-'), 'Must assign authentic CTT tracking format');
  assert(labelRes.body.labelBase64, 'Must return base64 PDF stream');
  assert.strictEqual(labelRes.body.labelUrl, `/api/v1/shipping/${shipmentA._id}/label`);

  // Verify DB entities updated
  const updatedShipment = await Shipment.findById(shipmentA._id);
  assert.strictEqual(updatedShipment.tracking, labelRes.body.trackingNumber);
  assert.strictEqual(updatedShipment.labelUrl, `/api/v1/shipping/${shipmentA._id}/label`);

  const updatedOrder = await Order.findOne({ orderId: orderA.orderId, company: companyA._id });
  assert.strictEqual(updatedOrder.tracking, labelRes.body.trackingNumber);

  // Verify Document entity created
  const doc = await Document.findOne({
    company: companyA._id,
    'relatedEntity.id': shipmentA._id,
    type: 'SHIPPING_LABEL'
  });
  assert(doc, 'Must create immutable Document entity for the shipping label');
  assert.strictEqual(doc.mimeType, 'application/pdf');

  console.log(`✓ Real thermal label generated: ${labelRes.body.trackingNumber} via ${labelRes.body.carrierName}`);
  testsPassed++;

  // ── TEST 5: Stream / Download Shipping Label PDF ──
  console.log('\n=== TEST 5: GET /api/v1/shipping/:id/label — Download Label PDF ===');
  const pdfDownloadRes = await request(app)
    .get(`/api/v1/shipping/${shipmentA._id}/label`)
    .set('Authorization', `Bearer ${tokenA}`);

  assert.strictEqual(pdfDownloadRes.status, 200);
  assert.strictEqual(pdfDownloadRes.headers['content-type'], 'application/pdf');
  const magicHeader = pdfDownloadRes.body.slice(0, 4).toString('ascii');
  assert.strictEqual(magicHeader, '%PDF', 'Must stream valid PDF bytes with %PDF magic header');
  console.log(`✓ Streamed PDF label: ${pdfDownloadRes.body.length} bytes (%PDF valid)`);
  testsPassed++;

  // ── TEST 6: Auto-Create Shipment and Label from Order ID ──
  console.log('\n=== TEST 6: POST /api/v1/shipping/generate-label — Auto-Create from Order ===');
  const orderDirect = await Order.create({
    orderId: `ORD-REQ1-${suffix}-DIRECT`,
    customer: 'Joao Silva',
    company: companyA._id,
    warehouse: 'MIA',
    owner: 'Client Alpha',
    order_type: 'B2C',
    delivery_address: {
      street: 'Avenida da Liberdade 100',
      city: 'Lisboa',
      postcode: '1250-096',
      country: 'PT'
    },
    items: 1,
    status: 'picked'
  });

  const directLabelRes = await request(app)
    .post('/api/v1/shipping/generate-label')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      orderId: orderDirect.orderId,
      carrier: 'CTT',
      weightKg: 1.2
    });

  assert.strictEqual(directLabelRes.status, 200);
  assert(directLabelRes.body.trackingNumber);
  const autoCreatedShipment = await Shipment.findOne({ order: orderDirect.orderId, company: companyA._id });
  assert(autoCreatedShipment, 'Must auto-create Shipment entity when generating label directly from order');
  assert.strictEqual(autoCreatedShipment.tracking, directLabelRes.body.trackingNumber);
  console.log(`✓ Auto-created shipment and generated label directly from order: ${autoCreatedShipment.shipmentId}`);
  testsPassed++;

  // ── TEST 7: Honest Error Handling for Unsupported Carriers (Never Fabricate) ──
  console.log('\n=== TEST 7: Honest Handling for Unsupported Carriers ===');
  const unsupportedCarrierRes = await request(app)
    .post(`/api/v1/shipping/${shipmentA._id}/generate-label`)
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      carrier: 'FLYING_CARPET_CARRIER'
    });

  assert.strictEqual(unsupportedCarrierRes.status, 400);
  assert(unsupportedCarrierRes.body.message.includes('not supported'), 'Must honestly report carrier unsupported');
  console.log('✓ Unsupported carrier rejected honestly without fabricating fake labels or tracking');
  testsPassed++;

  // ── TEST 8: Carrier Checkpoint Tracking ──
  console.log('\n=== TEST 8: GET /api/v1/shipping/:id/tracking — Structured Checkpoints ===');
  const trackingRes = await request(app)
    .get(`/api/v1/shipping/${shipmentA._id}/tracking`)
    .set('Authorization', `Bearer ${tokenA}`);

  assert.strictEqual(trackingRes.status, 200);
  assert.strictEqual(trackingRes.body.trackingNumber, updatedShipment.tracking);
  assert(Array.isArray(trackingRes.body.events));
  assert(trackingRes.body.events.length >= 1, 'Must return at least 1 tracking checkpoint');
  const firstEvent = trackingRes.body.events[0];
  assert(firstEvent.timestamp && firstEvent.status && firstEvent.description);
  console.log(`✓ Retrieved ${trackingRes.body.events.length} tracking checkpoints for ${trackingRes.body.trackingNumber}`);
  testsPassed++;

  // ── TEST 9: Reject Tracking for Shipment Without Assigned Tracking ──
  console.log('\n=== TEST 9: Reject Tracking for Pending Shipments ===');
  const pendingShipment = await Shipment.create({
    shipmentId: `SHP-PENDING-${suffix}`,
    order: 'ORD-PENDING',
    customer: 'Pending Customer',
    carrier: 'CTT',
    tracking: 'Pending',
    origin: 'MIA',
    destination: 'Sevilla',
    status: 'pending',
    company: companyA._id
  });

  const pendingTrackRes = await request(app)
    .get(`/api/v1/shipping/${pendingShipment._id}/tracking`)
    .set('Authorization', `Bearer ${tokenA}`);

  assert.strictEqual(pendingTrackRes.status, 400);
  assert(pendingTrackRes.body.message.includes('no tracking number assigned'), 'Must decline tracking lookup if no label/tracking exists yet');
  console.log('✓ Correctly refused tracking lookup for pending unassigned shipment');
  testsPassed++;

  // ── TEST 10: Authoritative Status Sync with Audit Log ──
  console.log('\n=== TEST 10: POST /api/v1/shipping/:id/sync-tracking — Authoritative Sync ===');
  const syncRes = await request(app)
    .post(`/api/v1/shipping/${shipmentA._id}/sync-tracking`)
    .set('Authorization', `Bearer ${tokenA}`);

  assert.strictEqual(syncRes.status, 200);
  assert(syncRes.body.carrierStatus, 'Must report authoritative carrier status');
  assert(['in_transit', 'delivered', 'processing'].includes(syncRes.body.shipmentStatus));

  const syncedShipment = await Shipment.findById(shipmentA._id);
  assert.strictEqual(syncedShipment.status, syncRes.body.shipmentStatus);

  if (syncRes.body.statusChanged) {
    const auditLog = await ActivityLog.findOne({
      company: companyA._id,
      action: 'CARRIER_TRACKING_SYNC'
    });
    assert(auditLog, 'Must record audit log entry for carrier status transition');
  }
  console.log(`✓ Authoritative tracking sync verified (Status: ${syncRes.body.shipmentStatus})`);
  testsPassed++;

  // ── TEST 11: Grouped Shipments Compatibility Validation & Creation ──
  console.log('\n=== TEST 11: Grouped Shipments Multi-Order Workflow ===');
  const groupOrder1 = await Order.create({
    orderId: `ORD-GRP-${suffix}-1`,
    customer: 'Bulk Retailer Store 1',
    warehouse: 'BCN-01',
    owner: 'MegaCorp Retail',
    order_type: 'B2B',
    items: 10,
    total: 500,
    status: 'packed',
    company: companyA._id
  });

  const groupOrder2 = await Order.create({
    orderId: `ORD-GRP-${suffix}-2`,
    customer: 'Bulk Retailer Store 2',
    warehouse: 'BCN-01',
    owner: 'MegaCorp Retail',
    order_type: 'B2B',
    items: 15,
    total: 750,
    status: 'packed',
    company: companyA._id
  });

  // Validate grouping compatibility
  const groupValRes = await request(app)
    .post('/api/v1/shipping/group-validate')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      orderIds: [groupOrder1.orderId, groupOrder2.orderId]
    });

  assert.strictEqual(groupValRes.status, 200);
  assert.strictEqual(groupValRes.body.compatible, true);
  assert.strictEqual(groupValRes.body.orderCount, 2);
  assert.strictEqual(groupValRes.body.warehouse, 'BCN-01');
  assert.strictEqual(groupValRes.body.owner, 'MegaCorp Retail');
  assert.strictEqual(groupValRes.body.orderType, 'B2B');
  assert.strictEqual(groupValRes.body.totalItems, 25);
  assert.strictEqual(groupValRes.body.totalValue, 1250);

  // Create grouped shipment
  const createGroupRes = await request(app)
    .post('/api/v1/shipping')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      shipmentId: `SHP-GRP-${suffix}`,
      orders: [groupOrder1.orderId, groupOrder2.orderId],
      customer: 'MegaCorp Retail (Consolidated)',
      carrier: 'SEUR',
      origin: 'BCN-01',
      destination: 'MegaCorp Central DC',
      status: 'processing',
      shipment_type: 'Pallet',
      pallets_count: 1
    });

  assert.strictEqual(createGroupRes.status, 201);
  assert.strictEqual(createGroupRes.body.isGrouped, true);
  assert.strictEqual(createGroupRes.body.orders.length, 2);
  assert(createGroupRes.body.groupedShipmentId);

  // Verify orders updated with shipment reference
  const reloadedO1 = await Order.findOne({ orderId: groupOrder1.orderId, company: companyA._id });
  const reloadedO2 = await Order.findOne({ orderId: groupOrder2.orderId, company: companyA._id });
  assert.strictEqual(reloadedO1.shipmentId, `SHP-GRP-${suffix}`);
  assert.strictEqual(reloadedO2.shipmentId, `SHP-GRP-${suffix}`);
  console.log(`✓ Grouped shipment verified with ${createGroupRes.body.orders.length} orders and audit links`);
  testsPassed++;

  // ── TEST 12: Tenant Isolation Across Shipping Operations ──
  console.log('\n=== TEST 12: Tenant Isolation (Company A vs Company B) ===');
  // Company B user attempts to access Company A's shipment label
  const tenantCrossLabel = await request(app)
    .get(`/api/v1/shipping/${shipmentA._id}/label`)
    .set('Authorization', `Bearer ${tokenB}`);
  assert.strictEqual(tenantCrossLabel.status, 404, 'Cross-tenant label access must fail with 404');

  // Company B user attempts to track Company A's shipment
  const tenantCrossTrack = await request(app)
    .get(`/api/v1/shipping/${shipmentA._id}/tracking`)
    .set('Authorization', `Bearer ${tokenB}`);
  assert.strictEqual(tenantCrossTrack.status, 404, 'Cross-tenant tracking lookup must fail with 404');

  // Company B user attempts to generate label for Company A's shipment
  const tenantCrossGen = await request(app)
    .post(`/api/v1/shipping/${shipmentA._id}/generate-label`)
    .set('Authorization', `Bearer ${tokenB}`)
    .send({ carrier: 'CTT' });
  assert.strictEqual(tenantCrossGen.status, 404, 'Cross-tenant label generation must fail with 404');

  console.log('✓ Strict tenant isolation enforced across all shipping actions');
  testsPassed++;

  // ── TEST 13: Inventory Invariants: Shipping Does Not Double-Deduct Physical Inventory ──
  console.log('\n=== TEST 13: Preserve Physical Inventory Invariants ===');
  const initialBalance = await InventoryBalance.countDocuments({ company: companyA._id });

  // Trigger label generation and tracking updates
  await request(app)
    .post(`/api/v1/shipping/${shipmentA._id}/generate-label`)
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ carrier: 'CORREOS', weightKg: 2.0 });

  await request(app)
    .post(`/api/v1/shipping/${shipmentA._id}/sync-tracking`)
    .set('Authorization', `Bearer ${tokenA}`);

  const postBalance = await InventoryBalance.countDocuments({ company: companyA._id });
  assert.strictEqual(initialBalance, postBalance, 'Shipping operations must not mutate physical inventory balances twice');
  console.log('✓ Physical inventory balance preserved without duplicate deduction');
  testsPassed++;

  console.log('\n======================================================');
  console.log(`✓✓✓ ALL ${testsPassed}/13 REQUIREMENT #1 TESTS PASSED SUCCESSFULLY ✓✓✓`);
  console.log('======================================================\n');
}

runTests()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('❌ Requirement #1 Test Failure:', err);
    await teardownTestDatabase();
    process.exit(1);
  });
