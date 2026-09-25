import mongoose from 'mongoose';
import assert from 'assert';
import request from 'supertest';
import app from '../index.js';
import Company from '../models/Company.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import Shipment from '../models/Shipment.js';
import EdiInterchange from '../models/EdiInterchange.js';
import { setupTestDatabase, teardownTestDatabase } from '../test_helper.js';
import { edifactOrdersParser } from '../services/edi/EdifactOrdersParser.js';
import { x12OrdersParser } from '../services/edi/X12OrdersParser.js';
import { desadvGenerator } from '../services/edi/DesadvGenerator.js';
import { SftpAdapter } from '../services/edi/SftpAdapter.js';
import { ediManager } from '../services/edi/EdiManager.js';

let company, adminUser, adminToken;

async function runTests() {
  console.log('--- RF-P26 EDI Ingestion & DESADV Architecture Test Suite ---');
  await setupTestDatabase();

  const suffix = Date.now().toString();
  company = await Company.create({
    name: `EDI Test Co ${suffix}`,
    code: `EDI_${suffix.slice(-4)}`
  });

  adminUser = await User.create({
    name: 'Admin EDI',
    email: `adminedi_${suffix}@house3pl.com`,
    password: 'password123',
    role: 'admin',
    company: company._id
  });

  const jwtModule = await import('jsonwebtoken');
  const jwt = jwtModule.default;
  const secret = process.env.JWT_SECRET || 'fallback_secret_key';
  adminToken = jwt.sign({ id: adminUser._id }, secret, { expiresIn: '1h' });

  // ============================================================
  // TEST 1: UN/EDIFACT D96A ORDERS Parsing
  // ============================================================
  console.log('\n=== TEST 1: UN/EDIFACT D96A ORDERS Parsing ===');
  const sampleEdifact = `UNA:+.? '
UNB+UNOC:3+SENDER_GLN:14+RECIPIENT_GLN:14+260924:1000+REF00001+++++1'
UNH+MSG001+ORDERS:D:96A:UN:EAN008'
BGM+220+ORD-EDIF-001+9'
DTM+137:20260924:102'
NAD+BY+BUYER_GLN::9++Acme Retailer+Main Street 100+Madrid++28001+ES'
NAD+SU+SUPPLIER_GLN::9++House 3PL Partner'
NAD+DP+++Acme Central Hub+Industrial Ave 45+Barcelona++08001+ES'
LIN+1++843700000001:SRV'
PIA+1+SKU-EDIF-01:IN'
QTY+21:40:PCE'
PRI+AAA:15.50'
LIN+2++843700000002:SRV'
PIA+1+SKU-EDIF-02:IN'
QTY+21:10:PCE'
PRI+AAA:25.00'
UNS+S'
CNT+2:2'
UNT+15+MSG001'
UNZ+1+REF00001'`;

  const parsedEdifact = edifactOrdersParser.parse(sampleEdifact);
  assert.strictEqual(parsedEdifact.interchangeControlRef, 'REF00001');
  assert.strictEqual(parsedEdifact.senderGln, 'SENDER_GLN');
  assert.strictEqual(parsedEdifact.orders.length, 1);

  const order1 = parsedEdifact.orders[0];
  assert.strictEqual(order1.orderNumber, 'ORD-EDIF-001');
  assert.strictEqual(order1.buyer.name, 'Acme Retailer');
  assert.strictEqual(order1.deliveryAddress.city, 'Barcelona');
  assert.strictEqual(order1.lines.length, 2);
  assert.strictEqual(order1.lines[0].sku, 'SKU-EDIF-01');
  assert.strictEqual(order1.lines[0].quantity, 40);
  assert.strictEqual(order1.lines[0].unitPrice, 15.50);
  assert.strictEqual(order1.lines[1].sku, 'SKU-EDIF-02');
  assert.strictEqual(order1.lines[1].quantity, 10);
  console.log('✓ UN/EDIFACT D96A ORDERS parsed accurately with header, lines, pricing, and partner GLNs');

  // ============================================================
  // TEST 2: ANSI X12 850 Purchase Order Parsing
  // ============================================================
  console.log('\n=== TEST 2: ANSI X12 850 Purchase Order Parsing ===');
  const sampleX12 = `ISA*00*          *00*          *ZZ*SENDERID       *ZZ*RECEIVERID     *260924*1000*U*00401*000000042*0*P*>~
GS*PO*SENDERID*RECEIVERID*20260924*1000*42*X*004010~
ST*850*0001~
BEG*00*SA*PO-X12-0042**20260924~
N1*BY*Global Enterprise*92*BUYER123~
N1*ST*Destination Facility*92*DEST456~
N3*Distribution Blvd 700~
N4*Dallas*TX*75001*US~
PO1*1*50*EA*12.75**SK*SKU-X12-01~
PO1*2*100*EA*5.50**SK*SKU-X12-02~
CTT*2~
SE*10*0001~
GE*1*42~
IEA*1*000000042~`;

  const parsedX12 = x12OrdersParser.parse(sampleX12);
  assert.strictEqual(parsedX12.interchangeControlNumber, '000000042');
  assert.strictEqual(parsedX12.senderId, 'SENDERID');
  assert.strictEqual(parsedX12.orders.length, 1);

  const x12Order = parsedX12.orders[0];
  assert.strictEqual(x12Order.orderNumber, 'PO-X12-0042');
  assert.strictEqual(x12Order.buyer.name, 'Global Enterprise');
  assert.strictEqual(x12Order.shipTo.city, 'Dallas');
  assert.strictEqual(x12Order.lines.length, 2);
  assert.strictEqual(x12Order.lines[0].sku, 'SKU-X12-01');
  assert.strictEqual(x12Order.lines[0].quantity, 50);
  assert.strictEqual(x12Order.lines[0].unitPrice, 12.75);
  assert.strictEqual(x12Order.lines[1].quantity, 100);
  console.log('✓ ANSI X12 850 Purchase Order parsed accurately with ISA/GS, ST/BEG, N1/N3/N4, and PO1 segments');

  // ============================================================
  // TEST 3: EDI Ingestion API with Idempotency & Auto-Ingest
  // ============================================================
  console.log('\n=== TEST 3: EDI Ingestion via API & Idempotency ===');
  const ingestRes = await request(app)
    .post('/api/v1/edi/ingest')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      format: 'EDIFACT',
      rawPayload: sampleEdifact,
      autoCreateOrders: true,
      defaultWarehouse: 'MIA'
    });

  assert.strictEqual(ingestRes.status, 200, `Expected 200, got: ${ingestRes.status}`);
  assert.strictEqual(ingestRes.body.status, 'PROCESSED');
  assert.strictEqual(ingestRes.body.interchangeRef, 'REF00001');
  assert.strictEqual(ingestRes.body.createdOrdersCount, 1);

  // Verify created Order in database
  const createdOrder = await Order.findOne({ company: company._id, orderId: 'ORD-EDIF-001' });
  assert(createdOrder, 'Order must be materialized in database');
  assert.strictEqual(createdOrder.product_lines.length, 2);
  assert.strictEqual(createdOrder.ownerType, 'CUSTOMER');

  // Test Idempotency: re-submitting the exact same interchange control ref must not duplicate order
  const duplicateRes = await request(app)
    .post('/api/v1/edi/ingest')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      format: 'EDIFACT',
      rawPayload: sampleEdifact,
      autoCreateOrders: true
    });

  assert.strictEqual(duplicateRes.status, 200);
  assert.strictEqual(duplicateRes.body.isDuplicate, true, 'Duplicate must be detected');
  assert.strictEqual(duplicateRes.body.message, 'Interchange already processed');

  const orderCount = await Order.countDocuments({ company: company._id, orderId: 'ORD-EDIF-001' });
  assert.strictEqual(orderCount, 1, 'Strict idempotency: exactly 1 order must exist');
  console.log('✓ EDI Ingestion is strictly idempotent and prevents duplicate orders');

  // ============================================================
  // TEST 4: Error Quarantine for Malformed Interchanges
  // ============================================================
  console.log('\n=== TEST 4: Error Quarantine for Malformed Interchanges ===');
  const malformedEdi = `UNB+UNOC:3+CORRUPT_DATA`;
  const badRes = await request(app)
    .post('/api/v1/edi/ingest')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      format: 'EDIFACT',
      rawPayload: malformedEdi
    });

  assert.strictEqual(badRes.status, 422, 'Malformed EDI must return 422 Unprocessable Entity');
  assert.strictEqual(badRes.body.status, 'ERROR');

  const quarantinedDoc = await EdiInterchange.findById(badRes.body.interchangeId);
  assert(quarantinedDoc, 'Quarantined document recorded in database');
  assert.strictEqual(quarantinedDoc.status, 'ERROR');
  assert(quarantinedDoc.errors.length > 0, 'Validation errors must be captured in audit trail');
  console.log('✓ Malformed EDI interchange safely quarantined in audit ledger without unhandled exception');

  // ============================================================
  // TEST 5: EDIFACT D96A DESADV (Despatch Advice) Generation
  // ============================================================
  console.log('\n=== TEST 5: DESADV Generation with SSCC Barcodes ===');
  const sampleShipment = {
    shipmentNumber: 'SHP-2026-999',
    orderNumber: 'ORD-EDIF-001',
    shippedDate: new Date('2026-09-24T12:00:00Z'),
    estimatedDeliveryDate: new Date('2026-09-25T12:00:00Z'),
    carrier: 'CTT Express',
    trackingNumber: 'CTT-TRACK-99999',
    totalGrossWeightKg: 12.5,
    packagesCount: 1,
    buyer: {
      gln: 'BUYER_GLN',
      name: 'Acme Retailer'
    },
    deliveryAddress: {
      gln: 'DELIVERY_GLN',
      name: 'Acme Central Hub',
      street: 'Industrial Ave 45',
      city: 'Barcelona',
      postalCode: '08001',
      country: 'ES'
    },
    handlingUnits: [
      {
        sscc: '384370000000000018',
        packageType: 'CT',
        grossWeightKg: 12.5,
        lines: [
          {
            lineNumber: 1,
            sku: 'SKU-EDIF-01',
            description: 'Item Alpha',
            shippedQty: 40,
            lotNumber: 'LOT-2026-A',
            uom: 'PCE'
          }
        ]
      }
    ]
  };

  const desadvText = desadvGenerator.generate(sampleShipment, {
    senderGln: 'SUPPLIER_GLN',
    recipientGln: 'BUYER_GLN',
    interchangeRef: 'DESADV-001'
  });

  assert(desadvText.includes('UNH+'), 'DESADV must have UNH header');
  assert(desadvText.includes('BGM+351+SHP-2026-999+9'), 'BGM+351 Despatch Advice code present');
  assert(desadvText.includes('CPS+1'), 'Consignment packaging structure present');
  assert(desadvText.includes('GIN+BJ+384370000000000018'), 'SSCC-18 identifier encoded with GIN+BJ');
  assert(desadvText.includes('LIN+1'), 'Line items present');
  assert(desadvText.includes('QTY+12:40'), 'Shipped quantity present');
  console.log('✓ EDIFACT D96A DESADV generated with BGM+351, CPS hierarchy, and SSCC-18 barcodes');

  // ============================================================
  // TEST 6: SFTP Transport Boundary & Hermetic Sandbox
  // ============================================================
  console.log('\n=== TEST 6: SFTP Adapter Boundary Check ===');
  const sftpAdapter = new SftpAdapter({
    host: 'sftp.client3pl.com',
    port: 22,
    username: 'house3pl_client',
    companyId: company._id
  });

  // Verify status is hermetically reported as BLOCKED without credentials
  const status = sftpAdapter.getStatus();
  assert.strictEqual(status.connected, false);
  assert.strictEqual(status.status, 'BLOCKED_MISSING_CREDENTIALS');

  // Verify sandboxed dry-run file download
  const mockFiles = await sftpAdapter.downloadFiles({ dryRun: true });
  assert(Array.isArray(mockFiles), 'Mock files list returned');
  assert.strictEqual(mockFiles.length, 1);
  assert(mockFiles[0].filename.endsWith('.edi'));

  console.log('✓ SFTP boundary verified: fails safely when credentials unconfigured, sandbox mode functional');

  await teardownTestDatabase();
  console.log('\n======================================================');
  console.log('✓✓✓ ALL RF-P26 EDI INTEGRATION TESTS PASSED ✓✓✓');
  console.log('======================================================\n');
}

runTests()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('❌ RF-P26 Test Failure:', err);
    await teardownTestDatabase();
    process.exit(1);
  });
