import mongoose from 'mongoose';
import { replenishmentEngine } from './replenishmentEngine.js';
import Warehouse from '../models/Warehouse.js';
import Company from '../models/Company.js';
import WarehouseTask from '../models/WarehouseTask.js';

let intervalId = null;

export const replenishmentScheduler = {
  /**
   * Start the global replenishment scheduler.
   * @param {number} intervalMs  Default: 15 minutes
   */
  start(intervalMs = 60000 * 15) {
    if (intervalId) return;
    console.log(`[Scheduler] Starting Auto-Replenishment Scheduler (interval: ${intervalMs}ms)`);
    intervalId = setInterval(async () => {
      try {
        await this.run();
      } catch (err) {
        console.error('[Scheduler] Auto-Replenishment Error:', err);
      }
    }, intervalMs);
    // Run initial scan after 5 s to pick up backlog on startup
    setTimeout(() => this.run().catch(console.error), 5000);
  },

  stop() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
      console.log('[Scheduler] Stopped Auto-Replenishment Scheduler');
    }
  },

  /**
   * Main evaluation loop: per-company, per-warehouse, per-need.
   * Finds pick-face locations below min_stock, selects source from PALLET/RESERVE,
   * creates an active replenishment task with atomic reservation.
   * Does NOT auto-complete the task (leaves it for warehouse staff execution).
   * Safe under duplicate runs (idempotent + active task guard).
   *
   * @returns {Promise<Array<Object>>} List of created tasks
   */
  async run() {
    if (mongoose.connection.readyState !== 1) {
      console.log('[Scheduler] Database not connected yet. Skipping Auto-Replenishment check.');
      return [];
    }
    console.log('[Scheduler] Running Auto-Replenishment check...');
    const companies = await Company.find({ status: { $ne: 'inactive' } });
    const createdTasks = [];

    for (const comp of companies) {
      const warehouses = await Warehouse.find({ company: comp._id, status: { $ne: 'inactive' } });

      for (const wh of warehouses) {
        try {
          // 1. Evaluate warehouse pick faces — returns { warehouse, evaluations[] }
          const result = await replenishmentEngine.evaluateWarehouse(comp._id, wh._id);
          const evaluations = Array.isArray(result?.evaluations) ? result.evaluations : [];

          // 2. Identify replenishment needs where requiredQty > 0
          const needs = evaluations.filter(e => e.requiredQty > 0);
          if (needs.length === 0) continue;

          console.log(`[Scheduler] ${comp.name} / ${wh.code}: ${needs.length} replenishment need(s).`);

          // 3. Process each need that has sufficient reserve stock
          for (const need of needs) {
            if (!need.hasSufficientStock) {
              console.log(
                `[Scheduler] Insufficient reserve stock: SKU "${need.sku}" in ${wh.code}` +
                ` (needs ${need.requiredQty}, reserve has ${need.totalReserveAvailable})`
              );
              continue;
            }

            try {
              // ── Duplicate-task guard ────────────────────────────────────
              // Check for any active replenishment task for this SKU + destination + owner
              // to prevent creating duplicate tasks across scheduler runs.
              const existingActive = await WarehouseTask.findOne({
                company: comp._id,
                task_type: 'replenishment',
                sku_code: need.sku,
                destination_bin: need.pickFaceBin,
                owner: need.owner,
                status: { $in: ['pending', 'assigned', 'in_progress', 'reserved', 'PENDING', 'IN_PROGRESS', 'RESERVED'] }
              });

              if (existingActive) {
                console.log(
                  `[Scheduler] Skipping: active replenishment task ${existingActive.taskId} already exists` +
                  ` for SKU "${need.sku}" (Owner: ${need.owner}) → ${need.pickFaceBin} in ${wh.code}`
                );
                continue;
              }

              // ── Deterministic idempotency key ──
              const hourSlot = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
              const idempotencyKey = `SCHED-REP-${comp._id}-${wh.code}-${need.sku}-${need.pickFaceBin}-${hourSlot}`;

              // ── Select best FEFO reserve candidate ──────────────────────
              const bestSource = Array.isArray(need.candidates) && need.candidates.length > 0
                ? need.candidates[0]
                : null;

              // ── Create replenishment task with atomic reservation ──────
              const reservation = await replenishmentEngine.reserveReplenishment(
                comp._id,
                {
                  warehouse: wh._id,
                  sku: need.sku,
                  destinationBin: need.pickFaceBin,
                  sourceBin: bestSource ? bestSource.bin : undefined,
                  lotNumber: bestSource ? bestSource.lotNumber : undefined,
                  requestedQty: need.requiredQty,
                  allowPartial: true,
                  user: 'scheduler',
                  idempotencyKey
                }
              );

              if (!reservation || !reservation.task || !reservation.task.taskId) {
                console.error(
                  `[Scheduler] reserveReplenishment returned no taskId for SKU "${need.sku}"` +
                  ` in warehouse "${wh.code}" (company: "${comp.name}")`
                );
                continue;
              }

              console.log(
                `[Scheduler] Successfully created replenishment task ${reservation.task.taskId}` +
                ` for SKU "${need.sku}" (Qty: ${reservation.task.qty}) → ${need.pickFaceBin}`
              );

              createdTasks.push(reservation.task);
            } catch (needErr) {
              console.error(
                `[Scheduler] Replenishment creation failed for SKU "${need.sku}"` +
                ` in ${wh.code} (${need.pickFaceBin}): ${needErr.message}`
              );
            }
          }
        } catch (whErr) {
          console.error(
            `[Scheduler] Error evaluating warehouse "${wh.code}" (company: "${comp.name}"): ${whErr.message}`
          );
        }
      }
    }

    return createdTasks;
  }
};
