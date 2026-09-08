import ComplianceOutboxEvent from '../models/ComplianceOutboxEvent.js';

/**
 * Phase 8C.1 Compliance Outbox Worker Shell
 * 
 * Safely polls and executes ComplianceOutboxEvents.
 * Features:
 * - Atomic MongoDB claims (findOneAndUpdate).
 * - Safe recovery of abandoned PROCESSING leases.
 * - Exponential backoff on FAILED events.
 */
export class ComplianceOutboxWorker {
  
  /**
   * Attempt to claim a single event for processing.
   */
  static async claimNextEvent(leaseDurationMs = 60000) {
    const now = new Date();
    const lockedUntil = new Date(now.getTime() + leaseDurationMs);

    // Find a PENDING event ready to run, OR a PROCESSING event that has exceeded its lease (crashed worker)
    const event = await ComplianceOutboxEvent.findOneAndUpdate(
      {
        $or: [
          { status: 'PENDING', nextAttemptAt: { $lte: now } },
          { status: 'PROCESSING', lockedUntil: { $lte: now } }
        ]
      },
      {
        $set: {
          status: 'PROCESSING',
          lockedUntil: lockedUntil
        },
        $inc: { attempts: 1 }
      },
      { 
        new: true,
        sort: { nextAttemptAt: 1 } // Process oldest ready events first
      }
    );

    return event;
  }

  /**
   * Process an event and mark it COMPLETED or FAILED.
   * This is a shell for Phase 8C.1. Actual AEAT integration will be injected in later phases.
   */
  static async processEvent(event, processorFn) {
    try {
      // Execute the injected processor (e.g. AEAT API call)
      if (processorFn) {
        await processorFn(event);
      } else {
        // Dummy successful processing for testing Phase 8C.1 shell
      }

      await ComplianceOutboxEvent.updateOne(
        { _id: event._id },
        {
          $set: {
            status: 'COMPLETED',
            processedAt: new Date(),
            lockedUntil: null
          }
        }
      );
      return true;
    } catch (err) {
      // Exponential backoff: 1m, 2m, 4m, 8m...
      const backoffMs = Math.min(1000 * 60 * Math.pow(2, event.attempts - 1), 1000 * 60 * 60 * 24); 
      const nextAttemptAt = new Date(Date.now() + backoffMs);

      await ComplianceOutboxEvent.updateOne(
        { _id: event._id },
        {
          $set: {
            status: 'FAILED',
            lastError: err.message,
            nextAttemptAt: nextAttemptAt,
            lockedUntil: null
          }
        }
      );
      return false;
    }
  }

  /**
   * Process a batch of events (for cron/worker loop).
   */
  static async processBatch(batchSize = 10, processorFn = null) {
    let processedCount = 0;
    for (let i = 0; i < batchSize; i++) {
      const event = await this.claimNextEvent();
      if (!event) {
        break; // No more events ready
      }
      await this.processEvent(event, processorFn);
      processedCount++;
    }
    return processedCount;
  }
}
