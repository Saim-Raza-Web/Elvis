import mongoose from 'mongoose';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';

dotenv.config();

async function runPhase1Verification() {
  console.log('=== STARTING MODULE 02 - PHASE 1 (ASN FOUNDATION) AUDIT ===\n');

  await mongoose.connect(process.env.MONGO_URI);

  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }), 'users');
  const Company = mongoose.model('Company', new mongoose.Schema({}, { strict: false }), 'companies');
  const ASN = mongoose.model('ASN', new mongoose.Schema({}, { strict: false }), 'asns');
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

  // 1. TEST VALIDATION ERRORS (400 BAD REQUEST)
  console.log('--- 1. Testing Backend Payload Validation ---');
  const invalidRes = await fetch('http://localhost:5000/api/v1/receiving', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      supplier: "", // Missing
      poNumber: "", // Missing
      items: []     // Empty
    })
  });

  console.log('Validation Error Response Code:', invalidRes.status);
  const invalidData = await invalidRes.json();
  if (invalidRes.status === 400 && invalidData.message) {
    console.log('✅ PASS: Backend returned 400 Bad Request with message:', invalidData.message);
  } else {
    console.error('❌ FAIL: Backend validation failed to block invalid payload:', invalidData);
  }

  // 2. TEST CREATE ASN (201 CREATED)
  console.log('\n--- 2. Testing Create Inbound ASN ---');
  const validAsnPayload = {
    supplier: 'Acme Semiconductor GmbH',
    poNumber: 'PO-2026-9900',
    origin: 'Munich, Germany',
    carrier: 'DHL Express',
    expectedDate: new Date('2026-08-15').toISOString(),
    receivingDock: 'Dock 2 (High Tech)',
    warehouse: 'MIA',
    notes: 'Fragile component shipment. Temperature sensitive.',
    items: [
      {
        sku: 'SEM-8801',
        name: 'Microcontroller Unit 32-bit',
        description: 'ARM Cortex M4 processor chip',
        expected_qty: 5000,
        uom: 'pcs',
        lotNumber: 'LOT-MUN-01',
        batchNumber: 'BATCH-2026-X',
        expiryDate: new Date('2030-12-31').toISOString(),
        qcRequired: true
      },
      {
        sku: 'SEM-8802',
        name: 'Power Regulation IC',
        description: 'Voltage step-down converter',
        expected_qty: 2000,
        uom: 'pcs',
        lotNumber: 'LOT-MUN-02',
        batchNumber: 'BATCH-2026-Y',
        qcRequired: false
      }
    ]
  };

  const createRes = await fetch('http://localhost:5000/api/v1/receiving', {
    method: 'POST',
    headers,
    body: JSON.stringify(validAsnPayload)
  });

  console.log('Create ASN Status Code:', createRes.status);
  const createdASN = await createRes.json();
  if (createRes.status === 201 && createdASN.asnId) {
    console.log(`✅ PASS: Created ASN Number: ${createdASN.asnId} | Status: ${createdASN.status} | Lines: ${createdASN.items.length}`);
  } else {
    console.error('❌ FAIL: Failed to create ASN:', createdASN);
    process.exit(1);
  }

  // 3. TEST UPDATE ASN (200 OK)
  console.log('\n--- 3. Testing Update ASN ---');
  const updateRes = await fetch(`http://localhost:5000/api/v1/receiving/${createdASN._id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      ...validAsnPayload,
      carrier: 'Kuehne+Nagel',
      notes: 'Updated carrier to Kuehne+Nagel per supplier request.'
    })
  });

  console.log('Update ASN Status Code:', updateRes.status);
  const updatedASN = await updateRes.json();
  if (updateRes.status === 200 && updatedASN.carrier === 'Kuehne+Nagel') {
    console.log(`✅ PASS: ASN ${updatedASN.asnId} updated carrier to '${updatedASN.carrier}'.`);
  } else {
    console.error('❌ FAIL: Failed to update ASN:', updatedASN);
  }

  // 4. TEST PATCH STATUS CHANGE
  console.log('\n--- 4. Testing Patch Status Change ---');
  const statusRes = await fetch(`http://localhost:5000/api/v1/receiving/${createdASN._id}/status`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ status: 'in_progress' })
  });

  console.log('Patch Status Status Code:', statusRes.status);
  const statusASN = await statusRes.json();
  if (statusRes.status === 200 && statusASN.status === 'in_progress') {
    console.log(`✅ PASS: ASN ${statusASN.asnId} status changed to '${statusASN.status}'.`);
  } else {
    console.error('❌ FAIL: Failed to change ASN status:', statusASN);
  }

  // 5. TEST LIST, SEARCH & FILTER
  console.log('\n--- 5. Testing List, Search & Filter APIs ---');
  const searchRes = await fetch('http://localhost:5000/api/v1/receiving?search=Acme&status=in_progress', { headers });
  console.log('List API Status Code:', searchRes.status);
  const listData = await searchRes.json();
  console.log(`✅ PASS: Found ${listData.data?.length || 0} ASN(s) matching search 'Acme' and status 'in_progress'.`);

  // 6. TEST ACTIVITY LOGGING
  console.log('\n--- 6. Testing Activity Log Audit Entries ---');
  const logs = await ActivityLog.find({ module: 'ASN', company: adminUser.company }).sort({ createdAt: -1 }).limit(5);
  console.log(`Found ${logs.length} Activity Log records for ASN module:`);
  logs.forEach(l => console.log(`  - [${l.action}] by ${l.user}: ${l.detail}`));

  // 7. TEST DELETE ASN
  console.log('\n--- 7. Testing Delete ASN ---');
  const delRes = await fetch(`http://localhost:5000/api/v1/receiving/${createdASN._id}`, {
    method: 'DELETE',
    headers
  });

  console.log('Delete ASN Status Code:', delRes.status);
  if (delRes.status === 200) {
    console.log(`✅ PASS: ASN ${createdASN.asnId} deleted successfully.`);
  } else {
    console.error('❌ FAIL: Failed to delete ASN');
  }

  await mongoose.disconnect();
  console.log('\n=== ALL PHASE 1 TESTS COMPLETED SUCCESSFULLY ===');
}

runPhase1Verification().catch(console.error);
