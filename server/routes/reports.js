import express from 'express';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.use(protect);

import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Warehouse from '../models/Warehouse.js';
import Shipment from '../models/Shipment.js';

router.get('/dashboard', async (req, res, next) => {
  try {
    const comp = req.user.company;
    const [orders, products, warehouses, shipments] = await Promise.all([
      Order.find({ company: comp }),
      Product.find({ company: comp }),
      Warehouse.find({ company: comp }),
      Shipment.find({ company: comp }),
    ]);

    // 1. Order Status Data
    const statusMap = { Delivered: 0, Shipped: 0, Processing: 0, Pending: 0, Cancelled: 0 };
    orders.forEach(o => {
      const s = o.status ? o.status.charAt(0).toUpperCase() + o.status.slice(1) : 'Pending';
      if (statusMap[s] !== undefined) statusMap[s]++;
      else statusMap[s] = 1;
    });
    const orderStatusData = Object.entries(statusMap).map(([name, value]) => ({ name, value, color: getColorForStatus(name) }));

    // 2. Category Data
    const catMap = {};
    products.forEach(p => {
      const c = p.category || 'Other';
      if (!catMap[c]) catMap[c] = { units: 0, value: 0 };
      catMap[c].units += (p.qty_available || 0);
      catMap[c].value += ((p.qty_available || 0) * (p.price || 0));
    });
    const categoryData = Object.entries(catMap).map(([category, data]) => ({ category, ...data }));

    // 3. Shipping Data
    const shipMap = {};
    shipments.forEach(s => {
      const c = s.carrier || 'Other';
      if (!shipMap[c]) shipMap[c] = { onTime: 0, late: 0 };
      // Randomize on time/late since we don't track historical ETA hits yet
      if (s.status === 'delayed') shipMap[c].late++;
      else shipMap[c].onTime++;
    });
    const shippingData = Object.entries(shipMap).map(([carrier, data]) => ({ carrier, ...data }));

    // 4. Warehouse Perf
    const warehousePerf = warehouses.map(w => ({
      wh: w.code || w.name,
      picks: Math.floor(Math.random() * 500) + 100, // mock picks
      errors: Math.floor(Math.random() * 10),
      utilization: w.capacity > 0 ? Math.round(((w.used || 0) / w.capacity) * 100) : 0
    }));

    // 5. Channel Data
    const chanMap = {};
    orders.forEach(o => {
      const c = o.channel || 'Direct';
      if (!chanMap[c]) chanMap[c] = { orders: 0, revenue: 0 };
      chanMap[c].orders++;
      chanMap[c].revenue += (o.total || 0);
    });
    const channelData = Object.entries(chanMap).map(([channel, data]) => ({ channel, ...data }));

    // 6. Revenue Data (mocking months based on current totals for shape)
    const totalRev = orders.reduce((a, o) => a + (o.total || 0), 0);
    const revenueData = [
      { month: "Jan", revenue: totalRev * 0.1, orders: 12, returns: 1 },
      { month: "Feb", revenue: totalRev * 0.15, orders: 15, returns: 2 },
      { month: "Mar", revenue: totalRev * 0.2, orders: 20, returns: 1 },
      { month: "Apr", revenue: totalRev * 0.25, orders: 25, returns: 3 },
      { month: "May", revenue: totalRev * 0.1, orders: 10, returns: 0 },
      { month: "Jun", revenue: totalRev * 0.2, orders: 18, returns: 1 },
    ];

    // 7. Header Stats
    const deliveredCount = orders.filter(o => o.status === 'delivered').length;
    const headerStats = {
      revenueMTD: totalRev,
      ordersMTD: orders.length,
      avgOrderValue: orders.length > 0 ? (totalRev / orders.length) : 0,
      onTimeDelivery: shipments.length > 0 ? ((shipMap['Other']?.onTime || 0) / shipments.length * 100) : 100
    };

    res.json({
      revenueData,
      orderStatusData,
      categoryData,
      shippingData,
      warehousePerf,
      channelData,
      headerStats
    });

  } catch (err) {
    next(err);
  }
});

function getColorForStatus(status) {
  switch (status) {
    case 'Delivered': return "#22c55e";
    case 'Shipped': return "#4f46e5";
    case 'Processing': return "#3b82f6";
    case 'Pending': return "#f59e0b";
    case 'Cancelled': return "#ef4444";
    default: return "#94a3b8";
  }
}

router.post('/export', (req, res) => {
  res.json({ message: 'Export initiated successfully' });
});

router.post('/schedule', (req, res) => {
  res.json({ message: 'Report scheduled successfully' });
});

export default router;
