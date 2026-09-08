import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/elvis');
  const InventoryValuationLedger = (await import('./models/InventoryValuationLedger.js')).default;
  const total = await InventoryValuationLedger.countDocuments();
  const nullAccounts = await InventoryValuationLedger.countDocuments({ inventoryAssetAccountId: null });
  const hasAccounts = await InventoryValuationLedger.countDocuments({ inventoryAssetAccountId: { $ne: null } });
  
  console.log('Total:', total);
  console.log('Null:', nullAccounts);
  console.log('HasAccount:', hasAccounts);
  
  const unresolved = await InventoryValuationLedger.find({ inventoryAssetAccountId: null }, 'accountingUrn eventType referenceId sku');
  console.log('\nUnresolved URNS:');
  unresolved.forEach(u => console.log(u.accountingUrn));

  process.exit(0);
}
run();
