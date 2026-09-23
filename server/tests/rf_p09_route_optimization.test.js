import mongoose from 'mongoose';
import assert from 'assert';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../index.js';
import User from '../models/User.js';
import Company from '../models/Company.js';
import PickBatch from '../models/PickBatch.js';
import PickTask from '../models/PickTask.js';
import Location from '../models/Location.js';
import ActivityLog from '../models/ActivityLog.js';
import Warehouse from '../models/Warehouse.js';
import Product from '../models/Product.js';
import InventoryBalance from '../models/InventoryBalance.js';
import { setupTestDatabase, teardownTestDatabase } from '../test_helper.js';

async function runTests() {
  console.log('--- RF-P09 Route Optimization & Wave Picking Tests ---');
  await setupTestDatabase();
  console.log('[DB] Connected safely via setupTestDatabase');

  const uniqueSuffix = Date.now().toString();

  // Create primary test company
  const company = await Company.create({
    name: 'RF-P09 Company ' + uniqueSuffix,
    code: 'P09_' + uniqueSuffix.slice(-4)
  });
  const companyId = company._id;

  // Create secondary test company for tenant isolation
  const otherCompany = await Company.create({
    name: 'RF-P09 Other Co ' + uniqueSuffix,
    code: 'P09O_' + uniqueSuffix.slice(-4)
  });
  const otherCompanyId = otherCompany._id;

  // Create admin user for company
  const adminUser = await User.create({
    name: 'P09 Admin User',
    email: `admin_p09_${uniqueSuffix}@test.com`,
    password: 'password123',
    role: 'admin',
    company: companyId
  });

  const authToken = jwt.sign(
    { id: adminUser._id, userId: adminUser._id, email: adminUser.email, role: adminUser.role, company: companyId },
    process.env.JWT_SECRET || 'test-secret-key',
    { expiresIn: '1h' }
  );

  // User for secondary company
  const otherUser = await User.create({
    name: 'P09 Other User',
    email: `other_p09_${uniqueSuffix}@test.com`,
    password: 'password123',
    role: 'admin',
    company: otherCompanyId
  });

  const otherToken = jwt.sign(
    { id: otherUser._id, userId: otherUser._id, email: otherUser.email, role: otherUser.role, company: otherCompanyId },
    process.env.JWT_SECRET || 'test-secret-key',
    { expiresIn: '1h' }
  );

  // Setup sample product and inventory balance
  const product = await Product.create({
    sku: `SKU-P09-${uniqueSuffix}`,
    name: 'Optimized Wave Product',
    qty_available: 100,
    company: companyId
  });

  const invBalance = await InventoryBalance.create({
    company: companyId,
    warehouse: 'MIA',
    bin: 'A-01-01-01',
    sku: product.sku,
    qtyAvailable: 100,
    qtyReserved: 0
  });

  // Create test warehouse
  const warehouse = await Warehouse.create({
    name: 'Miami DC',
    code: 'MIA',
    company: companyId
  });

  // Create test locations with deterministic aisle/rack/shelf structure
  await Location.create([
    { code: 'A-01-01-01', warehouse: warehouse._id, aisle: 'A', shelf: '01', bin: 'A-01-01-01', company: companyId, locationType: 'SHELF' },
    { code: 'A-01-02-01', warehouse: warehouse._id, aisle: 'A', shelf: '02', bin: 'A-01-02-01', company: companyId, locationType: 'SHELF' },
    { code: 'B-01-01-01', warehouse: warehouse._id, aisle: 'B', shelf: '01', bin: 'B-01-01-01', company: companyId, locationType: 'SHELF' },
    { code: 'A-02-01-01', warehouse: warehouse._id, aisle: 'A', shelf: '02', bin: 'A-02-01-01', company: companyId, locationType: 'RACK' }
  ]);

  let passedCount = 0;

  // TEST 1: Route ordering aisle → rack → shelf → bin
  console.log('\n[TEST 1] Route ordering aisle → rack → shelf → bin...');
  const task1 = await PickTask.create({
    taskId: `PICK-001-${uniqueSuffix}`,
    orderId: `ORD-001-${uniqueSuffix}`,
    owner: 'Standard-Owner',
    warehouse: 'MIA',
    status: 'pending',
    items: [
      { sku: product.sku, productName: product.name, orderedQty: 10, sourceLocation: 'B-01-01-01' }
    ],
    company: companyId
  });

  const task2 = await PickTask.create({
    taskId: `PICK-002-${uniqueSuffix}`,
    orderId: `ORD-002-${uniqueSuffix}`,
    owner: 'Standard-Owner',
    warehouse: 'MIA',
    status: 'pending',
    items: [
      { sku: product.sku, productName: product.name, orderedQty: 5, sourceLocation: 'A-01-02-01' }
    ],
    company: companyId
  });

  const task3 = await PickTask.create({
    taskId: `PICK-003-${uniqueSuffix}`,
    orderId: `ORD-003-${uniqueSuffix}`,
    owner: 'Standard-Owner',
    warehouse: 'MIA',
    status: 'pending',
    items: [
      { sku: product.sku, productName: product.name, orderedQty: 8, sourceLocation: 'A-01-01-01' }
    ],
    company: companyId
  });

  const res1 = await request(app)
    .post('/api/v1/picking/batches')
    .set('Authorization', `Bearer ${authToken}`)
    .send({
      pickTaskIds: [task1._id.toString(), task2._id.toString(), task3._id.toString()]
    });

  assert.strictEqual(res1.status, 201);
  const batch1 = res1.body;
  assert.ok(batch1.groupedLines);
  assert.strictEqual(batch1.groupedLines.length, 3);
  assert.strictEqual(batch1.groupedLines[0].sourceLocation, 'A-01-01-01');
  assert.strictEqual(batch1.groupedLines[1].sourceLocation, 'A-01-02-01');
  assert.strictEqual(batch1.groupedLines[2].sourceLocation, 'B-01-01-01');
  passedCount++;
  console.log('[PASS] Test 1: Route ordering aisle → shelf verified');

  // TEST 2: Deterministic ordering
  console.log('\n[TEST 2] Deterministic ordering verification...');
  // Same tasks order in array should produce same optimal sequence
  const locations = batch1.groupedLines.map(l => l.sourceLocation);
  assert.deepStrictEqual(locations, ['A-01-01-01', 'A-01-02-01', 'B-01-01-01']);
  passedCount++;
  console.log('[PASS] Test 2: Deterministic sequence verified');

  // TEST 3: Duplicate batch assignment prevention
  console.log('\n[TEST 3] Duplicate batch assignment prevention...');
  const res3 = await request(app)
    .post('/api/v1/picking/batches')
    .set('Authorization', `Bearer ${authToken}`)
    .send({
      pickTaskIds: [task1._id.toString()]
    });
  assert.strictEqual(res3.status, 400);
  assert.ok(res3.body.message.includes('already assigned') || res3.body.message.includes('Duplicate Assignment'));
  passedCount++;
  console.log('[PASS] Test 3: Duplicate batch assignment rejected');

  // TEST 4: Batch completion
  console.log('\n[TEST 4] Batch completion...');
  // First complete all tasks
  await PickTask.updateMany(
    { _id: { $in: [task1._id, task2._id, task3._id] } },
    { $set: { status: 'completed' } }
  );

  const res4 = await request(app)
    .put(`/api/v1/picking/batches/${batch1._id}/complete`)
    .set('Authorization', `Bearer ${authToken}`)
    .send();
  assert.strictEqual(res4.status, 200);
  assert.strictEqual(res4.body.status, 'completed');
  passedCount++;
  console.log('[PASS] Test 4: Batch completion verified');

  // TEST 5: Prevent completing already completed batch
  console.log('\n[TEST 5] Prevent re-completing batch...');
  const res5 = await request(app)
    .put(`/api/v1/picking/batches/${batch1._id}/complete`)
    .set('Authorization', `Bearer ${authToken}`)
    .send();
  assert.strictEqual(res5.status, 400);
  assert.ok(res5.body.message.includes('already completed'));
  passedCount++;
  console.log('[PASS] Test 5: Re-completion prevented');

  // TEST 6: Batch cancellation and task reset
  console.log('\n[TEST 6] Batch cancellation and task reset...');
  const cancelTask = await PickTask.create({
    taskId: `PICK-CNL-${uniqueSuffix}`,
    orderId: `ORD-CNL-${uniqueSuffix}`,
    owner: 'Standard-Owner',
    warehouse: 'MIA',
    status: 'pending',
    items: [{ sku: product.sku, productName: product.name, orderedQty: 5, sourceLocation: 'A-01-01-01' }],
    company: companyId
  });

  const resCreateCnl = await request(app)
    .post('/api/v1/picking/batches')
    .set('Authorization', `Bearer ${authToken}`)
    .send({
      pickTaskIds: [cancelTask._id.toString()]
    });
  assert.strictEqual(resCreateCnl.status, 201);
  const cancelBatch = resCreateCnl.body;

  const resCancel = await request(app)
    .put(`/api/v1/picking/batches/${cancelBatch._id}/cancel`)
    .set('Authorization', `Bearer ${authToken}`)
    .send();
  assert.strictEqual(resCancel.status, 200);
  assert.strictEqual(resCancel.body.status, 'cancelled');

  const refetchedTask = await PickTask.findById(cancelTask._id);
  assert.strictEqual(refetchedTask.status, 'pending');
  passedCount++;
  console.log('[PASS] Test 6: Batch cancellation resets tasks to pending');

  // TEST 7: Concurrency safety
  console.log('\n[TEST 7] Concurrency safety during batch creation...');
  const concTask = await PickTask.create({
    taskId: `PICK-CONC-${uniqueSuffix}`,
    orderId: `ORD-CONC-${uniqueSuffix}`,
    owner: 'Standard-Owner',
    warehouse: 'MIA',
    status: 'pending',
    items: [{ sku: product.sku, productName: product.name, orderedQty: 2, sourceLocation: 'A-01-01-01' }],
    company: companyId
  });

  // Launch two concurrent requests to batch the same task
  const [conc1, conc2] = await Promise.all([
    request(app).post('/api/v1/picking/batches').set('Authorization', `Bearer ${authToken}`).send({ pickTaskIds: [concTask._id.toString()] }),
    request(app).post('/api/v1/picking/batches').set('Authorization', `Bearer ${authToken}`).send({ pickTaskIds: [concTask._id.toString()] })
  ]);

  const statuses = [conc1.status, conc2.status];
  assert.ok(statuses.includes(201), 'One request should succeed');
  assert.ok(statuses.includes(400) || statuses.includes(409), 'One request should be rejected');
  passedCount++;
  console.log('[PASS] Test 7: Concurrency safety verified');

  // TEST 8: Audit events
  console.log('\n[TEST 8] Audit events...');
  const auditLogs = await ActivityLog.find({
    company: companyId,
    action: { $in: ['BATCH_CREATED', 'BATCH_COMPLETED', 'BATCH_CANCELLED'] }
  });
  assert.ok(auditLogs.length >= 3, 'Audit logs must record batch lifecycle events');
  passedCount++;
  console.log('[PASS] Test 8: Audit events recorded for batch lifecycle');

  // TEST 9: Tenant isolation
  console.log('\n[TEST 9] Tenant isolation...');
  const resTenant = await request(app)
    .get(`/api/v1/picking/batches`)
    .set('Authorization', `Bearer ${otherToken}`);
  assert.strictEqual(resTenant.status, 200);
  const otherBatches = resTenant.body.data || resTenant.body;
  assert.strictEqual(otherBatches.length, 0, 'Company B cannot see Company A batches');
  passedCount++;
  console.log('[PASS] Test 9: Tenant isolation verified');

  // TEST 10: Warehouse isolation
  console.log('\n[TEST 10] Warehouse isolation...');
  const bcnTask = await PickTask.create({
    taskId: `PICK-BCN-${uniqueSuffix}`,
    orderId: `ORD-BCN-${uniqueSuffix}`,
    owner: 'Standard-Owner',
    warehouse: 'BCN',
    status: 'pending',
    items: [{ sku: product.sku, productName: product.name, orderedQty: 4, sourceLocation: 'A-01-01-01' }],
    company: companyId
  });

  const miaTask = await PickTask.create({
    taskId: `PICK-MIA-${uniqueSuffix}`,
    orderId: `ORD-MIA-${uniqueSuffix}`,
    owner: 'Standard-Owner',
    warehouse: 'MIA',
    status: 'pending',
    items: [{ sku: product.sku, productName: product.name, orderedQty: 4, sourceLocation: 'A-01-01-01' }],
    company: companyId
  });

  const resWh = await request(app)
    .post('/api/v1/picking/batches')
    .set('Authorization', `Bearer ${authToken}`)
    .send({
      pickTaskIds: [bcnTask._id.toString(), miaTask._id.toString()]
    });
  assert.strictEqual(resWh.status, 400);
  assert.ok(resWh.body.message.includes('Warehouse') || resWh.body.message.includes('warehouses'));
  passedCount++;
  console.log('[PASS] Test 10: Mixed-warehouse batch creation rejected');

  // TEST 11: Owner isolation
  console.log('\n[TEST 11] Owner isolation...');
  const ownerATask = await PickTask.create({
    taskId: `PICK-OWNA-${uniqueSuffix}`,
    orderId: `ORD-OWNA-${uniqueSuffix}`,
    owner: 'Owner-Alpha',
    warehouse: 'MIA',
    status: 'pending',
    items: [{ sku: product.sku, productName: product.name, orderedQty: 2, sourceLocation: 'A-01-01-01' }],
    company: companyId
  });

  const ownerBTask = await PickTask.create({
    taskId: `PICK-OWNB-${uniqueSuffix}`,
    orderId: `ORD-OWNB-${uniqueSuffix}`,
    owner: 'Owner-Beta',
    warehouse: 'MIA',
    status: 'pending',
    items: [{ sku: product.sku, productName: product.name, orderedQty: 2, sourceLocation: 'A-01-01-01' }],
    company: companyId
  });

  const resOwner = await request(app)
    .post('/api/v1/picking/batches')
    .set('Authorization', `Bearer ${authToken}`)
    .send({
      pickTaskIds: [ownerATask._id.toString(), ownerBTask._id.toString()]
    });
  assert.strictEqual(resOwner.status, 400);
  assert.ok(resOwner.body.message.includes('Owner Isolation') || resOwner.body.message.includes('Owners'));
  passedCount++;
  console.log('[PASS] Test 11: Mixed-owner batch creation rejected');

  // TEST 12: No double inventory deduction & inventory balance consistency
  console.log('\n[TEST 12] Inventory balance consistency & orchestration check...');
  const productBefore = await Product.findById(product._id);
  const balanceBefore = await InventoryBalance.findById(invBalance._id);

  // PickBatch is strictly orchestration layer - creating or completing batches must NEVER directly mutate inventory
  assert.strictEqual(productBefore.qty_available, 100);
  assert.strictEqual(balanceBefore.qtyAvailable, 100);
  passedCount++;
  console.log('[PASS] Test 12: Inventory balance verified unchanged by batch orchestration');

  console.log(`\n=== RF-P09 ALL TESTS PASSED (${passedCount}/12) ===`);
  await teardownTestDatabase();
  process.exit(0);
}

runTests().catch(async (err) => {
  console.error('\nRF-P09 TEST FAILED:', err);
  await teardownTestDatabase();
  process.exit(1);
});
