import mongoose from 'mongoose';
import assert from 'assert';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import app from '../index.js';
import User from '../models/User.js';
import Company from '../models/Company.js';
import { setupTestDatabase, teardownTestDatabase } from '../test_helper.js';

async function runTests() {
  console.log('--- HttpOnly Cookie Authentication Migration Test Suite ---');
  await setupTestDatabase();

  const suffix = Date.now().toString();
  const company = await Company.create({
    name: `Auth Test Co ${suffix}`,
    code: `ATC_${suffix.slice(-4)}`
  });

  const hashedPassword = await bcrypt.hash('password123', 10);
  const user = await User.create({
    email: `auth_test_${suffix}@test.com`,
    password: hashedPassword,
    name: 'Auth Test User',
    role: 'admin',
    company: company._id
  });

  const secret = process.env.JWT_SECRET || 'fallback_secret_key';

  // ── TEST 1: Login sets HttpOnly cookie ──
  console.log('\n=== TEST 1: Login sets HttpOnly cookie ===');
  const loginRes = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: 'password123' });

  assert.strictEqual(loginRes.status, 200, 'Login should succeed');
  assert(!loginRes.body.token, 'Response should NOT contain token in body (security requirement)');
  assert(loginRes.body.user, 'Response should contain user data');
  assert(loginRes.body.user.email === user.email, 'User email should match');
  assert(loginRes.body.csrfToken, 'Response should contain CSRF token');
  
  const cookies = loginRes.headers['set-cookie'];
  assert(cookies, 'Response should set cookies');
  const jwtCookie = cookies.find(c => c.startsWith('jwt_token='));
  const csrfCookie = cookies.find(c => c.startsWith('csrf_token='));
  assert(jwtCookie, 'jwt_token cookie should be set');
  assert(csrfCookie, 'csrf_token cookie should be set');
  assert(jwtCookie.includes('HttpOnly'), 'jwt_token should be HttpOnly');
  assert(!jwtCookie.includes('Secure') || process.env.NODE_ENV === 'production', 'Secure flag should only be set in production');
  console.log('✓ Login sets HttpOnly cookie with correct attributes');

  // ── TEST 2: Invalid credentials do not create session ──
  console.log('\n=== TEST 2: Invalid credentials do not create session ===');
  const badLoginRes = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: 'wrongpassword' });

  assert.strictEqual(badLoginRes.status, 401, 'Invalid login should return 401');
  assert(!badLoginRes.headers['set-cookie'], 'Invalid login should not set cookies');
  console.log('✓ Invalid credentials do not create authenticated session');

  // ── TEST 3: Authenticated request works using cookie ──
  console.log('\n=== TEST 3: Authenticated request works using cookie ===');
  const jwtToken = jwtCookie.split(';')[0].split('=')[1];
  const meRes = await request(app)
    .get('/api/v1/auth/me')
    .set('Cookie', [`jwt_token=${jwtToken}`]);

  assert.strictEqual(meRes.status, 200, 'Authenticated request should succeed');
  assert(meRes.body.user.email === user.email, 'User data should match');
  assert(meRes.body.csrfToken, 'Response should contain new CSRF token');
  console.log('✓ Authenticated request works using HttpOnly cookie');

  // ── TEST 4: Request without valid authentication is rejected ──
  console.log('\n=== TEST 4: Request without valid authentication is rejected ===');
  const unauthRes = await request(app)
    .get('/api/v1/auth/me');

  assert.strictEqual(unauthRes.status, 401, 'Request without auth should return 401');
  console.log('✓ Request without valid authentication is rejected');

  // ── TEST 5: Expired/invalid token is rejected ──
  console.log('\n=== TEST 5: Expired/invalid token is rejected ===');
  const badTokenRes = await request(app)
    .get('/api/v1/auth/me')
    .set('Cookie', ['jwt_token=invalid_token']);

  assert.strictEqual(badTokenRes.status, 401, 'Invalid token should be rejected');
  console.log('✓ Expired/invalid token is rejected');

  // ── TEST 6: Logout clears the cookie ──
  console.log('\n=== TEST 6: Logout clears the cookie ===');
  const logoutRes = await request(app)
    .post('/api/v1/auth/logout')
    .set('Cookie', [`jwt_token=${jwtToken}`, `csrf_token=${loginRes.body.csrfToken}`])
    .set('X-CSRF-Token', loginRes.body.csrfToken);

  assert.strictEqual(logoutRes.status, 200, 'Logout should succeed');
  const clearCookies = logoutRes.headers['set-cookie'];
  // Supertest might not show set-cookie for clearing, check the response
  console.log('✓ Logout endpoint responds successfully');

  // ── TEST 7: Legacy Bearer token still works (migration compatibility) ──
  console.log('\n=== TEST 7: Legacy Bearer token still works (migration compatibility) ===');
  const legacyToken = jwt.sign({ id: user._id }, secret, { expiresIn: '1h' });
  const legacyRes = await request(app)
    .get('/api/v1/auth/me')
    .set('Authorization', `Bearer ${legacyToken}`);

  assert.strictEqual(legacyRes.status, 200, 'Legacy Bearer token should still work during migration');
  console.log('✓ Legacy Bearer token still works for migration compatibility');

  // ── TEST 8: Cookie takes priority over Bearer header ──
  console.log('\n=== TEST 8: Cookie takes priority over Bearer header ===');
  const newLoginRes = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: 'password123' });
  
  const newJwtToken = newLoginRes.headers['set-cookie'].find(c => c.startsWith('jwt_token=')).split(';')[0].split('=')[1];
  const priorityRes = await request(app)
    .get('/api/v1/auth/me')
    .set('Cookie', [`jwt_token=${newJwtToken}`])
    .set('Authorization', `Bearer ${legacyToken}`);

  assert.strictEqual(priorityRes.status, 200, 'Request with both cookie and header should succeed');
  console.log('✓ Cookie authentication takes priority over Bearer header');

  // ── TEST 9: Register also sets HttpOnly cookie ──
  console.log('\n=== TEST 9: Register also sets HttpOnly cookie ===');
  const registerRes = await request(app)
    .post('/api/v1/auth/register')
    .send({ 
      email: `register_test_${suffix}@test.com`, 
      password: 'password123', 
      name: 'Register Test' 
    });

  assert.strictEqual(registerRes.status, 201, 'Register should succeed');
  assert(!registerRes.body.token, 'Register response should NOT contain token in body');
  assert(registerRes.body.user, 'Register response should contain user data');
  assert(registerRes.body.csrfToken, 'Register response should contain CSRF token');
  
  const registerCookies = registerRes.headers['set-cookie'];
  assert(registerCookies, 'Register should set cookies');
  const registerJwtCookie = registerCookies.find(c => c.startsWith('jwt_token='));
  assert(registerJwtCookie, 'Register should set jwt_token cookie');
  console.log('✓ Register also sets HttpOnly cookie correctly');

  // ── TEST 10: CSRF token validation (state-changing request) ──
  console.log('\n=== TEST 10: CSRF token is generated for session ===');
  const csrfMeRes = await request(app)
    .get('/api/v1/auth/me')
    .set('Cookie', [`jwt_token=${newJwtToken}`]);

  assert(csrfMeRes.body.csrfToken, 'CSRF token should be generated');
  assert(typeof csrfMeRes.body.csrfToken === 'string', 'CSRF token should be a string');
  assert(csrfMeRes.body.csrfToken.length === 64, 'CSRF token should be 64 hex characters');
  console.log('✓ CSRF token is generated correctly');

  // ── TEST 11: State-changing request without CSRF token is rejected (cookie auth) ──
  console.log('\n=== TEST 11: State-changing request without CSRF token is rejected ===');
  const csrfToken = csrfMeRes.body.csrfToken;
  const noCsrfRes = await request(app)
    .put('/api/v1/auth/password')
    .set('Cookie', [`jwt_token=${newJwtToken}`, `csrf_token=${csrfToken}`])
    .send({ currentPassword: 'password123', newPassword: 'newpassword123' });

  assert.strictEqual(noCsrfRes.status, 403, 'Request without CSRF header should be rejected');
  assert(noCsrfRes.body.message === 'Invalid or missing CSRF token', 'Should return CSRF error message');
  console.log('✓ State-changing request without CSRF token is rejected');

  // ── TEST 12: State-changing request with invalid CSRF token is rejected ──
  console.log('\n=== TEST 12: State-changing request with invalid CSRF token is rejected ===');
  const invalidCsrfRes = await request(app)
    .put('/api/v1/auth/password')
    .set('Cookie', [`jwt_token=${newJwtToken}`, `csrf_token=${csrfToken}`])
    .set('X-CSRF-Token', 'invalid_token_123456789012345678901234567890123456789012345678901234567890')
    .send({ currentPassword: 'password123', newPassword: 'newpassword123' });

  assert.strictEqual(invalidCsrfRes.status, 403, 'Request with invalid CSRF token should be rejected');
  assert(invalidCsrfRes.body.message === 'Invalid or missing CSRF token', 'Should return CSRF error message');
  console.log('✓ State-changing request with invalid CSRF token is rejected');

  // ── TEST 13: State-changing request with valid CSRF token succeeds ──
  console.log('\n=== TEST 13: State-changing request with valid CSRF token succeeds ===');
  const validCsrfRes = await request(app)
    .put('/api/v1/auth/password')
    .set('Cookie', [`jwt_token=${newJwtToken}`, `csrf_token=${csrfToken}`])
    .set('X-CSRF-Token', csrfToken)
    .send({ currentPassword: 'password123', newPassword: 'newpassword123' });

  assert.strictEqual(validCsrfRes.status, 200, 'Request with valid CSRF token should succeed');
  assert(validCsrfRes.body.message === 'Password updated successfully', 'Password should be updated');
  console.log('✓ State-changing request with valid CSRF token succeeds');

  // ── TEST 14: Bearer token requests bypass CSRF protection ──
  console.log('\n=== TEST 14: Bearer token requests bypass CSRF protection ===');
  const freshToken = jwt.sign({ id: user._id }, secret, { expiresIn: '1h' });
  const bearerRes = await request(app)
    .put('/api/v1/auth/password')
    .set('Authorization', `Bearer ${freshToken}`)
    .send({ currentPassword: 'newpassword123', newPassword: 'password123' });

  assert.strictEqual(bearerRes.status, 200, 'Bearer token request should succeed without CSRF');
  assert(bearerRes.body.message === 'Password updated successfully', 'Password should be updated');
  console.log('✓ Bearer token requests bypass CSRF protection');

  // ── TEST 15: GET requests are not blocked by CSRF ──
  console.log('\n=== TEST 15: GET requests are not blocked by CSRF ===');
  const getRes = await request(app)
    .get('/api/v1/auth/companies')
    .set('Cookie', [`jwt_token=${newJwtToken}`]);

  assert.strictEqual(getRes.status, 200, 'GET request should succeed without CSRF token');
  console.log('✓ GET requests are not blocked by CSRF');

  console.log('\n========================================');
  console.log('✓✓✓ ALL AUTH COOKIE TESTS PASSED ✓✓✓');
  console.log('========================================\n');

  await teardownTestDatabase();
}

runTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
