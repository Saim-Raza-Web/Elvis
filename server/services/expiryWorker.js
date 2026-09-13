import mongoose from 'mongoose';
import Company from '../models/Company.js';
import WorkerLease from '../models/WorkerLease.js';
import { expiryAlertService } from './expiryAlertService.js';

/**
 * Service: Scheduled Expiry Worker with Atomic Distributed Leasing (Stage 8)
 *
 * SAFETY INVARIANTS:
 * - NO in-memory locks (distributed-safe for Serverless / multi-instance clusters).
 * - Multi-tenant isolation: Each company has an independent lease key (EXPIRY_WORKER_<companyId>).
 * - Company A cannot block Company B.
 * - Stale leases (leaseUntil < now) are automatically recoverable if a worker process crashes.
 * - Processing failure safely releases the lease so subsequent schedules are not permanently locked.
 */
export const expiryWorker = {
  /**
   * Generates a unique lease job key.
   */
  getJobKey(companyId) {
    if (!companyId) return 'EXPIRY_WORKER_GLOBAL';
    const idStr = typeof companyId === 'string' ? companyId : companyId.toString();
    return `EXPIRY_WORKER_${idStr}`;
  },

  /**
   * Atomically claims a distributed worker lease.
   *
   * @param {Object} params
   * @param {ObjectId|string} params.companyId - Tenant context
   * @param {number} [params.leaseDurationMs=60000] - Lease duration (default 60s)
   * @param {string} [params.workerId] - Worker instance identifier
   * @returns {Promise<Object|null>} Acquired lease document or null if locked
   */
  async claimLease({ companyId, leaseDurationMs = 60000, workerId = null }) {
    const jobKey = this.getJobKey(companyId);
    const now = new Date();
    const lockedUntil = new Date(now.getTime() + leaseDurationMs);
    const owner = workerId || `worker_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;

    // 1. Attempt atomic claim on existing released or stale lease
    let lease = await WorkerLease.findOneAndUpdate(
      {
        jobKey,
        $or: [
          { status: 'RELEASED' },
          { leaseUntil: { $lte: now } } // Stale lease reclamation
        ]
      },
      {
        $set: {
          status: 'ACQUIRED',
          leaseOwner: owner,
          leaseUntil: lockedUntil,
          lastHeartbeat: now,
          company: companyId || null
        }
      },
      { returnDocument: 'after' }
    );

    // 2. If no lease document existed, attempt initial insertion
    if (!lease) {
      const existing = await WorkerLease.findOne({ jobKey });
      if (!existing) {
        try {
          lease = await WorkerLease.create({
            jobKey,
            leaseOwner: owner,
            leaseUntil: lockedUntil,
            status: 'ACQUIRED',
            lastHeartbeat: now,
            company: companyId || null
          });
        } catch (err) {
          // Concurrency race: another instance inserted it first
          if (err.code === 11000) {
            return null;
          }
          throw err;
        }
      }
    }

    return lease;
  },

  /**
   * Releases a previously acquired worker lease.
   */
  async releaseLease({ companyId, workerId = null, runStatus = 'COMPLETED', durationMs = 0, error = null }) {
    const jobKey = this.getJobKey(companyId);
    const query = { jobKey };
    if (workerId) {
      query.leaseOwner = workerId;
    }

    await WorkerLease.updateOne(
      query,
      {
        $set: {
          status: 'RELEASED',
          leaseUntil: new Date(0),
          lastRunAt: new Date(),
          lastRunStatus: runStatus,
          lastRunDurationMs: durationMs,
          ...(error ? { metadata: { error } } : {})
        }
      }
    );
  },

  /**
   * Executes the expiry worker for a single company under an atomic lease.
   */
  async runCompanyWorker({
    companyId,
    warehouse = null,
    dryRun = false,
    evaluationNow = new Date(),
    leaseDurationMs = 60000,
    workerId = null
  }) {
    const startTime = Date.now();
    const currentWorkerId = workerId || `worker_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;

    const lease = await this.claimLease({ companyId, leaseDurationMs, workerId: currentWorkerId });
    if (!lease) {
      return {
        success: false,
        skipped: true,
        reason: 'LEASE_LOCKED',
        message: `Worker lease for company ${companyId} is currently held by another active instance.`
      };
    }

    try {
      const scanResult = await expiryAlertService.scanCompanyExpiry({
        companyId,
        warehouse,
        dryRun,
        evaluationNow,
        runId: `EXP-WORKER-${Date.now()}`
      });

      const durationMs = Date.now() - startTime;
      await this.releaseLease({
        companyId,
        workerId: currentWorkerId,
        runStatus: 'SUCCESS',
        durationMs
      });

      return {
        success: true,
        companyId,
        scanResult,
        durationMs
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      // Guarantee lease release so future worker runs are not deadlocked
      await this.releaseLease({
        companyId,
        workerId: currentWorkerId,
        runStatus: 'FAILED',
        durationMs,
        error: err.message
      });

      throw err;
    }
  },

  /**
   * Global Scheduled Worker Shell (Daily at 06:00 as per Spec §11.C).
   * Iterates all registered companies and executes expiry scans independently.
   */
  async runDailyExpiryWorker({ evaluationNow = new Date(), dryRun = false } = {}) {
    const startTime = Date.now();
    const companies = await Company.find({}).select('_id name timezone').lean();
    const results = [];

    for (const comp of companies) {
      try {
        const res = await this.runCompanyWorker({
          companyId: comp._id,
          evaluationNow,
          dryRun
        });
        results.push({
          companyId: comp._id,
          name: comp.name,
          status: res.skipped ? 'SKIPPED' : 'SUCCESS',
          summary: res.scanResult?.summary || null
        });
      } catch (err) {
        console.error(`[ExpiryWorker] Worker failed for company ${comp.name} (${comp._id}):`, err.message);
        results.push({
          companyId: comp._id,
          name: comp.name,
          status: 'FAILED',
          error: err.message
        });
      }
    }

    return {
      success: true,
      totalCompanies: companies.length,
      durationMs: Date.now() - startTime,
      results
    };
  }
};
