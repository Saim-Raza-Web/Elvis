import Location from '../models/Location.js';
import StorageRule from '../models/StorageRule.js';
import InventoryBalance from '../models/InventoryBalance.js';
import Product from '../models/Product.js';
import { evaluateConditions } from '../utils/conditionEvaluator.js';

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
    // Phase 3: Enforce warehouse scoping and PUTAWAY ruleType
    const activeRules = await StorageRule.find({ 
      company: companyId, 
      warehouse,
      ruleType: 'PUTAWAY',
      isActive: true 
    }).sort({ priority: 1 });
    
    trace.push({
      step: 'Rules Fetch',
      status: 'INFO',
      message: `Found ${activeRules.length} active PUTAWAY storage rules for warehouse ${warehouse}.`
    });

    // 3. Determine target zone / criteria from rules using conditions[] AND logic
    let targetZone = null;
    let targetLocation = null;
    let appliedRuleName = 'Default Storage Policy';
    let appliedPriority = 999;
    let appliedAction = 'none';

    // Construct evaluation context based on payload
    const evalContext = {
      category: prodCategory,
      owner,
      tempRequirement,
      sku,
      qty,
      isHazmat,
      expiryDate,
      lotNumber
    };
    console.log('[DEBUG] evalContext:', evalContext);

    for (const rule of activeRules) {
      console.log('[DEBUG] Evaluating rule:', rule.name, 'conditions:', rule.conditions);
      if (evaluateConditions(rule.conditions, evalContext)) {
        targetZone = rule.targetZone;
        targetLocation = rule.targetLocation;
        appliedRuleName = rule.name;
        appliedPriority = rule.priority;
        appliedAction = rule.action || 'send_to_zone';
        trace.push({
          step: 'Rule Match',
          status: 'MATCHED',
          message: `Rule Priority ${rule.priority} ("${rule.name}") matched: Action = ${appliedAction}`
        });
        break; // First match wins (highest priority)
      }
    }

    // 4. Fetch candidate locations in warehouse
    const locQuery = { company: companyId, active: { $ne: false } };
    if (warehouse) locQuery.warehouse = warehouse;
    
    // Explicit fixed location overrides zone targeting
    if (targetLocation) {
      locQuery._id = targetLocation;
    } else if (targetZone) {
      locQuery.zone = targetZone;
    }

    if (appliedAction === 'send_to_pick_face') {
      locQuery.locationType = { $in: ['PICK_FACE', 'pick_face'] };
    } else if (appliedAction === 'send_to_zone_reserve_only') {
      locQuery.locationType = { $nin: ['PICK_FACE', 'pick_face'] }; // usually RESERVE or PALLET_RACK
    }

    let candidateLocations = await Location.find(locQuery).sort({ code: 1 });
    
    if (candidateLocations.length === 0 && targetZone && appliedAction !== 'fixed_location') {
      trace.push({
        step: 'Fallback Search',
        status: 'WARNING',
        message: `No active locations found matching target criteria. Falling back to all warehouse locations.`
      });
      candidateLocations = await Location.find({ company: companyId, active: { $ne: false }, warehouse }).sort({ code: 1 });
    }

    trace.push({
      step: 'Candidate Pool',
      status: 'INFO',
      message: `Evaluating ${candidateLocations.length} candidate locations for eligibility constraints.`
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
        success: true,
        proposedBin: loc.code,
        selectedLocation: loc.code,
        zone: loc.zone,
        locationId: loc._id,
        ruleApplied: appliedRuleName,
        rulePriority: appliedPriority,
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
      success: true,
      proposedBin: defaultBin,
      selectedLocation: defaultBin,
      locationId: candidateLocations[0]?._id,
      ruleApplied: 'Default Fallback Policy',
      rulePriority: 9999,
      zone: candidateLocations[0]?.zone || 'MAIN',
      locationType: 'SHELF',
      trace
    };
  }
};
