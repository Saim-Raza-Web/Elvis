import InventoryBalance from '../models/InventoryBalance.js';
import Location from '../models/Location.js';

/**
 * DECOUPLED PICKING ENGINE
 * Evaluates source locations & stock allocation independently from Putaway.
 * Enforces 3PL Owner Isolation, Excluded Recalled/Blocked Lots, Strategy Allocation (FEFO, FIFO, LIFO, FPFO),
 * and Pick-Face-First prioritization with Reserve Fallback.
 */
export const pickingEngine = {
  evaluatePickAllocation: async ({
    companyId,
    warehouse,
    sku,
    owner,
    qtyNeeded,
    strategy = 'FEFO',
    minPickUnit = 'EA'
  }) => {
    const trace = [];
    trace.push({
      step: 'Allocation Start',
      status: 'INFO',
      message: `Evaluating Picking Allocation for SKU: ${sku}, Required Qty: ${qtyNeeded}, Owner: ${owner || 'Any'}, Strategy: ${strategy}`
    });

    // 1. Build Query for Available Stock
    const query = {
      company: companyId,
      sku,
      qtyAvailable: { $gt: 0 },
      isBlocked: { $ne: true },
      isRecalled: { $ne: true }
    };

    if (warehouse) query.warehouse = warehouse;
    if (owner) query.owner = owner;

    let stockRecords = await InventoryBalance.find(query);

    trace.push({
      step: 'Stock Search',
      status: 'INFO',
      message: `Found ${stockRecords.length} available inventory records matching company, SKU, and owner.`
    });

    if (stockRecords.length === 0) {
      trace.push({
        step: 'Allocation Failed',
        status: 'ERROR',
        message: `Insufficient stock for SKU ${sku} (Owner: ${owner || 'N/A'}). 0 available units found.`
      });
      return {
        success: false,
        allocatedLocations: [],
        shortfallQty: qtyNeeded,
        strategyApplied: strategy,
        trace
      };
    }

    // 2. Sort Stock Records by Strategy
    if (strategy === 'FEFO') {
      stockRecords.sort((a, b) => {
        const dateA = a.expiryDate ? new Date(a.expiryDate).getTime() : 9999999999999;
        const dateB = b.expiryDate ? new Date(b.expiryDate).getTime() : 9999999999999;
        return dateA - dateB;
      });
    } else if (strategy === 'LIFO') {
      stockRecords.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    } else if (strategy === 'FPFO') {
      stockRecords.sort((a, b) => (a.batchNumber || '').localeCompare(b.batchNumber || ''));
    } else {
      // Default FIFO
      stockRecords.sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
    }

    // 3. Pick-Face-First Prioritization
    // Separate SHELF / PICK_FACE locations from RESERVE / PALLET locations
    const pickFaceList = [];
    const reserveList = [];

    for (const rec of stockRecords) {
      const locDoc = await Location.findOne({ code: rec.bin, company: companyId });
      if (locDoc && (locDoc.locationType === 'SHELF' || locDoc.locationType === 'PICK_FACE')) {
        pickFaceList.push(rec);
      } else {
        reserveList.push(rec);
      }
    }

    const orderedStock = [...pickFaceList, ...reserveList];

    // 4. Allocate Quantities Across Locations
    let remainingNeeded = qtyNeeded;
    const allocations = [];

    for (const rec of orderedStock) {
      if (remainingNeeded <= 0) break;

      const pickQty = Math.min(rec.qtyAvailable, remainingNeeded);
      remainingNeeded -= pickQty;

      allocations.push({
        location: rec.bin,
        lotNumber: rec.lotNumber || 'DEFAULT-LOT',
        expiryDate: rec.expiryDate || null,
        allocatedQty: pickQty,
        balanceId: rec._id,
        isPickFace: pickFaceList.includes(rec)
      });

      trace.push({
        step: 'Location Allocation',
        status: 'ALLOCATED',
        location: rec.bin,
        qty: pickQty,
        lot: rec.lotNumber || 'DEFAULT-LOT',
        message: `Allocated ${pickQty} units from ${rec.bin} (${pickFaceList.includes(rec) ? 'Pick Face' : 'Reserve Fallback'}). Expiry: ${rec.expiryDate ? new Date(rec.expiryDate).toLocaleDateString() : 'N/A'}`
      });
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
      strategyApplied: strategy,
      trace
    };
  }
};
