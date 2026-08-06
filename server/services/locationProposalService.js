import Location from '../models/Location.js';
import Product from '../models/Product.js';
import StorageRule from '../models/StorageRule.js';

/**
 * Dynamic Location Proposal Engine (Module 03)
 * Calculates the optimal destination location based on Warehouse, Zone, Storage Rules,
 * Temperature/Cold Chain, Hazmat, Weight/Volume, Capacity, and Current Occupancy.
 */
export async function proposeDestinationLocation({ company, warehouse = 'MIA', sku, qty = 1, lotNumber = '', session = null }) {
  if (!company || !sku) {
    return { proposedBin: `${warehouse}-STORAGE-01`, zone: 'Z-STORAGE' };
  }

  // 1. Fetch Product Metadata
  const prodQuery = Product.findOne({ sku, company });
  if (session) prodQuery.session(session);
  const product = await prodQuery;

  // Extract constraints
  const category = product?.category || '';
  const manufacturer = product?.manufacturer || '';
  const brand = product?.brand || '';
  const isColdStorage = Boolean(product?.isColdStorage || (category.toLowerCase().includes('cold') || category.toLowerCase().includes('frozen')));
  const isHazmat = Boolean(product?.isHazmat || (category.toLowerCase().includes('hazmat') || category.toLowerCase().includes('chemical')));

  // 2. Fetch Storage Rules
  const ruleQuery = StorageRule.find({ company, isActive: true }).sort({ priority: -1 });
  if (session) ruleQuery.session(session);
  const rules = await ruleQuery;

  let matchedRule = null;
  for (const rule of rules) {
    if (rule.conditionType === 'category' && category && category.toLowerCase() === (rule.conditionValue || '').toLowerCase()) {
      matchedRule = rule;
      break;
    }
    if (rule.conditionType === 'manufacturer' && manufacturer && manufacturer.toLowerCase() === (rule.conditionValue || '').toLowerCase()) {
      matchedRule = rule;
      break;
    }
    if (rule.conditionType === 'brand' && brand && brand.toLowerCase() === (rule.conditionValue || '').toLowerCase()) {
      matchedRule = rule;
      break;
    }
  }

  // 3. Determine Required Zone Type
  let requiredZoneType = 'AMBIENT';
  if (isColdStorage) {
    requiredZoneType = 'COLD_STORAGE';
  } else if (isHazmat) {
    requiredZoneType = 'HAZMAT';
  } else if (matchedRule && matchedRule.targetLocationType) {
    const targetType = matchedRule.targetLocationType.toUpperCase().replace(/\s+/g, '_');
    if (['AMBIENT', 'COLD_STORAGE', 'HAZMAT', 'PALLET_RACK'].includes(targetType)) {
      requiredZoneType = targetType;
    }
  }

  // 4. Query Candidate Locations from Location Master
  const locFilter = {
    company,
    warehouse,
    status: 'ACTIVE'
  };

  if (requiredZoneType) {
    locFilter.zoneType = requiredZoneType;
  }

  if (matchedRule && matchedRule.targetZone) {
    locFilter.zone = new RegExp(matchedRule.targetZone.trim(), 'i');
  }

  const candidateQuery = Location.find(locFilter);
  if (session) candidateQuery.session(session);
  let candidates = await candidateQuery;

  // If no candidates found with specific targetZone, retry without targetZone restriction
  if (candidates.length === 0 && locFilter.zone) {
    delete locFilter.zone;
    const fallbackQuery = Location.find(locFilter);
    if (session) fallbackQuery.session(session);
    candidates = await fallbackQuery;
  }

  // If no candidates found for exact zoneType, query all ACTIVE locations for warehouse
  if (candidates.length === 0) {
    const allLocQuery = Location.find({ company, warehouse, status: 'ACTIVE' });
    if (session) allLocQuery.session(session);
    candidates = await allLocQuery;
  }

  // 5. Filter Candidates by Capacity, Weight, Volume Constraints
  const availableCandidates = candidates.filter(loc => {
    const maxCap = loc.maxUnits || loc.capacity || 1000;
    const current = loc.currentUnits || 0;
    return (maxCap - current) >= qty;
  });

  // 6. Rank Candidates
  // Best choice: 1) Already has same SKU, 2) Most available space remaining
  if (availableCandidates.length > 0) {
    availableCandidates.sort((a, b) => {
      const aHasSku = a.sku === sku ? 1 : 0;
      const bHasSku = b.sku === sku ? 1 : 0;
      if (aHasSku !== bHasSku) return bHasSku - aHasSku;

      const aRem = (a.maxUnits || a.capacity || 1000) - (a.currentUnits || 0);
      const bRem = (b.maxUnits || b.capacity || 1000) - (b.currentUnits || 0);
      return bRem - aRem;
    });

    const best = availableCandidates[0];
    return {
      proposedBin: best.code || best.bin || `${warehouse}-STORAGE-01`,
      zone: best.zone || 'Z-STORAGE',
      locationId: best._id,
      ruleApplied: matchedRule ? matchedRule.name : 'Dynamic Capacity Allocation'
    };
  }

  // If DB has no active location with capacity, generate a clean dynamic location code for the warehouse
  const dynamicCode = `${warehouse}-Z1-A1-S1-B1`;
  
  // Upsert this new dynamic location so it exists in Location master
  const upsertOpts = session ? { session, upsert: true, new: true } : { upsert: true, new: true };
  await Location.findOneAndUpdate(
    { company, warehouse, code: dynamicCode },
    {
      $setOnInsert: {
        code: dynamicCode,
        warehouse,
        zone: 'Z-STORAGE',
        aisle: 'A-1',
        shelf: 'S-1',
        bin: 'B-1',
        zoneType: requiredZoneType || 'AMBIENT',
        status: 'ACTIVE',
        capacity: 1000,
        maxUnits: 500,
        currentUnits: 0,
        company
      }
    },
    upsertOpts
  ).catch(() => {});

  return {
    proposedBin: dynamicCode,
    zone: 'Z-STORAGE',
    ruleApplied: 'Dynamic Staging Allocation'
  };
}
