import InventoryBalance from '../models/InventoryBalance.js';
import StorageRule from '../models/StorageRule.js';
import Location from '../models/Location.js';
import Product from '../models/Product.js';
import { evaluateConditions } from '../utils/conditionEvaluator.js';
import mongoose from 'mongoose';

/**
 * Phase 3 Picking Core Engine
 * Implements FEFO/FIFO/LIFO algorithms, zone resolution, and atomic allocations.
 */
export const pickingEngine = {
  
  async evaluatePickAllocation({ companyId, warehouse, sku, qtyNeeded, owner, strategy = 'FEFO', lotNumber, session }) {
    console.log(`[DEBUG] evaluatePickAllocation called for sku: ${sku} qtyNeeded: ${qtyNeeded}`);

    const trace = [];
    trace.push({
      step: 'Initialization',
      status: 'INFO',
      message: `Evaluating Pick Allocation for SKU: ${sku}, Needed: ${qtyNeeded}, Default Strategy: ${strategy}, Owner: ${owner || 'Unassigned'}`
    });

    if (qtyNeeded <= 0) {
      return { success: true, allocatedLocations: [], totalAllocatedQty: 0, shortfallQty: 0, trace };
    }

    // 1. Fetch active storage rules for PICKING
    const activeRules = await StorageRule.find({ 
      company: companyId, 
      warehouse,
      ruleType: 'PICKING',
      isActive: true 
    }).sort({ priority: 1 });

    let appliedStrategy = strategy;

    // 2. Evaluate rules to override default strategy
    const evalContext = { sku, owner, lotNumber };
    for (const rule of activeRules) {
      if (evaluateConditions(rule.conditions || [], evalContext)) {
        appliedStrategy = rule.action || strategy;
        trace.push({
          step: 'Rule Match',
          status: 'MATCHED',
          message: `Rule Priority ${rule.priority} ("${rule.name}") matched: Overriding strategy to ${appliedStrategy}`
        });
        break; 
      }
    }

    // 3. Fetch Available Inventory
    // Note: To prevent tenant bleed, always scope by companyId!
    const query = {
      company: companyId,
      sku: { $regex: new RegExp(`^${sku}$`, 'i') },
      qtyAvailable: { $gt: 0 }
    };
    if (owner) { query.owner = owner; }
    if (lotNumber) { query.lotNumber = lotNumber; }
    if (warehouse) { query.warehouse = warehouse; }

    const stockRecords = await InventoryBalance.find(query).session(session);
    console.log(`[DEBUG] Found ${stockRecords.length} stock records for sku: ${sku}`);

    if (stockRecords.length === 0) {
      trace.push({
        step: 'Inventory Lookup',
        status: 'FAILED',
        message: 'No available stock found matching requirements.'
      });
      return { success: false, allocatedLocations: [], totalAllocatedQty: 0, shortfallQty: qtyNeeded, trace };
    }

    // 4. Sort Stock based on Strategy
    if (appliedStrategy === 'FEFO') {
      stockRecords.sort((a, b) => {
        const dateA = a.expiryDate ? new Date(a.expiryDate).getTime() : Infinity;
        const dateB = b.expiryDate ? new Date(b.expiryDate).getTime() : Infinity;
        return dateA - dateB;
      });
    } else if (appliedStrategy === 'LIFO') {
      stockRecords.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    } else if (appliedStrategy === 'FPFO') {
      stockRecords.sort((a, b) => (a.batchNumber || '').localeCompare(b.batchNumber || ''));
    } else {
      // Default FIFO (for FIFO and any other unhandled)
      stockRecords.sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
    }

    // 5. Pick-Face-First Prioritization
    const pickFaceList = [];
    const reserveList = [];

    for (const rec of stockRecords) {
      const locDoc = await Location.findOne({ code: rec.bin, company: companyId });
      if (locDoc && (locDoc.locationType === 'SHELF' || locDoc.locationType === 'PICK_FACE' || locDoc.locationType === 'pick_face')) {
        pickFaceList.push(rec);
      } else {
        reserveList.push(rec);
      }
    }

    const orderedStock = [...pickFaceList, ...reserveList];

    // 6. Atomically Allocate Quantities Across Locations
    let remainingNeeded = qtyNeeded;
    const allocations = [];

    for (const rec of orderedStock) {
      if (remainingNeeded <= 0) break;

      const pickQty = Math.min(rec.qtyAvailable, remainingNeeded);

      // --- ATOMIC INVENTORY RESERVATION ---
      const reservedDoc = await InventoryBalance.findOneAndUpdate(
        { _id: rec._id, qtyAvailable: { $gte: pickQty } },
        { $inc: { qtyAvailable: -pickQty, qtyReserved: pickQty } },
        { new: true, session }
      );

      if (reservedDoc) {
        // --- PHASE 7 OPTION A FIX: DEDUCT ALLOCATABLE AGGREGATE ---
        const productUpdate = await Product.findOneAndUpdate(
          { sku: rec.sku, company: companyId },
          { $inc: { qty_available: -pickQty } },
          { new: true, session }
        );

        if (!productUpdate) {
          throw new Error(`Failed to deduct Product.qty_available for SKU ${rec.sku}. Rollback required.`);
        }

        remainingNeeded -= pickQty;

        allocations.push({
          location: rec.bin,
          lotNumber: rec.lotNumber || 'DEFAULT-LOT',
          expiryDate: rec.expiryDate || null,
          allocatedQty: pickQty,
          balanceId: rec._id,
          owner: rec.owner,
          isPickFace: pickFaceList.includes(rec)
        });

        trace.push({
          step: 'Location Allocation',
          status: 'ALLOCATED',
          location: rec.bin,
          qty: pickQty,
          message: `Atomically reserved ${pickQty} units from ${rec.bin}. Remaining needed: ${remainingNeeded}`
        });
      } else {
        trace.push({
          step: 'Location Allocation',
          status: 'RETRY',
          location: rec.bin,
          message: `Failed to atomically reserve ${pickQty} units from ${rec.bin}. Retrying next.`
        });
      }
    }

    const success = remainingNeeded === 0;

    trace.push({
      step: 'Allocation Summary',
      status: success ? 'SUCCESS' : 'SHORTFALL',
      message: success
        ? `Successfully allocated ${qtyNeeded} units across ${allocations.length} location(s).`
        : `Allocated ${qtyNeeded - remainingNeeded} units. Shortfall: ${remainingNeeded} units.`
    });

    return {
      success,
      allocatedLocations: allocations,
      totalAllocatedQty: qtyNeeded - remainingNeeded,
      shortfallQty: remainingNeeded,
      strategyApplied: appliedStrategy,
      trace
    };
  }
};
