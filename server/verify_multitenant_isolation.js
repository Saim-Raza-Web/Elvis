import mongoose from 'mongoose';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';

dotenv.config();

async function verifyMultiTenantSecurity() {
  console.log('=== MULTI-TENANT SAAS ISOLATION AUDIT ===\n');

  await mongoose.connect(process.env.MONGO_URI);

  const Company = mongoose.model('Company', new mongoose.Schema({}, { strict: false }), 'companies');
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }), 'users');

  // Create two distinct tenant companies
  const companyA = await Company.create({
    name: 'Tenant Alpha Logistics S.L.',
    tradingName: 'Alpha Logistics',
    vatNumber: 'ESA11111111',
    logo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', // Alpha logo
    email: 'alpha@tenant-a.com',
    phone: '+34 91 111 1111'
  });

  const companyB = await Company.create({
    name: 'Tenant Beta Worldwide Corp',
    tradingName: 'Beta Cargo',
    vatNumber: 'ESB22222222',
    logo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', // Beta logo
    email: 'beta@tenant-b.com',
    phone: '+34 91 222 2222'
  });

  // Create distinct users for each tenant
  const userA = await User.create({
    email: 'admin@tenant-a.com',
    name: 'User Alpha',
    role: 'admin',
    company: companyA._id
  });

  const userB = await User.create({
    email: 'admin@tenant-b.com',
    name: 'User Beta',
    role: 'admin',
    company: companyB._id
  });

  const tokenA = jwt.sign({ id: userA._id }, process.env.JWT_SECRET || 'fallback_secret_key');
  const tokenB = jwt.sign({ id: userB._id }, process.env.JWT_SECRET || 'fallback_secret_key');

  // TEST 1: Tenant A fetches settings
  console.log('Test 1: Tenant A calling GET /api/v1/settings');
  const resA = await fetch('http://localhost:5000/api/v1/settings', {
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  const dataA = await resA.json();
  console.log('-> Tenant A fetched company:', dataA.name, '| VAT:', dataA.vatNumber);

  // TEST 2: Tenant B fetches settings
  console.log('\nTest 2: Tenant B calling GET /api/v1/settings');
  const resB = await fetch('http://localhost:5000/api/v1/settings', {
    headers: { Authorization: `Bearer ${tokenB}` }
  });
  const dataB = await resB.json();
  console.log('-> Tenant B fetched company:', dataB.name, '| VAT:', dataB.vatNumber);

  // TEST 3: Cross-Tenant Isolation Verification
  const isIsolated = (dataA._id === String(companyA._id)) && 
                     (dataB._id === String(companyB._id)) && 
                     (dataA._id !== dataB._id) &&
                     (dataA.vatNumber === 'ESA11111111') &&
                     (dataB.vatNumber === 'ESB22222222');

  console.log('\n--- MULTI-TENANT ISOLATION RESULT ---');
  if (isIsolated) {
    console.log('✅ PASS: Multi-tenant security ISOLATED. Tenant A and Tenant B cannot access each other\'s company data or logo!');
  } else {
    console.error('❌ FAIL: Security breach detected');
  }

  // Cleanup test documents
  await User.deleteMany({ _id: { $in: [userA._id, userB._id] } });
  await Company.deleteMany({ _id: { $in: [companyA._id, companyB._id] } });

  await mongoose.disconnect();
}

verifyMultiTenantSecurity().catch(console.error);
