import fs from 'fs';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';

dotenv.config();

async function testPdfGeneration() {
  await mongoose.connect(process.env.MONGO_URI);

  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }), 'users');
  const Order = mongoose.model('Order', new mongoose.Schema({}, { strict: false }), 'orders');
  const ActivityLog = mongoose.model('ActivityLog', new mongoose.Schema({}, { strict: false }), 'activitylogs');

  const adminUser = await User.findOne({ role: 'admin' });
  if (!adminUser) {
    console.error('No admin user found!');
    process.exit(1);
  }

  const token = jwt.sign({ id: adminUser._id }, process.env.JWT_SECRET || 'fallback_secret_key');

  const b2cOrder = await Order.findOne({ orderId: 'ORD-000001' });
  const b2bOrder = await Order.findOne({ orderId: 'ORD-000002' });

  console.log('Testing PDF delivery note for B2C order:', b2cOrder._id);
  const b2cRes = await fetch(`http://localhost:5000/api/v1/documents/delivery-note/${b2cOrder._id}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log('B2C DN HTTP Status:', b2cRes.status, 'Content-Type:', b2cRes.headers.get('content-type'));
  const b2cBuffer = await b2cRes.arrayBuffer();
  fs.writeFileSync('d:/Elvis Project/server/b2c_delivery_note.pdf', Buffer.from(b2cBuffer));
  console.log('Saved b2c_delivery_note.pdf, size:', b2cBuffer.byteLength, 'bytes');

  console.log('\nTesting PDF delivery note for B2B order:', b2bOrder._id);
  const b2bRes = await fetch(`http://localhost:5000/api/v1/documents/delivery-note/${b2bOrder._id}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log('B2B DN HTTP Status:', b2bRes.status, 'Content-Type:', b2bRes.headers.get('content-type'));
  const b2bBuffer = await b2bRes.arrayBuffer();
  fs.writeFileSync('d:/Elvis Project/server/b2b_delivery_note.pdf', Buffer.from(b2bBuffer));
  console.log('Saved b2b_delivery_note.pdf, size:', b2bBuffer.byteLength, 'bytes');

  // Re-fetch orders to check assigned delivery_note_number
  const b2cUpdated = await Order.findById(b2cOrder._id);
  const b2bUpdated = await Order.findById(b2bOrder._id);

  console.log('\n=== ASSIGNED DELIVERY NOTE NUMBERS ===');
  console.log('B2C Order DN Number:', b2cUpdated.delivery_note_number);
  console.log('B2B Order DN Number:', b2bUpdated.delivery_note_number);

  const dnLogs = await ActivityLog.find({ action: { $in: ['GENERATE_DELIVERY_NOTE', 'REPRINT_DELIVERY_NOTE'] } }).sort({ createdAt: -1 });
  console.log('\n=== DELIVERY NOTE ACTIVITY LOGS ===');
  dnLogs.forEach(l => console.log(l.action, '-', l.detail));

  await mongoose.disconnect();
}

testPdfGeneration().catch(console.error);
