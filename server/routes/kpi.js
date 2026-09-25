import express from 'express';
import mongoose from 'mongoose';
import { protect, requireRole, requireClientAccess } from '../middleware/auth.js';
import InventoryBalance from '../models/InventoryBalance.js';
import Order from '../models/Order.js';
import Shipment from '../models/Shipment.js';
import ASN from '../models/ASN.js';
import Location from '../models/Location.js';
import Warehouse from '../models/Warehouse.js';
import Incident from '../models/Incident.js';
import QuarantineInventory from '../models/QuarantineInventory.js';
import Return from '../models/Return.js';
import Client from '../models/Client.js';
import ExpiryAlert from '../models/ExpiryAlert.js';
import PickTask from '../models/PickTask.js';

const router = express.Router();

router.use(protect);

/**
 * GET /api/v1/kpi/summary
 * Authoritative WMS Real-Time KPI Dashboard (RF-P20)
 * Filters supported: warehouse, client/owner, startDate, endDate
 */
router.get(['/', '/summary'], requireRole('admin', 'manager', 'management', 'office', 'client_3pl'), async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({ message: 'Company context required' });
    }

    const companyId = req.user.company;
    const warehouseFilter = req.query.warehouse ? String(req.query.warehouse).trim() : null;
    let ownerFilter = req.query.owner || req.query.client || null;

    // Enforce client_3pl scoping strictly to own client
    if (req.user.role === 'client_3pl') {
      const clientDoc = await Client.findOne({ _id: req.user.clientId, company: companyId });
      ownerFilter = clientDoc ? clientDoc.name : req.user.name;
    }

    // Time window calculation
    const now = new Date();
    const period = req.query.period || '30d';
    let startDate = new Date();
    if (period === 'today') {
      startDate.setHours(0, 0, 0, 0);
    } else if (period === '7d') {
      startDate.setDate(now.getDate() - 7);
    } else if (period === '90d') {
      startDate.setDate(now.getDate() - 90);
    } else {
      // 30d default
      startDate.setDate(now.getDate() - 30);
    }

    if (req.query.startDate) {
      startDate = new Date(req.query.startDate);
    }
    const endDate = req.query.endDate ? new Date(req.query.endDate) : now;

    // 1. Inventory & Stock Balances
    const invMatch = { company: companyId };
    if (warehouseFilter) invMatch.warehouse = warehouseFilter;
    if (ownerFilter) invMatch.owner = ownerFilter;

    const inventoryAgg = await InventoryBalance.aggregate([
      { $match: invMatch },
      {
        $group: {
          _id: null,
          totalAvailable: { $sum: '$qtyAvailable' },
          totalReserved: { $sum: '$qtyReserved' },
          totalAwaitingPutaway: { $sum: '$qtyAwaitingPutaway' },
          uniqueLocations: { $addToSet: '$location' },
          uniqueSkus: { $addToSet: '$sku' }
        }
      }
    ]);

    const invSummary = inventoryAgg[0] || {
      totalAvailable: 0,
      totalReserved: 0,
      totalAwaitingPutaway: 0,
      uniqueLocations: [],
      uniqueSkus: []
    };

    // 2. Warehouse Occupancy
    const locMatch = { company: companyId, active: true };
    if (warehouseFilter) {
      const whDoc = await Warehouse.findOne({ company: companyId, code: warehouseFilter });
      if (whDoc) {
        locMatch.warehouse = whDoc._id;
      }
    }
    const totalLocations = await Location.countDocuments(locMatch);
    const occupiedLocationsCount = invSummary.uniqueLocations.length;
    const occupancyRatePct = totalLocations > 0
      ? Math.min(100, Math.round((occupiedLocationsCount / totalLocations) * 100))
      : 0;

    // 3. Orders & Outbound Fulfillment
    const orderMatch = {
      company: companyId,
      createdAt: { $gte: startDate, $lte: endDate }
    };
    if (warehouseFilter) orderMatch.warehouse = warehouseFilter;
    if (ownerFilter) orderMatch.owner = ownerFilter;

    const ordersInPeriod = await Order.find(orderMatch).select('status total order_type createdAt updatedAt').lean();

    const orderCountsByStatus = {
      pending: 0,
      processing: 0,
      picked: 0,
      packed: 0,
      shipped: 0,
      delivered: 0,
      cancelled: 0
    };

    let totalRevenue = 0;
    let b2cCount = 0;
    let b2bCount = 0;

    ordersInPeriod.forEach(o => {
      totalRevenue += (o.total || 0);
      if (o.order_type === 'B2B' || o.isB2B) b2bCount++;
      else b2cCount++;

      const st = String(o.status || 'pending').toLowerCase();
      if (st.includes('ship')) orderCountsByStatus.shipped++;
      else if (st.includes('deliver')) orderCountsByStatus.delivered++;
      else if (st.includes('pick')) orderCountsByStatus.picked++;
      else if (st.includes('pack')) orderCountsByStatus.packed++;
      else if (st.includes('cancel')) orderCountsByStatus.cancelled++;
      else if (st.includes('proc')) orderCountsByStatus.processing++;
      else orderCountsByStatus.pending++;
    });

    const totalOrders = ordersInPeriod.length;
    const completedOrders = orderCountsByStatus.shipped + orderCountsByStatus.delivered;
    const fulfillmentRatePct = totalOrders > 0
      ? Math.round((completedOrders / totalOrders) * 100)
      : 100;

    // 4. Inbound Performance (ASNs)
    const asnMatch = {
      company: companyId,
      createdAt: { $gte: startDate, $lte: endDate }
    };
    if (warehouseFilter) asnMatch.warehouse = warehouseFilter;
    if (ownerFilter) asnMatch.owner = ownerFilter;

    const asnsInPeriod = await ASN.find(asnMatch).select('status expected_units received_units expectedDate').lean();
    const totalAsns = asnsInPeriod.length;
    const completedAsns = asnsInPeriod.filter(a => a.status === 'completed' || a.status === 'completed_with_discrepancies').length;
    const pendingAsns = asnsInPeriod.filter(a => a.status === 'pending' || a.status === 'in_progress').length;

    // 5. Returns & Incidents
    const returnMatch = { company: companyId, createdAt: { $gte: startDate, $lte: endDate } };
    const incidentMatch = { company: companyId, status: { $ne: 'resolved' } };

    const [totalReturns, openIncidents, quarantineCount, expiryAlertsCount] = await Promise.all([
      Return.countDocuments(returnMatch).catch(() => 0),
      Incident.countDocuments(incidentMatch).catch(() => 0),
      QuarantineInventory.countDocuments({ company: companyId, status: 'quarantined' }).catch(() => 0),
      ExpiryAlert.countDocuments({ company: companyId, status: 'OPEN' }).catch(() => 0)
    ]);

    res.json({
      period: {
        code: period,
        startDate,
        endDate
      },
      filtersApplied: {
        warehouse: warehouseFilter || 'ALL',
        owner: ownerFilter || 'ALL'
      },
      inventory: {
        totalAvailableStock: invSummary.totalAvailable,
        totalReservedStock: invSummary.totalReserved,
        totalAwaitingPutaway: invSummary.totalAwaitingPutaway,
        totalPhysicalStock: invSummary.totalAvailable + invSummary.totalReserved + invSummary.totalAwaitingPutaway,
        activeSkuCount: invSummary.uniqueSkus.length,
        occupiedLocationsCount,
        totalLocations,
        occupancyRatePct,
        quarantineUnits: quarantineCount,
        openExpiryAlerts: expiryAlertsCount
      },
      fulfillment: {
        totalOrders,
        completedOrders,
        fulfillmentRatePct,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        b2cOrders: b2cCount,
        b2bOrders: b2bCount,
        ordersByStatus: orderCountsByStatus
      },
      inbound: {
        totalAsns,
        completedAsns,
        pendingAsns,
        inboundFulfillmentPct: totalAsns > 0 ? Math.round((completedAsns / totalAsns) * 100) : 100
      },
      qualityAndExceptions: {
        returnsCount: totalReturns,
        openIncidents,
        quarantinedLots: quarantineCount
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/kpi/operations
 * Granular hourly/daily throughput and cycle times
 */
router.get('/operations', requireRole('admin', 'manager', 'management', 'office'), async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const companyId = req.user.company;
    const warehouseFilter = req.query.warehouse ? String(req.query.warehouse).trim() : null;

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Filter bases
    const asnMatch = { company: companyId };
    const orderMatch = { company: companyId };
    const pickMatch = { company: companyId };
    const locMatch = { company: companyId, active: true };

    if (warehouseFilter) {
      asnMatch.warehouse = warehouseFilter;
      orderMatch.warehouse = warehouseFilter;
      pickMatch.warehouse = warehouseFilter;
      const whDoc = await Warehouse.findOne({ company: companyId, code: warehouseFilter });
      if (whDoc) locMatch.warehouse = whDoc._id;
    }

    const [
      pendingAsns,
      completedAsns,
      pendingOrders,
      shippedOrders,
      pendingPickTasks,
      completedPickTasks,
      totalLocations,
      occupiedLocations
    ] = await Promise.all([
      ASN.countDocuments({ ...asnMatch, status: { $in: ['pending', 'in_progress'] } }),
      ASN.countDocuments({ ...asnMatch, status: { $in: ['completed', 'completed_with_discrepancies'] } }),
      Order.countDocuments({ ...orderMatch, status: 'pending' }),
      Order.countDocuments({ ...orderMatch, status: { $in: ['shipped', 'delivered'] } }),
      PickTask.countDocuments({ ...pickMatch, status: { $in: ['PENDING', 'pending', 'IN_PROGRESS', 'in_progress'] } }).catch(() => 0),
      PickTask.countDocuments({ ...pickMatch, status: { $in: ['COMPLETED', 'completed'] } }).catch(() => 0),
      Location.countDocuments(locMatch),
      Location.countDocuments({ ...locMatch, status: { $in: ['OCCUPIED', 'OCUPADO', 'PARTIAL', 'PARCIAL'] } })
    ]);

    // Daily order throughput for the last 7 days
    const dailyThroughput = await Order.aggregate([
      {
        $match: {
          company: companyId,
          createdAt: { $gte: sevenDaysAgo }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          totalOrders: { $sum: 1 },
          shippedOrders: {
            $sum: { $cond: [{ $in: ['$status', ['shipped', 'delivered']] }, 1, 0] }
          },
          revenue: { $sum: '$total' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const occupancyRate = totalLocations > 0
      ? Math.round((occupiedLocations / totalLocations) * 100)
      : 0;

    res.json({
      inbound: {
        pending: pendingAsns,
        completed: completedAsns
      },
      outbound: {
        pending: pendingOrders,
        shipped: shippedOrders
      },
      picking: {
        pending: pendingPickTasks,
        completed: completedPickTasks
      },
      occupancy: {
        totalLocations,
        occupiedLocations,
        occupancyRate
      },
      dailyThroughput: dailyThroughput.map(d => ({
        date: d._id,
        totalOrders: d.totalOrders,
        shippedOrders: d.shippedOrders,
        revenue: Math.round(d.revenue * 100) / 100
      }))
    });
  } catch (err) {
    next(err);
  }
});

export default router;
