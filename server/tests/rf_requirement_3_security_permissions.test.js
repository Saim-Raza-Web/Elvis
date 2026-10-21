import assert from 'assert';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import app from '../index.js';
import User from '../models/User.js';
import Company from '../models/Company.js';
import { setupTestDatabase, teardownTestDatabase } from '../test_helper.js';

process.env.NODE_ENV = 'test';
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'test_jwt_secret_req3';

const TEST_CSRF = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function authHeaders(user) {
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1d' });
  return {
    cookies: [`jwt_token=${token}`, `csrf_token=${TEST_CSRF}`],
    csrf: TEST_CSRF
  };
}

async function run() {
  console.log('\n=== ELVIS WMS — REQ #3 SECURITY & PERMISSIONS TESTS ===\n');
  await setupTestDatabase();
  const s = Date.now().toString();
  const pw = await bcrypt.hash('Password123!', 10);

  const coA = await Company.create({ name: 'Tenant A ' + s, code: 'TA' + s.slice(-4) });
  const adminA = await User.create({ email: 'adminA_' + s + '@t.com', password: pw, name: 'Admin A', role: 'admin', company: coA._id, totpEnabled: true });
  const staffA = await User.create({ email: 'staffA_' + s + '@t.com', password: pw, name: 'Staff A', role: 'warehouse_staff', company: coA._id, totpEnabled: false });
  const coB = await Company.create({ name: 'Tenant B ' + s, code: 'TB' + s.slice(-4) });
  const adminB = await User.create({ email: 'adminB_' + s + '@t.com', password: pw, name: 'Admin B', role: 'admin', company: coB._id });

  const hA = authHeaders(adminA);
  const hS = authHeaders(staffA);
  const hB = authHeaders(adminB);
  const customRoleId = 'qcs_' + s.slice(-6);
  let passed = 0, failed = 0;
  function ok(m) { console.log('  PASS:', m); passed++; }
  function fail(m, e) { console.log('  FAIL:', m, e && e.message ? '— ' + e.message : ''); failed++; }

  try {
    // T1: warehouse_staff denied /locations (locations: false in system permissions)
    try {
      const r = await request(app).get('/api/v1/locations').set('Cookie', hS.cookies);
      assert.strictEqual(r.status, 403);
      ok('T1: warehouse_staff denied /locations (403)');
    } catch(e) { fail('T1: warehouse_staff denied /locations', e); }

    // T2: admin allowed /locations
    try {
      const r = await request(app).get('/api/v1/locations').set('Cookie', hA.cookies);
      assert.strictEqual(r.status, 200);
      ok('T2: admin allowed /locations (200)');
    } catch(e) { fail('T2: admin allowed /locations', e); }

    // T3: GET /roles returns system roles list
    try {
      const r = await request(app).get('/api/v1/roles').set('Cookie', hA.cookies);
      assert.strictEqual(r.status, 200);
      assert(r.body && Array.isArray(r.body.roles) && r.body.roles.some(x => x.id === 'admin'));
      ok('T3: GET /roles returns system roles including admin');
    } catch(e) { fail('T3: GET /roles returns system roles', e); }

    // T4: Create custom role with granular permissions (qc: true, locations: true, returns: false)
    try {
      const r = await request(app)
        .post('/api/v1/roles')
        .set('Cookie', hA.cookies)
        .set('X-CSRF-Token', hA.csrf)
        .send({ name: 'QC Spec', roleId: customRoleId, permissions: { qc: true, locations: true, returns: false } });
      assert.strictEqual(r.status, 201);
      assert.strictEqual(r.body.id, customRoleId);
      assert.strictEqual(r.body.permissions.returns, false);
      ok('T4: Custom role created with granular permissions');
    } catch(e) { fail('T4: Custom role creation', e); }

    // T5: Assign custom role to staffA and verify locations access granted
    try {
      const ra = await request(app)
        .put('/api/v1/admin/users/' + staffA._id)
        .set('Cookie', hA.cookies)
        .set('X-CSRF-Token', hA.csrf)
        .send({ role: customRoleId });
      assert.strictEqual(ra.status, 200);
      const rl = await request(app).get('/api/v1/locations').set('Cookie', hS.cookies);
      assert.strictEqual(rl.status, 200);
      ok('T5: Custom role grants /locations access dynamically');
    } catch(e) { fail('T5: Custom role dynamic permission grant', e); }

    // T6: Custom role without returns permission denied /returns
    try {
      const r = await request(app).get('/api/v1/returns').set('Cookie', hS.cookies);
      assert.strictEqual(r.status, 403);
      ok('T6: Custom role without returns:true denied /returns (403)');
    } catch(e) { fail('T6: Custom role returns restriction', e); }

    // T7: Update role to grant returns permission — propagates in real-time
    try {
      const ru = await request(app)
        .put('/api/v1/roles/' + customRoleId)
        .set('Cookie', hA.cookies)
        .set('X-CSRF-Token', hA.csrf)
        .send({ permissions: { qc: true, locations: true, returns: true } });
      assert.strictEqual(ru.status, 200);
      const rr = await request(app).get('/api/v1/returns').set('Cookie', hS.cookies);
      assert.strictEqual(rr.status, 200);
      ok('T7: Permission update propagates dynamically to /returns (200)');
    } catch(e) { fail('T7: Permission update propagation', e); }

    // T8: Tenant isolation — Company B cannot see Company A custom roles
    try {
      const r = await request(app).get('/api/v1/roles').set('Cookie', hB.cookies);
      assert.strictEqual(r.status, 200);
      assert(!r.body.roles.some(x => x.id === customRoleId));
      ok('T8: Tenant isolation — Company B cannot see Company A roles');
    } catch(e) { fail('T8: Tenant isolation role listing', e); }

    // T9: Tenant isolation — Company B cannot modify Company A custom role
    try {
      const r = await request(app)
        .put('/api/v1/roles/' + customRoleId)
        .set('Cookie', hB.cookies)
        .set('X-CSRF-Token', hB.csrf)
        .send({ name: 'Hijacked' });
      assert.strictEqual(r.status, 404);
      ok('T9: Tenant isolation — Cross-tenant role modification blocked (404)');
    } catch(e) { fail('T9: Cross-tenant role mutation guard', e); }

    // T10: Non-admin cannot create roles (privilege escalation prevention)
    try {
      const r = await request(app)
        .post('/api/v1/roles')
        .set('Cookie', hS.cookies)
        .set('X-CSRF-Token', hS.csrf)
        .send({ name: 'PrivEsc', permissions: {} });
      assert.strictEqual(r.status, 403);
      ok('T10: Privilege escalation prevented — non-admin cannot create roles');
    } catch(e) { fail('T10: Privilege escalation guard', e); }

    // T11: System/built-in role cannot be deleted
    try {
      const r = await request(app)
        .delete('/api/v1/roles/admin')
        .set('Cookie', hA.cookies)
        .set('X-CSRF-Token', hA.csrf);
      assert.strictEqual(r.status, 400);
      ok('T11: Built-in system role deletion rejected (400)');
    } catch(e) { fail('T11: System role deletion guard', e); }

    // T12: Sole admin demotion blocked
    try {
      const r = await request(app)
        .put('/api/v1/admin/users/' + adminA._id)
        .set('Cookie', hA.cookies)
        .set('X-CSRF-Token', hA.csrf)
        .send({ role: 'warehouse_staff' });
      assert.strictEqual(r.status, 400);
      ok('T12: Sole admin lockout prevented — self-demotion rejected (400)');
    } catch(e) { fail('T12: Sole admin lockout guard', e); }

    // T13: Admin user listing exposes totpEnabled but keeps totpSecret and recovery codes hidden
    try {
      const r = await request(app).get('/api/v1/admin/users').set('Cookie', hA.cookies);
      assert.strictEqual(r.status, 200);
      const u = r.body.find(x => x._id === adminA._id.toString());
      assert(u && u.totpEnabled === true);
      assert.strictEqual(u.totpSecret, undefined);
      assert.strictEqual(u.totpRecoveryCodes, undefined);
      ok('T13: 2FA status visible on users, secret credentials sanitized');
    } catch(e) { fail('T13: 2FA status visibility & secret sanitation', e); }

    // T14: OpenAPI 3.0.3 documentation endpoint returns valid spec
    try {
      const r = await request(app).get('/api/v1/docs');
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.openapi, '3.0.3');
      assert(r.body.paths && Object.keys(r.body.paths).length > 0);
      ok('T14: OpenAPI 3.0.3 docs endpoint active with valid paths');
    } catch(e) { fail('T14: OpenAPI docs endpoint', e); }

  } finally {
    await teardownTestDatabase();
  }

  console.log('\n--- RESULTS: ' + passed + '/' + (passed + failed) + ' passed, ' + failed + ' failed ---');
  if (failed > 0) process.exit(1);
  else {
    console.log('ALL TESTS PASSED\n');
    process.exit(0);
  }
}

run().catch(err => { console.error('FATAL:', err.message || err); process.exit(1); });
