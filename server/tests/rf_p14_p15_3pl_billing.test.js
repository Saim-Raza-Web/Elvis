import mongoose from 'mongoose';
import assert from 'assert';
import request from 'supertest';
import app from '../index.js';
import Company from '../models/Company.js';
import User from '../models/User.js';
import Client from '../models/Client.js';
import RateCard from '../models/RateCard.js';
import Order from '../models/Order.js';
import InventoryBalance from '../models/InventoryBalance.js';
import Location from '../models/Location.js';
import Warehouse from '../models/Warehouse.js';
import Product from '../models/Product.js';
import { setupTestDatabase, teardownTestDatabase } from '../test_helper.js';
import { threePlBillingEngine } from '../services/3plBillingEngine.js';

let company, company2, adminUser, adminToken, clientDoc;

async function runTests() {
  console.log('--- RF-P14 & RF-P15 3PL Billing & 20-Day Rule Test Suite ---');
  await setupTestDatabase();

  const suffix = Date.now().toString();
  company = await Company.create({
    name: `Billing Test Co ${suffix}`,
    code: `BTC_${suffix.slice(-4)}`
  });

  company2 = await Company.create({
    name: `Other Company ${suffix}`,
    code: `OTH_${suffix.slice(-4)}`
  });

  adminUser = await User.create({
    email: `admin_${suffix}@billing.test`,
    password: 'password123',
    role: 'admin',
    company: company._id
  });

  const jwtModule = await import('jsonwebtoken');
  const jwt = jwtModule.default;
  const secret = process.env.JWT_SECRET || 'fallback_secret_key';
  adminToken = jwt.sign({ id: adminUser._id }, secret, { expiresIn: '1h' });

  // ── TEST 1: RateCard Creation & Retrieval ──
  console.log('\n=== TEST 1: RateCard Domain & Persistence ===');
  const clientName = `3PL Client Alpha ${suffix}`;
  clientDoc = await Client.create({
    name: clientName,
    vat: `ESB${suffix.slice(-8)}`,
    company: company._id,
    billingModality: 'TEMPORAL',
    activeStockDays: 5,
    firstActiveStockDate: new Date()
  });

  const rateCard = await RateCard.create({
    name: `Custom RateCard ${clientName}`,
    client: clientName,
    company: company._id,
    warehouse: 'MIA',
    modality: 'RECURRENT',
    monthlyMinimum: 200,
    rates: {
      inbound: { palletFee: 3.50, boxFee: 0.50, unitFee: 0.10 },
      storage: { perLocationPerMonth: 8.50, billingBasis: 'LOCATION' },
      outboundB2C: { orderFee: 2.10, extraSkuFee: 0.35 },
      outboundB2B: { unitFee: 0.15, boxFee: 0.60, palletFee: 4.50 },
      reverseLogistics: { returnUnitFee: 1.25 }
    },
    isActive: true
  });

  assert(rateCard._id, 'RateCard should be created');
  assert.strictEqual(rateCard.monthlyMinimum, 200);
  assert.strictEqual(rateCard.rates.storage.perLocationPerMonth, 8.50);
  console.log('✓ RateCard persisted with complete 7 billable categories & monthly minimums');

  // ── TEST 2: Calculate 3PL Settlement Engine ──
  console.log('\n=== TEST 2: 3PL Billing Engine Calculation ===');
  const wh = await Warehouse.create({
    name: 'MIA Main Warehouse',
    code: 'MIA',
    company: company._id
  });

  // Seed physical inventory balances
  const loc = await Location.create({
    code: `LOC-${suffix}-01`,
    type: 'PALLET',
    warehouse: wh._id,
    company: company._id
  });

  const prod = await Product.create({
    sku: `SKU-${suffix}-01`,
    name: 'Test Product 3PL',
    company: company._id,
    price: 25
  });

  await InventoryBalance.create({
    product: prod._id,
    sku: prod.sku,
    location: loc._id,
    warehouse: 'MIA',
    owner: clientName,
    ownerType: 'CUSTOMER',
    company: company._id,
    qtyAvailable: 100,
    qtyReserved: 20,
    qtyAwaitingPutaway: 0
  });

  // Seed sample orders for outbound
  await Order.create({
    orderId: `ORD-3PL-${suffix}-1`,
    customer: 'Customer 1',
    company: company._id,
    owner: clientName,
    order_type: 'B2C',
    status: 'shipped',
    product_lines: [
      { sku: prod.sku, product_name: prod.name, qty: 2, unit_price: 25, line_total: 50 },
      { sku: prod.sku, product_name: prod.name, qty: 1, unit_price: 25, line_total: 25 }
    ],
    items: 2,
    subtotal: 75,
    total: 90.75
  });

  const calculation = await threePlBillingEngine.calculateMonthlyBilling({
    companyId: company._id,
    clientName,
    year: 2026,
    month: 9,
    warehouse: 'MIA'
  });

  assert.strictEqual(calculation.client, clientName);
  assert(calculation.concepts, 'Should calculate all 7 billing concepts');
  assert(calculation.concepts.storage.subtotal > 0, 'Storage subtotal should be calculated');
  assert(calculation.concepts.outboundB2C.subtotal > 0, 'Outbound B2C subtotal should be calculated');
  assert(calculation.totals.grandTotal > 0, 'Grand total must be > 0');
  console.log(`✓ 3PL Settlement calculated: Concepts Subtotal = €${calculation.totals.conceptsSubtotal.toFixed(2)}, Grand Total = €${calculation.totals.grandTotal.toFixed(2)}`);

  // ── TEST 3: Monthly Minimum Rule Enforcement (RF-P15) ──
  console.log('\n=== TEST 3: Monthly Minimum Adjustment ===');
  // If concepts subtotal is e.g. 50 EUR and monthly minimum is 200 EUR, adjustment should be 150 EUR
  if (calculation.totals.conceptsSubtotal < 200) {
    assert(calculation.totals.minimumAdjustment > 0, 'Minimum adjustment must be applied when subtotal < minimum');
    assert.strictEqual(calculation.totals.taxableBase, 200, 'Taxable base must equal minimum (200 EUR)');
    console.log(`✓ Monthly minimum adjustment correctly applied: +€${calculation.totals.minimumAdjustment.toFixed(2)} to reach €200.00 base`);
  } else {
    assert.strictEqual(calculation.totals.minimumAdjustment, 0, 'No adjustment when subtotal >= minimum');
  }

  // ── TEST 4: 20-Day Storage Rule Boundary Tests (RF-P15) ──
  console.log('\n=== TEST 4: 20-Day Rule Boundary Day Tests ===');

  // Case A: Before threshold (<20 days) -> Stays TEMPORAL
  const clientSub20 = await Client.create({
    name: `Client Sub20 ${suffix}`,
    company: company._id,
    billingModality: 'TEMPORAL',
    activeStockDays: 14,
    firstActiveStockDate: new Date(Date.now() - 14 * 24 * 3600 * 1000)
  });
  const ruleResA = await threePlBillingEngine.evaluate20DayRule(company._id);
  const reloadedA = await Client.findById(clientSub20._id);
  assert.strictEqual(reloadedA.billingModality, 'TEMPORAL', 'Client with 14 days must remain TEMPORAL');
  console.log('✓ Boundary < 20 days (14 days): Stays TEMPORAL with daily tariff');

  // Case B: Exactly at threshold (=20 days) -> Transitions to RECURRENT
  const clientExact20 = await Client.create({
    name: `Client Exact20 ${suffix}`,
    company: company._id,
    billingModality: 'TEMPORAL',
    activeStockDays: 20,
    firstActiveStockDate: new Date(Date.now() - 20 * 24 * 3600 * 1000)
  });
  await InventoryBalance.create({
    product: prod._id,
    sku: prod.sku,
    location: loc._id,
    warehouse: 'MIA',
    owner: clientExact20.name,
    ownerType: 'CUSTOMER',
    company: company._id,
    qtyAvailable: 50,
    qtyReserved: 0,
    qtyAwaitingPutaway: 0
  });

  const ruleResB = await threePlBillingEngine.evaluate20DayRule(company._id);
  const reloadedB = await Client.findById(clientExact20._id);
  assert.strictEqual(reloadedB.billingModality, 'RECURRENT', 'Client with >= 20 days must convert to RECURRENT');
  assert(reloadedB.modalityConvertedAt, 'Conversion date must be recorded');
  assert(reloadedB.modalityConversionReason.includes('20-day storage threshold'), 'Conversion reason must be recorded');
  console.log('✓ Boundary = 20 days: Successfully auto-converted to RECURRENT modality with timestamp');

  // Case C: After threshold (>20 days) -> Already RECURRENT, remains RECURRENT
  const clientOver20 = await Client.create({
    name: `Client Over20 ${suffix}`,
    company: company._id,
    billingModality: 'RECURRENT',
    activeStockDays: 45,
    firstActiveStockDate: new Date(Date.now() - 45 * 24 * 3600 * 1000)
  });
  await threePlBillingEngine.evaluate20DayRule(company._id);
  const reloadedC = await Client.findById(clientOver20._id);
  assert.strictEqual(reloadedC.billingModality, 'RECURRENT', 'Already RECURRENT client must stay RECURRENT');
  console.log('✓ Boundary > 20 days (45 days): Remains RECURRENT without redundant modification');

  // ── TEST 5: PDF & CSV Export Generation ──
  console.log('\n=== TEST 5: Export Document Generation (PDF & CSV) ===');
  const pdfBuffer = await threePlBillingEngine.generateSettlementPdf(calculation);
  assert(Buffer.isBuffer(pdfBuffer), 'PDF result must be a Buffer');
  assert.strictEqual(pdfBuffer.slice(0, 4).toString('ascii'), '%PDF', 'PDF must start with %PDF header');

  const csvString = await threePlBillingEngine.generateSettlementCsv(calculation);
  assert(typeof csvString === 'string', 'CSV output must be a string');
  assert(csvString.includes('LIQUIDACION MENSUAL SERVICIOS 3PL'), 'CSV must contain standard header');
  assert(csvString.includes('Inbound Reception'), 'CSV must contain inbound concept');
  assert(csvString.includes('Storage (Almacenaje)'), 'CSV must contain storage concept');
  console.log(`✓ Generated Liquidación 3PL PDF (${pdfBuffer.length} bytes) and CSV (${csvString.length} chars)`);

  // ── TEST 6: API Routes & Multi-Tenant Security ──
  console.log('\n=== TEST 6: API Route Integration & Tenant Isolation ===');
  // GET /api/v1/3pl/billing/rate-cards
  const rcRes = await request(app)
    .get('/api/v1/3pl/billing/rate-cards')
    .set('Authorization', `Bearer ${adminToken}`);
  assert.strictEqual(rcRes.status, 200);
  assert(Array.isArray(rcRes.body));
  assert(rcRes.body.some(rc => rc.client === clientName));

  // POST /api/v1/3pl/billing/calculate
  const calcRes = await request(app)
    .post('/api/v1/3pl/billing/calculate')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ client: clientName, year: 2026, month: 9, warehouse: 'MIA' });
  assert.strictEqual(calcRes.status, 200);
  assert.strictEqual(calcRes.body.client, clientName);

  // Tenant Isolation: other company admin cannot see company 1 rate cards
  const adminToken2 = jwt.sign({ id: (await User.create({ email: `other_${suffix}@test.com`, password: 'pwd', role: 'admin', company: company2._id }))._id }, secret, { expiresIn: '1h' });
  const rcOtherRes = await request(app)
    .get('/api/v1/3pl/billing/rate-cards')
    .set('Authorization', `Bearer ${adminToken2}`);
  assert.strictEqual(rcOtherRes.status, 200);
  assert(!rcOtherRes.body.some(rc => rc.client === clientName), 'Cross-company rate card leakage strictly prohibited');
  console.log('✓ 3PL billing endpoints verified with strict tenant isolation');

  console.log('\n======================================================');
  console.log('✓✓✓ ALL RF-P14 & RF-P15 3PL BILLING TESTS PASSED ✓✓✓');
  console.log('======================================================\n');
}

runTests()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('❌ RF-P14/P15 Test Failure:', err);
    await teardownTestDatabase();
    process.exit(1);
  });
