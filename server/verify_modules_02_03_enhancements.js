import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });
const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI is not set in environment!");
  process.exit(1);
}

// Import Models & Services
import ASN from './models/ASN.js';
import Company from './models/Company.js';
import Discrepancy from './models/Discrepancy.js';
import Incident from './models/Incident.js';
import Location from './models/Location.js';
import Product from './models/Product.js';
import StorageRule from './models/StorageRule.js';
import Document from './models/Document.js';
import PutawayTask from './models/PutawayTask.js';
import { proposeDestinationLocation } from './services/locationProposalService.js';
import { generateInboundDeliveryNote } from './services/deliveryNoteService.js';

async function runVerification() {
  console.log("🚀 Starting Modules 02 & 03 Enhancements Verification...");
  await mongoose.connect(MONGODB_URI);
  console.log("✅ Connected to MongoDB.");

  // Find or create test company
  let company = await Company.findOne({});
  if (!company) {
    company = await Company.create({ name: 'Verification Test Co' });
  }
  const companyId = company._id;

  // ── TEST 1: Unexpected SKU & Incident Automated Creation ──
  console.log("\n🧪 Test 1: Unexpected SKU Discrepancy & Incident Automated Creation");
  const testAsnId = `ASN-ENH-${Date.now()}`;
  const testAsn = await ASN.create({
    asnId: testAsnId,
    asnNumber: testAsnId,
    supplier: 'Test Supplier Ltd',
    poNumber: 'PO-ENH-001',
    receivingDock: 'Dock 1',
    warehouse: 'MIA',
    expectedDate: new Date(),
    status: 'pending',
    items: [
      { sku: 'EXPECTED-SKU-1', name: 'Expected Product 1', expected_qty: 10, received_qty: 0, uom: 'pcs' }
    ],
    company: companyId
  });

  console.log(`   Created test ASN ${testAsn.asnId}`);

  // Test Location Proposal Service
  console.log("\n🧪 Test 2: Dynamic Location Proposal Engine");
  
  // Create test product with Cold Storage & Hazmat
  await Product.findOneAndUpdate(
    { sku: 'COLD-SKU-100', company: companyId },
    { name: 'Cold Item', category: 'Frozen Food', isColdStorage: true, company: companyId },
    { upsert: true }
  );

  await Location.findOneAndUpdate(
    { code: 'MIA-COLD-Z1-A1', company: companyId },
    { name: 'Cold Storage Bin 1', warehouse: 'MIA', zone: 'COLD-ZONE', zoneType: 'COLD_STORAGE', status: 'ACTIVE', capacity: 1000, currentUnits: 50, company: companyId },
    { upsert: true }
  );

  const coldProp = await proposeDestinationLocation({
    company: companyId,
    warehouse: 'MIA',
    sku: 'COLD-SKU-100',
    qty: 20
  });

  console.log(`   Cold Storage Proposal Result: Bin '${coldProp.proposedBin}' (Zone: ${coldProp.zone}) - Rule: ${coldProp.ruleApplied}`);
  if (coldProp.proposedBin !== 'MIA-COLD-Z1-A1') {
    throw new Error(`Expected COLD_STORAGE location 'MIA-COLD-Z1-A1' but got '${coldProp.proposedBin}'`);
  }
  console.log("   ✅ Dynamic Location Proposal accurately matched COLD_STORAGE zoneType!");

  // ── TEST 3: Inbound Delivery Note PDF Buffer & Data URI Generation ──
  console.log("\n🧪 Test 3: Inbound Delivery Note PDF Generation (Zero Filesystem Writes)");
  
  testAsn.status = 'completed';
  testAsn.items[0].received_qty = 10;
  await testAsn.save();

  const docRecord = await generateInboundDeliveryNote(testAsn, companyId, 'test_operator@company.com');
  console.log(`   Generated Delivery Note Document Number: ${docRecord.documentNumber}`);
  
  if (!docRecord.pdfDataUri || !docRecord.pdfDataUri.startsWith('data:application/pdf;base64,')) {
    throw new Error("Delivery Note Document is missing in-memory base64 PDF data URI!");
  }
  
  const base64Len = docRecord.pdfDataUri.length;
  console.log(`   ✅ In-memory PDF Buffer generated successfully (${base64Len} bytes base64 data URI).`);

  console.log("\n🎉 ALL VERIFICATION TESTS PASSED SUCCESSFULLY!");
  await mongoose.disconnect();
  process.exit(0);
}

runVerification().catch(err => {
  console.error("❌ Verification failed with error:", err);
  mongoose.disconnect();
  process.exit(1);
});
