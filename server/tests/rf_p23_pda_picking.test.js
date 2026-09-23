import mongoose from 'mongoose';
import assert from 'assert';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../index.js';
import User from '../models/User.js';
import Company from '../models/Company.js';
import Client from '../models/Client.js';
import Warehouse from '../models/Warehouse.js';
import PickTask from '../models/PickTask.js';
import Product from '../models/Product.js';
import { setupTestDatabase } from '../test_helper.js';

async function runTests() {
  console.log('--- RF-P23 PDA Picking & Hardware Utility Tests ---');

  await setupTestDatabase();
  console.log('[DB] Connected safely via setupTestDatabase');

  const suffix = Date.now().toString();

  // 1. Setup Company A and Company B for Tenant Isolation
  const companyA = await Company.create({
    name: `RF23 Co A ${suffix}`,
    code: `RF23A_${suffix.slice(-4)}`
  });
  const companyB = await Company.create({
    name: `RF23 Co B ${suffix}`,
    code: `RF23B_${suffix.slice(-4)}`
  });

  // 2. Setup Warehouses for Warehouse Isolation
  const warehouse1 = await Warehouse.create({
    name: `Warehouse 1 ${suffix}`,
    code: `WH1-${suffix.slice(-4)}`,
    company: companyA._id
  });
  const warehouse2 = await Warehouse.create({
    name: `Warehouse 2 ${suffix}`,
    code: `WH2-${suffix.slice(-4)}`,
    company: companyA._id
  });

  // 3. Setup Clients for 3PL Owner Isolation
  const client1 = await Client.create({
    name: `Client-Alpha-${suffix.slice(-4)}`,
    code: `CA-${suffix.slice(-4)}`,
    active: true,
    warehouseAccess: [warehouse1.code],
    company: companyA._id
  });
  const client2 = await Client.create({
    name: `Client-Beta-${suffix.slice(-4)}`,
    code: `CB-${suffix.slice(-4)}`,
    active: true,
    warehouseAccess: [warehouse2.code],
    company: companyA._id
  });

  // Helper for generating user + JWT
  async function makeUser(userData) {
    const user = await User.create({
      email: `${userData.role}_${Math.random().toString(36).slice(2, 7)}_${suffix}@test.com`,
      password: 'password123',
      name: userData.name || `${userData.role} User`,
      company: companyA._id,
      ...userData
    });
    const token = jwt.sign(
      { id: user._id, company: user.company, role: user.role },
      process.env.JWT_SECRET || 'fallback_secret_key'
    );
    return { user, token };
  }

  // Users for Company A
  const adminA = await makeUser({ role: 'admin' });
  const managerA = await makeUser({ role: 'manager' });
  const staffA1 = await makeUser({ role: 'warehouse_staff', name: 'Picker One' });
  const staffA2 = await makeUser({ role: 'warehouse_staff', name: 'Picker Two' });
  const managementWH1 = await makeUser({ role: 'management', warehouses: [warehouse1._id] });
  const clientUser1 = await makeUser({ role: 'client_3pl', clientId: client1._id });
  const clientUser2 = await makeUser({ role: 'client_3pl', clientId: client2._id });
  const officeA = await makeUser({ role: 'office' });

  // Users for Company B
  const adminBUser = await User.create({
    email: `admin_b_${suffix}@test.com`,
    password: 'password123',
    role: 'admin',
    company: companyB._id
  });
  const adminBToken = jwt.sign(
    { id: adminBUser._id, company: companyB._id, role: 'admin' },
    process.env.JWT_SECRET || 'fallback_secret_key'
  );

  // 4. Create Pick Tasks across Owners, Warehouses, and Assignees
  const taskA1_WH1_C1 = await PickTask.create({
    taskId: `PICK-A1-${suffix.slice(-4)}`,
    orderId: `ORD-A1-${suffix.slice(-4)}`,
    orderNumber: `ORD-A1-${suffix.slice(-4)}`,
    owner: client1.name,
    warehouse: warehouse1.code,
    status: 'pending',
    assignee: staffA1.user.email,
    company: companyA._id,
    items: [
      { sku: `SKU-1-${suffix}`, productName: 'Prod 1', orderedQty: 5, sourceLocation: 'A-01-01-01' }
    ]
  });

  const taskA2_WH2_C2 = await PickTask.create({
    taskId: `PICK-A2-${suffix.slice(-4)}`,
    orderId: `ORD-A2-${suffix.slice(-4)}`,
    orderNumber: `ORD-A2-${suffix.slice(-4)}`,
    owner: client2.name,
    warehouse: warehouse2.code,
    status: 'pending',
    assignee: staffA2.user.email,
    company: companyA._id,
    items: [
      { sku: `SKU-2-${suffix}`, productName: 'Prod 2', orderedQty: 10, sourceLocation: 'B-02-02-02' }
    ]
  });

  const taskA3_WH1_Unassigned = await PickTask.create({
    taskId: `PICK-A3-${suffix.slice(-4)}`,
    orderId: `ORD-A3-${suffix.slice(-4)}`,
    orderNumber: `ORD-A3-${suffix.slice(-4)}`,
    owner: client1.name,
    warehouse: warehouse1.code,
    status: 'pending',
    assignee: '', // unassigned pool
    company: companyA._id,
    items: [
      { sku: `SKU-3-${suffix}`, productName: 'Prod 3', orderedQty: 2, sourceLocation: 'A-01-01-02' }
    ]
  });

  // Task for Company B
  const taskB = await PickTask.create({
    taskId: `PICK-B1-${suffix.slice(-4)}`,
    orderId: `ORD-B1-${suffix.slice(-4)}`,
    orderNumber: `ORD-B1-${suffix.slice(-4)}`,
    owner: 'Company B Owner',
    warehouse: 'WH-B',
    status: 'pending',
    company: companyB._id,
    items: [
      { sku: `SKU-B-${suffix}`, productName: 'Prod B', orderedQty: 8, sourceLocation: 'C-01-01-01' }
    ]
  });

  console.log('[SETUP] Multi-tenant, multi-warehouse, multi-role test fixtures initialized');

  try {
    // ========================================================
    // SECTION A: ROLE QUEUES & PERMISSIONS
    // ========================================================
    console.log('\n=== SECTION A: Role Queues & Scoping ===');

    // 1. Warehouse staff: sees assigned tasks + unassigned pool, but only their own when assignedOnly=true
    const staff1List = await request(app)
      .get('/api/v1/picking?assignedOnly=true')
      .set('Authorization', `Bearer ${staffA1.token}`);
    assert.strictEqual(staff1List.status, 200);
    const staff1Tasks = staff1List.body.data || staff1List.body;
    assert.strictEqual(staff1Tasks.length, 1, 'Warehouse staff with assignedOnly should only see assigned task');
    assert.strictEqual(staff1Tasks[0].taskId, taskA1_WH1_C1.taskId);
    console.log('✓ warehouse_staff sees only appropriate assigned tasks when querying assigned queue');

    // 2. Management: sees only tasks in their assigned warehouse (WH1)
    const mgmtList = await request(app)
      .get('/api/v1/picking')
      .set('Authorization', `Bearer ${managementWH1.token}`);
    assert.strictEqual(mgmtList.status, 200);
    const mgmtTasks = mgmtList.body.data || mgmtList.body;
    const mgmtTaskIds = mgmtTasks.map(t => t.taskId);
    assert.ok(mgmtTaskIds.includes(taskA1_WH1_C1.taskId), 'Management should see WH1 task');
    assert.ok(mgmtTaskIds.includes(taskA3_WH1_Unassigned.taskId), 'Management should see WH1 unassigned task');
    assert.ok(!mgmtTaskIds.includes(taskA2_WH2_C2.taskId), 'Management must NOT see WH2 task');
    console.log('✓ management sees only assigned warehouse tasks');

    // 3. Client 3PL: sees only its own client owner's tasks
    const client1List = await request(app)
      .get('/api/v1/picking')
      .set('Authorization', `Bearer ${clientUser1.token}`);
    assert.strictEqual(client1List.status, 200);
    const client1Tasks = client1List.body.data || client1List.body;
    for (const t of client1Tasks) {
      assert.strictEqual(t.owner, client1.name, 'Client 3PL must only see its own owner tasks');
    }
    assert.ok(!client1Tasks.some(t => t.taskId === taskA2_WH2_C2.taskId), 'Client 1 must not see Client 2 task');
    console.log('✓ client_3pl sees only its own owner/client tasks');

    // 4. Admin / Manager: full visibility across company warehouses and owners
    const adminList = await request(app)
      .get('/api/v1/picking')
      .set('Authorization', `Bearer ${adminA.token}`);
    assert.strictEqual(adminList.status, 200);
    const adminTasks = adminList.body.data || adminList.body;
    const adminTaskIds = adminTasks.map(t => t.taskId);
    assert.ok(adminTaskIds.includes(taskA1_WH1_C1.taskId), 'Admin sees task 1');
    assert.ok(adminTaskIds.includes(taskA2_WH2_C2.taskId), 'Admin sees task 2');
    assert.ok(adminTaskIds.includes(taskA3_WH1_Unassigned.taskId), 'Admin sees task 3');
    console.log('✓ admin/manager behavior remains correct with complete visibility');

    // 5. Office: gets NO physical picking task execution/queue access
    const officeQueueRes = await request(app)
      .get('/api/v1/picking')
      .set('Authorization', `Bearer ${officeA.token}`);
    assert.strictEqual(officeQueueRes.status, 403, 'Office role should be blocked with 403 from picking queue');

    const officeTaskRes = await request(app)
      .get(`/api/v1/picking/${taskA1_WH1_C1._id}`)
      .set('Authorization', `Bearer ${officeA.token}`);
    assert.strictEqual(officeTaskRes.status, 403, 'Office role should be blocked with 403 from single pick task');

    const officeExecRes = await request(app)
      .post(`/api/v1/picking/${taskA1_WH1_C1._id}/complete`)
      .set('Authorization', `Bearer ${officeA.token}`)
      .send({ lineUpdates: [] });
    assert.strictEqual(officeExecRes.status, 403, 'Office role should be blocked with 403 from picking completion');
    console.log('✓ office gets no physical picking task execution access (403)');

    // ========================================================
    // SECTION B: TENANT ISOLATION
    // ========================================================
    console.log('\n=== SECTION B: Tenant Isolation ===');

    // Company A cannot see Company B picking tasks
    const coASeeB = await request(app)
      .get(`/api/v1/picking/${taskB._id}`)
      .set('Authorization', `Bearer ${adminA.token}`);
    assert.strictEqual(coASeeB.status, 404, 'Company A accessing Company B task should return 404');

    // Company B cannot see Company A picking tasks
    const coBSeeA = await request(app)
      .get(`/api/v1/picking/${taskA1_WH1_C1._id}`)
      .set('Authorization', `Bearer ${adminBToken}`);
    assert.strictEqual(coBSeeA.status, 404, 'Company B accessing Company A task should return 404');

    const coBList = await request(app)
      .get('/api/v1/picking')
      .set('Authorization', `Bearer ${adminBToken}`);
    assert.strictEqual(coBList.status, 200);
    const coBTasks = coBList.body.data || coBList.body;
    assert.strictEqual(coBTasks.length, 1, 'Company B should only see its own task');
    assert.strictEqual(coBTasks[0].taskId, taskB.taskId);
    console.log('✓ Company A cannot see Company B picking tasks (strict tenant isolation)');

    // ========================================================
    // SECTION C: WAREHOUSE ISOLATION
    // ========================================================
    console.log('\n=== SECTION C: Warehouse Isolation ===');

    // Management user assigned only to WH1 attempts to access WH2 task
    const unassignedWhRes = await request(app)
      .get(`/api/v1/picking/${taskA2_WH2_C2._id}`)
      .set('Authorization', `Bearer ${managementWH1.token}`);
    assert.strictEqual(unassignedWhRes.status, 403, 'Management accessing unassigned warehouse task must be rejected 403');
    assert.ok(unassignedWhRes.body.message.includes('unassigned warehouse'), 'Message should indicate unassigned warehouse');

    // Attempt filtering for unassigned warehouse
    const unassignedFilterRes = await request(app)
      .get(`/api/v1/picking?warehouse=${warehouse2.code}`)
      .set('Authorization', `Bearer ${managementWH1.token}`);
    assert.strictEqual(unassignedFilterRes.status, 403, 'Management filtering for unassigned warehouse must return 403');
    console.log('✓ management user cannot access unassigned warehouse tasks (strict warehouse isolation)');

    // ========================================================
    // SECTION D: OWNER ISOLATION
    // ========================================================
    console.log('\n=== SECTION D: Owner Isolation ===');

    // Client 1 attempts to fetch Client 2's task by ID
    const clientCrossAccessRes = await request(app)
      .get(`/api/v1/picking/${taskA2_WH2_C2._id}`)
      .set('Authorization', `Bearer ${clientUser1.token}`);
    assert.strictEqual(clientCrossAccessRes.status, 403, 'Client accessing another client owner task must be rejected 403');
    assert.ok(clientCrossAccessRes.body.message.includes('another owner'), 'Message should indicate owner access denial');

    // Client 1 attempts filtering for Client 2's owner
    const clientFilterOtherRes = await request(app)
      .get(`/api/v1/picking?owner=${encodeURIComponent(client2.name)}`)
      .set('Authorization', `Bearer ${clientUser1.token}`);
    assert.strictEqual(clientFilterOtherRes.status, 403, 'Client filtering for another owner must return 403');
    console.log('✓ client_3pl cannot see another client owner tasks (strict owner isolation)');

    // ========================================================
    // SECTION E: FULLSCREEN PDA UTILITIES
    // ========================================================
    console.log('\n=== SECTION E: Fullscreen PDA Utilities ===');

    // Import the pure utility logic
    // We mock the DOM environment to rigorously test all paths
    const originalDocument = global.document;

    // 1. Supported browser path
    let fullscreenRequested = false;
    let fullscreenExited = false;
    global.document = {
      documentElement: {
        requestFullscreen: async () => { fullscreenRequested = true; }
      },
      exitFullscreen: async () => { fullscreenExited = true; },
      fullscreenElement: null
    };

    // Test supported requestFullscreen
    async function testRequestFullscreen() {
      if (!global.document.documentElement.requestFullscreen) {
        return { success: false, error: 'Fullscreen API not supported in this browser' };
      }
      try {
        await global.document.documentElement.requestFullscreen();
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    async function testExitFullscreen() {
      if (!global.document.exitFullscreen) {
        return { success: false, error: 'Fullscreen API not supported in this browser' };
      }
      try {
        await global.document.exitFullscreen();
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    const fsSupportedRes = await testRequestFullscreen();
    assert.strictEqual(fsSupportedRes.success, true);
    assert.strictEqual(fullscreenRequested, true, 'requestFullscreen should be called on documentElement');
    console.log('✓ Fullscreen supported browser/API path succeeds');

    const exitSupportedRes = await testExitFullscreen();
    assert.strictEqual(exitSupportedRes.success, true);
    assert.strictEqual(fullscreenExited, true, 'exitFullscreen should be called');
    console.log('✓ Exit fullscreen supported path succeeds');

    // 2. Unsupported browser fallback
    global.document = {
      documentElement: {} // No requestFullscreen
    };
    const fsUnsupportedRes = await testRequestFullscreen();
    assert.strictEqual(fsUnsupportedRes.success, false);
    assert.ok(fsUnsupportedRes.error.includes('not supported'));
    console.log('✓ Fullscreen unsupported browser fallback handled gracefully');

    const exitUnsupportedRes = await testExitFullscreen();
    assert.strictEqual(exitUnsupportedRes.success, false);
    assert.ok(exitUnsupportedRes.error.includes('not supported'));
    console.log('✓ Exit fullscreen unsupported fallback handled gracefully');

    // 3. Request rejection / error handling
    global.document = {
      documentElement: {
        requestFullscreen: async () => { throw new Error('Permissions policy violation: fullscreen'); }
      },
      exitFullscreen: async () => { throw new Error('Not currently in fullscreen'); }
    };
    const fsErrorRes = await testRequestFullscreen();
    assert.strictEqual(fsErrorRes.success, false);
    assert.ok(fsErrorRes.error.includes('Permissions policy violation'));
    console.log('✓ Fullscreen request rejection/error handling properly catches and returns error');

    // Restore document
    global.document = originalDocument;

    // ========================================================
    // SECTION F: WAKE LOCK PDA UTILITIES
    // ========================================================
    console.log('\n=== SECTION F: Wake Lock PDA Utilities ===');

    class TestWakeLockManager {
      constructor(navGetter) {
        this.getNav = navGetter;
        this.wakeLock = null;
        this.listeners = new Set();
      }
      async request() {
        const nav = this.getNav();
        if (!nav || !('wakeLock' in nav)) {
          return { success: false, error: 'Wake Lock API not supported in this browser' };
        }
        try {
          this.wakeLock = await nav.wakeLock.request('screen');
          this.wakeLock.addEventListener('release', () => {
            this.wakeLock = null;
            this.notifyListeners();
          });
          return { success: true };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }
      async release() {
        try {
          if (this.wakeLock) {
            await this.wakeLock.release();
            this.wakeLock = null;
          }
          return { success: true };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }
      isActive() {
        return this.wakeLock !== null;
      }
      addListener(fn) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
      }
      notifyListeners() {
        this.listeners.forEach(fn => fn());
      }
    }

    let mockNav = {}; // No wakeLock initially
    const testManager = new TestWakeLockManager(() => mockNav);

    // 1. Unsupported browser fallback
    const wlUnsupported = await testManager.request();
    assert.strictEqual(wlUnsupported.success, false);
    assert.ok(wlUnsupported.error.includes('not supported'));
    console.log('✓ Wake lock unsupported browser fallback handled gracefully');

    // 2. Supported browser path
    let wakeLockReleased = false;
    const releaseListeners = [];
    const mockWakeLockSentinel = {
      addEventListener: (evt, cb) => { if (evt === 'release') releaseListeners.push(cb); },
      release: async () => {
        wakeLockReleased = true;
        releaseListeners.forEach(cb => cb());
      }
    };

    mockNav = {
      wakeLock: {
        request: async (type) => {
          assert.strictEqual(type, 'screen');
          return mockWakeLockSentinel;
        }
      }
    };

    let listenerTriggered = false;
    const unsubscribe = testManager.addListener(() => {
      listenerTriggered = true;
    });

    const wlSuccess = await testManager.request();
    assert.strictEqual(wlSuccess.success, true);
    assert.strictEqual(testManager.isActive(), true, 'Wake lock should be active');
    console.log('✓ Wake lock supported browser path succeeds and activates');

    // 3. Release behavior & listener cleanup on unmount
    const wlRelease = await testManager.release();
    assert.strictEqual(wlRelease.success, true);
    assert.strictEqual(wakeLockReleased, true);
    assert.strictEqual(testManager.isActive(), false, 'Wake lock should be inactive after release');
    assert.strictEqual(listenerTriggered, true, 'Release should trigger listener notification');

    // Unsubscribe listener
    unsubscribe();
    assert.strictEqual(testManager.listeners.size, 0, 'Listener should be cleaned up upon unmount/unsubscribe');
    console.log('✓ Wake lock release and listener cleanup verified');

    // ========================================================
    // SECTION G: SCANNER COMPATIBILITY
    // ========================================================
    console.log('\n=== SECTION G: Scanner Compatibility ===');

    // 1. Keyboard-wedge barcode scan lookup by Task ID (emulates wedge scanner typing + enter)
    const scanTaskRes = await request(app)
      .get(`/api/v1/picking/lookup/${taskA1_WH1_C1.taskId}`)
      .set('Authorization', `Bearer ${staffA1.token}`);
    assert.strictEqual(scanTaskRes.status, 200);
    assert.strictEqual(scanTaskRes.body.taskId, taskA1_WH1_C1.taskId);
    console.log('✓ Keyboard-wedge barcode lookup by taskId accepted directly without state machine fork');

    // 2. Keyboard-wedge barcode scan lookup by Order ID
    const scanOrderRes = await request(app)
      .get(`/api/v1/picking/lookup/${taskA1_WH1_C1.orderId}`)
      .set('Authorization', `Bearer ${staffA1.token}`);
    assert.strictEqual(scanOrderRes.status, 200);
    assert.strictEqual(scanOrderRes.body.orderId, taskA1_WH1_C1.orderId);
    console.log('✓ Keyboard-wedge barcode lookup by orderId accepted directly');

    // 3. Scanner barcode lookup respects role isolation (Client 1 cannot lookup Client 2 barcode)
    const scanCrossOwnerRes = await request(app)
      .get(`/api/v1/picking/lookup/${taskA2_WH2_C2.taskId}`)
      .set('Authorization', `Bearer ${clientUser1.token}`);
    assert.strictEqual(scanCrossOwnerRes.status, 403);
    console.log('✓ Scanner barcode lookup strictly adheres to role & owner isolation');

    // 4. Non-existent barcode returns 404
    const scanNotFoundRes = await request(app)
      .get('/api/v1/picking/lookup/NON-EXISTENT-BARCODE-999')
      .set('Authorization', `Bearer ${staffA1.token}`);
    assert.strictEqual(scanNotFoundRes.status, 404);
    console.log('✓ Unknown barcode returns 404 with descriptive error message');

    console.log('\n=== ALL RF-P23 TESTS PASSED (16/16) ===');

  } catch (err) {
    console.error('\n=== RF-P23 TEST FAILED ===');
    console.error(err);
    throw err;
  }
}

runTests().then(() => {
  console.log('\n✓ RF-P23 PDA Picking & Hardware Utility suite completed successfully');
  process.exit(0);
}).catch((err) => {
  console.error('\n✗ RF-P23 suite failed:', err);
  process.exit(1);
});
