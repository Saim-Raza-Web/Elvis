import express from 'express';
import PDFDocument from 'pdfkit';
import { protect, requireRole } from '../middleware/auth.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Warehouse from '../models/Warehouse.js';
import Shipment from '../models/Shipment.js';
import PickTask from '../models/PickTask.js';
import PackTask from '../models/PackTask.js';
import Return from '../models/Return.js';
import Company from '../models/Company.js';
import ScheduledReport from '../models/ScheduledReport.js';

const router = express.Router();

router.use(protect);
router.use(requireRole('admin', 'manager'));

router.get('/warehouse-kpis', async (req, res, next) => {
  try {
    const comp = req.user.company;
    const [picks, packs] = await Promise.all([
      PickTask.find({ company: comp, status: 'completed' }),
      PackTask.find({ company: comp, status: 'completed' }),
    ]);

    let totalPickTime = 0;
    let validPicks = 0;
    let pickErrors = 0;

    picks.forEach((p) => {
      if (p.errors > 0) pickErrors++;
      if (p.started && p.completedAt) {
        totalPickTime += (p.completedAt - p.started) / 1000;
        validPicks++;
      }
    });

    let totalPackTime = 0;
    let validPacks = 0;

    packs.forEach((p) => {
      if (p.startedAt && p.completedAt) {
        totalPackTime += (p.completedAt - p.startedAt) / 1000;
        validPacks++;
      }
    });

    const avgPickingTime = validPicks > 0 ? totalPickTime / validPicks : 0;
    const avgPackingTime = validPacks > 0 ? totalPackTime / validPacks : 0;
    const errorRate = picks.length > 0 ? (pickErrors / picks.length) * 100 : 0;
    let throughput = validPicks > 0 ? Math.round(validPicks / Math.max(1, totalPickTime / 3600)) : 0;
    throughput = Number.isFinite(throughput) ? throughput : 0;

    res.json({ avgPickingTime, avgPackingTime, errorRate, throughput });
  } catch (err) {
    next(err);
  }
});

function getColorForStatus(status) {
  switch (status) {
    case 'Delivered': return '#22c55e';
    case 'Shipped': return '#4f46e5';
    case 'Processing': return '#3b82f6';
    case 'Pending': return '#f59e0b';
    case 'Cancelled': return '#ef4444';
    default: return '#94a3b8';
  }
}

function buildRevenueByMonth(orders) {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const now = new Date();
  const revenueData = [];

  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
    const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
    const monthOrders = orders.filter((o) => {
      const created = new Date(o.createdAt || o.date);
      return created >= monthStart && created <= monthEnd;
    });
    revenueData.push({
      month: monthNames[d.getMonth()],
      revenue: monthOrders.reduce((a, o) => a + (o.total || 0), 0),
      orders: monthOrders.length,
      returns: 0,
    });
  }
  return revenueData;
}

async function buildDashboardPayload(comp) {
  const [orders, products, warehouses, shipments, picks, returns] = await Promise.all([
    Order.find({ company: comp }),
    Product.find({ company: comp }),
    Warehouse.find({ company: comp }),
    Shipment.find({ company: comp }),
    PickTask.find({ company: comp, status: 'completed' }),
    Return.find({ company: comp }),
  ]);

  const statusMap = { Delivered: 0, Shipped: 0, Processing: 0, Pending: 0, Cancelled: 0 };
  orders.forEach((o) => {
    const s = o.status ? o.status.charAt(0).toUpperCase() + o.status.slice(1) : 'Pending';
    if (statusMap[s] !== undefined) statusMap[s]++;
    else statusMap[s] = 1;
  });
  const orderStatusData = Object.entries(statusMap).map(([name, value]) => ({
    name, value, color: getColorForStatus(name),
  }));

  const catMap = {};
  products.forEach((p) => {
    const c = p.category || 'Other';
    if (!catMap[c]) catMap[c] = { units: 0, value: 0 };
    catMap[c].units += p.qty_available || 0;
    catMap[c].value += (p.qty_available || 0) * (p.price || 0);
  });
  const categoryData = Object.entries(catMap).map(([category, data]) => ({ category, ...data }));

  const shipMap = {};
  shipments.forEach((s) => {
    const c = s.carrier || 'Other';
    if (!shipMap[c]) shipMap[c] = { onTime: 0, late: 0 };
    if (s.status === 'delayed') shipMap[c].late++;
    else shipMap[c].onTime++;
  });
  const shippingData = Object.entries(shipMap).map(([carrier, data]) => ({ carrier, ...data }));

  const warehousePerf = warehouses.map((w) => {
    const whKey = w.code || w.name;
    const whPicks = picks.filter((p) => p.zone === whKey || (p.zone && whKey && p.zone.startsWith(whKey)));
    return {
      wh: whKey,
      picks: whPicks.length,
      errors: whPicks.reduce((a, p) => a + (p.errors || 0), 0),
      utilization: w.capacity > 0 ? Math.round(((w.used || 0) / w.capacity) * 100) : 0,
    };
  });

  const chanMap = {};
  orders.forEach((o) => {
    const c = o.channel || 'Direct';
    if (!chanMap[c]) chanMap[c] = { orders: 0, revenue: 0 };
    chanMap[c].orders++;
    chanMap[c].revenue += o.total || 0;
  });
  const channelData = Object.entries(chanMap).map(([channel, data]) => ({ channel, ...data }));

  const revenueData = buildRevenueByMonth(orders);
  const totalRev = orders.reduce((a, o) => a + (o.total || 0), 0);
  const onTimeTotal = Object.values(shipMap).reduce((a, s) => a + s.onTime, 0);

  const headerStats = {
    revenueMTD: totalRev,
    ordersMTD: orders.length,
    avgOrderValue: orders.length > 0 ? totalRev / orders.length : 0,
    onTimeDelivery: shipments.length > 0 ? (onTimeTotal / shipments.length) * 100 : 100,
  };

  return {
    revenueData,
    orderStatusData,
    categoryData,
    shippingData,
    warehousePerf,
    channelData,
    headerStats,
    meta: { orderCount: orders.length, productCount: products.length, returnCount: returns.length },
  };
}

router.get('/dashboard', async (req, res, next) => {
  try {
    const payload = await buildDashboardPayload(req.user.company);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

router.post('/export', async (req, res, next) => {
  try {
    const reportType = req.body.type || 'overview';
    const company = await Company.findById(req.user.company);
    const data = await buildDashboardPayload(req.user.company);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${reportType}-report.pdf"`);

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    doc.fontSize(20).font('Helvetica-Bold').text('Elvis WMS Report', 50, 50);
    doc.fontSize(10).font('Helvetica').fillColor('#666')
      .text(company?.name || 'Company', 50, 75)
      .text(`Report: ${reportType}`, 50, 90)
      .text(`Generated: ${new Date().toLocaleString()}`, 50, 105);
    doc.moveTo(50, 125).lineTo(550, 125).strokeColor('#e5e7eb').stroke();
    doc.fillColor('#000').y = 145;

    doc.fontSize(14).font('Helvetica-Bold').text('Summary');
    doc.fontSize(11).font('Helvetica');
    doc.text(`Revenue MTD: €${data.headerStats.revenueMTD.toLocaleString()}`);
    doc.text(`Orders MTD: ${data.headerStats.ordersMTD}`);
    doc.text(`Avg order value: €${data.headerStats.avgOrderValue.toFixed(2)}`);
    doc.text(`On-time delivery: ${data.headerStats.onTimeDelivery.toFixed(1)}%`);
    doc.moveDown();

    doc.fontSize(14).font('Helvetica-Bold').text('Revenue (last 6 months)');
    data.revenueData.forEach((row) => {
      doc.fontSize(10).font('Helvetica')
        .text(`${row.month}: €${Math.round(row.revenue).toLocaleString()} (${row.orders} orders)`);
    });
    doc.moveDown();

    doc.fontSize(14).font('Helvetica-Bold').text('Warehouse performance');
    if (data.warehousePerf.length === 0) {
      doc.fontSize(10).text('No warehouse data');
    } else {
      data.warehousePerf.forEach((w) => {
        doc.fontSize(10).text(`${w.wh}: ${w.picks} picks, ${w.errors} errors, ${w.utilization}% utilization`);
      });
    }

    doc.end();
  } catch (err) {
    next(err);
  }
});

router.post('/schedule', async (req, res, next) => {
  try {
    const { report, freq, email, format } = req.body;
    if (!email) return res.status(400).json({ message: 'Recipient email is required' });

    const scheduled = await ScheduledReport.create({
      report: report || 'overview',
      frequency: freq || 'weekly',
      email,
      format: format || 'pdf',
      company: req.user.company,
      createdBy: req.user._id,
    });

    res.status(201).json({
      message: 'Report scheduled successfully',
      schedule: scheduled,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
