import mongoose from 'mongoose';
import axios from 'axios';
import Product from '../server/models/Product.js';
import ASN from '../server/models/ASN.js';
import Incident from '../server/models/Incident.js';
import PutawayTask from '../server/models/PutawayTask.js';
import InventoryBalance from '../server/models/InventoryBalance.js';
import Location from '../server/models/Location.js';
import Company from '../server/models/Company.js';
import jwt from 'jsonwebtoken';

const ATLAS_URI = 'mongodb+srv://saimrzaa786_db_user:92tAthpdSdgsylTT@elviscluster.kr2u5fh.mongodb.net/demologistics?appName=ElvisCluster';
const API_BASE = 'http://localhost:5000/api/v1';

async function verifyPhase1() {
  console.log('====================================================');
  console.log('    PHASE 1 VERIFICATION & SYSTEM AUDIT SCRIPT     ');
  console.log('====================================================\n');

  await mongoose.connect(ATLAS_URI);
  const company = await Company.findOne();
  if (!company) throw new Error("No company found in database!");

  const token = jwt.sign(
    { id: new mongoose.Types.ObjectId(), email: 'admin@demologistics.io', name: 'Admin', role: 'admin', company: company._id },
    'demologistics_super_secret_key_2026',
    { expiresIn: '1h' }
  );
  const headers = { Authorization: `Bearer ${token}` };

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (condition) {
      console.log(` ✅ PASS: ${message}`);
      passedTests++;
    } else {
      console.error(` ❌ FAIL: ${message}`);
    }
  }

  // ───────────────────────────────────────────────────────────────
  // TEST 1: Unified Barcode Resolution & Multiplier
  // ───────────────────────────────────────────────────────────────
  console.log('\n--- TEST 1: Unified Barcode Resolution & Case Multiplier ---');
  await Product.deleteMany({ sku: 'SKU-TEST-BARCODE-01', company: company._id });

  // Create Product with Unit & Case Barcode
  const testProduct = await Product.create({
    sku: 'SKU-TEST-BARCODE-01',
    name: 'Test Gaming Mouse Box',
    category: 'Hardware',
    qty_available: 50,
    unitBarcode: '1234567890123',
    caseBarcode: '1234567890999',
    caseMultiplier: 20,
    owner: 'Apple Distribution 3PL',
    company: company._id
  });

  // Resolve Unit Barcode
  const unitRes = await axios.get(`${API_BASE}/inventory/resolve-barcode/1234567890123`, { headers });
  assert(unitRes.data.found === true && unitRes.data.matchType === 'unit' && unitRes.data.multiplier === 1,
    `Unit Barcode (1234567890123) resolved as unit with multiplier 1 (SKU: ${unitRes.data.sku})`);

  // Resolve Case Barcode
  const caseRes = await axios.get(`${API_BASE}/inventory/resolve-barcode/1234567890999`, { headers });
  assert(caseRes.data.found === true && caseRes.data.matchType === 'case' && caseRes.data.multiplier === 20,
    `Case Barcode (1234567890999) resolved as case with multiplier 20 (SKU: ${caseRes.data.sku})`);

  // Duplicate Barcode Protection
  try {
    await axios.post(`${API_BASE}/inventory`, {
      sku: 'SKU-TEST-BARCODE-DUP',
      name: 'Duplicate Test',
      unitBarcode: '1234567890123'
    }, { headers });
    assert(false, "Duplicate barcode should have been rejected!");
  } catch (err) {
    assert(err.response?.status === 400 && err.response?.data?.message?.includes('already assigned'),
      `Duplicate unit barcode creation rejected with HTTP 400: "${err.response?.data?.message}"`);
  }

  // ───────────────────────────────────────────────────────────────
  // TEST 2: Unexpected Barcode & Incident Document Persistence
  // ───────────────────────────────────────────────────────────────
  console.log('\n--- TEST 2: Unexpected Barcode Rejection & Incident Creation ---');
  const unknownRes = await axios.get(`${API_BASE}/inventory/resolve-barcode/UNKNOWN_BARCODE_999`, { headers }).catch(e => e.response);
  assert(unknownRes.status === 404 && unknownRes.data.found === false,
    `Unknown barcode returned HTTP 404 with found: false ("${unknownRes.data.message}")`);

  const incId = 'INC-TEST-' + Date.now();
  await axios.post(`${API_BASE}/incidents`, {
    incidentId: incId,
    type: 'Discrepancy',
    sku: 'UNKNOWN',
    scannedBarcode: 'UNKNOWN_BARCODE_999',
    expectedSKU: 'N/A',
    asnReference: 'ASN-TEST-001',
    supplier: 'Acme Test Supplier',
    owner: 'Apple Distribution 3PL',
    operator: 'admin@demologistics.io',
    user: 'admin@demologistics.io',
    reported_by: 'admin@demologistics.io',
    reason: 'Product not found / barcode not in catalog',
    module: 'Receiving',
    status: 'open',
    description: 'Test Incident Rejection Record'
  }, { headers });

  const persistedInc = await Incident.findOne({ incidentId: incId, company: company._id });
  assert(persistedInc && persistedInc.scannedBarcode === 'UNKNOWN_BARCODE_999' && persistedInc.module === 'Receiving',
    `Incident persisted in MongoDB with scannedBarcode='UNKNOWN_BARCODE_999' and module='Receiving'`);

  // ───────────────────────────────────────────────────────────────
  // TEST 3: Mandatory ASN Owner & Legacy Handling
  // ───────────────────────────────────────────────────────────────
  console.log('\n--- TEST 3: Mandatory ASN Owner & Legacy Handling ---');
  try {
    await axios.post(`${API_BASE}/receiving`, {
      supplier: 'Acme Test Supplier',
      owner: '', // Empty owner
      poNumber: 'PO-TEST-NO-OWNER',
      expectedDate: new Date(),
      receivingDock: 'Dock 1',
      warehouse: 'MIA',
      items: [{ sku: 'SKU-TEST-BARCODE-01', name: 'Mouse', expected_qty: 10, uom: 'pcs' }]
    }, { headers });
    assert(false, "ASN without owner should have been rejected!");
  } catch (err) {
    assert(err.response?.status === 400 && err.response?.data?.message?.includes('Owner'),
      `ASN creation without owner rejected with HTTP 400 ("${err.response?.data?.message}")`);
  }

  // Create valid ASN with Owner
  const validAsnRes = await axios.post(`${API_BASE}/receiving`, {
    supplier: 'Acme Test Supplier',
    owner: 'Apple Distribution 3PL',
    poNumber: 'PO-TEST-OWNER-OK',
    expectedDate: new Date(),
    receivingDock: 'Dock 1',
    warehouse: 'MIA',
    items: [{ sku: 'SKU-TEST-BARCODE-01', name: 'Mouse', expected_qty: 10, uom: 'pcs' }]
  }, { headers });
  assert(validAsnRes.status === 201 && validAsnRes.data.owner === 'Apple Distribution 3PL',
    `ASN created successfully with mandatory owner 'Apple Distribution 3PL' (ID: ${validAsnRes.data.asnId})`);

  // ───────────────────────────────────────────────────────────────
  // TEST 4: Putaway Step 1 Security & Partial Putaway Accounting
  // ───────────────────────────────────────────────────────────────
  console.log('\n--- TEST 4: Putaway Security & Partial Putaway Accounting ---');

  // Ensure Location A-01-01 exists
  let targetLoc = await Location.findOne({ code: 'A-01-01', company: company._id });
  if (!targetLoc) {
    targetLoc = await Location.create({
      code: 'A-01-01',
      name: 'Shelf A-01-01',
      warehouse: 'MIA',
      zone: 'Z1',
      status: 'AVAILABLE',
      company: company._id
    });
  }

  const putawayTaskId = 'PUT-TEST-' + Date.now();
  const putawayTask = await PutawayTask.create({
    taskId: putawayTaskId,
    asnId: validAsnRes.data.asnId,
    sku: 'SKU-TEST-BARCODE-01',
    productName: 'Test Gaming Mouse Box',
    warehouse: 'MIA',
    owner: 'Apple Distribution 3PL',
    qty: 10,
    fromLocation: 'STAGING-A',
    toLocation: 'A-01-01',
    priority: 'normal',
    status: 'pending',
    company: company._id
  });

  // Seed source location inventory balance (awaiting putaway)
  await InventoryBalance.findOneAndUpdate(
    { company: company._id, warehouse: 'MIA', sku: 'SKU-TEST-BARCODE-01', owner: 'Apple Distribution 3PL', bin: 'STAGING-A' },
    { $set: { qtyAwaitingPutaway: 10, qtyAvailable: 0 } },
    { upsert: true, new: true }
  );

  // Security Subtest 1: Missing scannedBinBarcode
  try {
    await axios.post(`${API_BASE}/putaway/${putawayTask._id}/complete`, {
      scannedBinBarcode: '',
      scannedSkuBarcode: '1234567890123',
      executedQty: 4
    }, { headers });
    assert(false, "Putaway without scanned bin barcode should be rejected!");
  } catch (err) {
    assert(err.response?.status === 400 && err.response?.data?.message?.includes('required'),
      `Putaway without scanned bin rejected with HTTP 400 ("${err.response?.data?.message}")`);
  }

  // Security Subtest 2: Wrong location scan (B-99-99)
  try {
    await axios.post(`${API_BASE}/putaway/${putawayTask._id}/complete`, {
      scannedBinBarcode: 'B-99-99',
      scannedSkuBarcode: '1234567890123',
      executedQty: 4
    }, { headers });
    assert(false, "Putaway with wrong location B-99-99 should be rejected!");
  } catch (err) {
    assert(err.response?.status === 400 && err.response?.data?.message?.includes('Wrong location'),
      `Putaway with wrong location rejected with HTTP 400 ("${err.response?.data?.message}")`);
  }

  // Execute Valid Partial Putaway (4 out of 10 units)
  const partialRes = await axios.post(`${API_BASE}/putaway/${putawayTask._id}/complete`, {
    scannedBinBarcode: 'A-01-01',
    scannedSkuBarcode: '1234567890123',
    executedQty: 4
  }, { headers });

  assert(partialRes.status === 200, "Partial putaway (4 of 10) executed successfully!");

  // Verify Inventory Balance Accounting
  const destBal = await InventoryBalance.findOne({ company: company._id, warehouse: 'MIA', sku: 'SKU-TEST-BARCODE-01', owner: 'Apple Distribution 3PL', bin: 'A-01-01' });
  const sourceBal = await InventoryBalance.findOne({ company: company._id, warehouse: 'MIA', sku: 'SKU-TEST-BARCODE-01', owner: 'Apple Distribution 3PL', bin: 'STAGING-A' });
  const remainingTask = await PutawayTask.findOne({ asnId: validAsnRes.data.asnId, status: 'pending', company: company._id });

  assert(destBal && destBal.qtyAvailable === 4,
    `Destination location A-01-01 has EXACTLY 4 units in qtyAvailable (Got: ${destBal?.qtyAvailable})`);

  assert(sourceBal && sourceBal.qtyAwaitingPutaway === 6,
    `Source location STAGING-A has EXACTLY 6 units remaining in qtyAwaitingPutaway (Got: ${sourceBal?.qtyAwaitingPutaway})`);

  assert(remainingTask && remainingTask.qty === 6,
    `New pending PutawayTask spawned for remaining 6 units (Task ID: ${remainingTask?.taskId})`);

  // Explicit Assertion against accidental full transfer
  assert(destBal.qtyAvailable !== 10,
    `EXPLICIT ACCOUNTING CHECK: 10 units were NOT falsely transferred to available stock! Only 4 transferred.`);

  // Cleanup test data
  await Product.deleteMany({ sku: 'SKU-TEST-BARCODE-01', company: company._id });
  await ASN.deleteMany({ _id: validAsnRes.data._id });
  await Incident.deleteMany({ incidentId: incId });
  await PutawayTask.deleteMany({ asnId: validAsnRes.data.asnId });

  console.log('\n====================================================');
  console.log(`    VERIFICATION SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log('====================================================');

  await mongoose.disconnect();
}

verifyPhase1().catch(err => {
  console.error("\n❌ PHASE 1 VERIFICATION SCRIPT ERROR:", err);
  process.exit(1);
});
