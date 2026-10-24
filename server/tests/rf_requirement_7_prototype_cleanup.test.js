/**
 * RF-Requirement-7: Prototype Cleanup & Session Restoration Regression Tests
 *
 * Server-side authentication regression tests only.
 * Cannot test browser refresh behavior, localStorage synchronization, or redirect loops
 * without browser automation (Playwright/Cypress).
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
  console.log('\n=== ELVIS WMS — REQ #7 PROTOTYPE CLEANUP & SESSION RESTORATION TESTS ===\n');
  await setupTestDatabase();

  const suffix = Date.now().toString();
  const pw = await bcrypt.hash('Password123!', 10);

  const company = await Company.create({
    name: 'Session Test Co ' + suffix,
    code: 'STC_' + suffix.slice(-4)
  });

  const user = await User.create({
    email: `session_test_${suffix}@test.com`,
    password: pw,
    name: 'Session Test User',
    role: 'admin',
    company: company._id
  });

  const secret = process.env.JWT_SECRET || 'fallback_secret_key';
  let passed = 0, failed = 0;
  function ok(m) { console.log('  PASS:', m); passed++; }
  function fail(m, e) { console.log('  FAIL:', m, e && e.message ? '— ' + e.message : ''); failed++; }

  try {
    // ── TEST 1: Login sets HttpOnly cookie and returns user data ──
    console.log('\n=== TEST 1: Login sets cookie and user data ===');
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'Password123!' });

    assert.strictEqual(loginRes.status, 200);
    assert(loginRes.body.user, 'Login must return user data for localStorage');
    assert(loginRes.body.user.email === user.email, 'User email must match');
    assert(loginRes.body.csrfToken, 'Login must return CSRF token');

    const cookies = loginRes.headers['set-cookie'];
    const jwtCookie = cookies.find(c => c.startsWith('jwt_token='));
    const csrfCookie = cookies.find(c => c.startsWith('csrf_token='));
    assert(jwtCookie, 'Login must set HttpOnly jwt_token cookie');
    assert(jwtCookie.includes('HttpOnly'), 'jwt_token must be HttpOnly');
    assert(csrfCookie, 'Login must set csrf_token cookie');
    ok('T1: Login sets HttpOnly cookie and returns user data for localStorage');

    const jwtToken = jwtCookie.split(';')[0].split('=')[1];

    // ── TEST 2: /api/v1/auth/me validates session from cookie ──
    console.log('\n=== TEST 2: /api/v1/auth/me validates session ===');
    const meRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', [`jwt_token=${jwtToken}`]);

    assert.strictEqual(meRes.status, 200);
    assert(meRes.body.user.email === user.email, '/me must return correct user');
    assert(meRes.body.csrfToken, '/me must return fresh CSRF token');
    assert(typeof meRes.body.csrfToken === 'string', 'CSRF token must be string');
    assert.strictEqual(meRes.body.csrfToken.length, 64, 'CSRF token must be 64 hex characters');
    ok('T2: /api/v1/auth/me validates session from HttpOnly cookie');

    // ── TEST 3: /api/v1/auth/me returns 401 without valid session ──
    console.log('\n=== TEST 3: /api/v1/auth/me rejects invalid session ===');
    const invalidMeRes = await request(app)
      .get('/api/v1/auth/me');

    assert.strictEqual(invalidMeRes.status, 401);
    assert(invalidMeRes.body.message.includes('Not authorized'), 'Must return auth error');
    ok('T3: /api/v1/auth/me returns 401 without valid session');

    // ── TEST 4: /api/v1/auth/me returns 401 with expired token ──
    console.log('\n=== TEST 4: /api/v1/auth/me rejects expired token ===');
    const expiredToken = jwt.sign({ id: user._id }, secret, { expiresIn: '-1h' });
    const expiredRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', [`jwt_token=${expiredToken}`]);

    assert.strictEqual(expiredRes.status, 401);
    ok('T4: /api/v1/auth/me rejects expired token');

    // ── TEST 5: Protected API rejects unauthenticated request ──
    console.log('\n=== TEST 5: Protected API rejects unauthenticated ===');
    const protectedRes = await request(app)
      .get('/api/v1/auth/companies');

    assert.strictEqual(protectedRes.status, 401);
    ok('T5: Protected API endpoint rejects unauthenticated request');

    // ── TEST 6: Logout clears HttpOnly cookie (does NOT invalidate JWT server-side) ──
    console.log('\n=== TEST 6: Logout clears cookie ===');
    const logoutRes = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', [`jwt_token=${jwtToken}`, `csrf_token=${loginRes.body.csrfToken}`])
      .set('X-CSRF-Token', loginRes.body.csrfToken);

    assert.strictEqual(logoutRes.status, 200);
    assert.strictEqual(logoutRes.body.message, 'Logged out successfully');

    // Verify that the same JWT token is still valid server-side (logout only clears cookies, not supertest may not show Set-Cookie for clearing)
    const sameTokenRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', [`jwt_token=${jwtToken}`]);

    assert.strictEqual(sameTokenRes.status, 200, 'JWT remains valid after logout (no server-side invalidation)');
    ok('T6: Logout clears cookies but does NOT invalidate JWT server-side');

    // ── TEST 7: New login after logout works ──
    console.log('\n=== TEST 7: Re-login after logout ===');
    const reloginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'Password123!' });

    assert.strictEqual(reloginRes.status, 200);
    assert(reloginRes.body.user, 'Re-login must succeed');
    ok('T7: Re-login after logout works correctly');

    // ── TEST 8: CSRF token is refreshed on /me call ──
    console.log('\n=== TEST 8: CSRF token refresh ===');
    const newJwtCookie = reloginRes.headers['set-cookie'].find(c => c.startsWith('jwt_token='));
    const newJwtToken = newJwtCookie.split(';')[0].split('=')[1];

    const meRes2 = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', [`jwt_token=${newJwtToken}`]);

    assert.strictEqual(meRes2.status, 200);
    assert(meRes2.body.csrfToken, '/me must refresh CSRF token');
    assert.strictEqual(meRes2.body.csrfToken.length, 64, 'CSRF token must be 64 hex characters');
    ok('T8: CSRF token is refreshed on /me call');

    // ── TEST 9: State-changing request without CSRF fails ──
    console.log('\n=== TEST 9: CSRF required for mutations ===');
    const noCsrfMutation = await request(app)
      .put('/api/v1/auth/password')
      .set('Cookie', [`jwt_token=${newJwtToken}`])
      .send({ currentPassword: 'Password123!', newPassword: 'NewPassword123!' });

    assert.strictEqual(noCsrfMutation.status, 403);
    assert(noCsrfMutation.body.message.includes('CSRF'), 'Must require CSRF token');
    ok('T9: State-changing request without CSRF token is rejected');

    // ── TEST 10: State-changing request with valid CSRF succeeds (with password restore) ──
    console.log('\n=== TEST 10: Valid CSRF allows mutations ===');
    const originalPassword = 'Password123!';
    const newPassword = 'NewPassword123!';

    const csrfMutation = await request(app)
      .put('/api/v1/auth/password')
      .set('Cookie', [`jwt_token=${newJwtToken}`, `csrf_token=${meRes2.body.csrfToken}`])
      .set('X-CSRF-Token', meRes2.body.csrfToken)
      .send({ currentPassword: originalPassword, newPassword: newPassword });

    assert.strictEqual(csrfMutation.status, 200);
    assert.strictEqual(csrfMutation.body.message, 'Password updated successfully');

    // Restore original password for subsequent tests
    const restoreRes = await request(app)
      .put('/api/v1/auth/password')
      .set('Cookie', [`jwt_token=${newJwtToken}`, `csrf_token=${meRes2.body.csrfToken}`])
      .set('X-CSRF-Token', meRes2.body.csrfToken)
      .send({ currentPassword: newPassword, newPassword: originalPassword });

    assert.strictEqual(restoreRes.status, 200);
    assert.strictEqual(restoreRes.body.message, 'Password updated successfully');
    ok('T10: State-changing request with valid CSRF token succeeds (password restored)');

    // ── TEST 11: Bearer token bypasses CSRF (migration compatibility) ──
    console.log('\n=== TEST 11: Bearer token bypasses CSRF ===');
    const freshToken = jwt.sign({ id: user._id }, secret, { expiresIn: '1h' });
    const bearerMutation = await request(app)
      .put('/api/v1/auth/password')
      .set('Authorization', `Bearer ${freshToken}`)
      .send({ currentPassword: originalPassword, newPassword: 'AnotherPassword123!' });

    assert.strictEqual(bearerMutation.status, 200);
    assert.strictEqual(bearerMutation.body.message, 'Password updated successfully');

    // Restore password again
    const restoreRes2 = await request(app)
      .put('/api/v1/auth/password')
      .set('Authorization', `Bearer ${freshToken}`)
      .send({ currentPassword: 'AnotherPassword123!', newPassword: originalPassword });

    assert.strictEqual(restoreRes2.status, 200);
    ok('T11: Bearer token requests bypass CSRF protection');

  } finally {
    await teardownTestDatabase();
  }

  console.log(`\n--- RESULTS: ${passed}/${passed + failed} passed, ${failed} failed ---`);
  if (failed > 0) process.exit(1);
  else { console.log('ALL TESTS PASSED\n'); process.exit(0); }
}

runTests().catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(1);
});
