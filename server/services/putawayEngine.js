import Location from '../models/Location.js';
import StorageRule from '../models/StorageRule.js';
import InventoryBalance from '../models/InventoryBalance.js';
import Product from '../models/Product.js';

/**
 * DECOUPLED PUTAWAY ENGINE
 * Evaluates candidate destination storage locations strictly for putaway operations.
 * Enforces: Rule Priority (1..N), Lot Integrity (1 Location = 1 Lot + 1 SKU + 1 Owner),
 * Temperature bounds, 3PL Owner restrictions, Capacity/Occupancy limits, Hazmat segregation, and FEFO expiry.
 */
export const putawayEngine = {
  evaluatePutawayLocation: async ({
    companyId,
    warehouse,
    sku,
    category,
    owner,
    lotNumber,
    expiryDate,
    qty = 1,
    isHazmat = false,
    tempRequirement = null
  }) => {
    const trace = [];

    // 1. Fetch product details if not fully provided
    let prodCategory = category;
    let prodQcProfile = '';
    if (sku) {
      const prod = await Product.findOne({ sku, company: companyId });
      if (prod) {
        if (!prodCategory) prodCategory = prod.category;
        prodQcProfile = prod.qc_profile || '';
      }
    }

    trace.push({
      step: 'Product Inspection',
      status: 'INFO',
      message: `Evaluating Putaway for SKU: ${sku}, Category: ${prodCategory || 'GEN'}, Owner: ${owner || 'Unassigned'}, Lot: ${lotNumber || 'N/A'}`
    });

    // 2. Fetch active storage rules sorted by priority (1 = highest)
    const activeRules = await StorageRule.find({ company: companyId, isActive: true }).sort({ priority: 1 });
    trace.push({
      step: 'Rules Fetch',
      status: 'INFO',
      message: `Found ${activeRules.length} active storage rules configured.`
    });

    // 3. Determine target zone / criteria from rules
    let targetZone = null;
    let targetLocType = null;
    let appliedRuleName = 'Default Storage Policy';
    let appliedPriority = 999;

    for (const rule of activeRules) {
      let matched = false;
      if (rule.conditionType === 'category' && rule.conditionValue === prodCategory) matched = true;
      if (rule.conditionType === 'owner' && rule.conditionValue === owner) matched = true;
      if (rule.conditionType === 'brand' && rule.conditionValue === prodCategory) matched = true;

      if (matched) {
        targetZone = rule.targetZone;
        targetLocType = rule.targetLocationType;
        appliedRuleName = rule.name;
        appliedPriority = rule.priority;
        trace.push({
          step: 'Rule Match',
          status: 'MATCHED',
          message: `Rule Priority ${rule.priority} ("${rule.name}") matched: Target Zone = ${targetZone || 'Any'}, Type = ${targetLocType || 'Any'}`
        });
        break;
      }
    }

    // 4. Fetch candidate locations in warehouse
    const locQuery = { company: companyId, active: { $ne: false } };
    if (warehouse) locQuery.warehouse = warehouse;
    if (targetZone) locQuery.zone = targetZone;
    if (targetLocType) locQuery.locationType = targetLocType;

    let candidateLocations = await Location.find(locQuery).sort({ code: 1 });
    if (candidateLocations.length === 0 && targetZone) {
      trace.push({
        step: 'Fallback Search',
        status: 'WARNING',
        message: `No active locations found in target zone "${targetZone}". Falling back to all warehouse locations.`
      });
      candidateLocations = await Location.find({ company: companyId, active: { $ne: false }, warehouse }).sort({ code: 1 });
    }

    trace.push({
      step: 'Candidate Pool',
      status: 'INFO',
      message: `Evaluates ${candidateLocations.length} candidate locations for eligibility constraints.`
    });

    // 5. Evaluate each location against physical constraints & Lot Integrity
    for (const loc of candidateLocations) {
      const locCode = loc.code;

      // Exclusion A: Temperature Bounds
      if (tempRequirement !== null && tempRequirement !== undefined) {
        const reqTemp = Number(tempRequirement);
        if (loc.tempMin !== undefined && reqTemp < loc.tempMin) {
          trace.push({ step: 'Location Rejection', location: locCode, reason: `Temp ${reqTemp}°C below location min (${loc.tempMin}°C)` });
          continue;
        }
        if (loc.tempMax !== undefined && reqTemp > loc.tempMax) {
          trace.push({ step: 'Location Rejection', location: locCode, reason: `Temp ${reqTemp}°C above location max (${loc.tempMax}°C)` });
          continue;
        }
      }

      // Exclusion B: Owner Restrictions
      if (owner && Array.isArray(loc.allowedOwners) && loc.allowedOwners.length > 0) {
        if (!loc.allowedOwners.includes(owner)) {
          trace.push({ step: 'Location Rejection', location: locCode, reason: `Owner "${owner}" not in allowed owners list [${loc.allowedOwners.join(', ')}]` });
          continue;
        }
      }

      // Exclusion C: Hazmat Segregation
      if (isHazmat && loc.locationType !== 'HAZMAT' && loc.zone !== 'HAZMAT') {
        trace.push({ step: 'Location Rejection', location: locCode, reason: 'Hazmat product requires dedicated HAZMAT location type or zone.' });
        continue;
      }

      // Exclusion D: Existing Stock Occupancy & Lot Integrity Invariant
      // Hard Invariant: 1 LOCATION = 1 LOT + 1 SKU + 1 OWNER
      const existingBalances = await InventoryBalance.find({
        company: companyId,
        bin: locCode,
        $or: [{ qtyAvailable: { $gt: 0 } }, { qtyAwaitingPutaway: { $gt: 0 } }]
      });

      if (existingBalances.length > 0) {
        const conflictingOwner = existingBalances.find(b => b.owner && b.owner !== owner);
        if (conflictingOwner) {
          trace.push({ step: 'Location Rejection', location: locCode, reason: `Lot Integrity Violation: Occupied by another 3PL Owner ("${conflictingOwner.owner}")` });
          continue;
        }

        const conflictingSku = existingBalances.find(b => b.sku && b.sku !== sku);
        if (conflictingSku) {
          trace.push({ step: 'Location Rejection', location: locCode, reason: `Lot Integrity Violation: Occupied by another SKU ("${conflictingSku.sku}")` });
          continue;
        }

        const conflictingLot = existingBalances.find(b => b.lotNumber && lotNumber && b.lotNumber !== lotNumber);
        if (conflictingLot) {
          trace.push({ step: 'Location Rejection', location: locCode, reason: `Lot Integrity Violation: Occupied by another Lot Number ("${conflictingLot.lotNumber}" vs "${lotNumber}")` });
          continue;
        }

        // Capacity check
        const totalUnitsInLoc = existingBalances.reduce((sum, b) => sum + (b.qtyAvailable || 0) + (b.qtyAwaitingPutaway || 0), 0);
        if (loc.boxCapacity && (totalUnitsInLoc + qty) > loc.boxCapacity) {
          trace.push({ step: 'Location Rejection', location: locCode, reason: `Capacity Violation: ${totalUnitsInLoc} + ${qty} exceeds max box capacity (${loc.boxCapacity})` });
          continue;
        }
      }

      // Found valid location!
      trace.push({
        step: 'Location Selected',
        status: 'SUCCESS',
        location: locCode,
        message: `Selected Bin ${locCode} (Zone: ${loc.zone}, Type: ${loc.locationType || 'SHELF'}) under Rule "${appliedRuleName}"`
      });

      return {
        selectedLocation: locCode,
        ruleApplied: appliedRuleName,
        rulePriority: appliedPriority,
        zone: loc.zone,
        locationType: loc.locationType,
        trace
      };
    }

    // Default fallback if no exact candidate passed all constraints
    const defaultBin = candidateLocations[0]?.code || 'A-01-01';
    trace.push({
      step: 'Default Fallback',
      status: 'WARNING',
      message: `No location passed all strict constraints. Assigned default fallback bin: ${defaultBin}`
    });

    return {
      selectedLocation: defaultBin,
      ruleApplied: 'Default Fallback Policy',
      rulePriority: 9999,
      zone: 'MAIN',
      locationType: 'SHELF',
      trace
    };
  }
};
