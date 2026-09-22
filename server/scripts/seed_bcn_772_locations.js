import mongoose from 'mongoose';
import Warehouse from '../models/Warehouse.js';
import Zone from '../models/Zone.js';
import Location from '../models/Location.js';

/**
 * RF-P18: Generates and seeds the exact 772 rack locations for BCN warehouse.
 * Idempotent: checks for existing location codes and only inserts missing ones.
 *
 * Rack distribution:
 * - Aisles A01-A03: 20 racks x 5 levels x 2 bins = 200 bins each (600 total)
 * - Aisle A04: 17 racks x 5 levels x 2 bins + 1 rack (1 level x 2 bins) = 172 bins
 * Total = 772 locations.
 * Levels N01 = 'PICK_FACE', Levels N02-N05 = 'RESERVE'.
 */
export async function seedBCN772Locations({ companyId, warehouseCode = 'BCN' }) {
  if (!companyId) throw new Error('companyId is required to seed BCN locations');

  // 1. Ensure BCN Warehouse exists
  let warehouse = await Warehouse.findOne({ code: warehouseCode, company: companyId });
  if (!warehouse) {
    warehouse = await Warehouse.create({
      code: warehouseCode,
      name: 'Barcelona Distribution Hub',
      location: 'Barcelona, Spain',
      country: 'Spain',
      capacity: 1000,
      used: 0,
      status: 'active',
      temp: 'Ambient',
      blindReceiving: false,
      company: companyId
    });
  }

  // 2. Ensure ESTANTERIAS Zone exists
  let zone = await Zone.findOne({ code: 'ESTANTERIAS', company: companyId });
  if (!zone) {
    zone = await Zone.create({
      code: 'ESTANTERIAS',
      name: 'Zona Estanterias Pallet Racks',
      warehouse: warehouse._id,
      zoneType: 'PALLET_RACK',
      temperature: 'Ambient',
      company: companyId
    });
  }

  // 3. Generate the 772 unique location descriptors
  const locationDescriptors = [];
  const targetCount = 772;

  for (let a = 1; a <= 4; a++) {
    const aisleStr = String(a).padStart(2, '0');
    const maxRacks = a === 4 ? 18 : 20;

    for (let r = 1; r <= maxRacks; r++) {
      const rackStr = String(r).padStart(2, '0');
      const maxLevels = (a === 4 && r === 18) ? 1 : 5;

      for (let n = 1; n <= maxLevels; n++) {
        const levelStr = String(n).padStart(2, '0');
        const locType = n === 1 ? 'PICK_FACE' : 'RESERVE';

        for (let b = 1; b <= 2; b++) {
          if (locationDescriptors.length >= targetCount) break;

          const binStr = String(b).padStart(2, '0');
          const code = `ESTANTERIAS-A${aisleStr}-R${rackStr}-N${levelStr}-B${binStr}`;

          locationDescriptors.push({
            code,
            name: `Rack Pos A${aisleStr}-R${rackStr}-N${levelStr}-B${binStr}`,
            warehouse: warehouse._id,
            zone: zone._id,
            aisle: `A${aisleStr}`,
            shelf: `R${rackStr}`,
            bin: `B${binStr}`,
            locationType: locType,
            type: locType,
            zoneType: 'PALLET_RACK',
            status: 'AVAILABLE',
            capacity: locType === 'PICK_FACE' ? 200 : 1000,
            maxUnits: locType === 'PICK_FACE' ? 200 : 1000,
            maxWeight: locType === 'PICK_FACE' ? 300 : 1200,
            maxVolume: locType === 'PICK_FACE' ? 2 : 5,
            palletCapacity: locType === 'PICK_FACE' ? 0 : 1,
            boxCapacity: locType === 'PICK_FACE' ? 20 : 50,
            active: true,
            company: companyId
          });
        }
        if (locationDescriptors.length >= targetCount) break;
      }
      if (locationDescriptors.length >= targetCount) break;
    }
    if (locationDescriptors.length >= targetCount) break;
  }

  // 4. Idempotent bulk insertion
  const existingCodes = new Set(
    (await Location.find({ company: companyId, code: { $in: locationDescriptors.map(l => l.code) } }).select('code')).map(l => l.code)
  );

  const missingLocations = locationDescriptors.filter(l => !existingCodes.has(l.code));
  if (missingLocations.length > 0) {
    await Location.insertMany(missingLocations, { ordered: false });
  }

  const finalCount = await Location.countDocuments({
    company: companyId,
    code: { $regex: /^ESTANTERIAS-/ }
  });

  return {
    success: true,
    totalExpected: targetCount,
    totalSeeded: missingLocations.length,
    alreadyExisting: existingCodes.size,
    finalCountInDb: finalCount,
    warehouse: warehouse.code,
    zone: zone.code
  };
}
