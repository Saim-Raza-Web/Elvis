/**
 * rf_requirement_5_incomplete_screens.test.js
 *
 * Automated regression tests for Client Requirement #5:
 * "Complete Incomplete Screens"
 *
 * Covers:
 * 1. Batch withdrawal / recall backend functionality (preview & execution, inventory balance invariants).
 * 2. 3PL rate card editing (PUT /api/v1/3pl/billing/rate-cards/:id).
 * 3. Company details editing in Admin (PUT /api/v1/admin/companies/:id) with strict tenant isolation.
 * 4. Quality inspections editing (PUT /api/v1/qc/:id) with terminal state guards.
 * 5. Picking batches editing (PUT /api/v1/picking/batches/:id) with tenant isolation and status guards.
 * 6. Supplier products editing (PUT /api/v1/suppliers/:id/products/:mappingId) with validation.
 * 7. Inbound receipt/shipment statuses editing (PATCH /api/v1/receiving/:id/status) with state machine enforcement.
 */

import assert from 'assert';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import app from '../index.js';
import User from '../models/User.js';
import Company from '../models/Company.js';
import Warehouse from '../models/Warehouse.js';
import Location from '../models/Location.js';
import Product from '../models/Product.js';
import InventoryBalance from '../models/InventoryBalance.js';
import RateCard from '../models/RateCard.js';
import QuarantineInventory from '../models/QuarantineInventory.js';
import PickBatch from '../models/PickBatch.js';
import Supplier from '../models/Supplier.js';
import SupplierProduct from '../models/SupplierProduct.js';
import QCInspection from '../models/QCInspection.js';
import ASN from '../models/ASN.js';
import { setupTestDatabase, teardownTestDatabase } from '../test_helper.js';

process.env.NODE_ENV = 'test';
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'test_jwt_secret_req5';

const TEST_CSRF = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function authHeaders(user) {
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1d' });
  return {
    cookies: [`jwt_token=${token}`, `csrf_token=${TEST_CSRF}`],
    csrf: TEST_CSRF
  };
}

async function run() {
  console.log('\n=== ELVIS WMS — REQ #5 COMPLETE INCOMPLETE SCREENS TESTS ===\n');
  await setupTestDatabase();
  const s = Date.now().toString();
  const pw = await bcrypt.hash('Password123!', 10);

  // Setup Tenant A & Users
  const coA = await Company.create({ name: 'Tenant A ' + s, code: 'TA' + s.slice(-4), address: '123 Main St' });
  const adminA = await User.create({ email: 'adminA_' + s + '@t.com', password: pw, name: 'Admin A', role: 'admin', company: coA._id });
  const managerA = await User.create({ email: 'mgrA_' + s + '@t.com', password: pw, name: 'Manager A', role: 'manager', company: coA._id });
  const staffA = await User.create({ email: 'staffA_' + s + '@t.com', password: pw, name: 'Staff A', role: 'warehouse_staff', company: coA._id });

  // Setup Tenant B & Users (for isolation checks)
  const coB = await Company.create({ name: 'Tenant B ' + s, code: 'TB' + s.slice(-4) });
  const adminB = await User.create({ email: 'adminB_' + s + '@t.com', password: pw, name: 'Admin B', role: 'admin', company: coB._id });

  const whA = await Warehouse.create({ code: 'WHA_' + s.slice(-4), name: 'Warehouse A', company: coA._id });
  const locA = await Location.create({ code: 'LOC-A1', warehouse: whA._id, company: coA._id });

  const hAdminA = authHeaders(adminA);
  const hMgrA = authHeaders(managerA);
  const hStaffA = authHeaders(staffA);
  const hAdminB = authHeaders(adminB);

  let passed = 0, failed = 0;
  function ok(m) { console.log('  PASS:', m); passed++; }
  function fail(m, e) { console.log('  FAIL:', m, e && e.message ? '— ' + e.message : (e || '')); failed++; }

  try {
    // -------------------------------------------------------------
    // Req #5.3: Company details editing in Admin
    // -------------------------------------------------------------
    console.log('\n--- Req #5.3: Admin Company Details Editing ---');
    try {
      // T1: Own company update succeeds
      const resUpdate = await request(app)
        .put(`/api/v1/admin/companies/${coA._id}`)
        .set('Cookie', hAdminA.cookies)
        .set('x-csrf-token', hAdminA.csrf)
        .send({ name: 'Updated Tenant A', tradingName: 'Tenant A Logistics', vatNumber: 'B12345678', email: 'ops@tenanta.com' });
      assert.strictEqual(resUpdate.status, 200);
      assert.strictEqual(resUpdate.body.name, 'Updated Tenant A');
      assert.strictEqual(resUpdate.body.tradingName, 'Tenant A Logistics');
      ok('T1: PUT /companies/:id successfully updates own company details');
    } catch (e) { fail('T1: PUT /companies/:id update failed', e); }

    try {
      // T2: Tenant isolation: cannot edit another company
      const resCross = await request(app)
        .put(`/api/v1/admin/companies/${coB._id}`)
        .set('Cookie', hAdminA.cookies)
        .set('x-csrf-token', hAdminA.csrf)
        .send({ name: 'Hacked Tenant B' });
      assert.strictEqual(resCross.status, 403);
      ok('T2: PUT /companies/:id enforces tenant isolation (403 for cross-company edit)');
    } catch (e) { fail('T2: Cross-company update guard failed', e); }

    // -------------------------------------------------------------
    // Req #5.2: 3PL Rates Editing
    // -------------------------------------------------------------
    console.log('\n--- Req #5.2: 3PL Rates Editing ---');
    let rateCard;
    try {
      rateCard = await RateCard.create({
        company: coA._id,
        name: 'Standard 3PL Rate ' + s,
        client: 'Client A',
        warehouse: whA.code,
        monthlyMinimum: 350,
        rates: {
          storage: { perLocationPerMonth: 8.50 },
          outboundB2C: { orderFee: 2.10 }
        },
        isActive: true
      });

      const resRate = await request(app)
        .put(`/api/v1/3pl/billing/rate-cards/${rateCard._id}`)
        .set('Cookie', hAdminA.cookies)
        .set('x-csrf-token', hAdminA.csrf)
        .send({
          monthlyMinimum: 450,
          rates: {
            storage: { perLocationPerMonth: 12.00 },
            outboundB2C: { orderFee: 3.50 }
          },
          isActive: true
        });
      assert.strictEqual(resRate.status, 200);
      assert.strictEqual(resRate.body.monthlyMinimum, 450);
      assert.strictEqual(resRate.body.rates.storage.perLocationPerMonth, 12.00);
      ok('T3: PUT /3pl/billing/rate-cards/:id successfully edits 3PL rates');
    } catch (e) { fail('T3: Rate card update failed', e); }

    try {
      // Cross-tenant rate card edit blocked
      const resCrossRate = await request(app)
        .put(`/api/v1/3pl/billing/rate-cards/${rateCard._id}`)
        .set('Cookie', hAdminB.cookies)
        .set('x-csrf-token', hAdminB.csrf)
        .send({ storagePalletDayCost: 0.1 });
      assert.strictEqual(resCrossRate.status, 404); // Scoped to company
      ok('T4: Rate card edit respects tenant boundary (404 for other tenant)');
    } catch (e) { fail('T4: Rate card cross-tenant test failed', e); }

    // -------------------------------------------------------------
    // Req #5.4: Quality Inspections Editing
    // -------------------------------------------------------------
    console.log('\n--- Req #5.4: Quality Inspection Editing ---');
    let qcDoc;
    try {
      qcDoc = await QuarantineInventory.create({
        quarantineId: 'QC-' + s.slice(-6),
        company: coA._id,
        warehouse: whA.code,
        asnId: 'ASN-1',
        owner: 'TenantA',
        ownerType: 'COMPANY',
        sku: 'SKU-QC-' + s.slice(-4),
        qty: 10,
        status: 'pending_qc',
        failReason: 'Inbound inspection'
      });

      const resQc = await request(app)
        .put(`/api/v1/qc/${qcDoc._id}`)
        .set('Cookie', hMgrA.cookies)
        .set('x-csrf-token', hMgrA.csrf)
        .send({
          inspector: 'Inspector Gadget',
          damageLevel: 'minor',
          notes: 'Box damaged during offload, contents intact'
        });
      assert.strictEqual(resQc.status, 200);
      assert.strictEqual(resQc.body.inspector, 'Inspector Gadget');
      assert.strictEqual(resQc.body.damageLevel, 'minor');
      ok('T5: PUT /qc/:id edits active inspection details and notes');
    } catch (e) { fail('T5: QC inspection update failed', e); }

    try {
      // Terminal QC inspection cannot be modified
      await QCInspection.updateOne({ quarantineId: qcDoc.quarantineId, company: coA._id }, { status: 'qc_passed' });

      const resQcTerminal = await request(app)
        .put(`/api/v1/qc/${qcDoc._id}`)
        .set('Cookie', hMgrA.cookies)
        .set('x-csrf-token', hMgrA.csrf)
        .send({ notes: 'Attempting edit on closed QC' });
      assert.strictEqual(resQcTerminal.status, 400);
      ok('T6: PUT /qc/:id blocks editing closed/terminal inspections (400)');
    } catch (e) { fail('T6: QC terminal edit guard failed', e); }

    // -------------------------------------------------------------
    // Req #5.5: Picking Batches Editing
    // -------------------------------------------------------------
    console.log('\n--- Req #5.5: Picking Batches Editing ---');
    let batch;
    try {
      batch = await PickBatch.create({
        batchId: 'BATCH-' + s.slice(-6),
        company: coA._id,
        warehouse: whA.code,
        status: 'pending',
        priority: 'normal',
        type: 'standard',
        orders: [],
        items: []
      });

      const resBatch = await request(app)
        .put(`/api/v1/picking/batches/${batch.batchId}`)
        .set('Cookie', hMgrA.cookies)
        .set('x-csrf-token', hMgrA.csrf)
        .send({
          priority: 'urgent',
          assignee: 'Picker John',
          status: 'in_progress'
        });
      assert.strictEqual(resBatch.status, 200);
      assert.strictEqual(resBatch.body.priority, 'urgent');
      assert.strictEqual(resBatch.body.assignee, 'Picker John');
      assert.strictEqual(resBatch.body.status, 'in_progress');
      ok('T7: PUT /picking/batches/:id updates batch priority, assignee, and status');
    } catch (e) { fail('T7: Pick batch edit failed', e); }

    try {
      // Cross-tenant batch edit blocked
      const resCrossBatch = await request(app)
        .put(`/api/v1/picking/batches/${batch.batchId}`)
        .set('Cookie', hAdminB.cookies)
        .set('x-csrf-token', hAdminB.csrf)
        .send({ priority: 'low' });
      assert.strictEqual(resCrossBatch.status, 404);
      ok('T8: Pick batch edit enforces tenant isolation (404 for other tenant)');
    } catch (e) { fail('T8: Pick batch cross-tenant failed', e); }

    // -------------------------------------------------------------
    // Req #5.6: Supplier Products Editing
    // -------------------------------------------------------------
    console.log('\n--- Req #5.6: Supplier Products Editing ---');
    try {
      const prodA = await Product.create({
        sku: 'SUP-SKU-' + s.slice(-4),
        name: 'Supplied Widget',
        company: coA._id,
        category: 'Hardware',
        price: 15.0
      });

      const supplier = await Supplier.create({
        name: 'Acme Parts Corp ' + s,
        company: coA._id,
        country: 'Spain'
      });

      const mapping = await SupplierProduct.create({
        company: coA._id,
        supplierId: supplier._id,
        productId: prodA._id,
        supplierSku: 'ACME-OLD-01',
        supplierProductName: 'Old Name',
        purchaseCost: 9.50,
        leadTimeDays: 14,
        moq: 50,
        isPreferred: false
      });

      const resSupProd = await request(app)
        .put(`/api/v1/suppliers/${supplier._id}/products/${mapping._id}`)
        .set('Cookie', hMgrA.cookies)
        .set('x-csrf-token', hMgrA.csrf)
        .send({
          supplierSku: 'ACME-NEW-99',
          purchaseCost: 11.20,
          leadTimeDays: 7,
          moq: 100,
          isPreferred: true
        });
      assert.strictEqual(resSupProd.status, 200);
      assert.strictEqual(resSupProd.body.supplierSku, 'ACME-NEW-99');
      assert.strictEqual(resSupProd.body.purchaseCost, 11.20);
      assert.strictEqual(resSupProd.body.leadTimeDays, 7);
      assert.strictEqual(resSupProd.body.moq, 100);
      assert.strictEqual(resSupProd.body.isPreferred, true);
      ok('T9: PUT /suppliers/:id/products/:mappingId edits mapped product pricing & lead time');
    } catch (e) { fail('T9: Supplier product edit failed', e); }

    // -------------------------------------------------------------
    // Req #5.7: Inbound Receipt/Shipment Statuses Editing
    // -------------------------------------------------------------
    console.log('\n--- Req #5.7: Inbound Receipt Status Editing ---');
    let asn;
    try {
      asn = await ASN.create({
        asnId: 'ASN-' + s.slice(-6),
        asnNumber: 'ASN-' + s.slice(-6),
        poNumber: 'PO-' + s.slice(-6),
        expectedDate: new Date(),
        owner: 'TenantA',
        ownerType: 'COMPANY',
        company: coA._id,
        warehouse: whA.code,
        supplier: 'Acme Corp',
        status: 'pending',
        items: []
      });

      // Valid transition pending -> in_progress
      const resStatus1 = await request(app)
        .patch(`/api/v1/receiving/${asn._id}/status`)
        .set('Cookie', hMgrA.cookies)
        .set('x-csrf-token', hMgrA.csrf)
        .send({ status: 'in_progress' });
      assert.strictEqual(resStatus1.status, 200);
      assert.strictEqual(resStatus1.body.status, 'in_progress');
      ok('T10: PATCH /receiving/:id/status updates pending -> in_progress');
    } catch (e) { fail('T10: Valid status transition failed', e); }

    try {
      // Lookup by asnId (human-readable ID) also succeeds
      const resStatusByNum = await request(app)
        .patch(`/api/v1/receiving/${asn.asnId}/status`)
        .set('Cookie', hMgrA.cookies)
        .set('x-csrf-token', hMgrA.csrf)
        .send({ status: 'completed' });
      assert.strictEqual(resStatusByNum.status, 200);
      assert.strictEqual(resStatusByNum.body.status, 'completed');
      ok('T11: PATCH /receiving/:id/status resolves human-readable asnId');
    } catch (e) { fail('T11: ASN lookup by asnId failed', e); }

    try {
      // Non-admin attempting to revert terminal completed status gets 400
      const resTerminalReject = await request(app)
        .patch(`/api/v1/receiving/${asn._id}/status`)
        .set('Cookie', hMgrA.cookies)
        .set('x-csrf-token', hMgrA.csrf)
        .send({ status: 'in_progress' });
      assert.strictEqual(resTerminalReject.status, 400);
      ok('T12: PATCH /receiving/:id/status enforces state machine terminal guards for non-admin');
    } catch (e) { fail('T12: Terminal status guard failed', e); }

    // -------------------------------------------------------------
    // Req #5.1: Batch Withdrawal / Removal Invariants
    // -------------------------------------------------------------
    console.log('\n--- Req #5.1: Batch Withdrawal / Lot Recall Invariants ---');
    try {
      const lotNum = 'LOT-RECALL-' + s.slice(-6);
      const testSku = 'SKU-RECALL-' + s.slice(-4);

      // Seed product master record for dual aggregate invariant
      await Product.create({
        sku: testSku,
        name: 'Recall Test Item',
        company: coA._id,
        category: 'Hardware',
        qty_available: 50,
        qty_blocked: 0,
        price: 25.0,
        warehouse: whA.code
      });

      // Seed available inventory balance for lot
      const balance = await InventoryBalance.create({
        company: coA._id,
        warehouse: whA.code,
        sku: testSku,
        lotNumber: lotNum,
        location: locA.code,
        zone: 'Z1',
        aisle: 'A1',
        rack: 'R1',
        bin: 'B1',
        qtyAvailable: 50,
        qtyReserved: 0,
        qtyQuarantine: 0,
        owner: 'TenantA',
        ownerType: 'COMPANY'
      });

      // Preview recall
      const resPreview = await request(app)
        .get(`/api/v1/lot-recalls/preview?lotNumber=${lotNum}`)
        .set('Cookie', hMgrA.cookies);
      assert.strictEqual(resPreview.status, 200);
      assert.strictEqual(resPreview.body.totalAvailable, 50);
      assert.strictEqual(resPreview.body.totalQuarantine, 0);
      ok('T13: GET /lot-recalls/preview accurately inspects stock for batch withdrawal');

      // Execute batch withdrawal
      const resRecall = await request(app)
        .post('/api/v1/lot-recalls')
        .set('Cookie', hMgrA.cookies)
        .set('x-csrf-token', hMgrA.csrf)
        .send({
          lotNumber: lotNum,
          sku: testSku,
          reason: 'Defective batch withdrawal',
          warehouse: whA.code
        });
      assert.strictEqual(resRecall.status, 200);
      assert.strictEqual(resRecall.body.totalQuantityQuarantined, 50);

      // Verify physical stock invariant: qtyAvailable became 0, qtyQuarantine became 50
      const updatedBalance = await InventoryBalance.findById(balance._id);
      assert.strictEqual(updatedBalance.qtyAvailable, 0, 'qtyAvailable must be 0');
      assert.strictEqual(updatedBalance.qtyQuarantine, 50, 'qtyQuarantine must be 50');
      ok('T14: POST /lot-recalls shifts stock from available to quarantine preserving physical invariant');

      // Verify audit history is queryable
      const resHistory = await request(app)
        .get(`/api/v1/lot-recalls?lotNumber=${lotNum}`)
        .set('Cookie', hMgrA.cookies);
      assert.strictEqual(resHistory.status, 200);
      assert(resHistory.body.recalls.length >= 1);
      assert.strictEqual(resHistory.body.recalls[0].lot_number, lotNum);
      ok('T15: GET /lot-recalls returns immutable audit record for the withdrawn batch');
    } catch (e) { fail('T13-T15: Batch withdrawal tests failed', e); }

  } finally {
    console.log(`\n======================================================`);
    console.log(`RESULTS: ${passed} passed, ${failed} failed`);
    console.log(`======================================================\n`);
    await teardownTestDatabase();
    process.exit(failed > 0 ? 1 : 0);
  }
}

run().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
