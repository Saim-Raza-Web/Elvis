import InventoryBalance from '../models/InventoryBalance.js';
import StorageRule from '../models/StorageRule.js';
import Location from '../models/Location.js';
import Product from '../models/Product.js';
import Customer from '../models/Customer.js';
import Warehouse from '../models/Warehouse.js';
import { evaluateConditions } from '../utils/conditionEvaluator.js';
import mongoose from 'mongoose';

/**
 * Phase 3 & Stage 4 Picking Core Engine
 * Implements FEFO/FIFO/LIFO algorithms, zone resolution, pick-face prioritization,
 * customer & product shelf-life validation, and atomic allocations / zero-write dry-run.
 */
export const pickingEngine = {
  
  async evaluatePickAllocation({
    companyId,
    warehouse,
    sku,
    qtyNeeded,
    owner,
    customer,
    strategy = 'FEFO',
    lotNumber,
    dryRun = false,
    evaluationNow,
    session
  }) {
    console.log(`[DEBUG] evaluatePickAllocation called for sku: ${sku} qtyNeeded: ${qtyNeeded} dryRun: ${dryRun}`);

    const isDryRun = Boolean(dryRun);
    const evalNow = evaluationNow instanceof Date
      ? evaluationNow
      : (evaluationNow ? new Date(evaluationNow) : new Date());

    const trace = [];
    trace.push({
      step: 'Initialization',
      status: 'INFO',
      message: `Evaluating Pick Allocation for SKU: ${sku}, Needed: ${qtyNeeded}, Default Strategy: ${strategy}, Owner: ${owner || 'Unassigned'}, Customer: ${customer || 'Unassigned'}, DryRun: ${isDryRun}, EvaluationNow: ${evalNow.toISOString()}`
    });

    if (qtyNeeded <= 0) {
      return {
        success: true,
        dryRun: isDryRun,
        requestedSku: sku,
        requestedQty: qtyNeeded,
        owner: owner || null,
        customer: customer || null,
        strategy,
        strategyApplied: strategy,
        shelfLifeValidation: {
          customerMinDays: null,
          productMinDays: null,
          effectiveMinDays: 0,
          source: 'DEFAULT'
        },
        candidateLocations: [],
        eligibleCandidates: [],
        rejectedCandidates: [],
        allocatedLocations: [],
        selectedLocations: [],
        quantitiesPerLocation: {},
        pickFaceVsReserve: { pickFaceAllocatedQty: 0, reserveAllocatedQty: 0 },
        fefoOrdering: [],
        totalAllocatedQty: 0,
        shortfallQty: 0,
        sufficientStock: true,
        warnings: [],
        trace
      };
    }

    // 1. Resolve Customer deliveryTerms (Do NOT infer customer from owner)
    let customerDoc = null;
    if (customer) {
      const custQuery = { company: companyId };
      if (mongoose.isValidObjectId(customer)) {
        custQuery.$or = [{ _id: customer }, { name: customer }];
      } else {
        custQuery.name = customer;
      }
      customerDoc = await Customer.findOne(custQuery).lean();
    }

    // 2. Resolve Product metadata
    const productDoc = await Product.findOne({
      company: companyId,
      sku: { $regex: new RegExp(`^${sku}$`, 'i') }
    }).lean();

    // 3. Determine Shelf-Life Source Priority:
    // Priority 1: Customer.deliveryTerms.minShelfLifeDays
    // Priority 2: Product.min_shelf_life_days
    // Priority 3: Default 0 days (requires expiryDate > evalNow for perishable/lot-controlled inventory)
    const customerMinDays = (customerDoc?.deliveryTerms && typeof customerDoc.deliveryTerms.minShelfLifeDays === 'number')
      ? customerDoc.deliveryTerms.minShelfLifeDays
      : null;
    const productMinDays = (productDoc && typeof productDoc.min_shelf_life_days === 'number')
      ? productDoc.min_shelf_life_days
      : null;

    let effectiveMinDays = 0;
    let shelfLifeSource = 'DEFAULT';

    if (customerMinDays !== null) {
      effectiveMinDays = customerMinDays;
      shelfLifeSource = 'CUSTOMER';
    } else if (productMinDays !== null) {
      effectiveMinDays = productMinDays;
      shelfLifeSource = 'PRODUCT';
    } else {
      effectiveMinDays = 0;
      shelfLifeSource = 'DEFAULT';
    }

    trace.push({
      step: 'Shelf-Life Configuration',
      status: 'INFO',
      message: `Shelf-Life Priority: Source=${shelfLifeSource}, EffectiveMinDays=${effectiveMinDays} (CustomerMin=${customerMinDays}, ProductMin=${productMinDays})`
    });

    // 4. Resolve Warehouse identifier & code for multi-model compatibility
    let whCode = warehouse;
    let whId = null;
    if (warehouse) {
      if (mongoose.isValidObjectId(warehouse)) {
        whId = warehouse;
        const whDoc = await Warehouse.findById(warehouse).select('code').lean();
        if (whDoc) whCode = whDoc.code;
      } else {
        whCode = warehouse;
        const whDoc = await Warehouse.findOne({ company: companyId, code: warehouse }).select('_id').lean();
        if (whDoc) whId = whDoc._id;
      }
    }

    // 5. Fetch active storage rules for PICKING
    const ruleQuery = {
      company: companyId,
      ruleType: 'PICKING',
      isActive: true
    };
    if (whId) {
      ruleQuery.warehouse = whId;
    }

    const activeRules = await StorageRule.find(ruleQuery).sort({ priority: 1 });

    let appliedStrategy = strategy;

    // 6. Evaluate rules to override default strategy
    const evalContext = { sku, owner, customer, lotNumber };
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

    // 7. Fetch Available Inventory
    // Discover all candidate records for the SKU & warehouse with positive stock
    const baseQuery = {
      company: companyId,
      sku: { $regex: new RegExp(`^${sku}$`, 'i') },
      qtyAvailable: { $gt: 0 }
    };
    if (whCode) { baseQuery.warehouse = whCode; }
    if (lotNumber) { baseQuery.lotNumber = lotNumber; }

    const stockRecords = await InventoryBalance.find(baseQuery).session(isDryRun ? null : session).lean();
    console.log(`[DEBUG] Found ${stockRecords.length} candidate stock records for sku: ${sku}`);

    const candidateLocations = [...new Set(stockRecords.map(r => r.bin))];

    if (stockRecords.length === 0) {
      trace.push({
        step: 'Inventory Lookup',
        status: 'FAILED',
        message: 'No available stock found matching requirements.'
      });
      return {
        success: false,
        dryRun: isDryRun,
        requestedSku: sku,
        requestedQty: qtyNeeded,
        owner: owner || null,
        customer: customer || null,
        strategy,
        strategyApplied: appliedStrategy,
        shelfLifeValidation: {
          customerMinDays,
          productMinDays,
          effectiveMinDays,
          source: shelfLifeSource
        },
        candidateLocations: [],
        eligibleCandidates: [],
        rejectedCandidates: [],
        allocatedLocations: [],
        selectedLocations: [],
        quantitiesPerLocation: {},
        pickFaceVsReserve: { pickFaceAllocatedQty: 0, reserveAllocatedQty: 0 },
        fefoOrdering: [],
        totalAllocatedQty: 0,
        shortfallQty: qtyNeeded,
        sufficientStock: false,
        warnings: [`STOCK_SHORTFALL: Requested ${qtyNeeded}, allocated 0, shortfall ${qtyNeeded}`],
        trace
      };
    }

    // 7. Perishable & Shelf-Life Validation (FILTER BEFORE SORTING)
    const isLotOrPerishableProduct = Boolean(
      productDoc?.fefo ||
      productDoc?.lot_tracking ||
      (typeof productDoc?.min_shelf_life_days === 'number' && productDoc.min_shelf_life_days > 0)
    );

    const eligibleCandidates = [];
    const rejectedCandidates = [];

    const evalNowMs = evalNow.getTime();
    const requiredMinExpiryMs = evalNowMs + (effectiveMinDays * 86400000);

    for (const rec of stockRecords) {
      // Check Owner Isolation: If owner is specified, only matching owner may be allocated
      if (owner && rec.owner && rec.owner.trim().toLowerCase() !== owner.trim().toLowerCase()) {
        rejectedCandidates.push({
          location: rec.bin,
          lotNumber: rec.lotNumber || 'DEFAULT-LOT',
          expiryDate: rec.expiryDate || null,
          qtyAvailable: rec.qtyAvailable,
          owner: rec.owner,
          ownerType: rec.ownerType || 'UNKNOWN',
          reason: 'WRONG_OWNER',
          details: `Candidate owner '${rec.owner}' does not match requested owner '${owner}'`
        });
        continue;
      }

      // Perishable / Expiry Validation
      if (rec.expiryDate) {
        const expMs = new Date(rec.expiryDate).getTime();

        // Expired check: expiryDate <= evaluationNow
        if (expMs <= evalNowMs) {
          rejectedCandidates.push({
            location: rec.bin,
            lotNumber: rec.lotNumber || 'DEFAULT-LOT',
            expiryDate: rec.expiryDate,
            qtyAvailable: rec.qtyAvailable,
            owner: rec.owner,
            ownerType: rec.ownerType || 'UNKNOWN',
            reason: 'EXPIRED',
            details: `Lot expired on ${new Date(rec.expiryDate).toISOString()} (EvaluationNow: ${evalNow.toISOString()})`
          });
          continue;
        }

        // Shelf-life check: If effectiveMinDays > 0, expiryDate must be >= evalNow + minShelfLifeDays * 86400000
        if (effectiveMinDays > 0 && expMs < requiredMinExpiryMs) {
          const remainingDays = Math.floor((expMs - evalNowMs) / 86400000);
          rejectedCandidates.push({
            location: rec.bin,
            lotNumber: rec.lotNumber || 'DEFAULT-LOT',
            expiryDate: rec.expiryDate,
            qtyAvailable: rec.qtyAvailable,
            owner: rec.owner,
            ownerType: rec.ownerType || 'UNKNOWN',
            reason: 'INSUFFICIENT_SHELF_LIFE',
            details: `Remaining shelf life (${remainingDays} days) is less than required ${effectiveMinDays} days`
          });
          continue;
        }
      } else {
        // Candidate has no expiry date
        if (isLotOrPerishableProduct) {
          if (effectiveMinDays > 0) {
            rejectedCandidates.push({
              location: rec.bin,
              lotNumber: rec.lotNumber || 'DEFAULT-LOT',
              expiryDate: null,
              qtyAvailable: rec.qtyAvailable,
              owner: rec.owner,
              ownerType: rec.ownerType || 'UNKNOWN',
              reason: 'MISSING_EXPIRY_DATE',
              details: `Perishable lot-tracked product requires expiry date to validate minimum shelf life of ${effectiveMinDays} days`
            });
            continue;
          } else if (productDoc?.fefo || productDoc?.lot_tracking) {
            rejectedCandidates.push({
              location: rec.bin,
              lotNumber: rec.lotNumber || 'DEFAULT-LOT',
              expiryDate: null,
              qtyAvailable: rec.qtyAvailable,
              owner: rec.owner,
              ownerType: rec.ownerType || 'UNKNOWN',
              reason: 'MISSING_EXPIRY_DATE',
              details: `Perishable/FEFO product requires a valid expiry date`
            });
            continue;
          }
        }
        // Non-perishable general stock without expiry date is eligible!
      }

      eligibleCandidates.push(rec);
    }

    trace.push({
      step: 'Candidate Filtering',
      status: 'INFO',
      message: `Candidate validation completed: ${eligibleCandidates.length} eligible, ${rejectedCandidates.length} rejected.`
    });

    if (eligibleCandidates.length === 0) {
      trace.push({
        step: 'Candidate Selection',
        status: 'FAILED',
        message: 'All candidate stock was rejected due to shelf-life or owner isolation requirements.'
      });
      return {
        success: false,
        dryRun: isDryRun,
        requestedSku: sku,
        requestedQty: qtyNeeded,
        owner: owner || null,
        customer: customer || null,
        strategy,
        strategyApplied: appliedStrategy,
        shelfLifeValidation: {
          customerMinDays,
          productMinDays,
          effectiveMinDays,
          source: shelfLifeSource
        },
        candidateLocations,
        eligibleCandidates: [],
        rejectedCandidates,
        allocatedLocations: [],
        selectedLocations: [],
        quantitiesPerLocation: {},
        pickFaceVsReserve: { pickFaceAllocatedQty: 0, reserveAllocatedQty: 0 },
        fefoOrdering: [],
        totalAllocatedQty: 0,
        shortfallQty: qtyNeeded,
        sufficientStock: false,
        warnings: [
          `STOCK_SHORTFALL: Requested ${qtyNeeded}, allocated 0, shortfall ${qtyNeeded}`,
          `${rejectedCandidates.length} candidate lot(s) were rejected`
        ],
        trace
      };
    }

    // 8. Classify Candidates into Pick-Face vs Reserve
    const pickFaceList = [];
    const reserveList = [];

    for (const rec of eligibleCandidates) {
      const locDoc = await Location.findOne({ code: rec.bin, company: companyId }).lean();
      const isPickFace = Boolean(
        locDoc && (
          locDoc.locationType === 'SHELF' ||
          locDoc.locationType === 'PICK_FACE' ||
          locDoc.locationType === 'pick_face'
        )
      );
      rec._isPickFace = isPickFace;
      if (isPickFace) {
        pickFaceList.push(rec);
      } else {
        reserveList.push(rec);
      }
    }

    // 9. Deterministic Strategy Sorting per Sub-List
    if (appliedStrategy === 'FEFO') {
      const sortFefo = (a, b) => {
        const timeA = a.expiryDate ? new Date(a.expiryDate).getTime() : Infinity;
        const timeB = b.expiryDate ? new Date(b.expiryDate).getTime() : Infinity;
        if (timeA !== timeB) return timeA - timeB;
        // Tie-break 1: bin
        const binCmp = (a.bin || '').localeCompare(b.bin || '');
        if (binCmp !== 0) return binCmp;
        // Tie-break 2: lotNumber
        const lotCmp = (a.lotNumber || '').localeCompare(b.lotNumber || '');
        if (lotCmp !== 0) return lotCmp;
        // Fallback for non-perishable lots
        return new Date(a.entryDate || a.createdAt || 0).getTime() - new Date(b.entryDate || b.createdAt || 0).getTime();
      };
      pickFaceList.sort(sortFefo);
      reserveList.sort(sortFefo);
    } else if (appliedStrategy === 'LIFO') {
      const sortLifo = (a, b) => {
        const timeA = new Date(a.entryDate || a.createdAt || 0).getTime();
        const timeB = new Date(b.entryDate || b.createdAt || 0).getTime();
        if (timeA !== timeB) return timeB - timeA;
        const binCmp = (a.bin || '').localeCompare(b.bin || '');
        if (binCmp !== 0) return binCmp;
        return String(a._id).localeCompare(String(b._id));
      };
      pickFaceList.sort(sortLifo);
      reserveList.sort(sortLifo);
    } else if (appliedStrategy === 'FPFO') {
      const sortFpfo = (a, b) => {
        const batchCmp = (a.batchNumber || '').localeCompare(b.batchNumber || '');
        if (batchCmp !== 0) return batchCmp;
        const binCmp = (a.bin || '').localeCompare(b.bin || '');
        if (binCmp !== 0) return binCmp;
        return String(a._id).localeCompare(String(b._id));
      };
      pickFaceList.sort(sortFpfo);
      reserveList.sort(sortFpfo);
    } else {
      // Default FIFO (oldest first)
      const sortFifo = (a, b) => {
        const timeA = new Date(a.entryDate || a.createdAt || 0).getTime();
        const timeB = new Date(b.entryDate || b.createdAt || 0).getTime();
        if (timeA !== timeB) return timeA - timeB;
        
        const lotCmp = (a.lotNumber || '').localeCompare(b.lotNumber || '');
        if (lotCmp !== 0) return lotCmp;

        const binCmp = (a.bin || '').localeCompare(b.bin || '');
        if (binCmp !== 0) return binCmp;
        return String(a._id).localeCompare(String(b._id));
      };
      pickFaceList.sort(sortFifo);
      reserveList.sort(sortFifo);
    }

    // Pick-face first, then reserve fallback
    const orderedStock = [...pickFaceList, ...reserveList];

    // 10. Allocate Quantities Across Locations (DRY-RUN vs REAL RESERVATION)
    let remainingNeeded = qtyNeeded;
    const allocations = [];
    let pickFaceAllocatedQty = 0;
    let reserveAllocatedQty = 0;

    for (const rec of orderedStock) {
      if (remainingNeeded <= 0) break;

      const pickQty = Math.min(rec.qtyAvailable, remainingNeeded);
      if (pickQty <= 0) continue;

      const isPickFace = Boolean(rec._isPickFace);

      if (isDryRun) {
        // --- DRY RUN: ZERO DATABASE MUTATIONS ---
        remainingNeeded -= pickQty;
        if (isPickFace) {
          pickFaceAllocatedQty += pickQty;
        } else {
          reserveAllocatedQty += pickQty;
        }

        allocations.push({
          location: rec.bin,
          lotNumber: rec.lotNumber || 'DEFAULT-LOT',
          expiryDate: rec.expiryDate || null,
          allocatedQty: pickQty,
          balanceId: rec._id,
          owner: rec.owner,
          ownerType: rec.ownerType || 'UNKNOWN',
          isPickFace
        });

        trace.push({
          step: 'Location Allocation (Dry-Run)',
          status: 'SIMULATED',
          location: rec.bin,
          qty: pickQty,
          message: `Simulated reservation of ${pickQty} units from ${rec.bin} (${isPickFace ? 'Pick Face' : 'Reserve'}). Remaining needed: ${remainingNeeded}`
        });
      } else {
        // --- REAL OPERATION: ATOMIC INVENTORY RESERVATION ---
        const reservedDoc = await InventoryBalance.findOneAndUpdate(
          { _id: rec._id, qtyAvailable: { $gte: pickQty } },
          { $inc: { qtyAvailable: -pickQty, qtyReserved: pickQty } },
          { returnDocument: 'after', session }
        );

        if (reservedDoc) {
          // --- DEDUCT ALLOCATABLE AGGREGATE ON PRODUCT ---
          const productUpdate = await Product.findOneAndUpdate(
            { sku: rec.sku, company: companyId },
            { $inc: { qty_available: -pickQty } },
            { returnDocument: 'after', session }
          );

          if (!productUpdate) {
            throw new Error(`Failed to deduct Product.qty_available for SKU ${rec.sku}. Rollback required.`);
          }

          remainingNeeded -= pickQty;
          if (isPickFace) {
            pickFaceAllocatedQty += pickQty;
          } else {
            reserveAllocatedQty += pickQty;
          }

          allocations.push({
            location: rec.bin,
            lotNumber: rec.lotNumber || 'DEFAULT-LOT',
            expiryDate: rec.expiryDate || null,
            allocatedQty: pickQty,
            balanceId: rec._id,
            owner: rec.owner,
            ownerType: rec.ownerType || 'UNKNOWN',
            isPickFace
          });

          trace.push({
            step: 'Location Allocation',
            status: 'ALLOCATED',
            location: rec.bin,
            qty: pickQty,
            message: `Atomically reserved ${pickQty} units from ${rec.bin} (${isPickFace ? 'Pick Face' : 'Reserve'}). Remaining needed: ${remainingNeeded}`
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
    }

    const success = remainingNeeded === 0;
    const totalAllocatedQty = qtyNeeded - remainingNeeded;

    const quantitiesPerLocation = {};
    for (const alloc of allocations) {
      quantitiesPerLocation[alloc.location] = (quantitiesPerLocation[alloc.location] || 0) + alloc.allocatedQty;
    }

    const fefoOrdering = allocations.map(a => a.lotNumber);

    const warnings = [];
    if (!success) {
      warnings.push(`STOCK_SHORTFALL: Requested ${qtyNeeded}, allocated ${totalAllocatedQty}, shortfall ${remainingNeeded}`);
    }
    if (rejectedCandidates.length > 0) {
      warnings.push(`${rejectedCandidates.length} candidate lot(s) were rejected`);
    }

    trace.push({
      step: 'Allocation Summary',
      status: success ? 'SUCCESS' : 'SHORTFALL',
      message: success
        ? `Successfully allocated ${qtyNeeded} units across ${allocations.length} location(s).`
        : `Allocated ${totalAllocatedQty} units. Shortfall: ${remainingNeeded} units.`
    });

    return {
      success,
      dryRun: isDryRun,
      requestedSku: sku,
      requestedQty: qtyNeeded,
      owner: owner || null,
      customer: customer || null,
      strategy,
      strategyApplied: appliedStrategy,
      shelfLifeValidation: {
        customerMinDays,
        productMinDays,
        effectiveMinDays,
        source: shelfLifeSource
      },
      candidateLocations,
      eligibleCandidates: eligibleCandidates.map(c => ({
        location: c.bin,
        lotNumber: c.lotNumber || 'DEFAULT-LOT',
        expiryDate: c.expiryDate || null,
        qtyAvailable: c.qtyAvailable,
        owner: c.owner,
        ownerType: c.ownerType || 'UNKNOWN',
        isPickFace: Boolean(c._isPickFace)
      })),
      rejectedCandidates,
      allocatedLocations: allocations,
      selectedLocations: allocations,
      quantitiesPerLocation,
      pickFaceVsReserve: {
        pickFaceAllocatedQty,
        reserveAllocatedQty
      },
      fefoOrdering,
      totalAllocatedQty,
      shortfallQty: remainingNeeded,
      sufficientStock: success,
      warnings,
      trace
    };
  }
};
