import mongoose from 'mongoose';
import assert from 'assert';
import request from 'supertest';
import app from '../index.js';
import Company from '../models/Company.js';
import User from '../models/User.js';
import Warehouse from '../models/Warehouse.js';
import Location from '../models/Location.js';
import Product from '../models/Product.js';
import InventoryBalance from '../models/InventoryBalance.js';
import Order from '../models/Order.js';
import ASN from '../models/ASN.js';
import Return from '../models/Return.js';
import PickTask from '../models/PickTask.js';
import { setupTestDatabase, teardownTestDatabase } from '../test_helper.js';

let companyA, companyB, warehouseMIA, warehouseMAD;
let adminUserA, adminTokenA;
let adminUserB, adminTokenB;

async function runTests() {
  console.log('--- RF-P20 Real-Time KPI Dashboard Test Suite ---');
  await setupTestDatabase();

  const suffix = Date.now().toString();

  // Setup Company A
  companyA = await Company.create({
    name: `KPI Co A ${suffix}`,
    code: `KPA_${suffix.slice(-4)}`
  });

  // Setup Company B for tenant isolation testing
  companyB = await Company.create({
    name: `KPI Co B ${suffix}`,
    code: `KPB_${suffix.slice(-4)}`
  });

  warehouseMIA = await Warehouse.create({
    name: 'MIA Main Hub',
    code: 'MIA',
    company: companyA._id,
    active: true
  });

  warehouseMAD = await Warehouse.create({
    name: 'MAD Central Hub',
    code: 'MAD',
    company: companyA._id,
    active: true
  });

  // Locations for capacity occupancy calculation
  await Location.create([
    { warehouse: warehouseMIA._id, code: 'MIA-A1-01', company: companyA._id, status: 'OCCUPIED' },
    { warehouse: warehouseMIA._id, code: 'MIA-A1-02', company: companyA._id, status: 'OCCUPIED' },
    { warehouse: warehouseMIA._id, code: 'MIA-A1-03', company: companyA._id, status: 'AVAILABLE' },
    { warehouse: warehouseMIA._id, code: 'MIA-A1-04', company: companyA._id, status: 'AVAILABLE' }
  ]);

  // Inventory in Company A
  await InventoryBalance.create([
    {
      company: companyA._id,
      warehouse: 'MIA',
      sku: 'SKU-KPI-01',
      owner: 'Client Alpha',
      ownerType: 'CUSTOMER',
      qtyAvailable: 150,
      qtyReserved: 50,
      qtyAwaitingPutaway: 25,
      entryDate: new Date()
    },
    {
      company: companyA._id,
      warehouse: 'MAD',
      sku: 'SKU-KPI-02',
      owner: 'Client Beta',
      ownerType: 'CUSTOMER',
      qtyAvailable: 300,
      qtyReserved: 0,
      qtyAwaitingPutaway: 0,
      entryDate: new Date()
    }
  ]);

  // Inventory in Company B (must NOT be counted in Co A's KPIs)
  await InventoryBalance.create({
    company: companyB._id,
    warehouse: 'MIA',
    sku: 'SKU-KPI-LEAK',
    owner: 'Client CoB',
    ownerType: 'CUSTOMER',
    qtyAvailable: 9999,
    qtyReserved: 0,
    entryDate: new Date()
  });

  // Inbound ASNs
  await ASN.create([
    {
      asnId: `ASN-A1-${suffix}`,
      asnNumber: `ASN-A1-${suffix}`,
      poNumber: `PO-A1-${suffix}`,
      supplier: 'Supplier Alpha',
      expectedDate: new Date(),
      company: companyA._id,
      warehouse: 'MIA',
      status: 'pending',
      owner: 'Client Alpha',
      ownerType: 'CUSTOMER',
      expected_units: 100
    },
    {
      asnId: `ASN-A2-${suffix}`,
      asnNumber: `ASN-A2-${suffix}`,
      poNumber: `PO-A2-${suffix}`,
      supplier: 'Supplier Alpha',
      expectedDate: new Date(),
      company: companyA._id,
      warehouse: 'MIA',
      status: 'completed',
      owner: 'Client Alpha',
      ownerType: 'CUSTOMER',
      expected_units: 50
    }
  ]);

  // Outbound Orders
  await Order.create([
    {
      orderId: `ORD-A1-${suffix}`,
      company: companyA._id,
      warehouse: 'MIA',
      status: 'pending',
      owner: 'Client Alpha',
      ownerType: 'CUSTOMER',
      total: 250,
      items: 3
    },
    {
      orderId: `ORD-A2-${suffix}`,
      company: companyA._id,
      warehouse: 'MIA',
      status: 'shipped',
      owner: 'Client Alpha',
      ownerType: 'CUSTOMER',
      total: 500,
      items: 5
    }
  ]);

  // Picking Tasks
  await PickTask.create([
    {
      taskId: `PT-1-${suffix}`,
      orderId: `ORD-A1-${suffix}`,
      company: companyA._id,
      warehouse: 'MIA',
      owner: 'Client Alpha',
      status: 'pending'
    },
    {
      taskId: `PT-2-${suffix}`,
      orderId: `ORD-A2-${suffix}`,
      company: companyA._id,
      warehouse: 'MIA',
      owner: 'Client Alpha',
      status: 'completed'
    }
  ]);

  // Returns
  await Return.create({
    returnId: `RET-1-${suffix}`,
    rmaNumber: `RMA-1-${suffix}`,
    company: companyA._id,
    warehouse: 'MIA',
    status: 'INSPECTED',
    disposition: 'RESTOCK'
  });

  // Users
  adminUserA = await User.create({
    name: 'Admin KPI A',
    email: `adminkpiA_${suffix}@house3pl.com`,
    password: 'Password123!',
    role: 'admin',
    company: companyA._id,
    active: true
  });

  adminUserB = await User.create({
    name: 'Admin KPI B',
    email: `adminkpiB_${suffix}@house3pl.com`,
    password: 'Password123!',
    role: 'admin',
    company: companyB._id,
    active: true
  });

  const jwtModule = await import('jsonwebtoken');
  const jwt = jwtModule.default;
  const secret = process.env.JWT_SECRET || 'fallback_secret_key';
  adminTokenA = jwt.sign({ id: adminUserA._id }, secret, { expiresIn: '1h' });
  adminTokenB = jwt.sign({ id: adminUserB._id }, secret, { expiresIn: '1h' });

  // ============================================================
  // TEST 1: Real-Time Operational KPI Aggregation (/api/v1/kpi/operations)
  // ============================================================
  console.log('\n=== TEST 1: Real-Time Operational KPI Aggregation ===');
  const opsRes = await request(app)
    .get('/api/v1/kpi/operations')
    .set('Authorization', `Bearer ${adminTokenA}`);

  assert.strictEqual(opsRes.status, 200, `Expected 200, got: ${opsRes.status}`);
  const ops = opsRes.body;

  // Inbound checks
  assert.ok(ops.inbound, 'Inbound metrics present');
  assert.strictEqual(ops.inbound.pending, 1, '1 pending ASN in Co A');
  assert.strictEqual(ops.inbound.completed, 1, '1 completed ASN in Co A');

  // Outbound checks
  assert.ok(ops.outbound, 'Outbound metrics present');
  assert.strictEqual(ops.outbound.pending, 1, '1 pending order in Co A');
  assert.strictEqual(ops.outbound.shipped, 1, '1 shipped order in Co A');

  // Picking checks
  assert.ok(ops.picking, 'Picking metrics present');
  assert.strictEqual(ops.picking.pending, 1, '1 pending pick task in Co A');
  assert.strictEqual(ops.picking.completed, 1, '1 completed pick task in Co A');

  // Warehouse capacity occupancy
  assert.ok(ops.occupancy, 'Occupancy metrics present');
  assert.strictEqual(ops.occupancy.totalLocations, 4, '4 locations in Co A');
  assert.strictEqual(ops.occupancy.occupiedLocations, 2, '2 occupied locations in Co A');
  assert.strictEqual(ops.occupancy.occupancyRate, 50, '50% occupancy rate');

  console.log('✓ Operational KPIs aggregate authoritative inbounds, outbounds, pick tasks, and occupancy rate accurately');

  // ============================================================
  // TEST 2: Executive Summary Aggregation (/api/v1/kpi/summary)
  // ============================================================
  console.log('\n=== TEST 2: Executive Summary Aggregation ===');
  const sumRes = await request(app)
    .get('/api/v1/kpi/summary')
    .set('Authorization', `Bearer ${adminTokenA}`);

  assert.strictEqual(sumRes.status, 200);
  const sum = sumRes.body;
  assert.strictEqual(sum.inventory.activeSkuCount, 2, 'Co A has 2 SKUs');
  assert.strictEqual(sum.inventory.totalPhysicalStock, 525, '150+50+25 (MIA) + 300 (MAD) = 525');
  assert.strictEqual(sum.fulfillment.totalOrders, 2, 'Co A has 2 orders');
  assert.strictEqual(sum.fulfillment.totalRevenue, 750, 'Co A has 250 + 500 = 750 order total');

  console.log('✓ Executive summary metrics computed directly from database balances and orders');

  // ============================================================
  // TEST 3: Multi-Warehouse Filtering
  // ============================================================
  console.log('\n=== TEST 3: Multi-Warehouse Filtering ===');
  const miaSumRes = await request(app)
    .get('/api/v1/kpi/summary?warehouse=MIA')
    .set('Authorization', `Bearer ${adminTokenA}`);

  assert.strictEqual(miaSumRes.status, 200);
  const miaSum = miaSumRes.body;
  assert.strictEqual(miaSum.inventory.activeSkuCount, 1, 'MIA has 1 SKU');
  assert.strictEqual(miaSum.inventory.totalPhysicalStock, 225, 'MIA has 150+50+25 = 225 physical units');

  console.log('✓ Warehouse filter correctly restricts metrics to selected facility');

  // ============================================================
  // TEST 4: Strict Multi-Tenant Isolation
  // ============================================================
  console.log('\n=== TEST 4: Strict Multi-Tenant Isolation ===');
  const coBRes = await request(app)
    .get('/api/v1/kpi/summary')
    .set('Authorization', `Bearer ${adminTokenB}`);

  assert.strictEqual(coBRes.status, 200);
  const coBSum = coBRes.body;
  // Company B only has 1 SKU with 9999 units, 0 orders
  assert.strictEqual(coBSum.inventory.activeSkuCount, 1, 'Company B only sees its own SKU');
  assert.strictEqual(coBSum.inventory.totalPhysicalStock, 9999, 'Company B only sees its own 9999 units');
  assert.strictEqual(coBSum.fulfillment.totalOrders, 0, 'Company B sees 0 orders, no leakage from Company A');

  console.log('✓ Multi-tenant isolation verified: zero leakage across companies');

  // ============================================================
  // TEST 5: Legacy /api/v1/dashboard forwarder
  // ============================================================
  console.log('\n=== TEST 5: Legacy Dashboard Endpoint Compatibility ===');
  const dashRes = await request(app)
    .get('/api/v1/dashboard')
    .set('Authorization', `Bearer ${adminTokenA}`);

  assert.strictEqual(dashRes.status, 200);
  assert.ok(dashRes.body.inventory, 'Legacy dashboard returns unified KPI payload');
  assert.strictEqual(dashRes.body.inventory.totalPhysicalStock, 525);

  console.log('✓ Backward compatibility verified with /api/v1/dashboard');

  await teardownTestDatabase();
  console.log('\n======================================================');
  console.log('✓✓✓ ALL RF-P20 REAL-TIME KPI TESTS PASSED ✓✓✓');
  console.log('======================================================\n');
}

runTests()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('RF-P20 Test Suite Error:', err);
    await teardownTestDatabase();
    process.exit(1);
  });
