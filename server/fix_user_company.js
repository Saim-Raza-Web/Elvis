import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import User from './models/User.js';
import Company from './models/Company.js';

async function fixUserCompany() {
  await mongoose.connect(process.env.MONGO_URI);
  const mainCompany = await Company.findOne({ name: 'House Logistic S.L.' });
  if (!mainCompany) {
    console.log('Main company not found');
    return;
  }
  const res = await User.updateMany(
    { company: { $in: [null, undefined] } },
    { $set: { company: mainCompany._id, role: 'admin' } }
  );
  console.log('Updated users with missing company:', res.modifiedCount);
  await mongoose.disconnect();
}

fixUserCompany().catch(console.error);
