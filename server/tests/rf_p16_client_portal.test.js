import mongoose from 'mongoose';
import assert from 'assert';
import request from 'supertest';
import app from '../index.js';
import Company from '../models/Company.js';
import User from '../models/User.js';
import Client from '../models/Client.js';
import Warehouse from '../models/Warehouse.js';
import Location from '../models/Location.js';
import Product from '../models/Product.js';
import InventoryBalance from '../models/InventoryBalance.js';
import Order from '../models/Order.js';
import ASN from '../models/ASN.js';
import { setupTestDatabase, teardownTestDatabase } from '../test_helper.js';

let company, warehouse, clientA, clientB, userClientA, tokenClientA, userClientB, tokenClientB, adminToken;

async function runTests() {
  console.log('--- RF-P16 3PL Client Portal Test Suite ---');
  await setupTestDatabase();

  const suffix = Date.now().toString();
  company = await Company.create({
    name: `Client Portal Co ${suffix}`,
    code: `CPC_${suffix.slice(-4)}`
  });

  warehouse = await Warehouse.create({
    name: 'MIA Main',
    code: 'MIA',
    company: company._id
  });

  // Client A
  clientA = await Client.create({
    name: `Client Alpha ${suffix}`,
    vat: `ESB${suffix.slice(-8)}`,
    company: company._id,
    warehouseAccess: ['MIA'],
    billingModality: 'RECURRENT',
    activeStockDays: 30
  });

  // Client B
  clientB = await Client.create({
    name: `Client Beta ${suffix}`,
    vat: `ESB9${suffix.slice(-7)}`,
    company: company._id,
    warehouseAccess: ['MIA'],
    billingModality: 'TEMPORAL',
    activeStockDays: 5
  });

  // Users
  userClientA = await User.create({
    email: `alpha_${suffix}@portal.test`,
    password: 'password123',
    role: 'client_3pl',
    company: company._id,
    clientId: clientA._id
  });

  userClientB = await User.create({
    email: `beta_${suffix}@portal.test`,
    password: 'password123',
    role: 'client_3pl',
    company: company._id,
    clientId: clientB._id
  });

  const adminUser = await User.create({
    email: `admin_${suffix}@portal.test`,
    password: 'password123',
    role: 'admin',
    company: company._id
  });

  const jwtModule = await import('jsonwebtoken');
  const jwt = jwtModule.default;
  const secret = process.env.JWT_SECRET || 'fallback_secret_key';
  tokenClientA = jwt.sign({ id: userClientA._id }, secret, { expiresIn: '1h' });
  tokenClientB = jwt.sign({ id: userClientB._id }, secret, { expiresIn: '1h' });
  adminToken = jwt.sign({ id: adminUser._id }, secret, { expiresIn: '1h' });

  // Seed inventory for Client A and Client B
  const loc = await Location.create({
    code: `LOC-PORTAL-${suffix}`,
    type: 'PALLET',
    warehouse: warehouse._id,
    company: company._id
  });

  const prodA = await Product.create({
    sku: `SKU-A-${suffix}`,
    name: 'Product Alpha',
    company: company._id,
    price: 20
  });

  const prodB = await Product.create({
    sku: `SKU-B-${suffix}`,
    name: 'Product Beta',
    company: company._id,
    price: 35
  });

  await InventoryBalance.create({
    product: prodA._id,
    sku: prodA.sku,
    location: loc._id,
    warehouse: 'MIA',
    owner: clientA.name,
    ownerType: 'CUSTOMER',
    company: company._id,
    qtyAvailable: 150,
    qtyReserved: 25,
    qtyAwaitingPutaway: 10
  });

  await InventoryBalance.create({
    product: prodB._id,
    sku: prodB.sku,
    location: loc._id,
    warehouse: 'MIA',
    owner: clientB.name,
    ownerType: 'CUSTOMER',
    company: company._id,
    qtyAvailable: 80,
    qtyReserved: 10,
    qtyAwaitingPutaway: 0
  });

  // ── TEST 1: GET /profile ──
  console.log('\n=== TEST 1: Client Profile Scoping ===');
  const profRes = await request(app)
    .get('/api/v1/client-portal/profile')
    .set('Authorization', `Bearer ${tokenClientA}`);

  assert.strictEqual(profRes.status, 200);
  assert.strictEqual(profRes.body.client.name, clientA.name);
  assert.strictEqual(profRes.body.client.billingModality, 'RECURRENT');
  assert.strictEqual(profRes.body.client.activeStockDays, 30);
  console.log('✓ Client A profile retrieved with authoritative scoping');

  // ── TEST 2: GET /inventory (Strict Cross-Client Isolation) ──
  console.log('\n=== TEST 2: Authoritative Inventory Scoping & Isolation ===');
  const invResA = await request(app)
    .get('/api/v1/client-portal/inventory')
    .set('Authorization', `Bearer ${tokenClientA}`);

  assert.strictEqual(invResA.status, 200);
  assert.strictEqual(invResA.body.client, clientA.name);
  assert.strictEqual(invResA.body.summary.totalAvailable, 150);
  assert.strictEqual(invResA.body.summary.totalReserved, 25);
  assert.strictEqual(invResA.body.summary.totalAwaiting, 10);
  assert(invResA.body.inventory.every(item => item.sku === prodA.sku), 'Client A must ONLY see Product A');

  // Verify Client B sees only their own inventory
  const invResB = await request(app)
    .get('/api/v1/client-portal/inventory')
    .set('Authorization', `Bearer ${tokenClientB}`);

  assert.strictEqual(invResB.status, 200);
  assert.strictEqual(invResB.body.client, clientB.name);
  assert.strictEqual(invResB.body.summary.totalAvailable, 80);
  assert(invResB.body.inventory.every(item => item.sku === prodB.sku), 'Client B must ONLY see Product B');
  console.log('✓ Physical stock strictly scoped to client owner; cross-client access impossible');

  // ── TEST 3: Orders Retrieval & Creation ──
  console.log('\n=== TEST 3: Outbound Orders via 3PL Portal ===');
  // Create order via portal as Client A
  const createOrderRes = await request(app)
    .post('/api/v1/client-portal/orders')
    .set('Authorization', `Bearer ${tokenClientA}`)
    .send({
      orderId: `ORD-PORTAL-${suffix}`,
      customer: 'Comprador Final 1',
      deliveryAddress: { street: 'Diagonal 123', city: 'Barcelona', postcode: '08018', country: 'ES' },
      lines: [
        { sku: prodA.sku, qty: 5, unitPrice: 20 }
      ]
    });

  assert.strictEqual(createOrderRes.status, 201);
  assert.strictEqual(createOrderRes.body.order.owner, clientA.name);
  assert.strictEqual(createOrderRes.body.order.ownerType, 'CUSTOMER');
  assert.strictEqual(createOrderRes.body.order.orderId, `ORD-PORTAL-${suffix}`);

  // Retrieve orders as Client A
  const getOrdersRes = await request(app)
    .get('/api/v1/client-portal/orders')
    .set('Authorization', `Bearer ${tokenClientA}`);

  assert.strictEqual(getOrdersRes.status, 200);
  assert(getOrdersRes.body.orders.some(o => o.orderId === `ORD-PORTAL-${suffix}`));

  // Verify Client B does NOT see Client A's order
  const getOrdersB = await request(app)
    .get('/api/v1/client-portal/orders')
    .set('Authorization', `Bearer ${tokenClientB}`);

  assert(!getOrdersB.body.orders.some(o => o.orderId === `ORD-PORTAL-${suffix}`), 'Client B cannot see Client A orders');
  console.log('✓ Order created and retrieved with mandatory owner enforcement');

  // ── TEST 4: Inbound ASNs Announcement & Visibility ──
  console.log('\n=== TEST 4: Inbound ASNs via 3PL Portal ===');
  const createAsnRes = await request(app)
    .post('/api/v1/client-portal/asns')
    .set('Authorization', `Bearer ${tokenClientA}`)
    .send({
      poNumber: `PO-IMPORT-${suffix}`,
      supplier: 'Fabricante Global SL',
      carrier: 'Transports Ràpids',
      items: [
        { sku: prodA.sku, name: prodA.name, expected_qty: 200, uom: 'pcs' }
      ]
    });

  assert.strictEqual(createAsnRes.status, 201);
  assert.strictEqual(createAsnRes.body.asn.owner, clientA.name);
  assert.strictEqual(createAsnRes.body.asn.ownerType, 'CUSTOMER');
  assert.strictEqual(createAsnRes.body.asn.expected_units, 200);

  // List ASNs as Client A
  const getAsnsA = await request(app)
    .get('/api/v1/client-portal/asns')
    .set('Authorization', `Bearer ${tokenClientA}`);

  assert.strictEqual(getAsnsA.status, 200);
  assert(getAsnsA.body.asns.some(a => a.poNumber === `PO-IMPORT-${suffix}`));
  console.log('✓ Inbound ASN announced with owner scoping and expected units tracking');

  // ── TEST 5: Portal KPIs ──
  console.log('\n=== TEST 5: Client Portal Operational KPIs ===');
  const kpiRes = await request(app)
    .get('/api/v1/client-portal/kpis')
    .set('Authorization', `Bearer ${tokenClientA}`);

  assert.strictEqual(kpiRes.status, 200);
  assert.strictEqual(kpiRes.body.client, clientA.name);
  assert.strictEqual(kpiRes.body.kpis.totalAvailableStock, 150);
  assert.strictEqual(kpiRes.body.kpis.activeSkuCount, 1);
  assert(kpiRes.body.kpis.ordersThisMonth >= 1);
  console.log('✓ Client Portal KPIs calculated from authoritative database models');

  console.log('\n======================================================');
  console.log('✓✓✓ ALL RF-P16 3PL CLIENT PORTAL TESTS PASSED ✓✓✓');
  console.log('======================================================\n');
}

runTests()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('❌ RF-P16 Test Failure:', err);
    await teardownTestDatabase();
    process.exit(1);
  });
