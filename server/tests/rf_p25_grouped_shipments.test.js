import mongoose from 'mongoose';
import assert from 'assert';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../index.js';
import User from '../models/User.js';
import Company from '../models/Company.js';
import Shipment from '../models/Shipment.js';
import Order from '../models/Order.js';
import Warehouse from '../models/Warehouse.js';
import Product from '../models/Product.js';
import PickTask from '../models/PickTask.js';
import InventoryBalance from '../models/InventoryBalance.js';
import JournalEntry from '../models/JournalEntry.js';
import { setupTestDatabase, teardownTestDatabase } from '../test_helper.js';

async function runTests() {
  console.log('--- RF-P25 Grouped Shipments Forensic Verification Tests ---');
  await setupTestDatabase();
  console.log('[DB] Connected safely via setupTestDatabase');

  const uniqueSuffix = Date.now().toString();

  // 1. Setup Company A & Admin User A
  const companyA = await Company.create({
    name: 'RF-P25 Co A ' + uniqueSuffix,
    code: 'P25A_' + uniqueSuffix.slice(-4)
  });
  const companyAId = companyA._id;

  const userA = await User.create({
    name: 'P25 Shipping Admin',
    email: `shipping_p25_${uniqueSuffix}@test.com`,
    password: 'password123',
    role: 'admin',
    company: companyAId
  });
  const tokenA = jwt.sign(
    { id: userA._id, email: userA.email, name: userA.name, role: userA.role, company: companyAId },
    process.env.JWT_SECRET || 'test-secret-key',
    { expiresIn: '1h' }
  );

  // Setup Company B for tenant isolation
  const companyB = await Company.create({
    name: 'RF-P25 Co B ' + uniqueSuffix,
    code: 'P25B_' + uniqueSuffix.slice(-4)
  });
  const companyBId = companyB._id;

  const userB = await User.create({
    name: 'P25 User B',
    email: `user_b_${uniqueSuffix}@test.com`,
    password: 'password123',
    role: 'admin',
    company: companyBId
  });
  const tokenB = jwt.sign(
    { id: userB._id, email: userB.email, name: userB.name, role: userB.role, company: companyBId },
    process.env.JWT_SECRET || 'test-secret-key',
    { expiresIn: '1h' }
  );

  let passedCount = 0;

  // TEST 1: Single-order shipment still works (legacy compatibility)
  console.log('\n[TEST 1] Single-order shipment creation (backward compatibility)...');
  const singleOrder = await Order.create({
    orderId: `ORD-SGL-${uniqueSuffix}`,
    customer: 'Single Customer',
    warehouse: 'MIA',
    owner: 'Default Owner',
    order_type: 'B2C',
    status: 'picked',
    company: companyAId,
    product_lines: [
      { sku: 'SKU-001', product_name: 'Widget', qty: 2, unit_price: 25, line_total: 50 }
    ]
  });

  const res1 = await request(app)
    .post('/api/v1/shipping')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      shipmentId: `SHP-SGL-${uniqueSuffix}`,
      order: singleOrder.orderId,
      customer: singleOrder.customer,
      carrier: 'FedEx',
      tracking: `TRK-SGL-${uniqueSuffix}`,
      origin: 'MIA',
      destination: 'Orlando, FL',
      status: 'pending'
    });

  assert.strictEqual(res1.status, 201, `Expected 201, got ${res1.status}`);
  assert.strictEqual(res1.body.isGrouped, false);
  assert.deepStrictEqual(res1.body.orders, [singleOrder.orderId]);
  assert.strictEqual(res1.body.order, singleOrder.orderId);

  // Verify order updated with shipment reference
  const updatedSingleOrder = await Order.findById(singleOrder._id);
  assert.strictEqual(updatedSingleOrder.shipmentId, res1.body.shipmentId);
  passedCount++;
  console.log('[PASS] Test 1: Single-order backward compatibility verified');

  // TEST 2: Grouped shipment creation with multiple orders
  console.log('\n[TEST 2] Grouped shipment creation with orders[]...');
  const orderA = await Order.create({
    orderId: `ORD-GRP-A-${uniqueSuffix}`,
    customer: 'Grouped Customer',
    warehouse: 'MIA',
    owner: 'Owner-1',
    order_type: 'B2B',
    status: 'picked',
    items: 5,
    total: 500,
    company: companyAId,
    product_lines: [
      { sku: 'SKU-001', product_name: 'Widget A', qty: 5, unit_price: 100, line_total: 500 }
    ]
  });

  const orderB = await Order.create({
    orderId: `ORD-GRP-B-${uniqueSuffix}`,
    customer: 'Grouped Customer',
    warehouse: 'MIA',
    owner: 'Owner-1',
    order_type: 'B2B',
    status: 'picked',
    items: 3,
    total: 300,
    company: companyAId,
    product_lines: [
      { sku: 'SKU-002', product_name: 'Widget B', qty: 3, unit_price: 100, line_total: 300 }
    ]
  });

  const res2 = await request(app)
    .post('/api/v1/shipping')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      shipmentId: `SHP-GRP-${uniqueSuffix}`,
      orders: [orderA.orderId, orderB.orderId],
      customer: 'Grouped Customer',
      carrier: 'UPS Freight',
      tracking: `TRK-GRP-${uniqueSuffix}`,
      origin: 'MIA',
      destination: 'Atlanta, GA',
      status: 'pending',
      shipment_type: 'Pallet',
      pallets_count: 1
    });

  assert.strictEqual(res2.status, 201);
  assert.strictEqual(res2.body.isGrouped, true);
  assert.ok(res2.body.groupedShipmentId);
  assert.strictEqual(res2.body.order, orderA.orderId, 'Legacy order field populated with first order');
  assert.strictEqual(res2.body.orders.length, 2);
  assert.ok(res2.body.orders.includes(orderA.orderId));
  assert.ok(res2.body.orders.includes(orderB.orderId));

  // Verify both orders updated with shipment reference
  const refetchedA = await Order.findById(orderA._id);
  const refetchedB = await Order.findById(orderB._id);
  assert.strictEqual(refetchedA.shipmentId, res2.body.shipmentId);
  assert.strictEqual(refetchedB.shipmentId, res2.body.shipmentId);
  passedCount++;
  console.log('[PASS] Test 2: Grouped shipment created and linked to all orders');

  // TEST 3: Group validation endpoint (pre-validation)
  console.log('\n[TEST 3] Group validation endpoint...');
  const orderC = await Order.create({
    orderId: `ORD-VAL-C-${uniqueSuffix}`,
    customer: 'Validate Customer',
    warehouse: 'MIA',
    owner: 'Owner-V',
    order_type: 'B2B',
    status: 'picked',
    items: 2,
    total: 200,
    company: companyAId
  });
  const orderD = await Order.create({
    orderId: `ORD-VAL-D-${uniqueSuffix}`,
    customer: 'Validate Customer',
    warehouse: 'MIA',
    owner: 'Owner-V',
    order_type: 'B2B',
    status: 'picked',
    items: 4,
    total: 400,
    company: companyAId
  });

  const resVal = await request(app)
    .post('/api/v1/shipping/group-validate')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      orderIds: [orderC.orderId, orderD.orderId]
    });

  assert.strictEqual(resVal.status, 200);
  assert.strictEqual(resVal.body.compatible, true);
  assert.strictEqual(resVal.body.orderCount, 2);
  assert.strictEqual(resVal.body.warehouse, 'MIA');
  assert.strictEqual(resVal.body.owner, 'Owner-V');
  assert.strictEqual(resVal.body.orderType, 'B2B');
  passedCount++;
  console.log('[PASS] Test 3: Group validation endpoint verified');

  // TEST 4: Reject grouping with single order in group-validate
  console.log('\n[TEST 4] Reject single-order grouping validation...');
  const resValSingle = await request(app)
    .post('/api/v1/shipping/group-validate')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      orderIds: [orderC.orderId]
    });
  assert.strictEqual(resValSingle.status, 400);
  assert.ok(resValSingle.body.message.includes('at least 2 orders'));
  passedCount++;
  console.log('[PASS] Test 4: Single-order grouping rejected');

  // TEST 5: Same warehouse requirement
  console.log('\n[TEST 5] Reject grouping orders across different warehouses...');
  const orderMIA = await Order.create({
    orderId: `ORD-WH-MIA-${uniqueSuffix}`,
    warehouse: 'MIA',
    owner: 'Owner-WH',
    order_type: 'B2B',
    status: 'picked',
    company: companyAId
  });
  const orderBCN = await Order.create({
    orderId: `ORD-WH-BCN-${uniqueSuffix}`,
    warehouse: 'BCN',
    owner: 'Owner-WH',
    order_type: 'B2B',
    status: 'picked',
    company: companyAId
  });

  const resValWh = await request(app)
    .post('/api/v1/shipping/group-validate')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      orderIds: [orderMIA.orderId, orderBCN.orderId]
    });
  assert.strictEqual(resValWh.status, 400);
  assert.ok(resValWh.body.errors.some(e => e.includes('Warehouse mismatch')));
  passedCount++;
  console.log('[PASS] Test 5: Mixed warehouse grouping rejected');

  // TEST 6: Owner compatibility
  console.log('\n[TEST 6] Reject grouping orders with different stock owners...');
  const orderOwn1 = await Order.create({
    orderId: `ORD-OWN-1-${uniqueSuffix}`,
    warehouse: 'MIA',
    owner: 'Owner-Alpha',
    order_type: 'B2B',
    status: 'picked',
    company: companyAId
  });
  const orderOwn2 = await Order.create({
    orderId: `ORD-OWN-2-${uniqueSuffix}`,
    warehouse: 'MIA',
    owner: 'Owner-Beta',
    order_type: 'B2B',
    status: 'picked',
    company: companyAId
  });

  const resValOwn = await request(app)
    .post('/api/v1/shipping/group-validate')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      orderIds: [orderOwn1.orderId, orderOwn2.orderId]
    });
  assert.strictEqual(resValOwn.status, 400);
  assert.ok(resValOwn.body.errors.some(e => e.includes('Owner mismatch')));
  passedCount++;
  console.log('[PASS] Test 6: Mixed owner grouping rejected');

  // TEST 7: Shipping constraint compatibility (B2B vs B2C)
  console.log('\n[TEST 7] Reject grouping incompatible shipping types (B2B + B2C)...');
  const orderB2B = await Order.create({
    orderId: `ORD-B2B-${uniqueSuffix}`,
    warehouse: 'MIA',
    owner: 'Same-Owner',
    order_type: 'B2B',
    status: 'picked',
    company: companyAId
  });
  const orderB2C = await Order.create({
    orderId: `ORD-B2C-${uniqueSuffix}`,
    warehouse: 'MIA',
    owner: 'Same-Owner',
    order_type: 'B2C',
    status: 'picked',
    company: companyAId
  });

  const resValType = await request(app)
    .post('/api/v1/shipping/group-validate')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      orderIds: [orderB2B.orderId, orderB2C.orderId]
    });
  assert.strictEqual(resValType.status, 400);
  assert.ok(resValType.body.errors.some(e => e.includes('Order type mismatch')));
  passedCount++;
  console.log('[PASS] Test 7: Mixed order type grouping rejected');

  // TEST 8: Terminal-order rejection
  console.log('\n[TEST 8] Reject terminal state orders from grouping...');
  const orderDelivered = await Order.create({
    orderId: `ORD-DEL-${uniqueSuffix}`,
    warehouse: 'MIA',
    owner: 'Same-Owner',
    order_type: 'B2B',
    status: 'delivered',
    company: companyAId
  });
  const orderPicked = await Order.create({
    orderId: `ORD-PCK-${uniqueSuffix}`,
    warehouse: 'MIA',
    owner: 'Same-Owner',
    order_type: 'B2B',
    status: 'picked',
    company: companyAId
  });

  const resValTerm = await request(app)
    .post('/api/v1/shipping/group-validate')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      orderIds: [orderDelivered.orderId, orderPicked.orderId]
    });
  assert.strictEqual(resValTerm.status, 400);
  assert.ok(resValTerm.body.errors.some(e => e.includes('Terminal order')));
  passedCount++;
  console.log('[PASS] Test 8: Terminal order grouping rejected');

  // TEST 9: Duplicate shipment prevention
  console.log('\n[TEST 9] Prevent grouping orders that already belong to a shipment...');
  const orderAlreadyShipped = await Order.create({
    orderId: `ORD-ALREADY-${uniqueSuffix}`,
    warehouse: 'MIA',
    owner: 'Same-Owner',
    order_type: 'B2B',
    status: 'picked',
    shipmentId: 'SHP-EXISTING-123',
    company: companyAId
  });

  const resValDupe = await request(app)
    .post('/api/v1/shipping/group-validate')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      orderIds: [orderAlreadyShipped.orderId, orderPicked.orderId]
    });
  assert.strictEqual(resValDupe.status, 400);
  assert.ok(resValDupe.body.errors.some(e => e.includes('already have shipments')));
  passedCount++;
  console.log('[PASS] Test 9: Orders with existing shipment rejected');

  // TEST 10: Individual order traceability & line item integrity
  console.log('\n[TEST 10] Traceability: verify each order and lines remain intact...');
  const retrievedA = await Order.findOne({ orderId: orderA.orderId });
  assert.strictEqual(retrievedA.product_lines.length, 1);
  assert.strictEqual(retrievedA.product_lines[0].sku, 'SKU-001');
  assert.strictEqual(retrievedA.product_lines[0].qty, 5);

  const retrievedB = await Order.findOne({ orderId: orderB.orderId });
  assert.strictEqual(retrievedB.product_lines.length, 1);
  assert.strictEqual(retrievedB.product_lines[0].sku, 'SKU-002');
  assert.strictEqual(retrievedB.product_lines[0].qty, 3);
  passedCount++;
  console.log('[PASS] Test 10: Traceability and line items preserved');

  // TEST 11: Tenant isolation
  console.log('\n[TEST 11] Tenant isolation...');
  const resTenantQuery = await request(app)
    .get('/api/v1/shipping')
    .set('Authorization', `Bearer ${tokenB}`);
  assert.strictEqual(resTenantQuery.status, 200);
  const itemsB = resTenantQuery.body.data || resTenantQuery.body;
  assert.ok(!itemsB.some(s => s.shipmentId === res2.body.shipmentId), 'Company B cannot see Company A shipment');

  // Try to group Company A orders using Company B token
  const resCrossCompany = await request(app)
    .post('/api/v1/shipping/group-validate')
    .set('Authorization', `Bearer ${tokenB}`)
    .send({
      orderIds: [orderA.orderId, orderB.orderId]
    });
  assert.strictEqual(resCrossCompany.status, 404, 'Cannot find cross-tenant orders');
  passedCount++;
  console.log('[PASS] Test 11: Tenant isolation strictly verified');

  // TEST 12: Mode support: Pallet vs Parcel
  console.log('\n[TEST 12] Mode support: Pallet vs Parcel...');
  assert.strictEqual(res2.body.shipment_type, 'Pallet');
  assert.strictEqual(res2.body.pallets_count, 1);

  const resParcel = await request(app)
    .post('/api/v1/shipping')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      shipmentId: `SHP-PRC-${uniqueSuffix}`,
      orders: [orderC.orderId, orderD.orderId],
      customer: 'Parcel Customer',
      carrier: 'DHL',
      tracking: `TRK-PRC-${uniqueSuffix}`,
      origin: 'MIA',
      destination: 'Tampa, FL',
      status: 'pending',
      shipment_type: 'Parcel'
    });
  assert.strictEqual(resParcel.status, 201);
  assert.strictEqual(resParcel.body.shipment_type, 'Parcel');
  passedCount++;
  console.log('[PASS] Test 12: Parcel and Pallet shipping modes verified');

  // TEST 13: Financial items support and no duplicate accounting entries
  console.log('\n[TEST 13] Financial items & accounting integrity...');
  const resFin = await request(app)
    .post('/api/v1/shipping')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      shipmentId: `SHP-FIN-${uniqueSuffix}`,
      orders: [`ORD-FIN-1-${uniqueSuffix}`, `ORD-FIN-2-${uniqueSuffix}`],
      customer: 'Financial Client',
      carrier: 'FedEx',
      tracking: `TRK-FIN-${uniqueSuffix}`,
      origin: 'MIA',
      destination: 'Dallas, TX',
      status: 'pending',
      financial_items: [
        { sku: 'SKU-001', qty: 10, unitPriceSnapshot: 100, revenueAmount: 1000 },
        { sku: 'SKU-002', qty: 5, unitPriceSnapshot: 50, revenueAmount: 250 }
      ]
    });
  assert.strictEqual(resFin.status, 201);
  assert.strictEqual(resFin.body.financial_items.length, 2);
  assert.strictEqual(resFin.body.financial_items[0].revenueAmount, 1000);
  assert.strictEqual(resFin.body.financial_items[1].revenueAmount, 250);

  // Grouped shipments maintain separate financial items without duplicate JE emission
  const jes = await JournalEntry.find({
    company: companyAId,
    memo: { $regex: resFin.body.shipmentId }
  });
  // No duplicate entries created during initial shipment creation
  assert.strictEqual(jes.length, 0);
  passedCount++;
  console.log('[PASS] Test 13: Financial items correctly assigned and verified');

  console.log(`\n=== RF-P25 ALL TESTS PASSED (${passedCount}/13) ===`);
  await teardownTestDatabase();
  process.exit(0);
}

runTests().catch(async (err) => {
  console.error('\nRF-P25 TEST FAILED:', err);
  await teardownTestDatabase();
  process.exit(1);
});
