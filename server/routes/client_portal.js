import express from 'express';
import mongoose from 'mongoose';
import { protect, requireRole, requireClientAccess } from '../middleware/auth.js';
import Client from '../models/Client.js';
import InventoryBalance from '../models/InventoryBalance.js';
import Order from '../models/Order.js';
import ASN from '../models/ASN.js';
import Shipment from '../models/Shipment.js';
import Product from '../models/Product.js';
import RateCard from '../models/RateCard.js';
import { threePlBillingEngine } from '../services/3plBillingEngine.js';

const router = express.Router();

router.use(protect);
router.use(requireRole('admin', 'client_3pl'));
router.use(requireClientAccess);

/**
 * Helper to resolve the authoritative client name and allowed warehouses.
 * For client_3pl, uses req.clientContext.
 * For admin/testing, can optionally use ?client= or fallback to clientContext.
 */
async function resolveClientScope(req) {
  if (req.user.role === 'client_3pl') {
    return {
      clientId: req.clientContext.clientId,
      clientName: req.clientContext.clientName,
      allowedWarehouses: req.clientContext.warehouseAccess || ['MIA']
    };
  }

  // Admin role: can specify client via query param or fetch first client
  let clientDoc = null;
  if (req.query.client) {
    clientDoc = await Client.findOne({ name: req.query.client, company: req.user.company });
  } else if (req.query.clientId) {
    clientDoc = await Client.findOne({ _id: req.query.clientId, company: req.user.company });
  } else {
    clientDoc = await Client.findOne({ company: req.user.company });
  }

  if (!clientDoc) {
    throw new Error('No client context found for 3PL portal');
  }

  return {
    clientId: clientDoc._id,
    clientName: clientDoc.name,
    allowedWarehouses: clientDoc.warehouseAccess || ['MIA']
  };
}

// ── GET /api/v1/client-portal/profile ──
router.get('/profile', async (req, res, next) => {
  try {
    const scope = await resolveClientScope(req);
    const client = await Client.findOne({ _id: scope.clientId, company: req.user.company });
    if (!client) return res.status(404).json({ message: 'Client profile not found' });

    res.json({
      client: {
        id: client._id,
        name: client.name,
        vat: client.vat,
        country: client.country,
        email: client.email,
        contact: client.contact,
        billingModality: client.billingModality || 'TEMPORAL',
        warehouseAccess: client.warehouseAccess,
        activeStockDays: client.activeStockDays || 0,
        firstActiveStockDate: client.firstActiveStockDate
      }
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/client-portal/inventory — Authoritative physical stock for client ──
router.get('/inventory', async (req, res, next) => {
  try {
    const scope = await resolveClientScope(req);
    const query = {
      company: req.user.company,
      owner: scope.clientName,
      warehouse: { $in: scope.allowedWarehouses }
    };

    if (req.query.warehouse) {
      if (!scope.allowedWarehouses.includes(req.query.warehouse)) {
        return res.status(403).json({ message: 'Warehouse not permitted for this client' });
      }
      query.warehouse = req.query.warehouse;
    }

    if (req.query.sku) {
      query.sku = new RegExp(String(req.query.sku).trim(), 'i');
    }

    const balances = await InventoryBalance.find(query)
      .sort({ sku: 1, lotNumber: 1 })
      .lean();

    const skus = [...new Set(balances.map(b => b.sku))];
    const products = await Product.find({ company: req.user.company, sku: { $in: skus } })
      .select('sku name description uom')
      .lean();
    const productMap = new Map(products.map(p => [p.sku, p]));

    const totalAvailable = balances.reduce((sum, b) => sum + (b.qtyAvailable || 0), 0);
    const totalReserved = balances.reduce((sum, b) => sum + (b.qtyReserved || 0), 0);
    const totalAwaiting = balances.reduce((sum, b) => sum + (b.qtyAwaitingPutaway || 0), 0);

    res.json({
      client: scope.clientName,
      summary: {
        totalRecords: balances.length,
        totalAvailable,
        totalReserved,
        totalAwaiting,
        totalPhysical: totalAvailable + totalReserved + totalAwaiting
      },
      inventory: balances.map(b => {
        const prod = productMap.get(b.sku);
        return {
          id: b._id,
          sku: b.sku,
          productName: prod?.name || b.sku,
          lot: b.lotNumber || b.batchNumber || 'N/A',
          expiryDate: b.expiryDate,
          warehouse: b.warehouse,
          location: b.bin || `${b.zone || ''}-${b.aisle || ''}-${b.rack || ''}-${b.bin || ''}`,
          locationType: 'STANDARD',
          qtyAvailable: b.qtyAvailable || 0,
          qtyReserved: b.qtyReserved || 0,
          qtyAwaitingPutaway: b.qtyAwaitingPutaway || 0,
          updatedAt: b.updatedAt
        };
      })
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/client-portal/orders — Client Outbound Orders ──
router.get('/orders', async (req, res, next) => {
  try {
    const scope = await resolveClientScope(req);
    const query = {
      company: req.user.company,
      owner: scope.clientName
    };

    if (req.query.status) {
      query.status = req.query.status;
    }

    const orders = await Order.find(query).sort({ createdAt: -1 }).limit(100);

    res.json({
      client: scope.clientName,
      count: orders.length,
      orders: orders.map(o => ({
        id: o._id,
        orderId: o.orderId,
        order_type: o.order_type,
        status: o.status,
        date: o.date || o.createdAt,
        itemsCount: o.product_lines?.length || 0,
        lines: o.product_lines,
        total: o.total,
        tracking_number: o.tracking_number,
        carrier: o.carrier,
        customerName: o.customer,
        deliveryAddress: o.delivery_address
      }))
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/client-portal/orders — Create outbound order as client ──
router.post('/orders', async (req, res, next) => {
  try {
    const scope = await resolveClientScope(req);
    const { orderId, customer, lines, deliveryAddress, notes, isB2B } = req.body;

    if (!lines || !Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ message: 'Order lines are required' });
    }

    const targetWarehouse = scope.allowedWarehouses[0] || 'MIA';
    const cleanOrderId = orderId || `ORD-${Date.now().toString().slice(-6)}`;

    // Verify all SKUs belong to company and calculate totals
    let subtotal = 0;
    const productLines = [];
    for (const item of lines) {
      const prod = await Product.findOne({ sku: item.sku, company: req.user.company });
      if (!prod) {
        return res.status(400).json({ message: `SKU '${item.sku}' not recognized` });
      }
      const unitPrice = item.unitPrice || prod.price || 10;
      const qty = Number(item.qty) || 1;
      const lineTotal = unitPrice * qty;
      subtotal += lineTotal;
      productLines.push({
        sku: prod.sku,
        product_name: prod.name,
        qty,
        unit_price: unitPrice,
        line_total: lineTotal
      });
    }

    const vatAmount = subtotal * 0.21;
    const grandTotal = subtotal + vatAmount;

    const newOrder = await Order.create({
      orderId: cleanOrderId,
      company: req.user.company,
      owner: scope.clientName,
      ownerType: 'CUSTOMER',
      customer: customer || scope.clientName,
      warehouse: targetWarehouse,
      order_type: isB2B ? 'B2B' : 'B2C',
      isB2B: Boolean(isB2B),
      status: 'pending',
      date: new Date(),
      notes: notes || 'Created via 3PL Client Portal',
      product_lines: productLines,
      items: productLines.length,
      subtotal,
      vat_rate: 21,
      vat_amount: vatAmount,
      total: grandTotal,
      delivery_address: deliveryAddress || {}
    });

    res.status(201).json({
      message: 'Order created successfully in 3PL portal',
      order: newOrder
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/client-portal/asns — Client Inbound ASNs ──
router.get('/asns', async (req, res, next) => {
  try {
    const scope = await resolveClientScope(req);
    const query = {
      company: req.user.company,
      owner: scope.clientName
    };

    if (req.query.status) {
      query.status = req.query.status;
    }

    const asns = await ASN.find(query).sort({ createdAt: -1 }).limit(100);

    res.json({
      client: scope.clientName,
      count: asns.length,
      asns: asns.map(a => ({
        id: a._id,
        asnId: a.asnId,
        poNumber: a.poNumber,
        supplier: a.supplier,
        carrier: a.carrier,
        status: a.status,
        expectedDate: a.expectedDate,
        warehouse: a.warehouse,
        receivingDock: a.receivingDock,
        expectedUnits: a.expected_units || a.items?.reduce((s, i) => s + (i.expected_qty || 0), 0) || 0,
        receivedUnits: a.items?.reduce((s, i) => s + (i.received_qty || 0), 0) || 0,
        items: a.items
      }))
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/client-portal/asns — Announce inbound receipt as client ──
router.post('/asns', async (req, res, next) => {
  try {
    const scope = await resolveClientScope(req);
    const { poNumber, supplier, expectedDate, carrier, warehouse, items, notes } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'ASN items are required' });
    }

    const targetWarehouse = warehouse && scope.allowedWarehouses.includes(warehouse)
      ? warehouse
      : (scope.allowedWarehouses[0] || 'MIA');

    const asnId = `ASN-${Date.now().toString().slice(-6)}`;
    const totalExpectedUnits = items.reduce((sum, item) => sum + (Number(item.expected_qty) || 0), 0);

    const asn = await ASN.create({
      asnId,
      asnNumber: asnId,
      company: req.user.company,
      owner: scope.clientName,
      ownerType: 'CUSTOMER',
      supplier: supplier || 'Default Supplier',
      poNumber: poNumber || `PO-${asnId}`,
      carrier: carrier || 'Standard Carrier',
      expectedDate: expectedDate ? new Date(expectedDate) : new Date(Date.now() + 24 * 60 * 60 * 1000),
      warehouse: targetWarehouse,
      receivingDock: 'Dock 1',
      status: 'pending',
      notes: notes || 'Created via 3PL Client Portal',
      sku_count: items.length,
      expected_units: totalExpectedUnits,
      items: items.map(it => ({
        sku: it.sku,
        name: it.name || it.sku,
        description: it.description || '',
        expected_qty: Number(it.expected_qty) || 1,
        received_qty: 0,
        uom: it.uom || 'pcs',
        lotNumber: it.lotNumber || '',
        expiryDate: it.expiryDate ? new Date(it.expiryDate) : undefined
      }))
    });

    res.status(201).json({
      message: 'Inbound notification (ASN) registered successfully',
      asn
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/client-portal/billing — Own Rate Card & Monthly Liquidation ──
router.get('/billing', async (req, res, next) => {
  try {
    const scope = await resolveClientScope(req);
    const now = new Date();
    const year = Number(req.query.year) || now.getFullYear();
    const month = Number(req.query.month) || (now.getMonth() + 1);

    const rateCard = await RateCard.findOne({
      company: req.user.company,
      client: scope.clientName
    });

    const liquidation = await threePlBillingEngine.calculateMonthlyBilling({
      companyId: req.user.company,
      clientName: scope.clientName,
      year,
      month,
      warehouse: req.query.warehouse || scope.allowedWarehouses[0]
    });

    res.json({
      client: scope.clientName,
      year,
      month,
      hasRateCard: Boolean(rateCard),
      rateCard,
      liquidation
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/client-portal/kpis — Operational KPIs for client ──
router.get('/kpis', async (req, res, next) => {
  try {
    const scope = await resolveClientScope(req);
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Stock stats
    const balances = await InventoryBalance.find({
      company: req.user.company,
      owner: scope.clientName,
      warehouse: { $in: scope.allowedWarehouses }
    });

    const totalAvailable = balances.reduce((s, b) => s + (b.qtyAvailable || 0), 0);
    const totalReserved = balances.reduce((s, b) => s + (b.qtyReserved || 0), 0);
    const uniqueSkus = new Set(balances.map(b => b.sku)).size;

    // Monthly orders stats
    const monthOrders = await Order.find({
      company: req.user.company,
      owner: scope.clientName,
      createdAt: { $gte: startOfMonth }
    });

    const totalOrders = monthOrders.length;
    const deliveredOrders = monthOrders.filter(o => o.status === 'delivered' || o.status === 'shipped').length;
    const pendingOrders = monthOrders.filter(o => o.status === 'pending' || o.status === 'processing').length;

    // Inbounds this month
    const monthAsns = await ASN.find({
      company: req.user.company,
      owner: scope.clientName,
      createdAt: { $gte: startOfMonth }
    });

    res.json({
      client: scope.clientName,
      kpis: {
        totalAvailableStock: totalAvailable,
        totalReservedStock: totalReserved,
        totalPhysicalStock: totalAvailable + totalReserved,
        activeSkuCount: uniqueSkus,
        ordersThisMonth: totalOrders,
        dispatchedOrdersThisMonth: deliveredOrders,
        pendingOrdersThisMonth: pendingOrders,
        inboundReceiptsThisMonth: monthAsns.length,
        fulfillmentRatePct: totalOrders > 0 ? Math.round((deliveredOrders / totalOrders) * 100) : 100
      }
    });
  } catch (err) {
    next(err);
  }
});

export default router;
