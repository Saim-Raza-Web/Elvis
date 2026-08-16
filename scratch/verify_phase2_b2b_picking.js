import mongoose from 'mongoose';
import axios from 'axios';
import Order from '../server/models/Order.js';
import PickTask from '../server/models/PickTask.js';
import PickBatch from '../server/models/PickBatch.js';
import Document from '../server/models/Document.js';
import InventoryBalance from '../server/models/InventoryBalance.js';
import Company from '../server/models/Company.js';
import jwt from 'jsonwebtoken';

const ATLAS_URI = 'mongodb+srv://saimrzaa786_db_user:92tAthpdSdgsylTT@elviscluster.kr2u5fh.mongodb.net/demologistics?appName=ElvisCluster';
const API_BASE = 'http://localhost:5000/api/v1';

async function verifyPhase2() {
  console.log('====================================================');
  console.log('    PHASE 2 VERIFICATION — B2B PICKING AUDIT       ');
  console.log('====================================================\n');

  await mongoose.connect(ATLAS_URI);
  const company = await Company.findOne();
  if (!company) throw new Error("No company found!");

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

  // Cleanup past test data
  await Order.deleteMany({ orderId: 'ORD-B2B-TEST-001', company: company._id });
  await PickTask.deleteMany({ orderId: 'ORD-B2B-TEST-001', company: company._id });
  await PickBatch.deleteMany({ company: company._id });

  // ───────────────────────────────────────────────────────────────
  // TEST 1: Automatic Idempotent PickTask Generation on B2B Order Confirmation
  // ───────────────────────────────────────────────────────────────
  console.log('\n--- TEST 1: Automatic Idempotent PickTask Generation ---');
  const b2bOrderRes = await axios.post(`${API_BASE}/orders`, {
    order_type: 'B2B',
    customer: 'TechCorp International',
    company_name: 'Apple Distribution 3PL',
    email: 'procurement@techcorp.com',
    warehouse: 'MIA',
    product_lines: [{ sku: 'SKU-MOUSE-01', product_name: 'Gaming Mouse Pro', qty: 10, unit_price: 50, line_total: 500 }]
  }, { headers });

  const orderId = b2bOrderRes.data.orderId;
  assert(orderId && b2bOrderRes.data.company_name === 'Apple Distribution 3PL',
    `B2B Order created successfully (ID: ${orderId}, Owner: Apple Distribution 3PL)`);

  // Confirm Order -> Triggers PickTask Generation
  await axios.patch(`${API_BASE}/orders/${b2bOrderRes.data._id}/status`, { status: 'confirmed' }, { headers });

  const createdTask = await PickTask.findOne({ orderId, company: company._id });
  assert(createdTask && createdTask.owner === 'Apple Distribution 3PL' && createdTask.status === 'pending',
    `PickTask automatically generated with status 'pending' and owner 'Apple Distribution 3PL' (Task ID: ${createdTask?.taskId})`);

  // Idempotency Subtest: Re-confirming order should NOT create a duplicate task
  await axios.patch(`${API_BASE}/orders/${b2bOrderRes.data._id}/status`, { status: 'confirmed' }, { headers });
  const allTasksForOrder = await PickTask.find({ orderId, company: company._id });
  assert(allTasksForOrder.length === 1,
    `IDEMPOTENCY CHECK PASSED: Re-confirming order generated 0 duplicate tasks (Total count: ${allTasksForOrder.length})`);

  // ───────────────────────────────────────────────────────────────
  // TEST 2: PickBatch Owner Isolation Validation
  // ───────────────────────────────────────────────────────────────
  console.log('\n--- TEST 2: PickBatch Owner Isolation Validation ---');
  
  // Create a second PickTask for Owner B ('Acme Logistics 3PL')
  const taskOwnerB = await PickTask.create({
    taskId: 'PICK-TEST-OWNER-B',
    orderId: 'ORD-B2B-OWNER-B',
    orderType: 'B2B',
    owner: 'Acme Logistics 3PL',
    customer: 'Client B Corp',
    warehouse: 'MIA',
    priority: 'normal',
    status: 'pending',
    items: [{ sku: 'SKU-MOUSE-01', productName: 'Mouse', orderedQty: 5, sourceLocation: 'STAGING-A' }],
    company: company._id
  });

  // Attempt creating batch mixing Owner A and Owner B tasks -> Must be rejected!
  try {
    await axios.post(`${API_BASE}/picking/batches`, {
      pickTaskIds: [createdTask._id, taskOwnerB._id]
    }, { headers });
    assert(false, "Mixing different Owners in a PickBatch should have been rejected!");
  } catch (err) {
    assert(err.response?.status === 400 && err.response?.data?.message?.includes('Owner Isolation Error'),
      `Mixed-owner batch creation rejected with HTTP 400 ("${err.response?.data?.message}")`);
  }

  // Create single-owner batch -> Must succeed!
  const singleOwnerBatchRes = await axios.post(`${API_BASE}/picking/batches`, {
    pickTaskIds: [createdTask._id]
  }, { headers });
  assert(singleOwnerBatchRes.status === 201 && singleOwnerBatchRes.data.owner === 'Apple Distribution 3PL',
    `Single-owner PickBatch created successfully for Owner 'Apple Distribution 3PL' (Batch ID: ${singleOwnerBatchRes.data.batchId})`);

  // ───────────────────────────────────────────────────────────────
  // TEST 3: Step-by-Step Pick Execution & Partial Pick Shortfall
  // ───────────────────────────────────────────────────────────────
  console.log('\n--- TEST 3: Pick Execution & Partial Pick Shortfall Accounting ---');

  // Seed inventory balance for Apple Distribution 3PL at STAGING-A (20 units available)
  await InventoryBalance.findOneAndUpdate(
    { company: company._id, warehouse: 'MIA', sku: 'SKU-MOUSE-01', owner: 'Apple Distribution 3PL', bin: 'STAGING-A' },
    { $set: { qtyAvailable: 20 } },
    { upsert: true, new: true }
  );

  // Subtest: Owner stock isolation violation check (attempt picking stock under wrong owner)
  try {
    await axios.post(`${API_BASE}/picking/${taskOwnerB._id}/complete`, {
      lineUpdates: [{ sku: 'SKU-MOUSE-01', pickedQty: 5, sourceLocation: 'STAGING-A' }]
    }, { headers });
    assert(false, "Picking stock for Owner B when no Owner B stock exists should be rejected!");
  } catch (err) {
    assert(err.response?.status === 400 && err.response?.data?.message?.includes('Owner Stock Isolation Failure'),
      `Cross-owner stock picking rejected with HTTP 400 ("${err.response?.data?.message}")`);
  }

  // Execute Partial Pick for Owner A task (7 out of 10 units picked, 3 shortfall)
  const pickCompleteRes = await axios.post(`${API_BASE}/picking/${createdTask._id}/complete`, {
    lineUpdates: [{ sku: 'SKU-MOUSE-01', pickedQty: 7, sourceLocation: 'STAGING-A' }]
  }, { headers });

  assert(pickCompleteRes.status === 200 && pickCompleteRes.data.deliveryNoteNumber,
    `Pick Task completed with Partial Shortfall! Generated Delivery Note: ${pickCompleteRes.data.deliveryNoteNumber}`);

  // Verify Inventory Balance Deduction
  const updatedBal = await InventoryBalance.findOne({ company: company._id, warehouse: 'MIA', sku: 'SKU-MOUSE-01', owner: 'Apple Distribution 3PL', bin: 'STAGING-A' });
  assert(updatedBal && updatedBal.qtyAvailable === 13,
    `Available inventory for Apple Distribution 3PL deducted by EXACTLY 7 units (From 20 to ${updatedBal?.qtyAvailable})`);

  // Verify PickTask state & shortfall recording
  const updatedPickTask = await PickTask.findById(createdTask._id);
  assert(updatedPickTask.status === 'partially_picked' && updatedPickTask.totalPickedQty === 7 && updatedPickTask.totalShortfallQty === 3,
    `PickTask recorded status='partially_picked', totalPickedQty=7, totalShortfallQty=3`);

  // ───────────────────────────────────────────────────────────────
  // TEST 4: Outbound Delivery Note PDF Binary Stream & Content Audit
  // ───────────────────────────────────────────────────────────────
  console.log('\n--- TEST 4: Delivery Note PDF Stream & Visual Content Decoding ---');
  const dnNumber = pickCompleteRes.data.deliveryNoteNumber;

  const pdfRes = await axios.get(`${API_BASE}/documents/dn/${dnNumber}/pdf`, {
    headers,
    responseType: 'arraybuffer'
  });

  const pdfBuf = Buffer.from(pdfRes.data);
  const pdfText = pdfBuf.toString('utf8');
  const magic = pdfBuf.slice(0, 5).toString('utf8');

  assert(pdfRes.status === 200 && pdfRes.headers['content-type'] === 'application/pdf',
    `GET /documents/dn/${dnNumber}/pdf returned HTTP 200 with Content-Type application/pdf`);

  assert(magic.startsWith('%PDF-'),
    `PDF Binary Stream contains valid Magic Header '%PDF-' (Size: ${pdfBuf.length} bytes)`);

  // Decode PDF metadata string content
  const hasOutboundTitle = pdfText.includes('OUTBOUND B2B DELIVERY NOTE') || pdfText.includes('OUTBOUND');
  const hasOrderRef = pdfText.includes(orderId);
  const hasOwnerRef = pdfText.includes('Apple Distribution 3PL');
  const hasSkuRef = pdfText.includes('SKU-MOUSE-01');

  assert(hasOutboundTitle && hasOrderRef && hasOwnerRef && hasSkuRef,
    `PDF Document text successfully verified: Order #${orderId}, Owner 'Apple Distribution 3PL', SKU 'SKU-MOUSE-01' present in generated PDF!`);

  // Cleanup
  await Order.deleteMany({ orderId, company: company._id });
  await PickTask.deleteMany({ _id: { $in: [createdTask._id, taskOwnerB._id] } });
  await PickBatch.deleteMany({ _id: singleOwnerBatchRes.data._id });
  await Document.deleteMany({ documentNumber: dnNumber, company: company._id });

  console.log('\n====================================================');
  console.log(`    VERIFICATION SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log('====================================================');

  await mongoose.disconnect();
}

verifyPhase2().catch(err => {
  console.error("\n❌ PHASE 2 VERIFICATION SCRIPT ERROR:", err);
  process.exit(1);
});
