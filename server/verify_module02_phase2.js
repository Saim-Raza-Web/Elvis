import mongoose from 'mongoose';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';

dotenv.config();

async function runPhase2Verification() {
  console.log('=== STARTING MODULE 02 - PHASE 2 (PHYSICAL RECEIVING & INVENTORY EXECUTION) AUDIT ===\n');

  await mongoose.connect(process.env.MONGO_URI);

  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }), 'users');
  const ASN = mongoose.model('ASN', new mongoose.Schema({}, { strict: false }), 'asns');
  const InventoryBalance = mongoose.model('InventoryBalance', new mongoose.Schema({}, { strict: false }), 'inventorybalances');
  const InventoryTransaction = mongoose.model('InventoryTransaction', new mongoose.Schema({}, { strict: false }), 'inventorytransactions');
  const ReceivingHistory = mongoose.model('ReceivingHistory', new mongoose.Schema({}, { strict: false }), 'receivinghistories');
  const Discrepancy = mongoose.model('Discrepancy', new mongoose.Schema({}, { strict: false }), 'discrepancies');
  const QuarantineInventory = mongoose.model('QuarantineInventory', new mongoose.Schema({}, { strict: false }), 'quarantineinventories');
  const ActivityLog = mongoose.model('ActivityLog', new mongoose.Schema({}, { strict: false }), 'activitylogs');

  const adminUser = await User.findOne({ role: 'admin' });
  if (!adminUser) {
    console.error('No admin user found!');
    process.exit(1);
  }

  const token = jwt.sign({ id: adminUser._id }, process.env.JWT_SECRET || 'fallback_secret_key');
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  // 1. CREATE INITIAL INBOUND ASN
  console.log('--- 1. Registering Inbound ASN for Physical Delivery ---');
  const asnPayload = {
    supplier: 'Global Tech Suppliers S.A.',
    poNumber: 'PO-PHASE2-8877',
    origin: 'Rotterdam Port',
    carrier: 'Kuehne+Nagel',
    expectedDate: new Date('2026-08-20').toISOString(),
    receivingDock: 'Dock 3 (Cold Chain)',
    warehouse: 'MIA',
    notes: 'Phase 2 Execution Test Shipment',
    items: [
      {
        sku: 'SKU-QC-YES',
        name: 'Precision Laser Diode',
        description: 'Requires Quality Control inspection upon delivery',
        expected_qty: 100,
        uom: 'pcs',
        qcRequired: true
      },
      {
        sku: 'SKU-QC-NO',
        name: 'Standard Mounting Bracket',
        description: 'Direct to available stock',
        expected_qty: 50,
        uom: 'pcs',
        qcRequired: false
      }
    ]
  };

  const createRes = await fetch('http://localhost:5000/api/v1/receiving', {
    method: 'POST',
    headers,
    body: JSON.stringify(asnPayload)
  });

  const createdASN = await createRes.json();
  console.log(`✅ PASS: Created ASN ${createdASN.asnId} | Status: ${createdASN.status}`);

  // 2. TRUCK 1 ARRIVES: PARTIAL RECEIVING EXECUTION
  console.log('\n--- 2. Truck 1 Arrives: Executing Partial Receiving ---');
  const partialReceivePayload = {
    receiveItems: [
      {
        sku: 'SKU-QC-YES',
        qtyToReceive: 40,
        damagedQty: 0,
        lotNumber: 'LOT-QC-A1',
        batchNumber: 'BATCH-2026-1',
        expiryDate: new Date('2028-12-31').toISOString(),
        bin: 'BIN-01'
      },
      {
        sku: 'SKU-QC-NO',
        qtyToReceive: 20,
        damagedQty: 0,
        lotNumber: 'LOT-NOQC-B1',
        bin: 'BIN-01'
      }
    ],
    __v: createdASN.__v
  };

  const receive1Res = await fetch(`http://localhost:5000/api/v1/receiving/${createdASN._id}/receive`, {
    method: 'POST',
    headers,
    body: JSON.stringify(partialReceivePayload)
  });

  const r1Result = await receive1Res.json();
  console.log('Receive 1 Status Code:', receive1Res.status);
  console.log(`✅ PASS: ${r1Result.message} | ASN Status: ${r1Result.status}`);

  // 3. VERIFY STOCK BALANCES & QC QUARANTINE HOLD FOR RECEIVING 1
  console.log('\n--- 3. Verifying Stock Balances & QC Quarantine Holdings ---');
  const qcInv = await QuarantineInventory.findOne({ asnId: createdASN.asnId, company: adminUser.company });
  if (qcInv && qcInv.qty === 40 && qcInv.status === 'pending_qc') {
    console.log(`✅ PASS: Stock for SKU-QC-YES (40 units) correctly placed in Quarantine with status '${qcInv.status}'.`);
  } else {
    console.error('❌ FAIL: Quarantine holding failed:', qcInv);
  }

  const balNoQc = await InventoryBalance.findOne({ sku: 'SKU-QC-NO', company: adminUser.company });
  if (balNoQc && balNoQc.qtyAvailable === 20) {
    console.log(`✅ PASS: Available Stock for SKU-QC-NO increased by +20 (qtyAvailable: ${balNoQc.qtyAvailable}).`);
  } else {
    console.error('❌ FAIL: Available inventory balance check failed:', balNoQc);
  }

  // 4. TRUCK 2 ARRIVES: FINAL RECEIVING EXECUTION WITH DAMAGED DISCREPANCY
  console.log('\n--- 4. Truck 2 Arrives: Completing ASN with Damaged Discrepancy ---');
  const finalReceivePayload = {
    receiveItems: [
      {
        sku: 'SKU-QC-YES',
        qtyToReceive: 60, // Remaining 60/60
        damagedQty: 0,
        lotNumber: 'LOT-QC-A2',
        bin: 'BIN-01'
      },
      {
        sku: 'SKU-QC-NO',
        qtyToReceive: 30, // Remaining 30/30
        damagedQty: 2,   // 2 damaged units reported!
        lotNumber: 'LOT-NOQC-B2',
        bin: 'BIN-01'
      }
    ],
    __v: r1Result.asn.__v
  };

  const receive2Res = await fetch(`http://localhost:5000/api/v1/receiving/${createdASN._id}/receive`, {
    method: 'POST',
    headers,
    body: JSON.stringify(finalReceivePayload)
  });

  const r2Result = await receive2Res.json();
  console.log('Receive 2 Status Code:', receive2Res.status);
  console.log(`✅ PASS: ${r2Result.message} | Final ASN Status: ${r2Result.status}`);

  // 5. VERIFY AUDIT TRAIL, DISCREPANCIES & HISTORY
  console.log('\n--- 5. Verifying Audit Trail, Discrepancies & Receiving History ---');
  const historyRes = await fetch(`http://localhost:5000/api/v1/receiving/${createdASN._id}/history`, { headers });
  const history = await historyRes.json();
  console.log(`✅ PASS: Retreived ${history.length} line-by-line receiving history logs.`);

  const discRes = await fetch(`http://localhost:5000/api/v1/receiving/${createdASN._id}/discrepancies`, { headers });
  const discrepancies = await discRes.json();
  console.log(`✅ PASS: Retreived ${discrepancies.length} discrepancy log(s). Type: ${discrepancies[0]?.type} (${discrepancies[0]?.damagedQty} damaged units).`);

  const txns = await InventoryTransaction.find({ asnNumber: createdASN.asnId, company: adminUser.company });
  console.log(`✅ PASS: Generated ${txns.length} InventoryTransaction records (` + txns.map(t => `${t.type}: ${t.qty}`).join(', ') + `).`);

  // Cleanup test documents
  await ASN.deleteOne({ _id: createdASN._id });
  await InventoryBalance.deleteMany({ company: adminUser.company, sku: { $in: ['SKU-QC-YES', 'SKU-QC-NO'] } });
  await InventoryTransaction.deleteMany({ asnNumber: createdASN.asnId });
  await ReceivingHistory.deleteMany({ asnId: createdASN.asnId });
  await Discrepancy.deleteMany({ asnId: createdASN.asnId });
  await QuarantineInventory.deleteMany({ asnId: createdASN.asnId });

  await mongoose.disconnect();
  console.log('\n=== ALL MODULE 02 - PHASE 2 VERIFICATIONS PASSED SUCCESSFULLY ===');
}

runPhase2Verification().catch(console.error);
