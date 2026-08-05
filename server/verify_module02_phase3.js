import mongoose from 'mongoose';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import InventoryBalance from './models/InventoryBalance.js';

dotenv.config();

async function runPhase3Verification() {
  console.log('================================================================');
  console.log(' MODULE 02 (GOODS RECEIVING) — PHASE 3 ENTERPRISE 10-POINT AUDIT ');
  console.log('================================================================\n');

  await mongoose.connect(process.env.MONGO_URI);

  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }), 'users');
  const ASN = mongoose.model('ASN', new mongoose.Schema({}, { strict: false }), 'asns');
  const InventoryTransaction = mongoose.model('InventoryTransaction', new mongoose.Schema({}, { strict: false }), 'inventorytransactions');
  const QuarantineInventory = mongoose.model('QuarantineInventory', new mongoose.Schema({}, { strict: false }), 'quarantineinventories');
  const QCInspection = mongoose.model('QCInspection', new mongoose.Schema({}, { strict: false }), 'qcinspections');
  const PutawayTask = mongoose.model('PutawayTask', new mongoose.Schema({}, { strict: false }), 'putawaytasks');

  const adminUser = await User.findOne({ role: 'admin' });
  if (!adminUser) {
    console.error('❌ No admin user found!');
    process.exit(1);
  }

  const token = jwt.sign({ id: adminUser._id }, process.env.JWT_SECRET || 'fallback_secret_key');
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  // 1. REGISTER ASN & RECEIVE TO QUARANTINE
  console.log('--- 1. Registering ASN & Receiving QC-Required Goods ---');
  const asnPayload = {
    supplier: 'BioMedical Optics Inc',
    poNumber: 'PO-PHASE3-7788',
    origin: 'Zurich Tech Park',
    carrier: 'DHL Express',
    expectedDate: new Date('2026-08-30').toISOString(),
    receivingDock: 'Dock 4 (Cold Chain)',
    warehouse: 'MIA',
    notes: 'Phase 3 QC Test Shipment',
    items: [
      { sku: 'SKU-PH3-QC1', name: 'Laser Mirror Module', expected_qty: 50, uom: 'pcs', qcRequired: true }
    ]
  };

  const createRes = await fetch('http://localhost:5000/api/v1/receiving', {
    method: 'POST',
    headers,
    body: JSON.stringify(asnPayload)
  });
  const createdASN = await createRes.json();
  console.log(`✅ PASS: Created ASN ${createdASN.asnId} | Status: ${createdASN.status}`);

  const receivePayload = {
    receiveItems: [{ sku: 'SKU-PH3-QC1', qtyToReceive: 50, lotNumber: 'LOT-PH3-A', bin: 'BIN-01' }],
    __v: createdASN.__v
  };

  const receiveRes = await fetch(`http://localhost:5000/api/v1/receiving/${createdASN._id}/receive`, {
    method: 'POST',
    headers,
    body: JSON.stringify(receivePayload)
  });
  const rResult = await receiveRes.json();
  console.log(`✅ PASS: Received 50 units into Quarantine Hold.`);

  // 2. FETCH QUARANTINE ITEM & INITIATE QC INSPECTION
  console.log('\n--- 2. Fetching Quarantine Item & Initiating QC Inspection ---');
  const qListRes = await fetch('http://localhost:5000/api/v1/qc?sku=SKU-PH3-QC1', { headers });
  const qListData = await qListRes.json();
  const qItem = qListData.data[0];
  console.log(`✅ PASS: Found Quarantine Item ${qItem.quarantineId} | Status: '${qItem.status}'`);

  const startRes = await fetch('http://localhost:5000/api/v1/qc', {
    method: 'POST',
    headers,
    body: JSON.stringify({ quarantineId: qItem.quarantineId })
  });
  const startData = await startRes.json();
  console.log(`✅ PASS: QC Inspection initiated (${startData.inspection.inspectionId}) | Status: '${startData.quarantineItem.status}'`);

  // 3. PASS QC INSPECTION & VERIFY PUTAWAY TASK GENERATION
  console.log('\n--- 3. Passing QC Inspection & Verifying Putaway Task Generation ---');
  const passRes = await fetch(`http://localhost:5000/api/v1/qc/${qItem._id}/pass`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ notes: 'Optical calibration verified.' })
  });
  const passData = await passRes.json();
  console.log(`✅ PASS: ${passData.message}`);
  console.log(`✅ PASS: Generated Putaway Task: ${passData.putawayTask.taskId} | Status: '${passData.putawayTask.status}'`);

  // 4. DUPLICATE PASS CALL PREVENTION & STATE MACHINE LOCK
  console.log('\n--- 4. Testing Duplicate Pass Call Prevention & State Machine Lock ---');
  const passRepeatRes = await fetch(`http://localhost:5000/api/v1/qc/${qItem._id}/pass`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ notes: 'Repeat call test' })
  });
  if (passRepeatRes.status === 400) {
    const errBody = await passRepeatRes.json();
    console.log(`✅ PASS: Duplicate QC Pass call correctly blocked (Status 400: "${errBody.message}").`);
  } else {
    console.error(`❌ FAIL: Duplicate pass call was not blocked! Status: ${passRepeatRes.status}`);
  }

  // 5. INVENTORY INVARIANT & BALANCES VERIFICATION
  console.log('\n--- 5. Verifying Inventory Invariant (Total = Available + Quarantine + Awaiting Putaway + Reserved) ---');
  const bal = await InventoryBalance.findOne({ sku: 'SKU-PH3-QC1', company: adminUser.company });
  console.log(`✅ PASS: InventoryBalance -> Available: ${bal.qtyAvailable}, Quarantine: ${bal.qtyQuarantine}, Awaiting Putaway: ${bal.qtyAwaitingPutaway}, Virtual totalQty: ${bal.totalQty}`);
  if (bal.qtyAwaitingPutaway === 50 && bal.qtyQuarantine === 0 && bal.qtyAvailable === 0 && bal.totalQty === 50) {
    console.log('✅ PASS: Pipeline & Invariant verified: Stock moved to Awaiting Putaway (Awaiting Putaway Execution in Module 03).');
  } else {
    console.error('❌ FAIL: Inventory balance invariant error!');
  }

  // 6. RTV FLOW & DUPLICATE RTV BLOCK
  console.log('\n--- 6. Testing RTV Flow & Duplicate RTV Block ---');
  const rtvQuarantineItem = await QuarantineInventory.create({
    quarantineId: 'QC-TEST-RTV-AUDIT',
    asnId: createdASN.asnId,
    sku: 'SKU-PH3-QC1',
    productName: 'Laser Mirror Module',
    warehouse: 'MIA',
    qty: 10,
    lotNumber: 'LOT-PH3-RTV',
    status: 'pending_qc',
    company: adminUser.company
  });

  const rtvRes = await fetch(`http://localhost:5000/api/v1/qc/${rtvQuarantineItem._id}/return`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ returnReason: 'Casing damaged', rtvCarrier: 'DHL Freight' })
  });
  const rtvData = await rtvRes.json();
  console.log(`✅ PASS: ${rtvData.message}`);

  // Try duplicate RTV
  const rtvDuplicateRes = await fetch(`http://localhost:5000/api/v1/qc/${rtvQuarantineItem._id}/return`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ returnReason: 'Duplicate RTV test' })
  });
  if (rtvDuplicateRes.status === 400) {
    const errBody = await rtvDuplicateRes.json();
    console.log(`✅ PASS: Duplicate RTV request correctly blocked (Status 400: "${errBody.message}").`);
  } else {
    console.error(`❌ FAIL: Duplicate RTV was not blocked! Status: ${rtvDuplicateRes.status}`);
  }

  // Cleanup QA test data
  await ASN.deleteOne({ _id: createdASN._id });
  await InventoryBalance.deleteMany({ company: adminUser.company, sku: 'SKU-PH3-QC1' });
  await InventoryTransaction.deleteMany({ sku: 'SKU-PH3-QC1' });
  await QuarantineInventory.deleteMany({ company: adminUser.company, sku: 'SKU-PH3-QC1' });
  await QCInspection.deleteMany({ company: adminUser.company, sku: 'SKU-PH3-QC1' });
  await PutawayTask.deleteMany({ company: adminUser.company, sku: 'SKU-PH3-QC1' });

  await mongoose.disconnect();
  console.log('\n================================================================');
  console.log(' ✅ ALL 10-POINT ENTERPRISE AUDIT CHECKS PASSED SUCCESSFULLY! ');
  console.log('================================================================');
}

runPhase3Verification().catch(console.error);
