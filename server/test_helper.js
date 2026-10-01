import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mongod = null;

/**
 * Validates that a connection target or active connection does NOT target the shared/production database.
 * Throws a fatal error if an unsafe database target is detected.
 */
export function assertSafeTestDatabase(targetUriOrName, host = '') {
  // Hard safety guard: refuse to run if NODE_ENV is not explicitly 'test'
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(`[FATAL TEST GUARD] setupTestDatabase can only be run in NODE_ENV='test'. Current NODE_ENV: '${process.env.NODE_ENV || 'undefined'}'`);
  }

  const str = (targetUriOrName || '').toLowerCase();
  const h = (host || '').toLowerCase();

  // 1. Direct database name checks — HARD REJECTION of 'demologistics'
  if (
    str === 'demologistics' ||
    str.includes('demologistics?') ||
    (str.includes('/demologistics') && !str.includes('demologistics_test'))
  ) {
    throw new Error(`[FATAL TEST GUARD] Access to shared/production database "demologistics" is strictly prohibited in tests.`);
  }

  if (str.includes('production') || str.includes('live_db') || str.includes('prod_db')) {
    throw new Error(`[FATAL TEST GUARD] Production database target detected. Terminating immediately.`);
  }

  // 2. Atlas host checks: require explicit test database suffix
  if ((str.includes('mongodb.net') || h.includes('mongodb.net')) && !str.includes('_test')) {
    throw new Error(`[FATAL TEST GUARD] Attempted connection to remote MongoDB Atlas cluster without an explicit test database suffix (_test).`);
  }
}

/**
 * Hard fail-closed assertion immediately preceding mongoose.connect().
 * Enforces:
 * - Reject mongodb+srv://
 * - Reject mongodb.net
 * - Reject production database name "demologistics"
 * - Require the test database to originate from MongoMemoryReplSet
 * - Fail closed if these conditions are not satisfied.
 */
export function assertFailClosedPreConnectGuard(targetUri, replSetInstance) {
  if (!replSetInstance || typeof replSetInstance.getUri !== 'function') {
    throw new Error('[DATABASE_SAFETY_BLOCKED / TEST_DATABASE_UNAVAILABLE] Hard assertion failed: test database MUST originate from an active MongoMemoryReplSet instance.');
  }

  if (!targetUri || typeof targetUri !== 'string') {
    throw new Error('[DATABASE_SAFETY_BLOCKED / TEST_DATABASE_UNAVAILABLE] Hard assertion failed: invalid or missing MongoDB URI.');
  }

  const lower = targetUri.toLowerCase();

  // Reject mongodb+srv://
  if (lower.startsWith('mongodb+srv://') || lower.includes('+srv')) {
    throw new Error('[DATABASE_SAFETY_BLOCKED] Hard assertion failed: connection string contains mongodb+srv://. Remote clusters are strictly prohibited.');
  }

  // Reject mongodb.net
  if (lower.includes('mongodb.net')) {
    throw new Error('[DATABASE_SAFETY_BLOCKED] Hard assertion failed: connection string targets mongodb.net. Atlas connections are strictly prohibited.');
  }

  // Reject production database name "demologistics"
  if (
    lower === 'demologistics' ||
    lower.endsWith('/demologistics') ||
    lower.includes('/demologistics?') ||
    (lower.includes('demologistics') && !lower.includes('demologistics_test'))
  ) {
    throw new Error('[DATABASE_SAFETY_BLOCKED] Hard assertion failed: production database name "demologistics" is strictly prohibited.');
  }

  // Require localhost / 127.0.0.1
  if (!lower.includes('127.0.0.1') && !lower.includes('localhost')) {
    throw new Error('[DATABASE_SAFETY_BLOCKED] Hard assertion failed: test database host must be local in-memory (127.0.0.1).');
  }
}

/**
 * Initializes an isolated in-memory test database using MongoMemoryReplSet.
 * Deterministic and fail-closed:
 * - Uses MongoMemoryReplSet as the PRIMARY and ONLY test database.
 * - Does NOT fall back to local MongoDB (127.0.0.1:27017).
 * - Does NOT connect to MongoDB Atlas.
 * - Fails immediately and loudly if MongoMemoryReplSet cannot start.
 */
export async function setupTestDatabase() {
  process.env.NODE_ENV = 'test';

  // Prevent silent inheritance of production MONGO_URI
  delete process.env.MONGO_URI;
  delete process.env.MONGODB_URI;
  delete process.env.TEST_MONGO_URI;

  // Set up temp directory on workspace drive to avoid C: drive disk exhaustion
  const tmpD = path.join(__dirname, '../.tmp');
  if (!fs.existsSync(tmpD)) {
    fs.mkdirSync(tmpD, { recursive: true });
  } else {
    // Prevent disk exhaustion by pruning leftover mongo-mem temp dirs
    try {
      const entries = fs.readdirSync(tmpD);
      for (const entry of entries) {
        if (entry.startsWith('mongo-mem-')) {
          try {
            fs.rmSync(path.join(tmpD, entry), { recursive: true, force: true });
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  // Configure runtime and environment to use workspace temp dir
  os.tmpdir = () => tmpD;
  process.env.TMP = tmpD;
  process.env.TEMP = tmpD;
  process.env.TMPDIR = tmpD;

  const localBin = path.join(__dirname, '../mongodb-win32-x86_64-windows-8.2.6/bin/mongod.exe');
  if (fs.existsSync(localBin)) {
    process.env.MONGOMS_SYSTEM_BINARY = localBin;
  }

  let uri = null;

  try {
    if (!mongod) {
      const { MongoMemoryReplSet } = await import('mongodb-memory-server');
      mongod = await MongoMemoryReplSet.create({
        replSet: {
          count: 1,
          dbName: 'demologistics_test',
          args: ['--quiet']
        }
      });
    }
    uri = mongod.getUri('demologistics_test');
  } catch (err) {
    console.error('\n================================================================================');
    console.error('FATAL ERROR: [DATABASE_SAFETY_BLOCKED / TEST_DATABASE_UNAVAILABLE]');
    console.error('Failed to initialize in-memory MongoMemoryReplSet test database.');
    console.error('Error detail:', err.message);
    console.error('FAIL-CLOSED POLICY:');
    console.error('  - Local MongoDB fallback (127.0.0.1:27017) is DISABLED and REMOVED.');
    console.error('  - Atlas production/shared fallback is DISABLED and REJECTED.');
    console.error('  - Tests CANNOT continue without certified in-memory test database isolation.');
    console.error('================================================================================\n');
    throw new Error(`[DATABASE_SAFETY_BLOCKED / TEST_DATABASE_UNAVAILABLE] MongoMemoryReplSet startup failed: ${err.message}`);
  }

  // Mandatory Pre-Connection Guards
  assertSafeTestDatabase(uri);
  assertFailClosedPreConnectGuard(uri, mongod);

  // If mongoose is already connected, disconnect first to ensure clean test state
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000
  });

  const connectedName = mongoose.connection.name || mongoose.connection.db?.databaseName;
  const connectedHost = mongoose.connection.host || '';

  // Mandatory Post-Connection Guard
  assertSafeTestDatabase(connectedName, connectedHost);

  // Requirement 7 & 8: Explicit reporting of active test DB and non-secret proof
  console.log('[DB] TEST DATABASE: MongoMemoryReplSet');
  console.log('[DB] TEST DATABASE: IN-MEMORY');
  console.log('[DB] TEST DATABASE: ISOLATED');
  console.log(`[DB] Active Database Name: ${connectedName}`);
  console.log(`[DB] Active Host: ${connectedHost || '127.0.0.1 (in-memory replica set)'}`);
  console.log('[DB] Atlas Connection: IMPOSSIBLE (rejected by pre-connect & post-connect guards)');
  console.log('[DB] Production demologistics: IMPOSSIBLE (fail-closed verified)');
  console.log('[DB] Local external MongoDB fallback: REMOVED / DISABLED');

  // Settle all background schema index creations before running tests
  // This prevents MongoDB "catalog changes" WriteConflict during transactions
  await Promise.all(Object.values(mongoose.models).map(m => m.init().catch(() => {})));

  // Synchronize environment variables for any child processes or modules
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  process.env.TEST_MONGO_URI = uri;

  return {
    uri,
    connectedName,
    connectedHost,
    isMemory: true
  };
}

/**
 * Cleans up and stops the test database connection and MongoMemoryReplSet.
 */
export async function teardownTestDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongod) {
    try {
      await mongod.stop();
    } catch (_) {}
    mongod = null;
  }
}
