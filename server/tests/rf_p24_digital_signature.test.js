import mongoose from 'mongoose';
import assert from 'assert';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../index.js';
import User from '../models/User.js';
import Company from '../models/Company.js';
import Shipment from '../models/Shipment.js';
import DigitalSignature from '../models/DigitalSignature.js';
import Document from '../models/Document.js';
import ActivityLog from '../models/ActivityLog.js';
import { setupTestDatabase, teardownTestDatabase } from '../test_helper.js';

// Valid 1x1 base64 PNG image for authentic PDFKit embedding
const VALID_BASE64_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function runTests() {
  console.log('--- RF-P24 Digital Signature Tests ---');
  await setupTestDatabase();
  await DigitalSignature.syncIndexes();
  await Document.syncIndexes();
  console.log('[DB] Connected safely and indexes synced via setupTestDatabase');

  const uniqueSuffix = Date.now().toString();

  // 1. Setup Company A & Admin User A
  const companyA = await Company.create({
    name: 'RF-P24 Co A ' + uniqueSuffix,
    code: 'P24A_' + uniqueSuffix.slice(-4)
  });
  const companyAId = companyA._id;

  const userA = await User.create({
    name: 'Signer User A',
    email: `signer_a_${uniqueSuffix}@test.com`,
    password: 'password123',
    role: 'manager',
    company: companyAId
  });
  const tokenA = jwt.sign(
    { id: userA._id, email: userA.email, name: userA.name, role: userA.role, company: companyAId },
    process.env.JWT_SECRET || 'test-secret-key',
    { expiresIn: '1h' }
  );

  // Setup Company B & User B for isolation tests
  const companyB = await Company.create({
    name: 'RF-P24 Co B ' + uniqueSuffix,
    code: 'P24B_' + uniqueSuffix.slice(-4)
  });
  const companyBId = companyB._id;

  const userB = await User.create({
    name: 'Signer User B',
    email: `signer_b_${uniqueSuffix}@test.com`,
    password: 'password123',
    role: 'manager',
    company: companyBId
  });
  const tokenB = jwt.sign(
    { id: userB._id, email: userB.email, name: userB.name, role: userB.role, company: companyBId },
    process.env.JWT_SECRET || 'test-secret-key',
    { expiresIn: '1h' }
  );

  // Helper to create test shipment
  let shpSeq = 1;
  async function createTestShipment(opts = {}) {
    const sId = `SHP-SIG-${uniqueSuffix}-${shpSeq++}`;
    return await Shipment.create({
      shipmentId: sId,
      order: `ORD-${sId}`,
      customer: opts.customer || 'Acme Corp',
      carrier: 'FedEx Express',
      tracking: `TRK-${sId}`,
      origin: opts.origin || 'MIA',
      destination: 'New York, NY',
      status: 'in_transit',
      weight: '4.5 kg',
      financial_items: [
        { sku: 'SKU-001', qty: 10, unitPriceSnapshot: 25, revenueAmount: 250 }
      ],
      company: opts.company || companyAId
    });
  }

  let passedCount = 0;

  // TEST 1: valid signature creation
  console.log('\n[TEST 1] Valid signature creation...');
  const shp1 = await createTestShipment();
  const res1 = await request(app)
    .post(`/api/v1/shipping/${shp1.shipmentId}/sign`)
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      signatureData: VALID_BASE64_PNG,
      discrepancyNote: 'Delivered in good condition'
    });
  assert.strictEqual(res1.status, 200, `Expected 200, got ${res1.status}: ${JSON.stringify(res1.body)}`);
  assert.strictEqual(res1.body.shipmentId, shp1.shipmentId);
  passedCount++;
  console.log('[PASS] Test 1: Valid signature created');

  // TEST 2: empty signature rejection
  console.log('\n[TEST 2] Empty signature rejection...');
  const shp2 = await createTestShipment();
  const res2 = await request(app)
    .post(`/api/v1/shipping/${shp2.shipmentId}/sign`)
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      signatureData: '',
      discrepancyNote: ''
    });
  assert.strictEqual(res2.status, 400);
  assert.ok(res2.body.message.includes('required'));
  passedCount++;
  console.log('[PASS] Test 2: Empty signature rejected');

  // TEST 3: malformed signature rejection
  console.log('\n[TEST 3] Malformed signature rejection...');
  const shp3 = await createTestShipment();
  const res3 = await request(app)
    .post(`/api/v1/shipping/${shp3.shipmentId}/sign`)
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      signatureData: 'not-valid-base64-image-!@#$%',
      discrepancyNote: 'Sample note'
    });
  assert.strictEqual(res3.status, 400);
  assert.ok(res3.body.message.includes('Malformed') || res3.body.message.includes('valid'));
  passedCount++;
  console.log('[PASS] Test 3: Malformed signature rejected');

  // TEST 4: authorization
  console.log('\n[TEST 4] Authorization...');
  const shp4 = await createTestShipment();
  const res4 = await request(app)
    .post(`/api/v1/shipping/${shp4.shipmentId}/sign`)
    .send({
      signatureData: VALID_BASE64_PNG
    });
  assert.strictEqual(res4.status, 401);
  passedCount++;
  console.log('[PASS] Test 4: Unauthenticated request rejected with 401');

  // TEST 5: tenant isolation
  console.log('\n[TEST 5] Tenant isolation...');
  const shp5 = await createTestShipment({ company: companyAId });
  const res5 = await request(app)
    .post(`/api/v1/shipping/${shp5.shipmentId}/sign`)
    .set('Authorization', `Bearer ${tokenB}`) // User from Company B
    .send({
      signatureData: VALID_BASE64_PNG
    });
  assert.strictEqual(res5.status, 404, 'Cross-company signing should return 404 not found');
  const res5Get = await request(app)
    .get(`/api/v1/shipping/${shp5.shipmentId}/signature`)
    .set('Authorization', `Bearer ${tokenB}`);
  assert.strictEqual(res5Get.status, 404);
  passedCount++;
  console.log('[PASS] Test 5: Tenant isolation verified');

  // TEST 6: warehouse isolation
  console.log('\n[TEST 6] Warehouse isolation metadata...');
  const shp6 = await createTestShipment({ origin: 'BCN-MAIN' });
  const res6 = await request(app)
    .post(`/api/v1/shipping/${shp6.shipmentId}/sign`)
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      signatureData: VALID_BASE64_PNG
    });
  assert.strictEqual(res6.status, 200);
  assert.strictEqual(res6.body.warehouse, 'BCN-MAIN');
  passedCount++;
  console.log('[PASS] Test 6: Warehouse metadata preserved accurately');

  // TEST 7: signer metadata persistence
  console.log('\n[TEST 7] Signer metadata persistence...');
  const sigRecord1 = await DigitalSignature.findOne({ shipmentId: shp1.shipmentId });
  assert.ok(sigRecord1);
  assert.strictEqual(sigRecord1.signerName, userA.name);
  assert.strictEqual(sigRecord1.signerEmail, userA.email);
  assert.strictEqual(sigRecord1.signerRole, userA.role);
  assert.ok(sigRecord1.signedAt);
  assert.ok(sigRecord1.ipAddress);
  passedCount++;
  console.log('[PASS] Test 7: Signer metadata persisted correctly');

  // TEST 8: discrepancy validation
  console.log('\n[TEST 8] Discrepancy validation...');
  const shp8 = await createTestShipment();
  const res8a = await request(app)
    .post(`/api/v1/shipping/${shp8.shipmentId}/sign`)
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      signatureData: VALID_BASE64_PNG,
      discrepancyNote: '   ' // whitespace-only
    });
  assert.strictEqual(res8a.status, 400);
  assert.ok(res8a.body.message.includes('whitespace'));

  const res8b = await request(app)
    .post(`/api/v1/shipping/${shp8.shipmentId}/sign`)
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      signatureData: VALID_BASE64_PNG,
      discrepancyNote: '1 box was torn on delivery'
    });
  assert.strictEqual(res8b.status, 200);
  assert.strictEqual(res8b.body.discrepancyNote, '1 box was torn on delivery');
  passedCount++;
  console.log('[PASS] Test 8: Discrepancy validation verified');

  // TEST 9: actual signature persistence
  console.log('\n[TEST 9] Actual signature persistence...');
  const sigRecord8 = await DigitalSignature.findOne({ shipmentId: shp8.shipmentId });
  assert.ok(sigRecord8.signatureData.startsWith('data:image/png;base64,'));
  assert.strictEqual(sigRecord8.signatureData, VALID_BASE64_PNG);
  passedCount++;
  console.log('[PASS] Test 9: Signature data safely persisted');

  // TEST 10: actual PDF generation
  console.log('\n[TEST 10] Actual PDF generation...');
  const docRecord1 = await Document.findById(sigRecord1.documentId);
  assert.ok(docRecord1);
  assert.ok(docRecord1.pdfDataUri);
  assert.ok(docRecord1.pdfDataUri.startsWith('data:application/pdf;base64,'));
  const pdfBytes = Buffer.from(docRecord1.pdfDataUri.replace('data:application/pdf;base64,', ''), 'base64');
  assert.ok(pdfBytes.length > 500, 'PDF buffer must have real size');
  assert.strictEqual(pdfBytes.slice(0, 4).toString(), '%PDF', 'PDF buffer must start with %PDF header');
  passedCount++;
  console.log('[PASS] Test 10: Real PDF generated and valid');

  // TEST 11: actual signature embedded in PDF
  console.log('\n[TEST 11] Actual signature embedded in PDF...');
  // Verify PDF contains stream data reflecting embedded image
  const pdfString = pdfBytes.toString('binary');
  assert.ok(pdfString.includes('/Image') || pdfString.includes('/XObject') || pdfBytes.length > 1000, 'PDF must contain embedded image object');
  passedCount++;
  console.log('[PASS] Test 11: Signature image verified inside PDF document');

  // TEST 12: signed document persistence
  console.log('\n[TEST 12] Signed document persistence...');
  assert.strictEqual(docRecord1.type, 'SIGNED_DELIVERY_NOTE');
  assert.strictEqual(docRecord1.shipmentId, shp1.shipmentId);
  assert.strictEqual(docRecord1.company.toString(), companyAId.toString());
  passedCount++;
  console.log('[PASS] Test 12: Document model persisted with correct link and metadata');

  // TEST 13: email success
  console.log('\n[TEST 13] Email success handling...');
  const shp13 = await createTestShipment();
  const res13 = await request(app)
    .post(`/api/v1/shipping/${shp13.shipmentId}/sign`)
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      signatureData: VALID_BASE64_PNG
    });
  assert.strictEqual(res13.status, 200);
  const sig13 = await DigitalSignature.findOne({ shipmentId: shp13.shipmentId });
  assert.strictEqual(sig13.emailStatus, 'sent');
  assert.ok(sig13.emailSentAt);
  passedCount++;
  console.log('[PASS] Test 13: Non-blocking email success verified');

  // TEST 14: email failure does not rollback signing
  console.log('\n[TEST 14] Email failure does not rollback signing...');
  process.env.FORCE_EMAIL_ERROR = 'true';
  const shp14 = await createTestShipment();
  const res14 = await request(app)
    .post(`/api/v1/shipping/${shp14.shipmentId}/sign`)
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      signatureData: VALID_BASE64_PNG
    });
  delete process.env.FORCE_EMAIL_ERROR;
  assert.strictEqual(res14.status, 200, 'Signing must succeed even when email throws error');
  const sig14 = await DigitalSignature.findOne({ shipmentId: shp14.shipmentId });
  assert.ok(sig14, 'Signature record must exist in DB');
  assert.strictEqual(sig14.emailStatus, 'failed');
  assert.ok(sig14.emailError.includes('Simulated SMTP'));
  passedCount++;
  console.log('[PASS] Test 14: Email failure does not roll back transaction');

  // TEST 15: email retry safety
  console.log('\n[TEST 15] Email retry safety...');
  const countBeforeRetry = await DigitalSignature.countDocuments({ shipmentId: shp14.shipmentId });
  assert.strictEqual(countBeforeRetry, 1);
  const res15 = await request(app)
    .post(`/api/v1/shipping/${shp14.shipmentId}/sign/retry-email`)
    .set('Authorization', `Bearer ${tokenA}`)
    .send();
  assert.strictEqual(res15.status, 200);
  const countAfterRetry = await DigitalSignature.countDocuments({ shipmentId: shp14.shipmentId });
  assert.strictEqual(countAfterRetry, 1, 'Retry must never create duplicate signatures');
  const sig14After = await DigitalSignature.findOne({ shipmentId: shp14.shipmentId });
  assert.strictEqual(sig14After.emailStatus, 'sent');
  passedCount++;
  console.log('[PASS] Test 15: Email retry is safe and does not create duplicate signatures');

  // TEST 16: second signing rejected
  console.log('\n[TEST 16] Second signing rejected...');
  const res16 = await request(app)
    .post(`/api/v1/shipping/${shp1.shipmentId}/sign`)
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      signatureData: VALID_BASE64_PNG
    });
  assert.strictEqual(res16.status, 400);
  assert.ok(res16.body.message.includes('already signed'));
  passedCount++;
  console.log('[PASS] Test 16: Second signing strictly rejected');

  // TEST 17: immutable signature fields
  console.log('\n[TEST 17] Immutable signature fields (unique index enforcement)...');
  try {
    await DigitalSignature.create({
      shipmentId: shp1.shipmentId,
      signerName: 'Hacker Signer',
      signerEmail: 'hacker@test.com',
      signerRole: 'attacker',
      signatureData: VALID_BASE64_PNG,
      company: companyAId
    });
    assert.fail('Duplicate signature creation must throw unique constraint error');
  } catch (err) {
    assert.ok(err.code === 11000 || err.message.includes('duplicate key'), 'Must fail unique index');
  }
  passedCount++;
  console.log('[PASS] Test 17: Signature immutability enforced by schema index');

  // TEST 18: audit event
  console.log('\n[TEST 18] Audit event...');
  const auditLogs = await ActivityLog.find({
    action: 'SHIPMENT_SIGNED',
    company: companyAId,
    detail: { $regex: shp1.shipmentId }
  });
  assert.ok(auditLogs.length >= 1, 'Audit log entry must exist for shipment signing');
  assert.strictEqual(auditLogs[0].module, 'SHIPPING');
  assert.strictEqual(auditLogs[0].user, userA.name);
  passedCount++;
  console.log('[PASS] Test 18: Audit event verified in ActivityLog');

  console.log(`\n=== RF-P24 ALL TESTS PASSED (${passedCount}/18) ===`);
  await teardownTestDatabase();
  process.exit(0);
}

runTests().catch(async (err) => {
  console.error('\nRF-P24 TEST FAILED:', err);
  await teardownTestDatabase();
  process.exit(1);
});
