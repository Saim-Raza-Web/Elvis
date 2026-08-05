import mongoose from 'mongoose';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';

dotenv.config();

async function testOptimisticConcurrency() {
  console.log('=== TESTING OPTIMISTIC CONCURRENCY CONTROL (OCC) ===\n');

  await mongoose.connect(process.env.MONGO_URI);
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }), 'users');
  const adminUser = await User.findOne({ role: 'admin' });

  const token = jwt.sign({ id: adminUser._id }, process.env.JWT_SECRET || 'fallback_secret_key');
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  // 1. Create Initial ASN
  const createRes = await fetch('http://localhost:5000/api/v1/receiving', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      supplier: 'Concurrency Test Ltd',
      poNumber: 'PO-CONCURRENCY-1',
      expectedDate: new Date().toISOString(),
      receivingDock: 'Dock 1',
      items: [{ sku: 'SKU-OCC', name: 'Test OCC Product', expected_qty: 10, uom: 'pcs' }]
    })
  });
  const asn = await createRes.json();
  console.log(`1. Created initial ASN ${asn.asnId} with Version __v = ${asn.__v}`);

  // 2. Manager A and Manager B both open the ASN (both hold __v = 0)
  const managerA_payload = { ...asn, supplier: 'Updated by Manager A', __v: asn.__v };
  const managerB_payload = { ...asn, notes: 'Updated by Manager B concurrently', __v: asn.__v };

  // 3. Manager A saves first
  console.log('2. Manager A saves edits...');
  const resA = await fetch(`http://localhost:5000/api/v1/receiving/${asn._id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(managerA_payload)
  });
  const dataA = await resA.json();
  console.log('Manager A Save Status:', resA.status, '| New Version __v =', dataA.__v);

  // 4. Manager B tries to save using old version __v = 0
  console.log('3. Manager B tries to save stale edits...');
  const resB = await fetch(`http://localhost:5000/api/v1/receiving/${asn._id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(managerB_payload)
  });
  const dataB = await resB.json();
  console.log('Manager B Save Status:', resB.status, '| Message:', dataB.message);

  if (resB.status === 409) {
    console.log('\n✅ PASS: Optimistic Concurrency Control BLOCKED Manager B with 409 Conflict!');
  } else {
    console.error('\n❌ FAIL: Manager B overwrote Manager A without conflict detection');
  }

  // Clean up
  await fetch(`http://localhost:5000/api/v1/receiving/${asn._id}`, { method: 'DELETE', headers });
  await mongoose.disconnect();
}

testOptimisticConcurrency().catch(console.error);
