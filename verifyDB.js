import mongoose from 'mongoose';

const URI = 'mongodb://127.0.0.1:27017/demologistics';

async function verify() {
  console.log("=== CONNECTING TO DB ===");
  await mongoose.connect(URI);
  console.log("Connected.");
  
  const db = mongoose.connection.db;
  
  // 1. List Collections
  console.log("\n=== COLLECTIONS ===");
  const collections = await db.listCollections().toArray();
  const collectionNames = collections.map(c => c.name);
  console.log(collectionNames);

  // 2. Identify newly introduced collections (Document, Location, PutawayTask, StorageRule, Warehouse, Zone, InventoryBalance)
  const required = ['documents', 'locations', 'putawaytasks', 'storagerules', 'warehouses', 'zones', 'inventorybalances'];
  console.log("\n=== REQUIRED COLLECTIONS CHECK ===");
  required.forEach(req => {
    if (collectionNames.includes(req)) {
      console.log(`[OK] ${req} exists`);
    } else {
      console.log(`[MISSING] ${req} is missing!`);
    }
  });

  // 3. Confirm Indexes
  console.log("\n=== INDEXES ===");
  for (const name of required) {
    if (collectionNames.includes(name)) {
      const indexes = await db.collection(name).indexes();
      console.log(`\n-- ${name} indexes:`);
      indexes.forEach(idx => {
         console.log(`  Name: ${idx.name}, Keys: ${JSON.stringify(idx.key)}, Unique: ${!!idx.unique}`);
      });
    }
  }

  // 4. Verify APIs (assuming server is running on localhost:5000, or we can just start the server app)
  console.log("\n=== API VERIFICATION ===");
  // We will run this script separately, the server must be running.
  const endpoints = [
    '/api/v1/warehouses',
    '/api/v1/locations',
    '/api/v1/zones',
    '/api/v1/storage-rules',
    '/api/v1/inventory',
    '/api/v1/notifications',
    '/api/v1/orders'
  ];

  for (const ep of endpoints) {
    try {
      const res = await globalThis.fetch(`http://localhost:5000${ep}`);
      console.log(`[${res.status}] ${ep}`);
    } catch (e) {
      console.log(`[ERROR] ${ep} - ${e.message}`);
    }
  }

  await mongoose.disconnect();
}

verify().catch(console.error);
