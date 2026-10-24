/**
 * RF-Session-Bootstrap: Session Bootstrap Regression Tests (Req #6)
 *
 * Covers the five scenarios listed in Requirement #6 from the server side.
 * Browser-only behaviour (localStorage state, window.location redirects, and
 * the React "validating" screen) requires Playwright/Cypress for full E2E
 * verification and is documented as unverified below.
 *
 *  Scenario 1: Valid session reload
 *  Scenario 2: Expired/invalid cookie with stale localStorage user
 *  Scenario 3: Missing localStorage with a valid cookie
 *  Scenario 4: Cleared cookie with stale localStorage
 *  Scenario 5: Concurrent 401 responses
 */

import assert from 'assert';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import app from '../index.js';
import User from '../models/User.js';
import Company from '../models/Company.js';
import { setupTestDatabase, teardownTestDatabase } from '../test_helper.js';

async function runTests() {
  console.log('\n=== ELVIS WMS - SESSION BOOTSTRAP REGRESSION TESTS (REQ #6) ===\n');
  await setupTestDatabase();

  const suffix = Date.now().toString();
  const pw = await bcrypt.hash('BootTest123!', 10);

  const company = await Company.create({
    name: 'Bootstrap Test Co ' + suffix,
    code: 'BTC_' + suffix.slice(-4),
  });

  const user = await User.create({
    email: 'bootstrap_' + suffix + '@test.com',
    password: pw,
    name: 'Bootstrap User',
    role: 'admin',
    company: company._id,
  });

  const secret = process.env.JWT_SECRET || 'fallback_secret_key';
  let passed = 0, failed = 0;

  function ok(msg) { console.log('  PASS:', msg); passed++; }
  function fail(msg, err) { console.log('  FAIL:', msg, err && err.message ? '- ' + err.message : ''); failed++; }

  try {
    // SCENARIO 1: Valid session reload
    console.log('\n=== SCENARIO 1: Valid session reload ===');
    try {
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: 'BootTest123!' });

      assert.strictEqual(loginRes.status, 200, 'Login must succeed');
      const jwtCookieRaw = loginRes.headers['set-cookie'].find(function(c) { return c.startsWith('jwt_token='); });
      const validToken = jwtCookieRaw.split(';')[0].split('=')[1];

      const meRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Cookie', ['jwt_token=' + validToken]);

      assert.strictEqual(meRes.status, 200, '/me must return 200 for a valid session');
      assert(meRes.body.user, '/me must include user data');
      assert.strictEqual(meRes.body.user.email, user.email, '/me user must match');
      assert(meRes.body.csrfToken, '/me must refresh CSRF token');
      ok('S1: Valid session reload - /auth/me returns 200 + user + CSRF token');

      // Store validToken for subsequent tests
      runTests._validToken = validToken;
    } catch(e) { fail('S1', e); }

    // SCENARIO 2: Expired cookie with stale localStorage user
    console.log('\n=== SCENARIO 2: Expired cookie, stale localStorage ===');
    try {
      const expiredToken = jwt.sign({ id: user._id }, secret, { expiresIn: '-1h' });
      runTests._expiredToken = expiredToken;

      const expiredMeRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Cookie', ['jwt_token=' + expiredToken]);

      assert.strictEqual(expiredMeRes.status, 401, '/me must return 401 for an expired token');
      ok('S2: Expired cookie - /auth/me returns 401; front-end must clear localStorage (browser-only)');
    } catch(e) { fail('S2', e); }

    // SCENARIO 3: Missing localStorage, valid cookie
    console.log('\n=== SCENARIO 3: No localStorage user, valid cookie ===');
    try {
      const validToken = runTests._validToken;
      const meNoCacheRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Cookie', ['jwt_token=' + validToken]);

      assert.strictEqual(meNoCacheRes.status, 200, '/me must accept valid cookie regardless of localStorage');
      assert(meNoCacheRes.body.user, '/me must return user data');
      ok('S3: Missing localStorage, valid cookie - /auth/me returns 200 + user data');
    } catch(e) { fail('S3', e); }

    // SCENARIO 4: Cleared cookie, stale localStorage
    console.log('\n=== SCENARIO 4: Cleared cookie, stale localStorage ===');
    try {
      const noCookieRes = await request(app).get('/api/v1/auth/me');
      assert.strictEqual(noCookieRes.status, 401, '/me must return 401 when no cookie is present');
      ok('S4: Cleared cookie - /auth/me returns 401; localStorage cleared by front-end (browser-only)');
    } catch(e) { fail('S4', e); }

    // SCENARIO 5: Concurrent 401 responses
    console.log('\n=== SCENARIO 5: Concurrent 401 responses ===');
    try {
      const expiredToken = runTests._expiredToken;
      const concurrentCalls = await Promise.all([
        request(app).get('/api/v1/orders').set('Cookie', ['jwt_token=' + expiredToken]),
        request(app).get('/api/v1/warehouses').set('Cookie', ['jwt_token=' + expiredToken]),
        request(app).get('/api/v1/inventory').set('Cookie', ['jwt_token=' + expiredToken]),
        request(app).get('/api/v1/shipping').set('Cookie', ['jwt_token=' + expiredToken]),
      ]);

      const allUnauthorised = concurrentCalls.every(function(r) { return r.status === 401; });
      assert(allUnauthorised, 'All concurrent requests must return 401 for an expired token');
      ok('S5: Concurrent 401s - all return 401; redirect guard (browser-only) prevents multiple window.location calls');
    } catch(e) { fail('S5', e); }

    // BONUS: Legacy Bearer token
    console.log('\n=== BONUS: Legacy Bearer token ===');
    try {
      const legacyToken = jwt.sign({ id: user._id }, secret, { expiresIn: '1h' });
      const bearerRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer ' + legacyToken);

      assert.strictEqual(bearerRes.status, 200, 'Legacy Bearer token must still work');
      ok('BONUS: Legacy Bearer token accepted by /auth/me');
    } catch(e) { fail('BONUS', e); }

  } finally {
    await teardownTestDatabase();
  }

  console.log('\n--- RESULTS: ' + passed + '/' + (passed + failed) + ' passed, ' + failed + ' failed ---');
  if (failed > 0) process.exit(1);
  else { console.log('ALL SESSION BOOTSTRAP TESTS PASSED\n'); process.exit(0); }
}

runTests().catch(function(err) {
  console.error('FATAL:', err.message || err);
  process.exit(1);
});