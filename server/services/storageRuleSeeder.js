import mongoose from 'mongoose';
import StorageRule from '../models/StorageRule.js';
import Zone from '../models/Zone.js';
import Warehouse from '../models/Warehouse.js';

/**
 * CANONICAL 11 HOUSE LOGISTIC STORAGE RULES SPECIFICATION (STAGE 2 FREEZE)
 * Legacy aliases (HIGH-01..04, MED-01..04) are NOT persisted.
 * Exactly 11 canonical rules with sequential priorities 1..11.
 */
export const CANONICAL_RULES_SPEC = [
  {
    code: 'CRIT-01',
    name: 'QC Quarantine Isolation',
    description: 'Mandatory quarantine isolation for lots failing or pending quality control inspection',
    priority: 1,
    ruleType: 'PUTAWAY',
    isDefault: true,
    isActive: true,
    conditions: [
      { field: 'qc_status', operator: 'is', value: 'Quarantine' }
    ],
    action: 'send_to_quarantine',
    strategy: 'Manual',
    targetZoneType: 'QUARANTINE'
  },
  {
    code: 'CRIT-02',
    name: 'Urgent Cross-Docking',
    description: 'Priority cross-dock allocation directly to outbound shipment buffer',
    priority: 2,
    ruleType: 'PUTAWAY',
    isDefault: true,
    isActive: true,
    conditions: [
      { field: 'is_crossdock', operator: 'yes', value: true }
    ],
    action: 'cross_dock',
    strategy: 'FIFO',
    targetZoneType: 'CROSSDOCK'
  },
  {
    code: 'CRIT-03',
    name: 'Frozen Cold Chain',
    description: 'Strict sub-zero temperature isolation (-18°C or below)',
    priority: 3,
    ruleType: 'PUTAWAY',
    isDefault: true,
    isActive: true,
    conditions: [
      { field: 'temperature', operator: 'is', value: 'frozen_minus18' }
    ],
    action: 'send_to_zone',
    strategy: 'FIFO',
    targetZoneType: 'COLD_STORAGE'
  },
  {
    code: 'CRIT-04',
    name: 'Chilled Cold Chain',
    description: 'Refrigerated cold chain isolation (2°C to 8°C)',
    priority: 4,
    ruleType: 'PUTAWAY',
    isDefault: true,
    isActive: true,
    conditions: [
      { field: 'temperature', operator: 'is', value: 'chilled_2_8' }
    ],
    action: 'send_to_zone',
    strategy: 'FIFO',
    targetZoneType: 'COLD_STORAGE'
  },
  {
    code: 'CRIT-05',
    name: 'Hazardous Materials',
    description: 'Dedicated chemical and hazmat containment segregation',
    priority: 5,
    ruleType: 'PUTAWAY',
    isDefault: true,
    isActive: true,
    conditions: [
      { field: 'hazmat_class', operator: 'in_list', value: ['CHEMICAL', 'HAZMAT'] }
    ],
    action: 'send_to_zone',
    strategy: 'Manual',
    targetZoneType: 'HAZMAT'
  },
  {
    code: 'HL-01',
    name: 'Heavy Pallet Floor Tier',
    description: 'Pallets over 600kg restricted to Level 1 / Floor tier for structural rack safety',
    priority: 6,
    ruleType: 'PUTAWAY',
    isDefault: true,
    isActive: true,
    conditions: [
      { field: 'pallet_weight', operator: 'greater_than', value: 600 }
    ],
    action: 'send_to_zone',
    strategy: 'Nearest',
    targetZoneType: 'PALLET_RACK'
  },
  {
    code: 'HL-02',
    name: 'High-Rotation Star SKUs',
    description: 'Fast-moving ABC Class A items slotted to pick-face locations (Levels S1-S2)',
    priority: 7,
    ruleType: 'PUTAWAY',
    isDefault: true,
    isActive: true,
    conditions: [
      { field: 'abc_class', operator: 'is', value: 'A' }
    ],
    action: 'send_to_pick_face',
    strategy: 'Fill_first',
    targetZoneType: 'PALLET_RACK'
  },
  {
    code: 'HL-03',
    name: 'Dedicated 3PL Client',
    description: 'Dedicated client storage zone for exclusive clients',
    priority: 8,
    ruleType: 'PUTAWAY',
    isDefault: true,
    isActive: true,
    conditions: [
      { field: 'owner', operator: 'is', value: 'exclusive_client' }
    ],
    action: 'send_to_zone',
    strategy: 'Consolidate',
    targetZoneType: 'PALLET_RACK'
  },
  {
    code: 'HL-04',
    name: 'Returns & RTV Staging',
    description: 'Dedicated staging for customer returns and return-to-vendor processing',
    priority: 9,
    ruleType: 'PUTAWAY',
    isDefault: true,
    isActive: true,
    conditions: [
      { field: 'product_category', operator: 'is', value: 'Returns' }
    ],
    action: 'send_to_zone',
    strategy: 'Manual',
    targetZoneType: 'AMBIENT'
  },
  {
    code: 'HL-05',
    name: 'Perishable Lot Expiry',
    description: 'Perishable products with expiry dates enforced under FEFO rotation',
    priority: 10,
    ruleType: 'PUTAWAY',
    isDefault: true,
    isActive: true,
    conditions: [
      { field: 'has_lot_expiry', operator: 'yes', value: true }
    ],
    action: 'send_to_zone',
    strategy: 'FEFO',
    targetZoneType: 'PALLET_RACK'
  },
  {
    code: 'DEFAULT',
    name: 'Ambient Catch-All Fallback',
    description: 'Default ambient storage policy when no prior priority rules match',
    priority: 11,
    ruleType: 'PUTAWAY',
    isDefault: true,
    isActive: true,
    conditions: [], // Catch-all: always matches
    action: 'send_to_zone',
    strategy: 'Nearest',
    targetZoneType: 'AMBIENT'
  }
];

/**
 * Idempotently seeds the 11 Canonical Storage Rules for a given company and warehouse.
 * - Creates missing rules.
 * - Updates existing default rules to match frozen spec while preserving any custom targetZone assignments.
 * - Preserves custom tenant-created rules (isDefault === false).
 */
export async function seedCanonicalStorageRules({ companyId, warehouseId, overwriteCustom = false }) {
  if (!companyId) throw new Error('companyId is required for storage rule seeding');
  if (!warehouseId) throw new Error('warehouseId is required for storage rule seeding');

  // Verify warehouse belongs to company
  const wh = await Warehouse.findOne({ _id: warehouseId, company: companyId });
  if (!wh) {
    throw new Error(`Warehouse ${warehouseId} does not belong to company ${companyId}`);
  }

  // Pre-fetch candidate zones in this warehouse to link targetZone where available
  const zones = await Zone.find({ company: companyId, warehouse: warehouseId });
  const zoneByType = new Map();
  for (const z of zones) {
    if (z.type && !zoneByType.has(z.type.toUpperCase())) {
      zoneByType.set(z.type.toUpperCase(), z._id);
    }
    if (z.code) {
      zoneByType.set(z.code.toUpperCase(), z._id);
    }
  }

  const results = {
    created: 0,
    updated: 0,
    skipped: 0,
    rules: []
  };

  for (const ruleDef of CANONICAL_RULES_SPEC) {
    const existing = await StorageRule.findOne({
      company: companyId,
      warehouse: warehouseId,
      ruleType: ruleDef.ruleType,
      code: ruleDef.code
    });

    // Determine targetZone if available
    let resolvedTargetZone = null;
    if (ruleDef.targetZoneType && zoneByType.has(ruleDef.targetZoneType)) {
      resolvedTargetZone = zoneByType.get(ruleDef.targetZoneType);
    }

    if (!existing) {
      // Check priority collision
      const priorityCollision = await StorageRule.findOne({
        company: companyId,
        warehouse: warehouseId,
        ruleType: ruleDef.ruleType,
        priority: ruleDef.priority
      });

      let rulePriority = ruleDef.priority;
      if (priorityCollision) {
        // If an existing custom rule has this priority, adjust safely
        const highest = await StorageRule.findOne({
          company: companyId,
          warehouse: warehouseId,
          ruleType: ruleDef.ruleType
        }).sort({ priority: -1 });
        rulePriority = (highest?.priority || 100) + 1;
      }

      const created = await StorageRule.create({
        code: ruleDef.code,
        name: ruleDef.name,
        description: ruleDef.description,
        priority: rulePriority,
        ruleType: ruleDef.ruleType,
        isDefault: true,
        isActive: ruleDef.isActive,
        conditions: ruleDef.conditions,
        action: ruleDef.action,
        strategy: ruleDef.strategy,
        targetZone: resolvedTargetZone,
        warehouse: warehouseId,
        company: companyId
      });

      results.created++;
      results.rules.push(created);
    } else {
      // Rule already exists: Check if it is a default rule or tenant customized
      if (existing.isDefault || overwriteCustom) {
        existing.name = ruleDef.name;
        existing.description = ruleDef.description;
        existing.priority = ruleDef.priority;
        existing.conditions = ruleDef.conditions;
        existing.action = ruleDef.action;
        existing.strategy = ruleDef.strategy;
        existing.isActive = ruleDef.isActive;
        existing.isDefault = true;
        if (!existing.targetZone && resolvedTargetZone) {
          existing.targetZone = resolvedTargetZone;
        }
        await existing.save();
        results.updated++;
        results.rules.push(existing);
      } else {
        // Preserved tenant customization
        results.skipped++;
        results.rules.push(existing);
      }
    }
  }

  return results;
}
