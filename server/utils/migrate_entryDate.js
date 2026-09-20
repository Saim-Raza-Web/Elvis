import mongoose from 'mongoose';
import InventoryBalance from '../models/InventoryBalance.js';
import InventoryTransaction from '../models/InventoryTransaction.js';

export const migrateEntryDate = async (options = { dryRun: true }) => {
  const isDryRun = options.dryRun;
  console.log(`--- Starting RF-P08 entryDate Migration (Dry Run: ${isDryRun}) ---`);
  
  // Find balances missing entryDate
  const balances = await InventoryBalance.find({ entryDate: { $exists: false } });
  console.log(`Found ${balances.length} InventoryBalance records missing entryDate.`);
  
  let migratedCount = 0;
  let derivedCount = 0;
  let fallbackCount = 0;
  let skippedCount = 0;

  for (const bal of balances) {
    // Attempt to derive from historical receiving transaction
    const receiptTxn = await InventoryTransaction.findOne({
      sku: bal.sku,
      company: bal.company,
      lotNumber: bal.lotNumber,
      owner: bal.owner,
      type: { $in: ['RECEIVING', 'INBOUND_ASN', 'RETURN'] } // Types that constitute true entry
    }).sort({ createdAt: 1 });

    let finalEntryDate;
    
    if (receiptTxn && receiptTxn.createdAt) {
      finalEntryDate = receiptTxn.createdAt;
      derivedCount++;
    } else {
      // Fallback heuristic
      finalEntryDate = bal.createdAt || new Date();
      fallbackCount++;
    }

    // Atomic update
    if (!isDryRun) {
      await InventoryBalance.updateOne(
        { _id: bal._id },
        { $set: { entryDate: finalEntryDate } }
      );
      migratedCount++;
    } else {
      skippedCount++; // In dry run, all mutations are skipped
    }
  }

  console.log(`Migration Complete! Total Processed/Updated: ${migratedCount}`);
  console.log(`Derived from Transaction History: ${derivedCount}`);
  console.log(`Fallback to Document createdAt: ${fallbackCount}`);
  console.log(`Skipped (Dry Run): ${skippedCount}`);
  return { migratedCount, derivedCount, fallbackCount, skippedCount };
};

if (process.argv[1] && process.argv[1].includes('migrate_entryDate.js')) {
  const isProdEnv = process.env.NODE_ENV === 'production';
  const forceExecute = process.argv.includes('--execute');
  
  if (isProdEnv) {
    console.error('ERROR: Execution against the production environment is strictly prohibited in this phase.');
    process.exit(1);
  }

  mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/elvis_wms')
    .then(async () => {
      await migrateEntryDate({ dryRun: !forceExecute });
      process.exit(0);
    })
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}
