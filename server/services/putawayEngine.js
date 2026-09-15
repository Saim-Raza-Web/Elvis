import Location from '../models/Location.js';
import StorageRule from '../models/StorageRule.js';
import InventoryBalance from '../models/InventoryBalance.js';
import Product from '../models/Product.js';
import Customer from '../models/Customer.js';
import Warehouse from '../models/Warehouse.js';
import mongoose from 'mongoose';
import { evaluateConditions } from '../utils/conditionEvaluator.js';

/**
 * Resolves the aggregate static load limit (level_weight_limit) of a rack tier / beam level.
 * Default limits:
 * S1 => 1500 kg
 * S2 => 800 kg
 * S3+ => 300 kg
 * Zero and negative values are invalid.
 */
export function resolveDefaultLevelLimit(loc) {
  if (loc.level_weight_limit !== null && loc.level_weight_limit !== undefined) {
    const limit = Number(loc.level_weight_limit);
    if (!isNaN(limit) && limit > 0) return limit;
  }
  const shelfStr = (loc.shelf || '').toString().trim().toUpperCase();
  let tierNum = null;
  const shelfMatch = shelfStr.match(/^S?(\d+)$/i);
  if (shelfMatch) {
    tierNum = parseInt(shelfMatch[1], 10);
  } else if (loc.code) {
    const codeMatch = String(loc.code).match(/[-_]S(\d+)(?:[-_]|$)/i);
    if (codeMatch) {
      tierNum = parseInt(codeMatch[1], 10);
    }
  }

  if (tierNum === 2) return 800;
  if (tierNum !== null && tierNum >= 3) return 300;
  // Tier 1 (S1), ground, floor, or unassigned default to S1
  return 1500;
}

/**
 * Calculates the active weight of a location derived strictly from active inventory:
 * qtyAvailable + qtyReserved + qtyAwaitingPutaway
 * Quarantined stock (qtyQuarantine) is strictly EXCLUDED.
 * Pallet gross weight = goods weight + 25 kg EUR pallet tare.
 * Missing product weight falls back to 500 kg/pallet and marks evaluation as WEIGHT_UNKNOWN.
 * Does not mutate inventory.
 */
export async function calculateLocationActiveWeight(companyId, locOrCode) {
  const locCode = typeof locOrCode === 'string' ? locOrCode : locOrCode?.code;
  if (!locCode) return { currentWeight: 0, isWeightUnknown: false, activeQty: 0, balances: [] };

  const balances = await InventoryBalance.find({
    company: companyId,
    bin: locCode,
    $or: [
      { qtyAvailable: { $gt: 0 } },
      { qtyReserved: { $gt: 0 } },
      { qtyAwaitingPutaway: { $gt: 0 } }
    ]
  });

  let currentWeight = 0;
  let isWeightUnknown = false;
  let activeQty = 0;

  for (const b of balances) {
    const qty = (b.qtyAvailable || 0) + (b.qtyReserved || 0) + (b.qtyAwaitingPutaway || 0);
    if (qty <= 0) continue;
    activeQty += qty;

    const prod = await Product.findOne({ sku: b.sku, company: companyId });
    const palletWeightKg = prod?.pallet_weight_kg;

    if (palletWeightKg !== null && palletWeightKg !== undefined && Number(palletWeightKg) > 0) {
      // Goods weight + 25 kg EUR pallet tare applied exactly once per pallet
      const grossPalletWeight = Number(palletWeightKg) + 25;
      currentWeight += qty * grossPalletWeight;
    } else {
      // Conservative fallback: 500 kg/pallet marked WEIGHT_UNKNOWN
      currentWeight += qty * 500;
      isWeightUnknown = true;
    }
  }

  return { currentWeight, isWeightUnknown, activeQty, balances };
}

/**
 * Finds all sibling locations sharing the same structural beam level:
 * Same company, warehouse, aisle, and shelf (or beam level prefix).
 */
export async function getSiblingLocationsOnLevel(companyId, loc) {
  if (!loc) return [];
  const query = {
    company: companyId,
    warehouse: loc.warehouse,
    active: { $ne: false }
  };

  if (loc.zone) query.zone = loc.zone;
  if (loc.aisle) query.aisle = loc.aisle;
  if (loc.shelf) query.shelf = loc.shelf;

  if (!loc.shelf) {
    const parts = String(loc.code).split('-');
    if (parts.length >= 3) {
      const prefix = parts.slice(0, parts.length - 1).join('-');
      query.code = new RegExp(`^${prefix}-`);
    } else {
      query._id = loc._id;
    }
  }

  return await Location.find(query);
}

/**
 * DECOUPLED PUTAWAY ENGINE
 * Evaluates candidate destination storage locations strictly for putaway operations.
 * Enforces: Rule Priority (1..N), Lot Integrity (1 Location = 1 Lot + 1 SKU + 1 Owner),
 * Temperature bounds, 3PL Owner restrictions, Capacity/Occupancy limits, Hazmat segregation,
 * FEFO expiry, Individual Location Weight Limits, and Aggregate Rack/Beam Level Weight Limits.
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
    pallets = null,
    isHazmat = false,
    tempRequirement = null,
    qcStatus = null,
    isCrossdock = false,
    palletWeight = null,
    incomingWeight = null,
    isGrossWeight = false,
    abcClass = null,
    excludedLocations = []
  }) => {
    const trace = [];

    // Resolve warehouse ObjectId if code was provided
    let resolvedWarehouseId = null;
    let whCode = warehouse;
    if (warehouse) {
      if (mongoose.Types.ObjectId.isValid(warehouse) && String(warehouse).length === 24) {
        resolvedWarehouseId = warehouse;
        const whDoc = await Warehouse.findById(warehouse);
        if (whDoc) whCode = whDoc.code;
      } else {
        const whDoc = await Warehouse.findOne({ code: warehouse, company: companyId });
        if (whDoc) {
          resolvedWarehouseId = whDoc._id;
          whCode = whDoc.code;
        }
      }
    }

    // Resolve Customer exclusivity flag
    let isExclusiveCustomer = false;
    let customerDoc = null;
    if (owner) {
      customerDoc = await Customer.findOne({ name: owner, company: companyId });
      if (customerDoc && customerDoc.exclusive_client === true) {
        isExclusiveCustomer = true;
      }
    }

    // 1. Fetch product details if not fully provided
    let prodCategory = category;
    let prodQcProfile = '';
    let prodAbcClass = abcClass;
    let prodPalletWeight = palletWeight;
    let prodDoc = null;
    if (sku) {
      prodDoc = await Product.findOne({ sku, company: companyId });
      if (prodDoc) {
        if (!prodCategory) prodCategory = prodDoc.category;
        prodQcProfile = prodDoc.qc_profile || '';
        if (!prodAbcClass) prodAbcClass = prodDoc.abc_class_override || prodDoc.sku_abc_class || 'C';
        if (prodPalletWeight === null && prodDoc.pallet_weight_kg) prodPalletWeight = prodDoc.pallet_weight_kg;
      }
    }

    trace.push({
      step: 'Product Inspection',
      status: 'INFO',
      message: `Evaluating Putaway for SKU: ${sku}, Category: ${prodCategory || 'GEN'}, Owner: ${owner || 'Unassigned'} (Exclusive: ${isExclusiveCustomer}), Lot: ${lotNumber || 'N/A'}`
    });

    // 2. Fetch active storage rules sorted by priority (1 = highest)
    // Enforce warehouse scoping and PUTAWAY ruleType
    const ruleQuery = { 
      company: companyId, 
      ruleType: 'PUTAWAY',
      isActive: true 
    };
    if (resolvedWarehouseId) {
      ruleQuery.warehouse = resolvedWarehouseId;
    }
    const activeRules = await StorageRule.find(ruleQuery).sort({ priority: 1 });
    
    trace.push({
      step: 'Rules Fetch',
      status: 'INFO',
      message: `Found ${activeRules.length} active PUTAWAY storage rules for warehouse ${whCode || 'all'}.`
    });

    // 3. Determine target zone / criteria from rules using conditions[] AND logic
    let targetZone = null;
    let targetLocation = null;
    let appliedRuleName = 'Default Storage Policy';
    let appliedPriority = 999;
    let appliedAction = 'none';

    // Calculate incoming goods & gross weight:
    // For palletized goods: pallet gross weight includes goods weight + 25 kg EUR pallet tare.
    // Tare must be applied exactly once (no double tare).
    // Missing product weight uses conservative fallback: 500 kg per pallet, marked WEIGHT_UNKNOWN.
    let incomingGrossPerPallet = null;
    let isWeightUnknown = false;

    if (incomingWeight !== null && incomingWeight !== undefined && Number(incomingWeight) > 0) {
      if (isGrossWeight) {
        incomingGrossPerPallet = Number(incomingWeight);
      } else {
        // Net goods weight provided -> add 25 kg EUR pallet tare once
        incomingGrossPerPallet = Number(incomingWeight) + 25;
      }
    } else if (palletWeight !== null && palletWeight !== undefined && Number(palletWeight) > 0) {
      if (isGrossWeight) {
        incomingGrossPerPallet = Number(palletWeight);
      } else {
        incomingGrossPerPallet = Number(palletWeight) + 25;
      }
    } else if (prodPalletWeight !== null && prodPalletWeight !== undefined && Number(prodPalletWeight) > 0) {
      if (isGrossWeight) {
        incomingGrossPerPallet = Number(prodPalletWeight);
      } else {
        incomingGrossPerPallet = Number(prodPalletWeight) + 25;
      }
    } else {
      // Conservative fallback: 500 kg/pallet
      incomingGrossPerPallet = 500;
      isWeightUnknown = true;
    }

    let palletCount = 1;
    if (pallets !== undefined && pallets !== null && Number(pallets) > 0) {
      palletCount = Number(pallets);
    } else if (prodDoc?.base_uom === 'PLT' && Number(qty) > 0) {
      palletCount = Number(qty);
    }
    const totalIncomingWeight = incomingGrossPerPallet * palletCount;

    if (isWeightUnknown) {
      trace.push({
        step: 'Weight Evaluation',
        status: 'WEIGHT_UNKNOWN',
        message: `Product weight unavailable. Using conservative fallback: ${totalIncomingWeight} kg (${palletCount} pallet(s) @ 500 kg/pallet).`
      });
    } else {
      trace.push({
        step: 'Weight Evaluation',
        status: 'INFO',
        message: `Incoming gross weight calculated: ${totalIncomingWeight} kg (${palletCount} pallet(s) @ ${incomingGrossPerPallet} kg/pallet, including 25 kg EUR pallet tare).`
      });
    }

    // Construct evaluation context based on payload
    const evalContext = {
      category: prodCategory,
      owner,
      tempRequirement,
      sku,
      qty,
      isHazmat,
      expiryDate,
      lotNumber,
      qcStatus: qcStatus || prodQcProfile,
      isCrossdock,
      palletWeight: prodPalletWeight,
      incomingWeight: totalIncomingWeight,
      abcClass: prodAbcClass,
      isExclusiveClient: isExclusiveCustomer,
      exclusive_client: isExclusiveCustomer
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
    if (resolvedWarehouseId) locQuery.warehouse = resolvedWarehouseId;
    
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

    if (Array.isArray(excludedLocations) && excludedLocations.length > 0) {
      const cleanEx = excludedLocations.map(c => String(c).trim().toUpperCase()).filter(Boolean);
      if (cleanEx.length > 0) {
        locQuery.code = { $nin: cleanEx };
      }
    }

    let candidateLocations = await Location.find(locQuery).sort({ code: 1 });
    
    if (candidateLocations.length === 0 && targetZone && appliedAction !== 'fixed_location') {
      trace.push({
        step: 'Fallback Search',
        status: 'WARNING',
        message: `No active locations found matching target criteria. Falling back to all warehouse locations.`
      });
      const fallbackLocQuery = { company: companyId, active: { $ne: false } };
      if (resolvedWarehouseId) fallbackLocQuery.warehouse = resolvedWarehouseId;
      if (Array.isArray(excludedLocations) && excludedLocations.length > 0) {
        const cleanEx = excludedLocations.map(c => String(c).trim().toUpperCase()).filter(Boolean);
        if (cleanEx.length > 0) {
          fallbackLocQuery.code = { $nin: cleanEx };
        }
      }
      candidateLocations = await Location.find(fallbackLocQuery).sort({ code: 1 });
    }

    trace.push({
      step: 'Candidate Pool',
      status: 'INFO',
      message: `Evaluating ${candidateLocations.length} candidate locations for eligibility constraints.`
    });

    // 5. Evaluate each location against physical constraints & Lot Integrity
    for (const loc of candidateLocations) {
      const locCode = loc.code;

      if (Array.isArray(excludedLocations) && excludedLocations.some(e => String(e).trim().toUpperCase() === String(locCode).trim().toUpperCase())) {
        continue;
      }

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

      // Exclusion B: Owner Restrictions & Customer Exclusivity
      if (owner && Array.isArray(loc.allowedOwners) && loc.allowedOwners.length > 0) {
        if (!loc.allowedOwners.includes(owner)) {
          trace.push({ step: 'Location Rejection', location: locCode, reason: `Owner "${owner}" not in allowed owners list [${loc.allowedOwners.join(', ')}]` });
          continue;
        }
      }

      // Check if location is assigned to an exclusive client in allowedOwners
      if (Array.isArray(loc.allowedOwners) && loc.allowedOwners.length > 0) {
        const otherOwners = loc.allowedOwners.filter(o => o !== owner);
        if (otherOwners.length > 0) {
          const exclusiveOther = await Customer.findOne({
            company: companyId,
            name: { $in: otherOwners },
            exclusive_client: true
          });
          if (exclusiveOther) {
            trace.push({ step: 'Location Rejection', location: locCode, reason: `Location assigned to exclusive client "${exclusiveOther.name}". Cannot be used by "${owner || 'unassigned'}".` });
            continue;
          }
        }
      }

      // If incoming customer has exclusive_client === true:
      if (isExclusiveCustomer) {
        const allBalancesInLoc = await InventoryBalance.find({
          company: companyId,
          bin: locCode,
          $or: [
            { qtyAvailable: { $gt: 0 } },
            { qtyReserved: { $gt: 0 } },
            { qtyAwaitingPutaway: { $gt: 0 } },
            { qtyQuarantine: { $gt: 0 } }
          ]
        });
        const conflictingOccupant = allBalancesInLoc.find(b => b.owner && b.owner !== owner);
        if (conflictingOccupant) {
          trace.push({ step: 'Location Rejection', location: locCode, reason: `Exclusive client "${owner}" cannot use location occupied by "${conflictingOccupant.owner}".` });
          continue;
        }
      } else {
        // If incoming customer is NOT exclusive:
        const allBalancesInLoc = await InventoryBalance.find({
          company: companyId,
          bin: locCode,
          $or: [
            { qtyAvailable: { $gt: 0 } },
            { qtyReserved: { $gt: 0 } },
            { qtyAwaitingPutaway: { $gt: 0 } },
            { qtyQuarantine: { $gt: 0 } }
          ]
        });
        if (allBalancesInLoc.length > 0) {
          const activeOwners = [...new Set(allBalancesInLoc.map(b => b.owner).filter(Boolean))];
          const exclusiveOccupant = await Customer.findOne({
            company: companyId,
            name: { $in: activeOwners },
            exclusive_client: true
          });
          if (exclusiveOccupant) {
            trace.push({ step: 'Location Rejection', location: locCode, reason: `Location holds stock of exclusive client "${exclusiveOccupant.name}". Non-exclusive owner cannot use this location.` });
            continue;
          }
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

      // Exclusion E: Weight Limits (Individual Location & Aggregate Level)
      // 1. Determine current location weight derived from active inventory
      const { currentWeight: currentLocWeight, isWeightUnknown: locWeightUnknown } = await calculateLocationActiveWeight(companyId, loc.code);
      if (locWeightUnknown) isWeightUnknown = true;

      // 2. Validate individual location limit (max_weight_kg or legacy weight_limit)
      const locLimit = (loc.max_weight_kg !== null && loc.max_weight_kg !== undefined && loc.max_weight_kg > 0)
        ? loc.max_weight_kg
        : (loc.weight_limit !== null && loc.weight_limit !== undefined && loc.weight_limit > 0)
          ? loc.weight_limit
          : (loc.weightCapacity || loc.maxWeight || 1000);

      if ((currentLocWeight + totalIncomingWeight) > locLimit) {
        trace.push({
          step: 'Location Rejection',
          location: locCode,
          reason: `Individual Weight Limit Exceeded: current ${currentLocWeight}kg + incoming ${totalIncomingWeight}kg > max_weight_kg ${locLimit}kg`
        });
        continue;
      }

      // 3. Determine structural level and validate aggregate level static load limit
      const levelLimit = resolveDefaultLevelLimit(loc);
      const siblingLocations = await getSiblingLocationsOnLevel(companyId, loc);

      let currentLevelWeight = 0;
      for (const sib of siblingLocations) {
        const { currentWeight: sibWeight, isWeightUnknown: sibWeightUnknown } = await calculateLocationActiveWeight(companyId, sib.code);
        currentLevelWeight += sibWeight;
        if (sibWeightUnknown) isWeightUnknown = true;
      }

      if ((currentLevelWeight + totalIncomingWeight) > levelLimit) {
        trace.push({
          step: 'Location Rejection',
          location: locCode,
          reason: `Aggregate Level Weight Limit Exceeded: level current ${currentLevelWeight}kg + incoming ${totalIncomingWeight}kg > level_weight_limit ${levelLimit}kg`
        });
        continue;
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
        incomingWeight: totalIncomingWeight,
        weightStatus: isWeightUnknown ? 'WEIGHT_UNKNOWN' : 'KNOWN',
        isWeightUnknown,
        currentLocationWeight: currentLocWeight,
        currentLevelWeight,
        maxWeightKg: locLimit,
        levelWeightLimit: levelLimit,
        trace
      };
    }

    // When no candidate passed all constraints, do not assign a rejected location
    trace.push({
      step: 'Evaluation Complete',
      status: 'WARNING',
      message: `No eligible location passed all strict constraints under Rule "${appliedRuleName}".`
    });

    return {
      success: false,
      proposedBin: null,
      selectedLocation: null,
      locationId: null,
      ruleApplied: appliedRuleName,
      rulePriority: appliedPriority,
      zone: targetZone || null,
      locationType: null,
      incomingWeight: totalIncomingWeight,
      weightStatus: isWeightUnknown ? 'WEIGHT_UNKNOWN' : 'KNOWN',
      isWeightUnknown,
      message: 'No eligible location found meeting all constraints',
      trace
    };
  }
};
