import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function checkDb() {
  await mongoose.connect(process.env.MONGO_URI);

  const Order = mongoose.model('Order', new mongoose.Schema({}, { strict: false }), 'orders');
  const ActivityLog = mongoose.model('ActivityLog', new mongoose.Schema({}, { strict: false }), 'activitylogs');
  const Counter = mongoose.model('Counter', new mongoose.Schema({}, { strict: false }), 'counters');

  const orders = await Order.find().sort({ createdAt: -1 }).limit(5);
  console.log('=== LATEST ORDERS IN MONGODB ===');
  console.log(JSON.stringify(orders, null, 2));

  const logs = await ActivityLog.find({ module: { $in: ['Orders', 'Documents'] } }).sort({ createdAt: -1 }).limit(10);
  console.log('\n=== LATEST ACTIVITY LOGS IN MONGODB ===');
  console.log(JSON.stringify(logs, null, 2));

  const counters = await Counter.find();
  console.log('\n=== COUNTERS IN MONGODB ===');
  console.log(JSON.stringify(counters, null, 2));

  await mongoose.disconnect();
}

checkDb().catch(console.error);
