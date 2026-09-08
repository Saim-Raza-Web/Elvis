import crypto from 'crypto';
import IdempotencyRecord from '../models/IdempotencyRecord.js';

/**
 * Phase 8C.1 Atomic MongoDB Idempotency claim mechanism.
 * 
 * Safely acquires an idempotency lock OUTSIDE the MongoDB transaction.
 * Features:
 * - Deterministic payload hashing.
 * - Recovery of stale PENDING states via atomic findOneAndUpdate.
 * - Replay of COMPLETED responses without re-executing logic.
 * - HTTP 409 Conflict if payload changes for the same key.
 */
export class IdempotencyService {
  /**
   * Deterministically hash the payload.
   */
  static hashPayload(payload) {
    if (!payload) return '';
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  /**
   * Attempt to acquire a lock for the given business operation.
   * Returns: { status: 'EXECUTE', record: <doc> } or { status: 'CACHED', response: <payload> } 
   * Throws 409 for conflicts.
   * 
   * @param {ObjectId} companyId 
   * @param {String} operation 
   * @param {String} key 
   * @param {Object} payload 
   * @param {Number} leaseDurationMs 
   */
  static async acquireLock(companyId, operation, idempotencyKey, payload, leaseDurationMs = 30000) {
    const payloadHash = this.hashPayload(payload);
    const now = new Date();
    const lockedUntil = new Date(now.getTime() + leaseDurationMs);

    // 1. Attempt to insert a new PENDING record
    try {
      const newRecord = await IdempotencyRecord.create({
        company: companyId,
        operation,
        idempotencyKey,
        payloadHash,
        status: 'PENDING',
        lockedAt: now,
        lockedUntil: lockedUntil,
        attempts: 1
      });
      return { status: 'EXECUTE', record: newRecord };
    } catch (err) {
      if (err.code !== 11000) {
        throw err; // Propagate real DB errors
      }
      // Duplicate Key exists.
    }

    // 2. We are here because a record exists. Try to atomically claim it if stale or FAILED.
    const staleClaim = await IdempotencyRecord.findOneAndUpdate(
      {
        company: companyId,
        operation,
        idempotencyKey,
        $or: [
          { status: 'FAILED' },
          { status: 'PENDING', lockedUntil: { $lte: now } }
        ]
      },
      {
        $set: {
          status: 'PENDING',
          lockedAt: now,
          lockedUntil: lockedUntil,
          payloadHash // update hash in case they retried with a new payload after a failure
        },
        $inc: { attempts: 1 }
      },
      { new: true }
    );

    if (staleClaim) {
      return { status: 'EXECUTE', record: staleClaim };
    }

    // 3. If we couldn't claim it, it means it's either actively PENDING (locked) or COMPLETED.
    const existing = await IdempotencyRecord.findOne({ company: companyId, operation, idempotencyKey });
    
    if (!existing) {
      const conflictErr = new Error('Concurrency conflict: record disappeared. Please retry.');
      conflictErr.status = 409;
      throw conflictErr;
    }

    if (existing.status === 'COMPLETED') {
      if (existing.payloadHash !== payloadHash) {
        const conflictErr = new Error('Idempotency Conflict: A completed request with this key exists, but the payload is different.');
        conflictErr.status = 409;
        throw conflictErr;
      }
      return { status: 'CACHED', response: existing.response };
    }

    if (existing.status === 'PENDING') {
      const conflictErr = new Error('Idempotency Conflict: A request with this key is currently being processed.');
      conflictErr.status = 409;
      throw conflictErr;
    }

    throw new Error(`Unexpected Idempotency state: ${existing.status}`);
  }

  /**
   * Commit a successful idempotency operation.
   * @param {ObjectId} recordId 
   * @param {Object} response 
   */
  static async completeLock(recordId, response) {
    await IdempotencyRecord.updateOne(
      { _id: recordId },
      { 
        $set: { 
          status: 'COMPLETED',
          response,
          lockedUntil: null
        } 
      }
    );
  }

  /**
   * Mark an idempotency operation as failed.
   * @param {ObjectId} recordId 
   * @param {Error} error 
   */
  static async failLock(recordId, error) {
    await IdempotencyRecord.updateOne(
      { _id: recordId },
      { 
        $set: { 
          status: 'FAILED',
          response: { error: error.message || 'Unknown error' },
          lockedUntil: null
        } 
      }
    );
  }
}
