import mongoose from 'mongoose';
import assert from 'assert';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../index.js';
import User from '../models/User.js';
import Company from '../models/Company.js';
import Warehouse from '../models/Warehouse.js';
import Zone from '../models/Zone.js';
import Location from '../models/Location.js';
import Product from '../models/Product.js';
import Client from '../models/Client.js';
import Order from '../models/Order.js';
import Transfer from '../models/Transfer.js';
import InventoryBalance from '../models/InventoryBalance.js';
import StorageRule from '../models/StorageRule.js';
import QCProfile from '../models/QCProfile.js';
import QuarantineInventory from '../models/QuarantineInventory.js';
import ASN from '../models/ASN.js';
import PickTask from '../models/PickTask.js';
import { validateOwnerMaster } from '../utils/ownerValidation.js';
import { seedBCN772Locations } from '../scripts/seed_bcn_772_locations.js';
import { setupTestDatabase } from '../test_helper.js';

async function runTests() {
  console.log('--- Setting up test database ---');
  await setupTestDatabase();
  console.log('[DB] Connected safely via setupTestDatabase');

  const uniqueSuffix = Date.now().toString();

  // 1. Setup isolated test company
  const company = await Company.create({
    name: 'Batch1 Test Co ' + uniqueSuffix,
    code: 'B1_' + uniqueSuffix.slice(-4),
    blindReceiving: false
  });
  const companyId = company._id;

  // 2. Setup Admin and Staff tokens
  const adminUser = await User.create({
    name: 'Batch1 Admin',
    email: `admin_${uniqueSuffix}@batch1.test`,
    password: 'password123',
    role: 'admin',
    company: companyId
  });
  const adminToken = jwt.sign(
    { id: adminUser._id, company: companyId, role: 'admin' },
    process.env.JWT_SECRET || 'fallback_secret',
    { expiresIn: '1h' }
  );

  const staffUser = await User.create({
    name: 'Batch1 Staff',
    email: `staff_${uniqueSuffix}@batch1.test`,
    password: 'password123',
    role: 'warehouse_staff',
    company: companyId
  });
  const staffToken = jwt.sign(
    { id: staffUser._id, company: companyId, role: 'warehouse_staff' },
    process.env.JWT_SECRET || 'fallback_secret',
    { expiresIn: '1h' }
  );

  // 3. Setup Warehouse, Staging Location, and Clients
  const warehouseBCN = await Warehouse.create({
    code: 'BCN_' + uniqueSuffix.slice(-4),
    name: 'Barcelona Test Hub',
    blindReceiving: true,
    company: companyId
  });

  const stagingZone = await Zone.create({
    code: 'STAGING',
    name: 'Staging Area',
    warehouse: warehouseBCN._id,
    company: companyId
  });

  await Location.create({
    code: `${warehouseBCN.code}-STAGE-01`,
    name: 'Staging Area 1',
    warehouse: warehouseBCN._id,
    zone: stagingZone._id,
    locationType: 'STAGING',
    status: 'AVAILABLE',
    company: companyId
  });

  const activeClient = await Client.create({
    name: 'Active Logistics 3PL ' + uniqueSuffix,
    active: true,
    company: companyId
  });

  const inactiveClient = await Client.create({
    name: 'Suspended Trading 3PL ' + uniqueSuffix,
    active: false,
    company: companyId
  });

  console.log('\n================================================================');
  console.log('  STARTING PHASE 2 BATCH 1 TEST SUITE');
  console.log('================================================================\n');

  // ─────────────────────────────────────────────────────────────
  // Test 1: validateOwnerMaster unit logic
  // ─────────────────────────────────────────────────────────────
  console.log('Test 1: validateOwnerMaster unit checks (G-01)...');
  const nonExistentError = await validateOwnerMaster('Fake NonExistent 3PL', 'CUSTOMER', companyId);
  assert(nonExistentError && nonExistentError.includes('not a registered'));

  const inactiveError = await validateOwnerMaster(inactiveClient.name, 'CUSTOMER', companyId);
  assert(inactiveError && inactiveError.includes('inactive 3PL Client'));

  const activeResult = await validateOwnerMaster(activeClient.name, 'CUSTOMER', companyId);
  assert.strictEqual(activeResult, null);

  const internalResult = await validateOwnerMaster('Internal Stock', 'COMPANY', companyId);
  assert.strictEqual(internalResult, null);
  console.log('✓ Test 1 Passed: validateOwnerMaster correctly enforces active client registration');

  // ─────────────────────────────────────────────────────────────
  // Test 2: GET /api/v1/clients?active=true
  // ─────────────────────────────────────────────────────────────
  console.log('Test 2: GET /api/v1/clients?active=true filtering...');
  const clientsRes = await request(app)
    .get('/api/v1/clients?active=true')
    .set('Authorization', `Bearer ${adminToken}`);
  assert.strictEqual(clientsRes.status, 200);
  assert(Array.isArray(clientsRes.body));
  assert(clientsRes.body.some(c => c.name === activeClient.name));
  assert(!clientsRes.body.some(c => c.name === inactiveClient.name));
  console.log('✓ Test 2 Passed: Clients route filtered out inactive clients');

  // ─────────────────────────────────────────────────────────────
  // Test 3: POST /api/v1/orders Owner validation
  // ─────────────────────────────────────────────────────────────
  console.log('Test 3: POST /api/v1/orders Owner validation...');
  const invalidOrderRes = await request(app)
    .post('/api/v1/orders')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      customer: 'Order Test Customer',
      email: 'customer@batch1.test',
      delivery_address: { street: 'Carrer Gran', number: '12', city: 'Barcelona', postcode: '08001', region: 'BCN', country: 'ES' },
      owner: 'Unknown Depositor 999',
      ownerType: 'CUSTOMER',
      warehouse: warehouseBCN.code,
      product_lines: [{ sku: 'TEST-SKU', product_name: 'Test Prod', qty: 5, unit_price: 10 }]
    });
  assert.strictEqual(invalidOrderRes.status, 422);

  const validOrderRes = await request(app)
    .post('/api/v1/orders')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      customer: 'Order Test Customer',
      email: 'customer@batch1.test',
      delivery_address: { street: 'Carrer Gran', number: '12', city: 'Barcelona', postcode: '08001', region: 'BCN', country: 'ES' },
      owner: activeClient.name,
      ownerType: 'CUSTOMER',
      warehouse: warehouseBCN.code,
      product_lines: [{ sku: 'TEST-SKU', product_name: 'Test Prod', qty: 5, unit_price: 10, line_total: 50 }]
    });
  assert.strictEqual(validOrderRes.status, 201);
  assert.strictEqual(validOrderRes.body.owner, activeClient.name);
  assert.strictEqual(validOrderRes.body.ownerType, 'CUSTOMER');
  console.log('✓ Test 3 Passed: Order creation validates and persists 3PL owner');

  // ─────────────────────────────────────────────────────────────
  // Test 4: POST /api/v1/transfers Owner validation
  // ─────────────────────────────────────────────────────────────
  console.log('Test 4: POST /api/v1/transfers Owner validation...');
  const invalidTransferRes = await request(app)
    .post('/api/v1/transfers')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      sku: 'TEST-TRANSFER-SKU',
      qty: 1,
      from_wh: warehouseBCN.code,
      from_loc: 'LOC-A',
      to_wh: warehouseBCN.code,
      to_loc: 'LOC-B',
      owner: inactiveClient.name,
      ownerType: 'CUSTOMER'
    });
  assert.strictEqual(invalidTransferRes.status, 422);

  const validTransferRes = await request(app)
    .post('/api/v1/transfers')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      sku: 'TEST-TRANSFER-SKU',
      qty: 1,
      from_wh: warehouseBCN.code,
      from_loc: 'LOC-A',
      to_wh: warehouseBCN.code,
      to_loc: 'LOC-B',
      owner: activeClient.name,
      ownerType: 'CUSTOMER'
    });
  assert.strictEqual(validTransferRes.status, 201);
  assert.strictEqual(validTransferRes.body.owner, activeClient.name);
  assert.strictEqual(validTransferRes.body.ownerType, 'CUSTOMER');
  console.log('✓ Test 4 Passed: Transfer creation validates and persists 3PL owner');

  // ─────────────────────────────────────────────────────────────
  // Test 5: GET /api/v1/receiving/next-asn
  // ─────────────────────────────────────────────────────────────
  console.log('Test 5: GET /api/v1/receiving/next-asn format preview (H-01)...');
  const nextAsnRes = await request(app)
    .get('/api/v1/receiving/next-asn')
    .set('Authorization', `Bearer ${adminToken}`);
  assert.strictEqual(nextAsnRes.status, 200);
  const currentYear = new Date().getFullYear();
  const asnRegex = new RegExp(`^ASN-${currentYear}-\\d{6}$`);
  assert(asnRegex.test(nextAsnRes.body.asnNumber), `Expected ${nextAsnRes.body.asnNumber} to match ASN-${currentYear}-XXXXXX`);
  console.log(`✓ Test 5 Passed: Next ASN generated sequentially: ${nextAsnRes.body.asnNumber}`);

  // ─────────────────────────────────────────────────────────────
  // Test 6: Warehouse Blind Receiving
  // ─────────────────────────────────────────────────────────────
  console.log('Test 6: Warehouse Blind Receiving redact expected quantities...');
  const blindAsn = await ASN.create({
    asnId: 'ASN-BLIND-' + uniqueSuffix,
    asnNumber: 'ASN-BLIND-' + uniqueSuffix,
    poNumber: 'PO-BLIND-' + uniqueSuffix,
    supplier: 'Supplier Test',
    warehouse: warehouseBCN.code,
    owner: 'Internal Stock',
    ownerType: 'COMPANY',
    expectedDate: new Date(),
    expected_units: 50,
    items: [{
      sku: 'SKU-BLIND-01',
      name: 'Blind Item',
      expected_qty: 50,
      received_qty: 0
    }],
    company: companyId
  });

  // Detail endpoint checks
  const staffAsnRes = await request(app)
    .get(`/api/v1/receiving/${blindAsn._id}`)
    .set('Authorization', `Bearer ${staffToken}`);
  assert.strictEqual(staffAsnRes.status, 200);
  assert.strictEqual(staffAsnRes.body.blindReceiving, true);
  assert.strictEqual(staffAsnRes.body.expected_units, undefined);
  assert.strictEqual(staffAsnRes.body.items[0].expected_qty, undefined);
  assert.strictEqual('expected_units' in staffAsnRes.body, false);
  assert.strictEqual('expected_qty' in staffAsnRes.body.items[0], false);

  // List endpoint checks for warehouse staff (H-02)
  const staffListRes = await request(app)
    .get('/api/v1/receiving')
    .set('Authorization', `Bearer ${staffToken}`);
  assert.strictEqual(staffListRes.status, 200);
  const staffListItems = staffListRes.body.data || staffListRes.body;
  const staffBlindFound = staffListItems.find(a => a._id === blindAsn._id.toString() || a.asnId === blindAsn.asnId);
  assert(staffBlindFound, 'Staff should find blind ASN in list');
  assert.strictEqual(staffBlindFound.expected_units, undefined);
  assert.strictEqual('expected_units' in staffBlindFound, false);
  assert.strictEqual(staffBlindFound.items[0].expected_qty, undefined);
  assert.strictEqual('expected_qty' in staffBlindFound.items[0], false);

  const adminAsnRes = await request(app)
    .get(`/api/v1/receiving/${blindAsn._id}`)
    .set('Authorization', `Bearer ${adminToken}`);
  assert.strictEqual(adminAsnRes.status, 200);
  assert.strictEqual(adminAsnRes.body.items[0].expected_qty, 50);

  const adminListRes = await request(app)
    .get('/api/v1/receiving')
    .set('Authorization', `Bearer ${adminToken}`);
  assert.strictEqual(adminListRes.status, 200);
  const adminListItems = adminListRes.body.data || adminListRes.body;
  const adminBlindFound = adminListItems.find(a => a._id === blindAsn._id.toString() || a.asnId === blindAsn.asnId);
  assert(adminBlindFound, 'Admin should find blind ASN in list');
  assert.strictEqual(adminBlindFound.expected_units, 50);
  assert.strictEqual(adminBlindFound.items[0].expected_qty, 50);
  console.log('✓ Test 6 Passed: Warehouse blind receiving hides expected units from operators on both list and detail endpoints');

  // ─────────────────────────────────────────────────────────────
  // Test 7: QC Profiles and Electronics Validation (G-03)
  // ─────────────────────────────────────────────────────────────
  console.log('Test 7: QC Profiles seeding and Electronics validation...');
  const qcProfilesRes = await request(app)
    .get('/api/v1/qc/profiles')
    .set('Authorization', `Bearer ${adminToken}`);
  assert.strictEqual(qcProfilesRes.status, 200);
  assert(qcProfilesRes.body.some(p => p.name === 'Electronics / Equipment QC'));

  const elecProduct = await Product.create({
    sku: 'ELEC-' + uniqueSuffix,
    name: 'Smart Device',
    category: 'ELECTRONIC',
    qc_profile: 'Electronics / Equipment',
    qty_available: 0,
    price: 250,
    company: companyId
  });

  const qItem = await QuarantineInventory.create({
    quarantineId: 'Q-ELEC-' + uniqueSuffix,
    asnId: 'ASN-TEST-' + uniqueSuffix,
    owner: 'Internal Stock',
    ownerType: 'COMPANY',
    sku: elecProduct.sku,
    productName: elecProduct.name,
    warehouse: warehouseBCN.code,
    bin: `${warehouseBCN.code}-RCV-DOCK1`,
    qty: 10,
    status: 'pending_qc',
    company: companyId
  });

  const failQcRes = await request(app)
    .post(`/api/v1/qc/${qItem._id}/pass`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ notes: 'Visually checked', approvedQty: 10 });
  assert.strictEqual(failQcRes.status, 422);
  assert(failQcRes.body.message.includes('Functional test verification is required'));

  const failQcRes2 = await request(app)
    .post(`/api/v1/qc/${qItem._id}/pass`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ functionalCheck: true, approvedQty: 10 });
  assert.strictEqual(failQcRes2.status, 422);
  assert(failQcRes2.body.message.includes('Serial number verification is required'));

  const okQcRes = await request(app)
    .post(`/api/v1/qc/${qItem._id}/pass`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      functionalCheck: true,
      serialNumbers: 'SN-001, SN-002, SN-003',
      approvedQty: 10
    });
  assert.strictEqual(okQcRes.status, 200);
  console.log('✓ Test 7 Passed: Electronics QC profile strictly validates functional and serial verification');

  // ─────────────────────────────────────────────────────────────
  // Test 8: Picking execution Location empty status & qty_reserved decrement (D-03)
  // ─────────────────────────────────────────────────────────────
  console.log('Test 8: Picking execution Location status and reservation decrement...');
  const zone = await Zone.create({
    code: 'ZONE-PICK-' + uniqueSuffix.slice(-4),
    warehouse: warehouseBCN._id,
    company: companyId
  });

  const testLoc = await Location.create({
    code: 'PICK-LOC-' + uniqueSuffix.slice(-4),
    warehouse: warehouseBCN._id,
    zone: zone._id,
    status: 'OCCUPIED',
    company: companyId
  });

  const pickProd = await Product.create({
    sku: 'PICK-PROD-' + uniqueSuffix,
    name: 'Pick Item',
    qty_available: 50,
    qty_reserved: 10,
    price: 20,
    company: companyId
  });

  await InventoryBalance.create({
    sku: pickProd.sku,
    warehouse: warehouseBCN.code,
    bin: testLoc.code,
    qtyAvailable: 0,
    qtyReserved: 10,
    company: companyId
  });

  const pickTask = await PickTask.create({
    taskId: 'TASK-PICK-' + uniqueSuffix,
    orderId: 'ORD-PICK-' + uniqueSuffix,
    orderType: 'B2B',
    owner: 'Internal Stock',
    status: 'in_progress',
    warehouse: warehouseBCN.code,
    items: [{
      sku: pickProd.sku,
      productName: pickProd.name,
      orderedQty: 10,
      sourceLocation: testLoc.code,
      inventoryOwner: 'Internal Stock',
      ownerType: 'COMPANY'
    }],
    company: companyId
  });

  const completePickRes = await request(app)
    .post(`/api/v1/picking/${pickTask._id}/complete`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      items: [{
        sku: pickProd.sku,
        actualPicked: 10,
        shortfall: 0,
        location: testLoc.code
      }]
    });
  assert.strictEqual(completePickRes.status, 200);

  const updatedProd = await Product.findById(pickProd._id);
  assert.strictEqual(updatedProd.qty_reserved, 0);

  const updatedLoc = await Location.findById(testLoc._id);
  assert.strictEqual(updatedLoc.status, 'AVAILABLE');
  console.log('✓ Test 8 Passed: Location transitions to AVAILABLE when stock empties and qty_reserved decrements');

  // ─────────────────────────────────────────────────────────────
  // Test 9: Storage Rules Reordering (RF-P03)
  // ─────────────────────────────────────────────────────────────
  console.log('Test 9: Storage Rules reordering...');
  const r1 = await StorageRule.create({
    code: 'RULE-1-' + uniqueSuffix,
    name: 'Rule One',
    ruleType: 'PUTAWAY',
    priority: 1,
    action: 'send_to_zone',
    warehouse: warehouseBCN._id,
    company: companyId
  });

  const r2 = await StorageRule.create({
    code: 'RULE-2-' + uniqueSuffix,
    name: 'Rule Two',
    ruleType: 'PUTAWAY',
    priority: 2,
    action: 'send_to_zone',
    warehouse: warehouseBCN._id,
    company: companyId
  });

  const reorderRes = await request(app)
    .post('/api/v1/storage-rules/reorder')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ ruleIds: [r2._id.toString(), r1._id.toString()] });
  assert.strictEqual(reorderRes.status, 200);

  const checkR1 = await StorageRule.findById(r1._id);
  const checkR2 = await StorageRule.findById(r2._id);
  assert.strictEqual(checkR2.priority, 1);
  assert.strictEqual(checkR1.priority, 2);
  console.log('✓ Test 9 Passed: Storage rules priority reordered successfully');

  // ─────────────────────────────────────────────────────────────
  // Test 10: Location CSV Importer with whole-file validation
  // ─────────────────────────────────────────────────────────────
  console.log('Test 10: Location CSV Importer whole-file validation...');
  const zoneEstanterias = await Zone.create({
    code: 'ESTANTERIAS',
    name: 'Estanterias Zone',
    warehouse: warehouseBCN._id,
    company: companyId
  });

  const csvPayload = `code,warehouse,zone,locationType,status,maxUnits,maxWeight\nIMPORT-A-${uniqueSuffix.slice(-4)},${warehouseBCN.code},ESTANTERIAS,SHELF,AVAILABLE,500,1000\nIMPORT-B-${uniqueSuffix.slice(-4)},${warehouseBCN.code},ESTANTERIAS,SHELF,AVAILABLE,500,1000`;

  const importLocRes = await request(app)
    .post('/api/v1/locations/import-csv')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ csvData: csvPayload });
  assert.strictEqual(importLocRes.status, 201);
  assert.strictEqual(importLocRes.body.count, 2);

  const foundLocs = await Location.find({ company: companyId, code: { $regex: new RegExp(`IMPORT-.*-${uniqueSuffix.slice(-4)}`) } });
  assert.strictEqual(foundLocs.length, 2);
  console.log('✓ Test 10 Passed: Location CSV whole-file validation and import succeeded');

  // ─────────────────────────────────────────────────────────────
  // Test 11: Idempotent 772 BCN Location Seeder
  // ─────────────────────────────────────────────────────────────
  console.log('Test 11: Idempotent 772 BCN Location Seeder (RF-P18)...');
  const bcnWhCode = 'BCN_772_' + uniqueSuffix.slice(-4);
  const seedRes = await seedBCN772Locations({ companyId, warehouseCode: bcnWhCode });
  assert.strictEqual(seedRes.success, true);
  assert.strictEqual(seedRes.totalExpected, 772);
  assert.strictEqual(seedRes.finalCountInDb, 772);

  const rerunRes = await seedBCN772Locations({ companyId, warehouseCode: bcnWhCode });
  assert.strictEqual(rerunRes.totalSeeded, 0);
  assert.strictEqual(rerunRes.finalCountInDb, 772);
  console.log('✓ Test 11 Passed: Exactly 772 BCN rack locations generated idempotently');

  console.log('\n================================================================');
  console.log('  PHASE 2 BATCH 1 SUITE: ALL 11 TESTS PASSED PERFECTLY!');
  console.log('================================================================\n');

  process.exit(0);
}

runTests().catch((err) => {
  console.error('[FAIL] Test suite failed with error:', err);
  process.exit(1);
});
