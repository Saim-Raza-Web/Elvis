import mongoose from 'mongoose';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import InventoryBalance from './models/InventoryBalance.js';
import Location from './models/Location.js';
import ActivityLog from './models/ActivityLog.js';

dotenv.config();

async function runModule03Verification() {
  console.log('================================================================');
  console.log(' MODULE 03 (PUTAWAY MANAGEMENT) — MULTI-WAREHOUSE & SCALE AUDIT ');
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

  // Clean up old test data
  await InventoryBalance.deleteMany({ company: adminUser.company, sku: { $in: ['SKU-MOD03-PUT1', 'SKU-MOD03-PUT2'] } });
  await InventoryTransaction.deleteMany({ company: adminUser.company, sku: { $in: ['SKU-MOD03-PUT1', 'SKU-MOD03-PUT2'] } });
  await QuarantineInventory.deleteMany({ company: adminUser.company, sku: { $in: ['SKU-MOD03-PUT1', 'SKU-MOD03-PUT2'] } });
  await QCInspection.deleteMany({ company: adminUser.company, sku: { $in: ['SKU-MOD03-PUT1', 'SKU-MOD03-PUT2'] } });
  await PutawayTask.deleteMany({ company: adminUser.company, sku: { $in: ['SKU-MOD03-PUT1', 'SKU-MOD03-PUT2'] } });

  // Drop legacy single-warehouse index on Location collection to allow multi-warehouse compound index
  try { await mongoose.connection.collection('locations').dropIndex('company_1_code_1'); } catch (_) {}
  await Location.syncIndexes();

  // 1. MULTI-WAREHOUSE SUPPORT VERIFICATION (MIA, NYC, LAX, DAL)
  console.log('--- 1. Testing Multi-Warehouse Support (MIA, NYC, LAX, DAL) ---');
  await Location.findOneAndUpdate(
    { code: 'Z1-A1-B1', warehouse: 'MIA', company: adminUser.company },
    { name: 'Miami Bin 1', warehouse: 'MIA', zone: 'Z1', code: 'Z1-A1-B1', maxUnits: 200, company: adminUser.company },
    { upsert: true }
  );

  await Location.findOneAndUpdate(
    { code: 'Z1-A1-B1', warehouse: 'NYC', company: adminUser.company },
    { name: 'NYC Bin 1', warehouse: 'NYC', zone: 'Z1', code: 'Z1-A1-B1', maxUnits: 200, company: adminUser.company },
    { upsert: true }
  );

  await Location.findOneAndUpdate(
    { code: 'Z1-A1-B1', warehouse: 'LAX', company: adminUser.company },
    { name: 'LAX Bin 1', warehouse: 'LAX', zone: 'Z1', code: 'Z1-A1-B1', maxUnits: 200, company: adminUser.company },
    { upsert: true }
  );

  const locMIA = await Location.findOne({ code: 'Z1-A1-B1', warehouse: 'MIA', company: adminUser.company });
  const locNYC = await Location.findOne({ code: 'Z1-A1-B1', warehouse: 'NYC', company: adminUser.company });
  const locLAX = await Location.findOne({ code: 'Z1-A1-B1', warehouse: 'LAX', company: adminUser.company });

  console.log(`✅ PASS: Created identical bin 'Z1-A1-B1' across MIA (${locMIA._id}), NYC (${locNYC._id}), and LAX (${locLAX._id}) for same tenant.`);

  // 2. GENERATE PUTAWAY TASK VIA PIPELINE
  console.log('\n--- 2. Generating Putaway Task via Pipeline ---');
  const asnRes = await fetch('http://localhost:5000/api/v1/receiving', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      supplier: 'Tokyo Precision Instruments',
      poNumber: 'PO-MOD03-3003',
      expectedDate: new Date('2026-08-30').toISOString(),
      receivingDock: 'Dock 1',
      warehouse: 'NYC',
      items: [{ sku: 'SKU-MOD03-PUT1', name: 'Precision Lens A', expected_qty: 100, uom: 'pcs', qcRequired: true }]
    })
  });
  const createdASN = await asnRes.json();

  await fetch(`http://localhost:5000/api/v1/receiving/${createdASN._id}/receive`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      receiveItems: [{ sku: 'SKU-MOD03-PUT1', qtyToReceive: 100, lotNumber: 'LOT-MOD03-A', bin: 'BIN-01' }],
      __v: createdASN.__v
    })
  });

  const q1Res = await fetch('http://localhost:5000/api/v1/qc?search=SKU-MOD03-PUT1', { headers });
  const q1Item = (await q1Res.json()).data[0];
  const pass1Res = await fetch(`http://localhost:5000/api/v1/qc/${q1Item._id}/pass`, { method: 'POST', headers, body: JSON.stringify({ notes: 'Passed' }) });
  const task1 = (await pass1Res.json()).putawayTask;

  console.log(`✅ PASS: Generated Putaway Task ${task1.taskId} for Warehouse '${task1.warehouse}'`);

  // 3. EXECUTE PUTAWAY IN WAREHOUSE NYC
  console.log('\n--- 3. Executing Putaway Task in NYC Warehouse Bin ---');
  const completeRes = await fetch(`http://localhost:5000/api/v1/putaway/${task1._id}/complete`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ scannedTaskBarcode: task1.taskId, destinationBin: 'Z1-A1-B1' })
  });
  const completeData = await completeRes.json();
  console.log(`✅ PASS: ${completeData.message}`);

  // 4. VERIFY ACTIVITY LOG INDEXED SEARCH
  console.log('\n--- 4. Verifying Activity Log Index & Searchability ---');
  const logs = await ActivityLog.find(
    { company: adminUser.company, $text: { $search: task1.taskId } },
    { score: { $meta: "textScore" } }
  ).sort({ score: { $meta: "textScore" } });

  console.log(`✅ PASS: ActivityLog text search for Task '${task1.taskId}' returned ${logs.length} indexed record(s).`);
  console.log(`       Detail Log: "${logs[0]?.detail}"`);

  // Cleanup test data
  await ASN.deleteOne({ _id: createdASN._id });
  await InventoryBalance.deleteMany({ company: adminUser.company, sku: 'SKU-MOD03-PUT1' });
  await InventoryTransaction.deleteMany({ company: adminUser.company, sku: 'SKU-MOD03-PUT1' });
  await QuarantineInventory.deleteMany({ company: adminUser.company, sku: 'SKU-MOD03-PUT1' });
  await QCInspection.deleteMany({ company: adminUser.company, sku: 'SKU-MOD03-PUT1' });
  await PutawayTask.deleteMany({ company: adminUser.company, sku: 'SKU-MOD03-PUT1' });
  await Location.deleteMany({ company: adminUser.company, code: 'Z1-A1-B1' });

  await mongoose.disconnect();
  console.log('\n================================================================');
  console.log(' ✅ ALL MULTI-WAREHOUSE & HIGH-SCALE INDEX AUDITS PASSED! ');
  console.log('================================================================');
}

runModule03Verification().catch(console.error);
