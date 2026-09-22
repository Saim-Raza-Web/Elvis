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
import PutawayTask from '../models/PutawayTask.js';
import Return from '../models/Return.js';
import Document from '../models/Document.js';
import { validateOwnerMaster } from '../utils/ownerValidation.js';
import { seedBCN772Locations } from '../scripts/seed_bcn_772_locations.js';
import { setupTestDatabase } from '../test_helper.js';

let passedChecks = 0;
let totalChecks = 0;
const failedChecks = [];

function check(title, condition, extraInfo = '') {
  totalChecks++;
  if (condition) {
    passedChecks++;
    console.log(`  [PASS] #${totalChecks}: ${title}`);
  } else {
    failedChecks.push({ check: totalChecks, title, extraInfo });
    console.error(`  [FAIL] #${totalChecks}: ${title} ${extraInfo ? `-> ${extraInfo}` : ''}`);
  }
}

async function runForensicGate() {
  console.log('================================================================');
  console.log('  PHASE 2 BATCH 1 — FORENSIC RELEASE GATE TEST SUITE');
  console.log('================================================================\n');

  await setupTestDatabase();
  console.log('[DB] Hermetic in-memory test database connected.\n');

  const p = Date.now().toString();

  // Setup Company A & Company B
  const compA = await Company.create({ name: 'Forensic Corp A ' + p, code: 'COA_' + p.slice(-4), blindReceiving: false });
  const compB = await Company.create({ name: 'Forensic Corp B ' + p, code: 'COB_' + p.slice(-4), blindReceiving: false });

  // Tokens
  const adminA = await User.create({ name: 'Admin A', email: `adminA_${p}@test.com`, password: 'pwd', role: 'admin', company: compA._id });
  const tokenA = jwt.sign({ id: adminA._id, company: compA._id, role: 'admin' }, process.env.JWT_SECRET || 'secret');

  const staffA = await User.create({ name: 'Staff A', email: `staffA_${p}@test.com`, password: 'pwd', role: 'warehouse_staff', company: compA._id });
  const staffTokenA = jwt.sign({ id: staffA._id, company: compA._id, role: 'warehouse_staff' }, process.env.JWT_SECRET || 'secret');

  const adminB = await User.create({ name: 'Admin B', email: `adminB_${p}@test.com`, password: 'pwd', role: 'admin', company: compB._id });
  const tokenB = jwt.sign({ id: adminB._id, company: compB._id, role: 'admin' }, process.env.JWT_SECRET || 'secret');

  // Warehouses
  const whA1_blind = await Warehouse.create({ code: 'WHA1_' + p.slice(-4), name: 'WH A1 Blind', blindReceiving: true, company: compA._id });
  const whA2_normal = await Warehouse.create({ code: 'WHA2_' + p.slice(-4), name: 'WH A2 Normal', blindReceiving: false, company: compA._id });
  const whB = await Warehouse.create({ code: 'WHB_' + p.slice(-4), name: 'WH B Normal', blindReceiving: false, company: compB._id });

  // Staging zones and locations for putaway/QC fallback
  for (const wh of [whA1_blind, whA2_normal, whB]) {
    const stgZone = await Zone.create({ code: 'STAGING', name: 'Staging Area', warehouse: wh._id, company: wh.company });
    await Location.create({ code: `${wh.code}-STAGE-01`, name: 'Stage 1', warehouse: wh._id, zone: stgZone._id, locationType: 'STAGING', status: 'AVAILABLE', company: wh.company });
  }

  // Clients
  const clientActiveA = await Client.create({ name: 'Active Depositor A ' + p, active: true, company: compA._id });
  const clientInactiveA = await Client.create({ name: 'Suspended Depositor A ' + p, active: false, company: compA._id });
  const clientB = await Client.create({ name: 'Foreign Depositor B ' + p, active: true, company: compB._id });

  // Base Products for ASN Tests
  await Product.create({ sku: 'SKU-01', name: 'Product 01', price: 10, company: compA._id });
  await Product.create({ sku: 'SKU-CONC', name: 'Product Conc', price: 10, company: compA._id });
  await Product.create({ sku: 'SKU-B', name: 'Product B', price: 10, company: compB._id });

  console.log('--- SECTION 1: G-01 3PL DEPOSITOR MASTER ENFORCEABILITY ---');
  // 1. validateOwnerMaster unit logic across conditions
  const errUnknown = await validateOwnerMaster('Unknown 3PL', 'CUSTOMER', compA._id);
  check('Unknown client rejected', errUnknown && errUnknown.includes('not a registered'));

  const errInactive = await validateOwnerMaster(clientInactiveA.name, 'CUSTOMER', compA._id);
  check('Inactive client rejected', errInactive && errInactive.includes('inactive 3PL Client'));

  const errCrossTenant = await validateOwnerMaster(clientB.name, 'CUSTOMER', compA._id);
  check('Cross-tenant client rejected', errCrossTenant && errCrossTenant.includes('not a registered'));

  const errActive = await validateOwnerMaster(clientActiveA.name, 'CUSTOMER', compA._id);
  check('Active registered client accepted', errActive === null);

  const errInternal = await validateOwnerMaster('Internal Stock', 'COMPANY', compA._id);
  check('Internal Stock accepted as COMPANY', errInternal === null);

  // 2. ASN/Receiving owner validation
  const asnResFail = await request(app)
    .post('/api/v1/receiving')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      supplier: 'Supplier Inc',
      warehouse: whA1_blind.code,
      receivingDock: 'DOCK-01',
      owner: clientInactiveA.name,
      ownerType: 'CUSTOMER',
      expectedDate: new Date(),
      poNumber: 'PO-TEST-01',
      items: [{ sku: 'SKU-01', expected_qty: 10 }]
    });
  check('ASN creation with inactive owner rejected', (asnResFail.status === 400 || asnResFail.status === 422) && asnResFail.body.message.includes('inactive 3PL Client'));

  const asnResOk = await request(app)
    .post('/api/v1/receiving')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      supplier: 'Supplier Inc',
      warehouse: whA1_blind.code,
      receivingDock: 'DOCK-01',
      owner: clientActiveA.name,
      ownerType: 'CUSTOMER',
      expectedDate: new Date(),
      poNumber: 'PO-TEST-02',
      items: [{ sku: 'SKU-01', expected_qty: 10 }]
    });
  check('ASN creation with active owner returns 201 & persists owner', asnResOk.status === 201 && asnResOk.body.owner === clientActiveA.name && asnResOk.body.ownerType === 'CUSTOMER');

  // 3. Orders owner validation
  const orderFail = await request(app)
    .post('/api/v1/orders')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      customer: 'Buyer Retailer Corp',
      email: 'buyer@test.com',
      delivery_address: { street: 'Main 1', city: 'BCN', postcode: '08001', country: 'ES' },
      owner: 'Unknown Corp',
      ownerType: 'CUSTOMER',
      warehouse: whA1_blind.code,
      product_lines: [{ sku: 'SKU-01', product_name: 'Item 1', qty: 5, unit_price: 10, line_total: 50 }]
    });
  check('Order creation with unknown owner returns 422', orderFail.status === 422);

  const orderOk = await request(app)
    .post('/api/v1/orders')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      customer: 'Buyer Retailer Corp',
      email: 'buyer@test.com',
      delivery_address: { street: 'Main 1', city: 'BCN', postcode: '08001', country: 'ES' },
      owner: clientActiveA.name,
      ownerType: 'CUSTOMER',
      warehouse: whA1_blind.code,
      product_lines: [{ sku: 'SKU-01', product_name: 'Item 1', qty: 5, unit_price: 10, line_total: 50 }]
    });
  check('Order creation with active owner returns 201', orderOk.status === 201 && orderOk.body.owner === clientActiveA.name);
  check('Order customer is NOT conflated with stock owner', orderOk.body.customer === 'Buyer Retailer Corp' && orderOk.body.owner === clientActiveA.name);

  // 4. Transfers owner validation
  const trfFail = await request(app)
    .post('/api/v1/transfers')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ sku: 'SKU-01', qty: 1, from_wh: whA1_blind.code, from_loc: 'L1', to_wh: whA1_blind.code, to_loc: 'L2', owner: clientInactiveA.name, ownerType: 'CUSTOMER' });
  check('Transfer creation with inactive owner returns 422', trfFail.status === 422);

  const trfOk = await request(app)
    .post('/api/v1/transfers')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ sku: 'SKU-01', qty: 1, from_wh: whA1_blind.code, from_loc: 'L1', to_wh: whA1_blind.code, to_loc: 'L2', owner: clientActiveA.name, ownerType: 'CUSTOMER' });
  check('Transfer creation with active owner returns 201 & auto-generates transferId', trfOk.status === 201 && trfOk.body.transferId.startsWith('TRF-'));

  console.log('\n--- SECTION 2: H-01 ASN SEQUENTIAL NUMBERING & CONCURRENCY ---');
  // 5. ASN format preview
  const nextAsnRes = await request(app)
    .get('/api/v1/receiving/next-asn')
    .set('Authorization', `Bearer ${tokenA}`);
  check('Next ASN preview status 200', nextAsnRes.status === 200);
  const currentYear = new Date().getFullYear();
  check(`Next ASN matches ASN-${currentYear}-XXXXXX`, new RegExp(`^ASN-${currentYear}-\\d{6}$`).test(nextAsnRes.body.asnNumber));

  // 6. Concurrency test: 10 concurrent ASN creations
  const concurrentCount = 10;
  const promises = [];
  for (let i = 0; i < concurrentCount; i++) {
    promises.push(
      request(app)
        .post('/api/v1/receiving')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          supplier: `Supplier Conc ${i}`,
          warehouse: whA1_blind.code,
          receivingDock: 'DOCK-01',
          owner: 'Internal Stock',
          ownerType: 'COMPANY',
          expectedDate: new Date(),
          poNumber: `PO-CONC-${i}`,
          items: [{ sku: 'SKU-CONC', expected_qty: 1 }]
        })
    );
  }
  const results = await Promise.all(promises);
  const asnNumbers = results.map(r => r.body.asnNumber).filter(Boolean);
  check('All 10 concurrent ASNs created with 201', results.every(r => r.status === 201));
  check('All 10 concurrent ASN numbers are strictly unique', new Set(asnNumbers).size === concurrentCount);

  // 7. Tenant isolation in ASN counter
  const asnCompB = await request(app)
    .post('/api/v1/receiving')
    .set('Authorization', `Bearer ${tokenB}`)
    .send({
      supplier: 'Supplier B',
      warehouse: whB.code,
      receivingDock: 'DOCK-01',
      owner: 'Internal Stock',
      ownerType: 'COMPANY',
      expectedDate: new Date(),
      poNumber: 'PO-B-01',
      items: [{ sku: 'SKU-B', expected_qty: 1 }]
    });
  check('Company B sequential counter starts independently at 000001', asnCompB.body.asnNumber === `ASN-${currentYear}-000001`);

  console.log('\n--- SECTION 3: H-02 BLIND RECEIVING API & LEAKAGE PROOF ---');
  // 8. Create blind ASN in whA1_blind
  const blindAsn = await ASN.create({
    asnId: 'ASN-BLIND-' + p,
    asnNumber: 'ASN-BLIND-' + p,
    poNumber: 'PO-BLIND-99',
    supplier: 'Blind Supplier',
    warehouse: whA1_blind.code,
    owner: 'Internal Stock',
    ownerType: 'COMPANY',
    expectedDate: new Date(),
    expected_units: 100,
    items: [{ sku: 'SKU-BLIND', name: 'Blind Prod', expected_qty: 100, received_qty: 0 }],
    company: compA._id
  });

  // Staff query GET by ID
  const staffGet = await request(app)
    .get(`/api/v1/receiving/${blindAsn._id}`)
    .set('Authorization', `Bearer ${staffTokenA}`);
  check('Staff GET on blind ASN has blindReceiving: true', staffGet.body.blindReceiving === true);
  check('Staff GET on blind ASN redacts expected_units to undefined', staffGet.body.expected_units === undefined);
  check('Staff GET on blind ASN redacts items[0].expected_qty to undefined', staffGet.body.items[0].expected_qty === undefined);

  // Staff query GET list
  const staffList = await request(app)
    .get(`/api/v1/receiving`)
    .set('Authorization', `Bearer ${staffTokenA}`);
  const asns = Array.isArray(staffList.body) ? staffList.body : (staffList.body.data || staffList.body.items || []);
  const staffFound = asns.find(a => a._id === blindAsn._id.toString());
  check('Staff list query redacts expected_units for blind warehouse', staffFound && staffFound.expected_units === undefined);

  // Admin query GET by ID (normal exposure)
  const adminGet = await request(app)
    .get(`/api/v1/receiving/${blindAsn._id}`)
    .set('Authorization', `Bearer ${tokenA}`);
  check('Admin GET sees actual expected_units (100)', adminGet.body.expected_units === 100);
  check('Admin GET sees items[0].expected_qty (100)', adminGet.body.items[0].expected_qty === 100);

  // Normal warehouse (blindReceiving: false) exposes to staff
  const normalAsn = await ASN.create({
    asnId: 'ASN-NORM-' + p,
    asnNumber: 'ASN-NORM-' + p,
    poNumber: 'PO-NORM-99',
    supplier: 'Normal Supplier',
    warehouse: whA2_normal.code,
    owner: 'Internal Stock',
    ownerType: 'COMPANY',
    expectedDate: new Date(),
    expected_units: 50,
    items: [{ sku: 'SKU-NORM', name: 'Normal Prod', expected_qty: 50, received_qty: 0 }],
    company: compA._id
  });
  const staffNormalGet = await request(app)
    .get(`/api/v1/receiving/${normalAsn._id}`)
    .set('Authorization', `Bearer ${staffTokenA}`);
  check('Staff GET on normal warehouse exposes expected_units (50)', staffNormalGet.body.expected_units === 50);

  console.log('\n--- SECTION 4: G-03 QUALITY CONTROL PROFILES & ELECTRONICS ENFORCEMENT ---');
  // 9. Auto-seeding default profiles
  const profilesRes = await request(app)
    .get('/api/v1/qc/profiles')
    .set('Authorization', `Bearer ${tokenA}`);
  const profileNames = profilesRes.body.map(p => p.name);
  check('Standard QC profile exists', profileNames.includes('Standard QC'));
  check('Cold Chain QC profile exists', profileNames.includes('Cold Chain QC'));
  check('Electronics / Equipment QC profile exists', profileNames.includes('Electronics / Equipment QC'));

  // 10. Electronics enforcement
  const elecProd = await Product.create({
    sku: 'ELEC-' + p,
    name: 'Electronic Device',
    category: 'ELECTRONIC',
    qc_profile: 'Electronics / Equipment',
    qty_available: 0,
    price: 300,
    company: compA._id
  });

  const qElec = await QuarantineInventory.create({
    quarantineId: 'Q-ELEC-' + p,
    asnId: 'ASN-QC-01',
    owner: 'Internal Stock',
    ownerType: 'COMPANY',
    sku: elecProd.sku,
    productName: elecProd.name,
    warehouse: whA1_blind.code,
    bin: `${whA1_blind.code}-RCV-DOCK1`,
    qty: 10,
    status: 'pending_qc',
    company: compA._id
  });

  // Direct pass without functionalCheck -> 422
  const qcPassNoFunc = await request(app)
    .post(`/api/v1/qc/${qElec._id}/pass`)
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ approvedQty: 10 });
  check('Electronics QC pass without functionalCheck blocked with 422', qcPassNoFunc.status === 422 && qcPassNoFunc.body.message.includes('Functional test'));

  // Pass with functionalCheck but no serialNumbers -> 422
  const qcPassNoSer = await request(app)
    .post(`/api/v1/qc/${qElec._id}/pass`)
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ functionalCheck: true, approvedQty: 10 });
  check('Electronics QC pass without serialNumbers blocked with 422', qcPassNoSer.status === 422 && qcPassNoSer.body.message.includes('Serial number'));

  // Pass with both -> 200 & partial approval
  const qcPassOk = await request(app)
    .post(`/api/v1/qc/${qElec._id}/pass`)
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      functionalCheck: true,
      serialNumbers: 'SN-001, SN-002, SN-003',
      approvedQty: 7,
      rejectedQty: 3,
      rejectionDestination: 'Scrap Bin'
    });
  check('Electronics QC pass with functionalCheck & serialNumbers succeeds (200)', qcPassOk.status === 200);

  // Check remaining rejected units stayed in quarantine
  const rejectedRecord = await QuarantineInventory.findOne({ quarantineId: qElec.quarantineId + '-REJ' });
  check('Partial rejection leaves 3 units in quarantine', rejectedRecord && rejectedRecord.qty === 3);

  console.log('\n--- SECTION 5: D-02 & D-03 PICKING EXECUTION, EMPTY LOCATION RELEASE, & DELIVERY NOTE ---');
  // 11. Setup Picking Environment
  const pickZone = await Zone.create({ code: 'PICK-ZONE-' + p.slice(-4), warehouse: whA1_blind._id, company: compA._id });
  const locEmpty = await Location.create({ code: `LOC-EMPTY-${p.slice(-4)}`, warehouse: whA1_blind._id, zone: pickZone._id, status: 'OCCUPIED', company: compA._id });

  const pickProduct = await Product.create({
    sku: 'SKU-PICK-' + p,
    name: 'Pick Item Target',
    qty_available: 50,
    qty_reserved: 10,
    price: 15,
    company: compA._id
  });

  await InventoryBalance.create({
    sku: pickProduct.sku,
    warehouse: whA1_blind.code,
    bin: locEmpty.code,
    qtyAvailable: 0,
    qtyReserved: 10,
    owner: 'Internal Stock',
    ownerType: 'COMPANY',
    company: compA._id
  });

  const pickTask = await PickTask.create({
    taskId: 'PICK-TASK-' + p,
    orderId: 'ORD-PICK-' + p,
    orderType: 'B2B',
    owner: 'Internal Stock',
    status: 'in_progress',
    warehouse: whA1_blind.code,
    items: [{
      sku: pickProduct.sku,
      productName: pickProduct.name,
      orderedQty: 10,
      pickedQty: 0,
      shortfallQty: 0,
      sourceLocation: locEmpty.code,
      inventoryOwner: 'Internal Stock',
      ownerType: 'COMPANY',
      status: 'pending'
    }],
    company: compA._id
  });

  // Complete picking: 10 picked
  const completePick = await request(app)
    .post(`/api/v1/picking/${pickTask._id}/complete`)
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      items: [{
        sku: pickProduct.sku,
        actualPicked: 10,
        shortfall: 0,
        location: locEmpty.code
      }]
    });
  check('Pick completion succeeds with 200', completePick.status === 200);

  // Invariant verification: Product.qty_reserved decremented
  const updatedPickProd = await Product.findById(pickProduct._id);
  check('Product.qty_reserved decremented from 10 to 0', updatedPickProd.qty_reserved === 0);
  check('Product.qty_available was NOT double-decremented (remains 50)', updatedPickProd.qty_available === 50);

  // Empty location status update
  const updatedLoc = await Location.findById(locEmpty._id);
  check('Location status automatically transitions to AVAILABLE when bin hits 0', updatedLoc.status === 'AVAILABLE');

  // Delivery note generation
  const updatedTask = await PickTask.findById(pickTask._id);
  check('Delivery note number generated on PickTask', Boolean(updatedTask.deliveryNoteNumber));

  console.log('\n--- SECTION 6: RF-P03 STORAGE RULES MANAGEMENT & REORDERING ---');
  // 12. Create rules and reorder
  const rule1 = await StorageRule.create({
    code: 'RULE-A-' + p,
    name: 'Rule Alpha',
    ruleType: 'PUTAWAY',
    priority: 1,
    action: 'send_to_zone',
    warehouse: whA1_blind._id,
    company: compA._id
  });
  const rule2 = await StorageRule.create({
    code: 'RULE-B-' + p,
    name: 'Rule Beta',
    ruleType: 'PUTAWAY',
    priority: 2,
    action: 'send_to_zone',
    warehouse: whA1_blind._id,
    company: compA._id
  });

  const reorderRes = await request(app)
    .post('/api/v1/storage-rules/reorder')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ ruleIds: [rule2._id.toString(), rule1._id.toString()] });
  check('Storage rules reorder endpoint returns 200', reorderRes.status === 200);

  const checkR1 = await StorageRule.findById(rule1._id);
  const checkR2 = await StorageRule.findById(rule2._id);
  check('Rule Beta priority updated to 1', checkR2.priority === 1);
  check('Rule Alpha priority updated to 2', checkR1.priority === 2);

  console.log('\n--- SECTION 7: RF-P18 LOCATION MANAGEMENT & 772 BCN SEEDER ---');
  // 13. Idempotent 772 BCN seed
  const bcnWhCode = 'BCN_772_' + p.slice(-4);
  const seed1 = await seedBCN772Locations({ companyId: compA._id, warehouseCode: bcnWhCode });
  check('Initial run seeds exactly 772 locations', seed1.success === true && seed1.finalCountInDb === 772);

  const seed2 = await seedBCN772Locations({ companyId: compA._id, warehouseCode: bcnWhCode });
  check('Idempotent second run seeds 0 new locations and remains 772', seed2.totalSeeded === 0 && seed2.finalCountInDb === 772);

  console.log('\n--- SECTION 8: RF-P19 INITIAL STOCK LOAD ATOMICITY & REJECTION ---');
  // 14. Atomic rollback test: 2 valid rows + 1 invalid row (unknown SKU)
  const prodInitA = await Product.create({ sku: 'SKU-INIT-A-' + p, name: 'Init A', price: 10, company: compA._id, qty_available: 0 });
  const prodInitB = await Product.create({ sku: 'SKU-INIT-B-' + p, name: 'Init B', price: 10, company: compA._id, qty_available: 0 });

  const invalidBatch = [
    { sku: prodInitA.sku, bin: `${whA1_blind.code}-STAGE-01`, qty: 20, owner: 'Internal Stock', ownerType: 'COMPANY' },
    { sku: prodInitB.sku, bin: `${whA1_blind.code}-STAGE-01`, qty: 30, owner: 'Internal Stock', ownerType: 'COMPANY' },
    { sku: 'NON-EXISTENT-SKU-XYZ', bin: `${whA1_blind.code}-STAGE-01`, qty: 50, owner: 'Internal Stock', ownerType: 'COMPANY' }
  ];

  const failLoadRes = await request(app)
    .post(`/api/v1/inventory/initial-stock-load?warehouse=${whA1_blind.code}`)
    .set('Authorization', `Bearer ${tokenA}`)
    .send(invalidBatch);
  check('Invalid batch with 1 bad row rejected with 400', failLoadRes.status === 400 && Array.isArray(failLoadRes.body.errors) && failLoadRes.body.errors.some(e => e.includes('NON-EXISTENT-SKU-XYZ')));

  // Assert ZERO mutations persisted for valid rows
  const checkBalanceA = await InventoryBalance.findOne({ company: compA._id, sku: prodInitA.sku });
  const checkBalanceB = await InventoryBalance.findOne({ company: compA._id, sku: prodInitB.sku });
  const checkProdA = await Product.findById(prodInitA._id);
  check('Zero InventoryBalance created for Row 1 on rollback', checkBalanceA === null);
  check('Zero InventoryBalance created for Row 2 on rollback', checkBalanceB === null);
  check('Product A qty_available remains 0', checkProdA.qty_available === 0);

  // 15. Valid Batch Execution
  const validBatch = [
    { sku: prodInitA.sku, bin: `${whA1_blind.code}-STAGE-01`, qty: 20, lot: 'LOT-V1', expiryDate: '2028-01-01', owner: 'Internal Stock', ownerType: 'COMPANY' },
    { sku: prodInitB.sku, bin: `${whA1_blind.code}-STAGE-01`, qty: 30, lot: 'LOT-V2', expiryDate: '2028-01-01', owner: 'Internal Stock', ownerType: 'COMPANY' }
  ];

  const validLoadRes = await request(app)
    .post(`/api/v1/inventory/initial-stock-load?warehouse=${whA1_blind.code}`)
    .set('Authorization', `Bearer ${tokenA}`)
    .send(validBatch);
  check('Valid batch succeeds with 201', validLoadRes.status === 201);

  // Invariant verification: Product.qty_available === sum InventoryBalance.qtyAvailable
  const pAAfter = await Product.findById(prodInitA._id);
  const pBAfter = await Product.findById(prodInitB._id);
  const balAAfter = await InventoryBalance.findOne({ company: compA._id, sku: prodInitA.sku });
  const balBAfter = await InventoryBalance.findOne({ company: compA._id, sku: prodInitB.sku });
  check('Product A qty_available (20) matches InventoryBalance qtyAvailable (20)', pAAfter.qty_available === 20 && balAAfter.qtyAvailable === 20);
  check('Product B qty_available (30) matches InventoryBalance qtyAvailable (30)', pBAfter.qty_available === 30 && balBAfter.qtyAvailable === 30);

  console.log('\n================================================================');
  console.log(`  FORENSIC RELEASE GATE: ${passedChecks}/${totalChecks} CHECKS PASSED`);
  if (failedChecks.length > 0) {
    console.log(`  FAILURES DETECTED (${failedChecks.length} checks):`);
    failedChecks.forEach(f => console.log(`  - #${f.check}: ${f.title}`));
  }
  console.log('================================================================\n');

  process.exit(failedChecks.length === 0 ? 0 : 1);
}

runForensicGate().catch(err => {
  console.error('[GATE FAILURE]', err);
  process.exit(1);
});
