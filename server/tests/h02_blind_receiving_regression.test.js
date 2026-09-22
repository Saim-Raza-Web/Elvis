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
import ASN from '../models/ASN.js';
import { setupTestDatabase } from '../test_helper.js';

let totalChecks = 0;
let passedChecks = 0;

function check(label, condition, details = '') {
  totalChecks++;
  if (condition) {
    passedChecks++;
    console.log(`  [PASS] #${totalChecks}: ${label}`);
  } else {
    console.error(`  [FAIL] #${totalChecks}: ${label} ${details ? `(${details})` : ''}`);
    throw new Error(`Assertion failed: ${label}`);
  }
}

async function runH02RegressionSuite() {
  console.log('================================================================');
  console.log('  H-02 BLIND RECEIVING DEDICATED REGRESSION SUITE');
  console.log('================================================================\n');

  await setupTestDatabase();
  console.log('[DB] Connected to hermetic test database.\n');

  const p = Date.now().toString();

  // Setup Company A (Tenant A) and Company B (Tenant B)
  const compA = await Company.create({ name: 'H02 Corp A ' + p, code: 'COA_' + p.slice(-4), blindReceiving: false });
  const compB = await Company.create({ name: 'H02 Corp B ' + p, code: 'COB_' + p.slice(-4), blindReceiving: false });

  // Users for Company A
  const adminA = await User.create({ name: 'Admin A', email: `admin_a_${p}@test.com`, password: 'pwd', role: 'admin', company: compA._id });
  const adminTokenA = jwt.sign({ id: adminA._id, company: compA._id, role: 'admin' }, process.env.JWT_SECRET || 'secret');

  const managerA = await User.create({ name: 'Manager A', email: `manager_a_${p}@test.com`, password: 'pwd', role: 'manager', company: compA._id });
  const managerTokenA = jwt.sign({ id: managerA._id, company: compA._id, role: 'manager' }, process.env.JWT_SECRET || 'secret');

  const staffA = await User.create({ name: 'Staff A', email: `staff_a_${p}@test.com`, password: 'pwd', role: 'warehouse_staff', company: compA._id });
  const staffTokenA = jwt.sign({ id: staffA._id, company: compA._id, role: 'warehouse_staff' }, process.env.JWT_SECRET || 'secret');

  // Warehouses for Company A: 1 Blind, 1 Non-Blind
  const whBlindA = await Warehouse.create({ code: 'WH_BLIND_' + p.slice(-4), name: 'Blind Warehouse A', blindReceiving: true, company: compA._id });
  const whNormalA = await Warehouse.create({ code: 'WH_NORM_' + p.slice(-4), name: 'Normal Warehouse A', blindReceiving: false, company: compA._id });

  // Warehouse for Company B: Non-Blind
  const whB = await Warehouse.create({ code: 'WH_B_' + p.slice(-4), name: 'Warehouse B', blindReceiving: false, company: compB._id });

  // Create ASNs
  // ASN 1: Blind Warehouse in Company A
  const asnBlind = await ASN.create({
    asnId: 'ASN-BLIND-' + p,
    asnNumber: 'ASN-BLIND-' + p,
    poNumber: 'PO-BLIND-01',
    supplier: 'Supplier Blind Inc',
    warehouse: whBlindA.code,
    owner: 'Internal Stock',
    ownerType: 'COMPANY',
    expectedDate: new Date(),
    expected_units: 100,
    items: [
      { sku: 'SKU-BLIND-01', name: 'Blind Prod 1', expected_qty: 60, received_qty: 0 },
      { sku: 'SKU-BLIND-02', name: 'Blind Prod 2', expected_qty: 40, received_qty: 0 }
    ],
    company: compA._id
  });

  // ASN 2: Normal (Non-Blind) Warehouse in Company A
  const asnNormal = await ASN.create({
    asnId: 'ASN-NORM-' + p,
    asnNumber: 'ASN-NORM-' + p,
    poNumber: 'PO-NORM-01',
    supplier: 'Supplier Normal Inc',
    warehouse: whNormalA.code,
    owner: 'Internal Stock',
    ownerType: 'COMPANY',
    expectedDate: new Date(),
    expected_units: 50,
    items: [
      { sku: 'SKU-NORM-01', name: 'Normal Prod 1', expected_qty: 50, received_qty: 0 }
    ],
    company: compA._id
  });

  // ASN 3: Belongs to Company B (Tenant B)
  const asnCrossTenant = await ASN.create({
    asnId: 'ASN-COMP-B-' + p,
    asnNumber: 'ASN-COMP-B-' + p,
    poNumber: 'PO-B-01',
    supplier: 'Supplier B Foreign',
    warehouse: whB.code,
    owner: 'Internal Stock',
    ownerType: 'COMPANY',
    expectedDate: new Date(),
    expected_units: 75,
    items: [
      { sku: 'SKU-B-01', name: 'Foreign Prod', expected_qty: 75, received_qty: 0 }
    ],
    company: compB._id
  });

  console.log('--- TEST A: warehouse_staff + blind warehouse + LIST endpoint => expected_units absent ---');
  const staffListRes = await request(app)
    .get('/api/v1/receiving')
    .set('Authorization', `Bearer ${staffTokenA}`);
  check('Staff list request returns 200', staffListRes.status === 200);

  const staffItems = staffListRes.body.data || staffListRes.body;
  const staffBlindFound = staffItems.find(a => a._id === asnBlind._id.toString() || a.asnId === asnBlind.asnId);
  check('Blind ASN present in staff list query', Boolean(staffBlindFound));
  check('Blind ASN expected_units is strictly absent (undefined)', staffBlindFound.expected_units === undefined);
  check('Blind ASN does not have expected_units property in keys', !('expected_units' in staffBlindFound));
  check('Blind ASN does not have expectedUnits property in keys', !('expectedUnits' in staffBlindFound));
  check('Blind ASN does not have expected_quantity property in keys', !('expected_quantity' in staffBlindFound));
  check('Blind ASN does not have expectedQuantity property in keys', !('expectedQuantity' in staffBlindFound));

  console.log('\n--- TEST B: warehouse_staff + blind warehouse + LIST endpoint => items[].expected_qty absent ---');
  check('Blind ASN has items array', Array.isArray(staffBlindFound.items) && staffBlindFound.items.length === 2);
  check('Line 1 expected_qty is strictly absent (undefined)', staffBlindFound.items[0].expected_qty === undefined);
  check('Line 1 does not have expected_qty in keys', !('expected_qty' in staffBlindFound.items[0]));
  check('Line 1 does not have expectedQty in keys', !('expectedQty' in staffBlindFound.items[0]));
  check('Line 1 does not have expected_quantity in keys', !('expected_quantity' in staffBlindFound.items[0]));
  check('Line 1 does not have expectedQuantity in keys', !('expectedQuantity' in staffBlindFound.items[0]));
  check('Line 2 expected_qty is strictly absent (undefined)', staffBlindFound.items[1].expected_qty === undefined);
  check('Line 2 does not have expected_qty in keys', !('expected_qty' in staffBlindFound.items[1]));
  check('Line 2 does not have expectedQty in keys', !('expectedQty' in staffBlindFound.items[1]));

  console.log('\n--- TEST C: warehouse_staff + blind warehouse + DETAIL endpoint => expected fields absent ---');
  const staffDetailRes = await request(app)
    .get(`/api/v1/receiving/${asnBlind._id}`)
    .set('Authorization', `Bearer ${staffTokenA}`);
  check('Staff detail request returns 200', staffDetailRes.status === 200);
  check('Detail expected_units is strictly absent', staffDetailRes.body.expected_units === undefined);
  check('Detail expected_units key absent', !('expected_units' in staffDetailRes.body));
  check('Detail expectedUnits key absent', !('expectedUnits' in staffDetailRes.body));
  check('Detail expected_quantity key absent', !('expected_quantity' in staffDetailRes.body));
  check('Detail expectedQuantity key absent', !('expectedQuantity' in staffDetailRes.body));
  check('Detail items[0].expected_qty is strictly absent', staffDetailRes.body.items[0].expected_qty === undefined);
  check('Detail items[0] expected_qty key absent', !('expected_qty' in staffDetailRes.body.items[0]));
  check('Detail items[0] expectedQty key absent', !('expectedQty' in staffDetailRes.body.items[0]));
  check('Detail items[0] expected_quantity key absent', !('expected_quantity' in staffDetailRes.body.items[0]));
  check('Detail items[0] expectedQuantity key absent', !('expectedQuantity' in staffDetailRes.body.items[0]));
  check('Detail items[1].expected_qty is strictly absent', staffDetailRes.body.items[1].expected_qty === undefined);
  check('Detail blindReceiving flag is true', staffDetailRes.body.blindReceiving === true);

  console.log('\n--- TEST D: warehouse_staff + non-blind warehouse + LIST => expected fields visible ---');
  const staffNormalFound = staffItems.find(a => a._id === asnNormal._id.toString() || a.asnId === asnNormal.asnId);
  check('Normal ASN present in staff list query', Boolean(staffNormalFound));
  check('Normal ASN expected_units is visible (50)', staffNormalFound.expected_units === 50);
  check('Normal ASN line 1 expected_qty is visible (50)', staffNormalFound.items[0].expected_qty === 50);

  console.log('\n--- TEST E: warehouse_staff + non-blind warehouse + DETAIL => expected fields visible ---');
  const staffNormalDetail = await request(app)
    .get(`/api/v1/receiving/${asnNormal._id}`)
    .set('Authorization', `Bearer ${staffTokenA}`);
  check('Staff normal detail request returns 200', staffNormalDetail.status === 200);
  check('Normal detail expected_units is visible (50)', staffNormalDetail.body.expected_units === 50);
  check('Normal detail items[0].expected_qty is visible (50)', staffNormalDetail.body.items[0].expected_qty === 50);
  check('Normal detail blindReceiving flag is false', staffNormalDetail.body.blindReceiving === false);

  console.log('\n--- TEST F: manager/admin + blind warehouse + LIST => expected fields visible ---');
  const adminListRes = await request(app)
    .get('/api/v1/receiving')
    .set('Authorization', `Bearer ${adminTokenA}`);
  check('Admin list request returns 200', adminListRes.status === 200);
  const adminItems = adminListRes.body.data || adminListRes.body;
  const adminBlindFound = adminItems.find(a => a._id === asnBlind._id.toString() || a.asnId === asnBlind.asnId);
  check('Admin sees expected_units on blind ASN in list (100)', adminBlindFound.expected_units === 100);
  check('Admin sees items[0].expected_qty on blind ASN in list (60)', adminBlindFound.items[0].expected_qty === 60);
  check('Admin sees items[1].expected_qty on blind ASN in list (40)', adminBlindFound.items[1].expected_qty === 40);

  const managerListRes = await request(app)
    .get('/api/v1/receiving')
    .set('Authorization', `Bearer ${managerTokenA}`);
  const managerItems = managerListRes.body.data || managerListRes.body;
  const managerBlindFound = managerItems.find(a => a._id === asnBlind._id.toString() || a.asnId === asnBlind.asnId);
  check('Manager sees expected_units on blind ASN in list (100)', managerBlindFound.expected_units === 100);
  check('Manager sees items[0].expected_qty on blind ASN in list (60)', managerBlindFound.items[0].expected_qty === 60);

  console.log('\n--- TEST G: manager/admin + blind warehouse + DETAIL => expected fields visible ---');
  const adminDetailRes = await request(app)
    .get(`/api/v1/receiving/${asnBlind._id}`)
    .set('Authorization', `Bearer ${adminTokenA}`);
  check('Admin detail request returns 200', adminDetailRes.status === 200);
  check('Admin sees expected_units on blind ASN detail (100)', adminDetailRes.body.expected_units === 100);
  check('Admin sees items[0].expected_qty on blind ASN detail (60)', adminDetailRes.body.items[0].expected_qty === 60);
  check('Admin sees items[1].expected_qty on blind ASN detail (40)', adminDetailRes.body.items[1].expected_qty === 40);
  check('Admin sees blindReceiving: true flag on detail', adminDetailRes.body.blindReceiving === true);

  console.log('\n--- TEST H: mixed list containing blind + non-blind warehouses => independent redaction ---');
  // Both asnBlind and asnNormal are in staffItems
  const itemBlindInMixed = staffItems.find(a => a.warehouse === whBlindA.code);
  const itemNormInMixed = staffItems.find(a => a.warehouse === whNormalA.code);
  check('Mixed list contains both blind and normal warehouse ASNs', Boolean(itemBlindInMixed && itemNormInMixed));
  check('In mixed list, blind ASN is redacted (expected_units absent)', itemBlindInMixed.expected_units === undefined);
  check('In mixed list, normal ASN is NOT redacted (expected_units = 50)', itemNormInMixed.expected_units === 50);

  console.log('\n--- TEST I: cross-tenant ASN cannot be exposed through list response ---');
  const crossTenantInStaffList = staffItems.find(a => a._id === asnCrossTenant._id.toString() || a.asnId === asnCrossTenant.asnId);
  check('Company B ASN is completely absent from Company A list query', crossTenantInStaffList === undefined);

  const crossTenantDetailRes = await request(app)
    .get(`/api/v1/receiving/${asnCrossTenant._id}`)
    .set('Authorization', `Bearer ${staffTokenA}`);
  check('Company A staff cannot access Company B ASN detail (404)', crossTenantDetailRes.status === 404);

  console.log('\n--- TEST J: warehouse-scoped queries and filtering ---');
  // 1. Scoped query for blind warehouse
  const scopedBlindRes = await request(app)
    .get(`/api/v1/receiving?warehouse=${whBlindA.code}`)
    .set('Authorization', `Bearer ${staffTokenA}`);
  check('Scoped query returns 200', scopedBlindRes.status === 200);
  const scopedItems = scopedBlindRes.body.data || scopedBlindRes.body;
  check('All returned ASNs belong strictly to requested warehouse', scopedItems.every(a => a.warehouse === whBlindA.code));

  // 2. Querying a warehouse from another tenant
  const invalidWhRes = await request(app)
    .get(`/api/v1/receiving?warehouse=${whB.code}`)
    .set('Authorization', `Bearer ${staffTokenA}`);
  check('Querying cross-tenant warehouse rejected with 400', invalidWhRes.status === 400 && invalidWhRes.body.error === 'INVALID_WAREHOUSE');

  console.log('\n================================================================');
  console.log(`  H-02 DEDICATED REGRESSION SUITE: ALL ${passedChecks}/${totalChecks} CHECKS PASSED`);
  console.log('================================================================\n');

  process.exit(0);
}

runH02RegressionSuite().catch(err => {
  console.error('[H-02 REGRESSION FAILURE]', err);
  process.exit(1);
});
