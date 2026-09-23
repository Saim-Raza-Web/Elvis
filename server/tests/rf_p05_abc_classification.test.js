import mongoose from 'mongoose';
import assert from 'assert';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../index.js';
import User from '../models/User.js';
import Company from '../models/Company.js';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import AuditLog from '../models/AuditLog.js';
import { setupTestDatabase } from '../test_helper.js';
import { abcEngine } from '../services/abcEngine.js';

async function runTests() {
  console.log('--- RF-P05 ABC Classification Tests ---');
  
  // Test database setup
  await setupTestDatabase();
  console.log('[DB] Connected safely via setupTestDatabase');
  
  const uniqueSuffix = Date.now().toString();
  
  // Create test company
  const company = await Company.create({
    name: `RF-P05 Test Co ${uniqueSuffix}`,
    code: `RF05_${uniqueSuffix.slice(-4)}`,
    blindReceiving: false
  });
  const companyId = company._id;

  // Create test admin user
  const adminUser = await User.create({
    email: `admin_${uniqueSuffix}@test.com`,
    password: 'password123',
    name: 'Admin User',
    role: 'admin',
    company: companyId
  });
  const adminToken = jwt.sign(
    { id: adminUser._id, company: companyId, role: 'admin' },
    process.env.JWT_SECRET || 'fallback_secret_key'
  );

  // Create test products
  const productA = await Product.create({
    sku: `SKU-A-${uniqueSuffix}`,
    name: 'High Volume Product A',
    category: 'GEN',
    company: companyId,
    qty_available: 100
  });

  const productB = await Product.create({
    sku: `SKU-B-${uniqueSuffix}`,
    name: 'Medium Volume Product B',
    category: 'GEN',
    company: companyId,
    qty_available: 50
  });

  const productC = await Product.create({
    sku: `SKU-C-${uniqueSuffix}`,
    name: 'Low Volume Product C',
    category: 'GEN',
    company: companyId,
    qty_available: 25
  });

  console.log('[SETUP] Test environment created');

  try {
    // ============================================
    // TEST A: Product ABC Fields
    // ============================================
    console.log('\n=== TEST A: Product ABC Fields ===');
    
    assert.ok(productA.sku_abc_class === undefined, 'Initial ABC class should be undefined');
    assert.ok(productA.abc_calc_date === undefined, 'Initial calc date should be undefined');
    assert.ok(productA.abc_pick_count_period === undefined, 'Initial pick count should be undefined');
    assert.ok(productA.abc_class_override === undefined, 'Initial override should be undefined');
    console.log('✓ Product ABC fields exist and are initially undefined');

    // ============================================
    // TEST B: ABC Engine Calculation
    // ============================================
    console.log('\n=== TEST B: ABC Engine Calculation ===');
    
    // Create some test orders with different volumes
    const order1 = await Order.create({
      orderId: `ORD-1-${uniqueSuffix}`,
      date: new Date(),
      status: 'shipped',
      company: companyId,
      product_lines: [
        { 
          sku: productA.sku, 
          qty: 100,
          product_name: productA.name,
          unit_price: 10.0,
          line_total: 1000.0
        },
        { 
          sku: productB.sku, 
          qty: 50,
          product_name: productB.name,
          unit_price: 5.0,
          line_total: 250.0
        }
      ]
    });

    const order2 = await Order.create({
      orderId: `ORD-2-${uniqueSuffix}`,
      date: new Date(),
      status: 'shipped',
      company: companyId,
      product_lines: [
        { 
          sku: productA.sku, 
          qty: 80,
          product_name: productA.name,
          unit_price: 10.0,
          line_total: 800.0
        },
        { 
          sku: productC.sku, 
          qty: 10,
          product_name: productC.name,
          unit_price: 2.0,
          line_total: 20.0
        }
      ]
    });

    // Run ABC calculation
    const abcResult = await abcEngine.calculateCompanyABC(companyId);
    
    assert.ok(abcResult.success, 'ABC calculation should succeed');
    assert.strictEqual(abcResult.totalProducts, 3, 'Should process 3 products');
    assert.ok(abcResult.counts, 'Should return counts');
    console.log('✓ ABC engine calculation completed successfully');
    console.log(`  Total products: ${abcResult.totalProducts}`);
    console.log(`  Class A: ${abcResult.counts.A}, Class B: ${abcResult.counts.B}, Class C: ${abcResult.counts.C}`);

    // Verify products were updated
    const updatedProductA = await Product.findById(productA._id);
    assert.ok(updatedProductA.sku_abc_class, 'Product A should have calculated class');
    assert.ok(updatedProductA.abc_calc_date, 'Product A should have calc date');
    console.log('✓ Products updated with ABC calculations');

    // ============================================
    // TEST C: ABC API Endpoints
    // ============================================
    console.log('\n=== TEST C: ABC API Endpoints ===');
    
    // Test GET ABC summary
    const abcRes = await request(app)
      .get('/api/v1/abc-classification')
      .set('Authorization', `Bearer ${adminToken}`);
    assert.strictEqual(abcRes.status, 200, 'Should get ABC summary');
    assert.ok(abcRes.body.totalProducts >= 3, 'Should have at least 3 products');
    assert.ok(abcRes.body.products, 'Should return products array');
    console.log('✓ GET ABC summary endpoint works');

    // Test POST recalculate
    const recalcRes = await request(app)
      .post('/api/v1/abc-classification/recalculate')
      .set('Authorization', `Bearer ${adminToken}`);
    assert.strictEqual(recalcRes.status, 200, 'Should trigger recalculation');
    assert.ok(recalcRes.body.success, 'Recalculation should succeed');
    console.log('✓ POST recalculate endpoint works');

    // ============================================
    // TEST D: Manual Override API
    // ============================================
    console.log('\n=== TEST D: Manual Override API ===');
    
    // Test set override
    const overrideRes = await request(app)
      .put(`/api/v1/abc-classification/${productB.sku}/override`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ abcClass: 'A', reason: 'High priority customer' });
    assert.strictEqual(overrideRes.status, 200, 'Should set override');
    assert.strictEqual(overrideRes.body.override, 'A', 'Override should be A');
    assert.strictEqual(overrideRes.body.effectiveClass, 'A', 'Effective class should be A');
    console.log('✓ Manual override set successfully');

    // Verify override persists
    const overriddenProduct = await Product.findById(productB._id);
    assert.strictEqual(overriddenProduct.abc_class_override, 'A', 'Override should persist');
    assert.strictEqual(overriddenProduct.abc_override_reason, 'High priority customer', 'Reason should persist');
    console.log('✓ Override persists in database');

    // Test clear override
    const clearRes = await request(app)
      .delete(`/api/v1/abc-classification/${productB.sku}/override`)
      .set('Authorization', `Bearer ${adminToken}`);
    assert.strictEqual(clearRes.status, 200, 'Should clear override');
    assert.ok(clearRes.body.message, 'Should return success message');
    console.log('✓ Manual override cleared successfully');

    // Verify override is cleared
    const clearedProduct = await Product.findById(productB._id);
    assert.strictEqual(clearedProduct.abc_class_override, null, 'Override should be null');
    assert.strictEqual(clearedProduct.abc_override_reason, null, 'Reason should be null');
    console.log('✓ Override cleared from database');

    // ============================================
    // TEST E: Audit Logging
    // ============================================
    console.log('\n=== TEST E: Audit Logging ===');
    
    // Set override again to test audit
    await request(app)
      .put(`/api/v1/abc-classification/${productC.sku}/override`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ abcClass: 'B', reason: 'Test audit' });

    // Check for audit log entry
    const auditLog = await AuditLog.findOne({
      company: companyId,
      event_type: 'abc_override_set'
    });
    assert.ok(auditLog, 'Should have audit log for override');
    assert.strictEqual(auditLog.user_id.toString(), adminUser._id.toString(), 'Audit should log user');
    console.log('✓ ABC override audit logging works');

    // Check for calculation audit log
    const calcAuditLog = await AuditLog.findOne({
      company: companyId,
      event_type: 'abc_calculated'
    });
    assert.ok(calcAuditLog, 'Should have audit log for calculation');
    console.log('✓ ABC calculation audit logging works');

    // ============================================
    // TEST F: Validation
    // ============================================
    console.log('\n=== TEST F: Validation ===');
    
    // Test invalid ABC class
    const invalidRes = await request(app)
      .put(`/api/v1/abc-classification/${productA.sku}/override`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ abcClass: 'X', reason: 'Invalid class' });
    assert.strictEqual(invalidRes.status, 400, 'Should reject invalid ABC class');
    console.log('✓ Invalid ABC class validation works');

    // Test override for non-existent product
    const missingRes = await request(app)
      .put('/api/v1/abc-classification/NONEXISTENT/override')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ abcClass: 'A', reason: 'Test' });
    assert.strictEqual(missingRes.status, 404, 'Should return 404 for non-existent product');
    console.log('✓ Non-existent product validation works');

    // ============================================
    // TEST G: Vercel Cron Scheduling & Authentication
    // ============================================
    console.log('\n=== TEST G: Vercel Cron Scheduling & Authentication ===');
    
    const prevCronSecret = process.env.CRON_SECRET;
    const testCronSecret = 'test_cron_secret_weekly_abc_789';
    process.env.CRON_SECRET = testCronSecret;

    // 1. Missing Authorization header rejected
    const noAuthCronRes = await request(app)
      .get('/api/v1/abc-classification/recalculate');
    assert.strictEqual(noAuthCronRes.status, 401, 'Cron call with no secret should return 401');
    console.log('✓ Missing cron secret rejected (401)');

    // 2. Invalid CRON_SECRET rejected
    const invalidCronRes = await request(app)
      .get('/api/v1/abc-classification/recalculate')
      .set('Authorization', 'Bearer wrong_cron_secret');
    assert.strictEqual(invalidCronRes.status, 401, 'Cron call with invalid secret should return 401');
    console.log('✓ Invalid cron secret rejected (401)');

    // 3. Valid CRON_SECRET accepted via GET /recalculate (Vercel Cron standard)
    const validCronRes = await request(app)
      .get('/api/v1/abc-classification/recalculate')
      .set('Authorization', `Bearer ${testCronSecret}`);
    assert.strictEqual(validCronRes.status, 200, 'Cron call with valid secret should return 200');
    assert.strictEqual(validCronRes.body.success, true, 'Cron response should indicate success');
    assert.ok(Array.isArray(validCronRes.body.results), 'Cron response should include results array');
    console.log('✓ Valid cron authentication executes ABC recalculation successfully (200)');

    // 4. Verify Cron AuditLog entry
    const cronAudit = await AuditLog.findOne({
      event_type: 'abc_calculated',
      user_name: 'CRON_SCHEDULER'
    }).sort({ createdAt: -1 });
    assert.ok(cronAudit, 'Cron run should generate an AuditLog entry');
    console.log('✓ Cron recalculation logged to AuditLog');

    // 5. Valid CRON_SECRET accepted via /cron alias
    const aliasCronRes = await request(app)
      .get('/api/v1/abc-classification/cron')
      .set('Authorization', `Bearer ${testCronSecret}`);
    assert.strictEqual(aliasCronRes.status, 200, 'Cron alias /cron should return 200');
    console.log('✓ /cron alias works with valid CRON_SECRET (200)');

    // ============================================
    // TEST H: Concurrency Lock & Role Protection
    // ============================================
    console.log('\n=== TEST H: Concurrency Lock & Role Protection ===');

    const { default: WorkerLease } = await import('../models/WorkerLease.js');

    // Acquire lock manually to simulate concurrent execution in progress
    await WorkerLease.findOneAndUpdate(
      { jobKey: 'ABC_RECALCULATION_WORKER' },
      {
        $set: {
          status: 'ACQUIRED',
          leaseOwner: 'test_active_worker',
          leaseUntil: new Date(Date.now() + 120000), // 2 min in future
          lastHeartbeat: new Date()
        }
      },
      { upsert: true }
    );

    // Attempt concurrent cron recalculation while lock is held
    const concurrentRes = await request(app)
      .get('/api/v1/abc-classification/recalculate')
      .set('Authorization', `Bearer ${testCronSecret}`);
    assert.strictEqual(concurrentRes.status, 409, 'Concurrent run should be rejected with 409 Conflict');
    assert.strictEqual(concurrentRes.body.status, 'CONCURRENT_RUN_PREVENTED', 'Should indicate concurrent run prevented');
    console.log('✓ Concurrency lock prevents duplicate ABC recalculation runs (409 Conflict)');

    // Release lock and verify recalculation succeeds again
    await WorkerLease.updateOne(
      { jobKey: 'ABC_RECALCULATION_WORKER' },
      { $set: { status: 'RELEASED' } }
    );

    const releasedRes = await request(app)
      .get('/api/v1/abc-classification/recalculate')
      .set('Authorization', `Bearer ${testCronSecret}`);
    assert.strictEqual(releasedRes.status, 200, 'Should succeed after lock is released');
    console.log('✓ Recalculation succeeds once lock is released');

    // 6. Role protection: Non-ops user rejected from manual recalculation
    const staffUser = await User.create({
      email: `staff_${uniqueSuffix}@test.com`,
      password: 'password123',
      name: 'Staff User',
      role: 'warehouse_staff',
      company: companyId
    });
    const staffToken = jwt.sign(
      { id: staffUser._id, company: companyId, role: 'warehouse_staff' },
      process.env.JWT_SECRET || 'fallback_secret_key'
    );

    const staffRecalcRes = await request(app)
      .post('/api/v1/abc-classification/recalculate')
      .set('Authorization', `Bearer ${staffToken}`);
    assert.strictEqual(staffRecalcRes.status, 403, 'Non-ops role should be forbidden from manual recalculation');
    console.log('✓ Non-ops role correctly rejected from recalculation (403)');

    // Restore CRON_SECRET env
    if (prevCronSecret) {
      process.env.CRON_SECRET = prevCronSecret;
    } else {
      delete process.env.CRON_SECRET;
    }

    console.log('\n=== ALL RF-P05 TESTS (INCLUDING VERCEL CRON) PASSED ===');

  } catch (error) {
    console.error('\n=== RF-P05 TEST FAILED ===');
    console.error(error);
    throw error;
  } finally {
    // Cleanup
    console.log('\n[CLEANUP] Test database will be cleaned by setupTestDatabase');
  }
}

// Run tests
runTests().then(() => {
  console.log('\n✓ RF-P05 ABC Classification tests completed successfully');
  process.exit(0);
}).catch((error) => {
  console.error('\n✗ RF-P05 ABC Classification tests failed');
  console.error(error);
  process.exit(1);
});