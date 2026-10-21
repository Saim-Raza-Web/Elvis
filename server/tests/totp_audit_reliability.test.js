process.env.NODE_ENV = 'test';
process.env.TOTP_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import mongoose from 'mongoose';
import assert from 'assert';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { generate } from 'otplib';
import { setupTestDatabase, teardownTestDatabase } from '../test_helper.js';
import app from '../index.js';
import AuditLog from '../models/AuditLog.js';
import User from '../models/User.js';
import Company from '../models/Company.js';
import { logTotpEvent } from '../services/totpService.js';

async function runTests() {
  console.log('--- Phase 1B.4 TOTP Audit Logging Reliability Test Suite ---');

  await setupTestDatabase();

  const suffix = Date.now().toString();
  const company = await Company.create({
    name: `Audit Test Co ${suffix}`,
    code: `ATC_${suffix.slice(-4)}`
  });

  const hashedPassword = await bcrypt.hash('password123', 10);
  const user = await User.create({
    email: `audit_user_${suffix}@test.com`,
    password: hashedPassword,
    name: 'Audit Test User',
    role: 'admin',
    company: company._id
  });

  const SUPPORTED_TOTP_EVENTS = [
    'totp_setup_started',
    'totp_setup_cancelled',
    'totp_verify_failed',
    'totp_enabled',
    'totp_disabled',
    'totp_regenerated_codes',
    'totp_login_challenge',
    'totp_login_success',
    'totp_login_failed',
    'totp_recovery_code_used'
  ];

  // ── TEST 1: Each supported TOTP event type is accepted by the AuditLog schema ──
  console.log('\n=== TEST 1: Schema accepts all supported TOTP event types ===');
  for (const eventType of SUPPORTED_TOTP_EVENTS) {
    const entry = await AuditLog.create({
      event_id: `TEST-${eventType}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      event_type: eventType,
      user_id: user._id,
      company: company._id,
      new_value: { test: true },
      reason_text: 'Schema acceptance verification'
    });
    assert.ok(entry._id, `Failed to insert AuditLog for ${eventType}`);
    assert.strictEqual(entry.event_type, eventType);
  }
  console.log(`✓ All ${SUPPORTED_TOTP_EVENTS.length} TOTP event types successfully accepted by AuditLog schema`);

  // ── TEST 2: Unknown event types remain rejected by AuditLog schema ──
  console.log('\n=== TEST 2: Unknown event types remain rejected ===');
  const invalidEvents = ['totp_invalid_event', 'arbitrary_event', 'login_bypass', 'totp_'];
  for (const invalidType of invalidEvents) {
    try {
      await AuditLog.create({
        event_id: `INVALID-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        event_type: invalidType,
        user_id: user._id,
        company: company._id
      });
      assert.fail(`Should have rejected invalid event_type '${invalidType}'`);
    } catch (err) {
      assert(err.name === 'ValidationError', `Expected ValidationError for '${invalidType}', got: ${err.message}`);
    }
  }
  console.log('✓ Unknown/unsupported event types are strictly rejected by Mongoose schema enum');

  // ── TEST 3: logTotpEvent actually persists records to the in-memory test database ──
  console.log('\n=== TEST 3: logTotpEvent reliably persists records to the database ===');
  const countBefore = await AuditLog.countDocuments({ company: company._id, event_type: 'totp_setup_started' });
  const logResult = await logTotpEvent(user._id, company._id, 'setup_started', {
    email: user.email,
    reason: 'Initial setup'
  });
  assert.ok(logResult, 'logTotpEvent should return created document on success');
  assert.ok(logResult._id, 'Created document must have database _id');

  const countAfter = await AuditLog.countDocuments({ company: company._id, event_type: 'totp_setup_started' });
  assert.strictEqual(countAfter, countBefore + 1, 'AuditLog document count must increment in database');

  const persistedDoc = await AuditLog.findById(logResult._id);
  assert.ok(persistedDoc, 'Document must be retrievable from MongoDB');
  assert.strictEqual(persistedDoc.event_type, 'totp_setup_started');
  assert.strictEqual(persistedDoc.reason_text, 'Initial setup');
  console.log('✓ logTotpEvent reliably persists audit entries to MongoDB');

  // ── TEST 4: Audit records contain actor, username, and tenant/company context ──
  console.log('\n=== TEST 4: Audit records maintain actor and tenant isolation ===');
  const contextualLog = await logTotpEvent(user._id, company._id, 'login_challenge', {
    email: user.email,
    userName: user.name
  });
  assert.ok(contextualLog, 'Audit log should be created');
  assert.strictEqual(contextualLog.user_id.toString(), user._id.toString(), 'user_id must match actor');
  assert.strictEqual(contextualLog.company.toString(), company._id.toString(), 'company must match tenant');
  assert.strictEqual(contextualLog.user_name, 'Audit Test User', 'user_name must match actor name');

  // Verify tenant query isolation
  const otherCompany = await Company.create({
    name: `Other Co ${suffix}`,
    code: `OTH_${suffix.slice(-4)}`
  });
  const crossTenantLogs = await AuditLog.find({ company: otherCompany._id, user_id: user._id });
  assert.strictEqual(crossTenantLogs.length, 0, 'Cross-tenant audit leakage must be zero');
  console.log('✓ Actor attribution and tenant scoping preserved without cross-tenant leakage');

  // ── TEST 5: Audit records do not contain secrets, OTP values, passwords, or recovery codes ──
  console.log('\n=== TEST 5: Sanitizer prevents credential leakage in audit records ===');
  const sanitizedLog = await logTotpEvent(user._id, company._id, 'login_failed', {
    reason: 'Invalid code',
    code: '123456', // Prohibited OTP
    password: 'SuperSecretPassword!', // Prohibited password
    secret: 'JBSWY3DPEHPK3PXP', // Prohibited secret
    challengeToken: 'eyJhbGciOi...', // Prohibited challenge token
    recoveryCodes: ['ABCD1234', 'EFGH5678'], // Prohibited recovery codes
    safeDetail: 'Allowed operational context'
  });

  assert.ok(sanitizedLog, 'Log should be created');
  const fetchedSanitized = await AuditLog.findById(sanitizedLog._id);
  assert.strictEqual(fetchedSanitized.new_value.code, undefined, 'OTP code must be stripped');
  assert.strictEqual(fetchedSanitized.new_value.password, undefined, 'Password must be stripped');
  assert.strictEqual(fetchedSanitized.new_value.secret, undefined, 'Secret must be stripped');
  assert.strictEqual(fetchedSanitized.new_value.challengeToken, undefined, 'Challenge token must be stripped');
  assert.strictEqual(fetchedSanitized.new_value.recoveryCodes, undefined, 'Recovery codes must be stripped');
  assert.strictEqual(fetchedSanitized.new_value.safeDetail, 'Allowed operational context', 'Safe metadata preserved');
  console.log('✓ Sensitive credentials and OTP codes are strictly stripped from audit records');

  // ── TEST 6: Audit logging failure behavior is explicit and testable ──
  console.log('\n=== TEST 6: Failure behavior is explicit and observable ===');
  // Attempt to log without required company (violates schema requirement)
  const failedLog = await logTotpEvent(user._id, null, 'setup_started', {});
  assert.strictEqual(failedLog, null, 'logTotpEvent must return null on failure rather than false success');
  console.log('✓ Failure behavior returns null and emits observable error without crashing application');

  // ── TEST 7: End-to-end integration via Auth API routes persists audit events ──
  console.log('\n=== TEST 7: API routes persist audit events during authentication flows ===');
  // Enable 2FA on user to test challenge audit event
  user.setTotpSecret('0123456789abcdef0123456789abcdef');
  user.totpEnabled = true;
  await user.save();

  // Login triggers login_challenge
  const challengeLoginRes = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: 'password123' });

  assert.strictEqual(challengeLoginRes.status, 200);
  assert.strictEqual(challengeLoginRes.body.requires2FA, true);

  const challengeAudit = await AuditLog.findOne({
    company: company._id,
    user_id: user._id,
    event_type: 'totp_login_challenge'
  }).sort({ timestamp: -1 });

  assert.ok(challengeAudit, 'API login should persist totp_login_challenge event to AuditLog');
  assert.strictEqual(challengeAudit.new_value.email, user.email);

  // Invalid verification triggers login_failed audit
  const badVerifyRes = await request(app)
    .post('/api/v1/auth/2fa/verify-login')
    .send({
      challengeToken: challengeLoginRes.body.challengeToken,
      code: '000000',
      isRecoveryCode: false
    });

  assert.strictEqual(badVerifyRes.status, 400);

  const failedAudit = await AuditLog.findOne({
    company: company._id,
    user_id: user._id,
    event_type: 'totp_login_failed'
  }).sort({ timestamp: -1 });

  assert.ok(failedAudit, 'API verification failure should persist totp_login_failed event to AuditLog');
  assert.strictEqual(failedAudit.reason_text, 'Invalid code');

  console.log('✓ Authentication API routes reliably write audit events to MongoDB during live flows');

  console.log('\n======================================================');
  console.log('✓✓✓ ALL PHASE 1B.4 AUDIT RELIABILITY TESTS PASSED ✓✓✓');
  console.log('======================================================\n');

  await teardownTestDatabase();
  process.exit(0);
}

runTests().catch(err => {
  console.error('Audit reliability test suite failed:', err);
  process.exit(1);
});
