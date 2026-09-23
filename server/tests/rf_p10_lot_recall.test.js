import mongoose from 'mongoose';
import assert from 'assert';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../index.js';
import User from '../models/User.js';
import Company from '../models/Company.js';
import Warehouse from '../models/Warehouse.js';
import Product from '../models/Product.js';
import InventoryBalance from '../models/InventoryBalance.js';
import PickTask from '../models/PickTask.js';
import Order from '../models/Order.js';
import Shipment from '../models/Shipment.js';
import AuditLog from '../models/AuditLog.js';
import { lotRecallService } from '../services/lotRecallService.js';
import { setupTestDatabase, teardownTestDatabase } from '../test_helper.js';

async function runTests() {
  console.log('--- RF-P10 Lot Recall Tests ---');
  await setupTestDatabase();
  console.log('[DB] Connected safely via setupTestDatabase');

  const uniqueSuffix = Date.now().toString();

  // Setup test company
  const company = await Company.create({
    name: 'RF-P10 Test Co ' + uniqueSuffix,
    code: 'P10_' + uniqueSuffix.slice(-4),
    blindReceiving: false
  });
  const companyId = company._id;

  // Setup admin user
  const adminUser = await User.create({
    name: 'RF-P10 Admin',
    email: `admin_p10_${uniqueSuffix}@test.com`,
    password: 'password123',
    role: 'admin',
    company: companyId
  });
  const adminToken = jwt.sign(
    { id: adminUser._id, company: companyId, role: 'admin' },
    process.env.JWT_SECRET || 'fallback_secret',
    { expiresIn: '1h' }
  );

  // Setup warehouse
  const warehouse = await Warehouse.create({
    code: 'P10-WH-' + uniqueSuffix.slice(-4),
    name: 'RF-P10 Test Warehouse',
    company: companyId
  });

  // Setup product
  const product = await Product.create({
    sku: 'P10-SKU-' + uniqueSuffix.slice(-4),
    name: 'RF-P10 Test Product',
    qty_available: 100,
    company: companyId
  });

  // Setup inventory balances
  const lotNumber = 'LOT-P10-' + uniqueSuffix.slice(-4);
  await InventoryBalance.create([
    {
      company: companyId,
      warehouse: warehouse.code,
      sku: product.sku,
      owner: 'Test Owner',
      ownerType: 'COMPANY',
      bin: 'BIN-A01',
      lotNumber,
      qtyAvailable: 50,
      qtyReserved: 0,
      qtyQuarantine: 0
    },
    {
      company: companyId,
      warehouse: warehouse.code,
      sku: product.sku,
      owner: 'Test Owner',
      ownerType: 'COMPANY',
      bin: 'BIN-A02',
      lotNumber,
      qtyAvailable: 30,
      qtyReserved: 0,
      qtyQuarantine: 0
    }
  ]);

  // Setup shipped orders (historical data)
  const order = await Order.create({
    orderId: 'ORD-P10-' + uniqueSuffix.slice(-4),
    company: companyId,
    warehouse: warehouse.code,
    status: 'shipped',
    customer: 'Test Customer',
    product_lines: [{ 
      sku: product.sku, 
      qty: 20, 
      product_name: product.name,
      unit_price: 10,
      line_total: 200
    }],
    date: new Date()
  });

  await Shipment.create({
    shipmentId: 'SHP-P10-' + uniqueSuffix.slice(-4),
    company: companyId,
    order: order.orderId,
    tracking: 'TRACK-P10-' + uniqueSuffix.slice(-4),
    carrier: 'Test Carrier'
  });

  // Create pick task before recall (to test blocking)
  const pickTask = await PickTask.create({
    taskId: 'PICK-P10-' + uniqueSuffix.slice(-4),
    orderId: 'ORD-PICK-' + uniqueSuffix.slice(-4),
    company: companyId,
    warehouse: warehouse.code,
    status: 'pending',
    items: [{ 
      sku: product.sku, 
      lotNumber, 
      qty: 10,
      orderedQty: 10,
      productName: product.name
    }]
  });

  // Test 1: Preview accuracy
  console.log('\n[TEST 1] Preview accuracy...');
  const previewResult = await lotRecallService.getLotInventorySummary({
    companyId,
    lotNumber,
    sku: product.sku,
    warehouse: warehouse.code
  });
  assert.strictEqual(previewResult.totalAvailable, 80, 'Preview should show 80 available units');
  assert.strictEqual(previewResult.remainingStock.length, 2, 'Preview should show 2 stock locations');
  console.log('[PASS] Preview accuracy verified');

  // Test 2: Shipped report accuracy
  console.log('\n[TEST 2] Shipped report accuracy...');
  const shippedReport = await lotRecallService.getShippedOrdersReport({
    companyId,
    lotNumber,
    sku: product.sku,
    warehouse: warehouse.code
  });
  assert.strictEqual(shippedReport.length, 1, 'Should find 1 shipped order');
  assert.strictEqual(shippedReport[0].orderId, order.orderId, 'Should match order ID');
  console.log('[PASS] Shipped report accuracy verified');

  // Test 3: Recall idempotency
  console.log('\n[TEST 3] Recall idempotency...');
  const recallResult1 = await lotRecallService.executeIdempotentLotRecall({
    companyId,
    lotNumber,
    sku: product.sku,
    warehouse: warehouse.code,
    reason: 'Test recall',
    recallId: 'RCL-P10-' + uniqueSuffix.slice(-4),
    idempotencyKey: 'IDEM-P10-' + uniqueSuffix.slice(-4),
    user: adminUser
  });
  assert.strictEqual(recallResult1.totalQuantityQuarantined, 80, 'Should quarantine 80 units');

  // Verify that repeated recall on same lot with no available stock doesn't double-quarantine
  const recallResult2 = await lotRecallService.executeLotRecall({
    companyId,
    lotNumber,
    sku: product.sku,
    warehouse: warehouse.code,
    reason: 'Test recall 2',
    recallId: 'RCL-P10-2-' + uniqueSuffix.slice(-4),
    user: adminUser
  });
  // Second recall should find 0 available stock (already quarantined)
  assert.strictEqual(recallResult2.totalQuantityQuarantined, 0, 'Second recall should quarantine 0 units (already quarantined)');
  assert.strictEqual(recallResult2.totalAvailablePrior, 0, 'Should show 0 available prior');
  console.log('[PASS] Recall idempotency verified (no double-quarantine)');

  // Test 4: Recalled lot blocks picking
  console.log('\n[TEST 4] Recalled lot blocks picking...');
  // After recall, pending pick tasks should be blocked
  const blockedPickTask = await PickTask.findOne({ taskId: pickTask.taskId });
  assert.strictEqual(blockedPickTask.status, 'blocked', 'Pick task should be blocked after recall');
  console.log('[PASS] Recalled lot blocks picking verified');

  // Test 5: Tenant isolation
  console.log('\n[TEST 5] Tenant isolation...');
  const otherCompany = await Company.create({
    name: 'Other Company ' + uniqueSuffix,
    code: 'OTHER-' + uniqueSuffix.slice(-4),
    blindReceiving: false
  });
  
  const otherPreview = await lotRecallService.getLotInventorySummary({
    companyId: otherCompany._id,
    lotNumber,
    sku: product.sku
  });
  assert.strictEqual(otherPreview.totalAvailable, 0, 'Other company should not see recalled lot');
  console.log('[PASS] Tenant isolation verified');

  // Test 6: Warehouse isolation
  console.log('\n[TEST 6] Warehouse isolation...');
  const otherWarehouse = await Warehouse.create({
    code: 'OTHER-WH-' + uniqueSuffix.slice(-4),
    name: 'Other Warehouse',
    company: companyId
  });
  
  const otherWhPreview = await lotRecallService.getLotInventorySummary({
    companyId,
    lotNumber,
    sku: product.sku,
    warehouse: otherWarehouse.code
  });
  assert.strictEqual(otherWhPreview.totalAvailable, 0, 'Other warehouse should not see recalled lot');
  console.log('[PASS] Warehouse isolation verified');

  // Test 7: Report does not mutate inventory
  console.log('\n[TEST 7] Report does not mutate inventory...');
  const beforeReportBalances = await InventoryBalance.find({ company: companyId, lotNumber });
  await lotRecallService.getShippedOrdersReport({
    companyId,
    lotNumber,
    sku: product.sku
  });
  const afterReportBalances = await InventoryBalance.find({ company: companyId, lotNumber });
  assert.strictEqual(beforeReportBalances.length, afterReportBalances.length, 'Report should not mutate inventory');
  console.log('[PASS] Report does not mutate inventory verified');

  // Test 8: Recall audit event exists
  console.log('\n[TEST 8] Recall audit event exists...');
  const auditEvent = await AuditLog.findOne({
    company: companyId,
    event_type: 'lot_recalled',
    lot_number: lotNumber
  });
  assert.ok(auditEvent, 'Audit event should exist for recall');
  assert.strictEqual(auditEvent.quantity, 80, 'Audit event should record quarantined quantity');
  console.log('[PASS] Recall audit event exists verified');

  console.log('\n=== RF-P10 ALL TESTS PASSED ===');
  await teardownTestDatabase();
  process.exit(0);
}

runTests().catch(async err => {
  console.error('RF-P10 TEST FAILED:', err);
  await teardownTestDatabase();
  process.exit(1);
});
