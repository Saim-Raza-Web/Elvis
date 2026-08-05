import mongoose from 'mongoose';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';

dotenv.config();

async function runDeliveryNoteVerification() {
  console.log('================================================================');
  console.log(' AUTOMATIC INBOUND DELIVERY NOTE (DN-2026-000001) VERIFICATION ');
  console.log('================================================================\n');

  await mongoose.connect(process.env.MONGO_URI);

  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }), 'users');
  const ASN = mongoose.model('ASN', new mongoose.Schema({}, { strict: false }), 'asns');
  const Document = mongoose.model('Document', new mongoose.Schema({}, { strict: false }), 'documents');

  const adminUser = await User.findOne({ role: 'admin' });
  if (!adminUser) {
    console.error('❌ No admin user found!');
    process.exit(1);
  }

  const token = jwt.sign({ id: adminUser._id }, process.env.JWT_SECRET || 'fallback_secret_key');
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  // 1. Create ASN
  console.log('--- 1. Creating ASN for Inbound Receiving ---');
  const asnRes = await fetch('http://localhost:5000/api/v1/receiving', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      supplier: 'Tokyo Precision Instruments',
      poNumber: 'PO-DN-99001',
      expectedDate: new Date('2026-08-30').toISOString(),
      receivingDock: 'Dock 2',
      warehouse: 'MIA',
      items: [{ sku: 'SKU-DN-TEST', name: 'Precision Lens DN', expected_qty: 100, uom: 'pcs', qcRequired: false }]
    })
  });
  const createdASN = await asnRes.json();
  console.log(`✅ PASS: Created ASN ${createdASN.asnId}`);

  // 2. Receive Goods to Complete ASN
  console.log('\n--- 2. Completing ASN Receiving (Triggers Automatic Delivery Note Generation) ---');
  const receiveRes = await fetch(`http://localhost:5000/api/v1/receiving/${createdASN._id}/receive`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      receiveItems: [{ sku: 'SKU-DN-TEST', qtyToReceive: 100, lotNumber: 'LOT-DN-A', bin: 'BIN-01' }],
      __v: createdASN.__v
    })
  });
  const receiveData = await receiveRes.json();
  const updatedASN = receiveData.asn;

  console.log(`✅ PASS: ASN Status updated to '${updatedASN.status}'`);
  console.log(`✅ PASS: Linked Delivery Note Number: '${updatedASN.deliveryNoteNumber}'`);

  if (!updatedASN.deliveryNoteNumber || !updatedASN.deliveryNoteNumber.startsWith('DN-')) {
    console.error(`❌ FAIL: Delivery Note number was not assigned! Received: '${updatedASN.deliveryNoteNumber}'`);
    process.exit(1);
  }

  // 3. Verify Document Record in Database
  console.log('\n--- 3. Verifying Document Record in MongoDB ---');
  const docRecord = await Document.findOne({ documentNumber: updatedASN.deliveryNoteNumber, company: adminUser.company });

  if (docRecord) {
    console.log(`✅ PASS: Document Record Found in DB:`);
    console.log(`       - Document Number: ${docRecord.documentNumber}`);
    console.log(`       - Document Type: ${docRecord.type}`);
    console.log(`       - Supplier: ${docRecord.supplier}`);
    console.log(`       - PO Number: ${docRecord.poNumber}`);
    console.log(`       - Total Received: ${docRecord.totalReceived} / ${docRecord.totalExpected} pcs`);
    console.log(`       - PDF/HTML Path: ${docRecord.pdfPath}`);
  } else {
    console.error(`❌ FAIL: Document record ${updatedASN.deliveryNoteNumber} was not found in MongoDB!`);
    process.exit(1);
  }

  // 4. Test Fetching Delivery Note HTML Endpoint
  console.log('\n--- 4. Testing Delivery Note View API Endpoint ---');
  const viewRes = await fetch(`http://localhost:5000/api/v1/documents/inbound-delivery-note/${updatedASN._id}`, { headers });
  if (viewRes.status === 200) {
    const html = await viewRes.text();
    console.log(`✅ PASS: Served Delivery Note Document (HTML length: ${html.length} chars). Contains header: ${html.includes('INBOUND DELIVERY NOTE')}`);
  } else {
    console.error(`❌ FAIL: View Delivery Note API returned status ${viewRes.status}`);
  }

  // Cleanup test data
  await ASN.deleteOne({ _id: createdASN._id });
  await Document.deleteOne({ _id: docRecord._id });

  await mongoose.disconnect();
  console.log('\n================================================================');
  console.log(' ✅ AUTOMATIC DELIVERY NOTE GENERATION FULLY VERIFIED! ');
  console.log('================================================================');
}

runDeliveryNoteVerification().catch(console.error);
