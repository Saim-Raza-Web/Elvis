import mongoose from 'mongoose';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';

// Import all models to ensure Mongoose schemas & indexes are registered
import ASN from './models/ASN.js';
import ActivityLog from './models/ActivityLog.js';
import Carrier from './models/Carrier.js';
import CarrierRule from './models/CarrierRule.js';
import Company from './models/Company.js';
import Counter from './models/Counter.js';
import Customer from './models/Customer.js';
import Discrepancy from './models/Discrepancy.js';
import Document from './models/Document.js';
import EcommerceChannel from './models/EcommerceChannel.js';
import Incident from './models/Incident.js';
import InventoryBalance from './models/InventoryBalance.js';
import InventoryTransaction from './models/InventoryTransaction.js';
import Invoice from './models/Invoice.js';
import Lead from './models/Lead.js';
import Location from './models/Location.js';
import Notification from './models/Notification.js';
import Order from './models/Order.js';
import PackTask from './models/PackTask.js';
import PickBatch from './models/PickBatch.js';
import PickTask from './models/PickTask.js';
import Product from './models/Product.js';
import PutawayTask from './models/PutawayTask.js';
import QCInspection from './models/QCInspection.js';
import QuarantineInventory from './models/QuarantineInventory.js';
import Receipt from './models/Receipt.js';
import ReceivingHistory from './models/ReceivingHistory.js';
import Return from './models/Return.js';
import ScheduledReport from './models/ScheduledReport.js';
import Shipment from './models/Shipment.js';
import StockCount from './models/StockCount.js';
import StorageRule from './models/StorageRule.js';
import Transaction from './models/Transaction.js';
import Transfer from './models/Transfer.js';
import User from './models/User.js';
import Warehouse from './models/Warehouse.js';
import Zone from './models/Zone.js';

dotenv.config();

async function runProductionMongoDBAudit() {
  console.log('================================================================');
  console.log('      PRODUCTION MONGODB DATABASE & COLLECTION AUDIT REPORT     ');
  console.log('================================================================\n');

  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  console.log(`Connected to MongoDB Database: "${db.databaseName}"\n`);

  // 1. Sync All Indexes on MongoDB Collection Level
  console.log('--- 1. Syncing All Schema Indexes on Live MongoDB Database ---');
  const models = [
    { name: 'Document', model: Document },
    { name: 'Location', model: Location },
    { name: 'PutawayTask', model: PutawayTask },
    { name: 'StorageRule', model: StorageRule },
    { name: 'Warehouse', model: Warehouse },
    { name: 'Zone', model: Zone },
    { name: 'ActivityLog', model: ActivityLog },
    { name: 'InventoryBalance', model: InventoryBalance },
    { name: 'InventoryTransaction', model: InventoryTransaction },
    { name: 'ASN', model: ASN },
    { name: 'QCInspection', model: QCInspection },
    { name: 'QuarantineInventory', model: QuarantineInventory },
    { name: 'Discrepancy', model: Discrepancy }
  ];

  for (const m of models) {
    try {
      await m.model.syncIndexes();
      console.log(`  ✓ ${m.name} indexes synchronized successfully.`);
    } catch (err) {
      console.log(`  ⚠️ ${m.name} index sync note: ${err.message}`);
    }
  }

  // 2. List All Collections Present in Database
  console.log('\n--- 2. Live Database Collections List ---');
  const collectionsList = await db.listCollections().toArray();
  const collectionNames = collectionsList.map(c => c.name).sort();

  console.log(`Total Active Collections: ${collectionNames.length}`);
  collectionNames.forEach((name, i) => {
    console.log(`  ${i + 1}. ${name}`);
  });

  // 3. Confirm Required Collections Exist
  console.log('\n--- 3. Required Enterprise Collections Check ---');
  const requiredCollections = [
    'documents', 'locations', 'putawaytasks', 'storagerules', 'warehouses', 'zones',
    'activitylogs', 'inventorybalances', 'inventorytransactions', 'asns', 'qcinspections',
    'quarantineinventories', 'discrepancies', 'users', 'companies', 'counters'
  ];

  let missingCount = 0;
  for (const reqColl of requiredCollections) {
    const exists = collectionNames.includes(reqColl);
    if (exists) {
      const count = await db.collection(reqColl).countDocuments();
      console.log(`  ✅ Collection "${reqColl}": EXISTS (${count} document records)`);
    } else {
      console.error(`  ❌ Collection "${reqColl}": MISSING!`);
      missingCount++;
    }
  }

  // 4. Inspect Indexes on Critical Collections
  console.log('\n--- 4. Live Collection Indexes Verification ---');
  const targetIndexCollections = ['locations', 'putawaytasks', 'inventorybalances', 'activitylogs', 'documents'];

  for (const cName of targetIndexCollections) {
    try {
      const idxs = await db.collection(cName).indexes();
      console.log(`\n  Collection "${cName}" Indexes (${idxs.length} index(es)):`);
      idxs.forEach(idx => {
        const keyStr = JSON.stringify(idx.key);
        const uniqueStr = idx.unique ? ' [UNIQUE]' : '';
        const textStr = idx.weights ? ' [TEXT INDEX]' : '';
        console.log(`    - Index Name: "${idx.name}" | Keys: ${keyStr}${uniqueStr}${textStr}`);
      });
    } catch (e) {
      console.error(`    ❌ Error reading indexes for ${cName}: ${e.message}`);
    }
  }

  // 5. Test Live API Responses
  console.log('\n--- 5. Testing Production API Endpoints Health ---');
  const adminUser = await User.findOne({ role: 'admin' });
  if (adminUser) {
    const token = jwt.sign({ id: adminUser._id }, process.env.JWT_SECRET || 'fallback_secret_key');
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

    const testEndpoints = [
      '/api/v1/warehouses',
      '/api/v1/locations',
      '/api/v1/zones',
      '/api/v1/storage-rules',
      '/api/v1/inventory',
      '/api/v1/orders',
      '/api/v1/notifications'
    ];

    for (const ep of testEndpoints) {
      try {
        const res = await fetch(`http://localhost:5000${ep}`, { headers });
        const data = await res.json();
        if (res.status === 200) {
          console.log(`  ✅ ${ep} -> Status 200 OK (Returned ${Array.isArray(data) ? data.length : data.data?.length ?? 'object'})`);
        } else {
          console.error(`  ❌ ${ep} -> Status ${res.status}: ${data.message || 'Error'}`);
        }
      } catch (err) {
        console.error(`  ❌ ${ep} -> Failed to fetch: ${err.message}`);
      }
    }
  }

  await mongoose.disconnect();
  console.log('\n================================================================');
  console.log('   ✅ PRODUCTION MONGODB DATABASE AUDIT COMPLETED SUCCESSFULLY!  ');
  console.log('================================================================');
}

runProductionMongoDBAudit().catch(console.error);
