import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import morgan from 'morgan';
import { protect, requireModuleAccess } from './middleware/auth.js';
import { ROUTE_MODULE_MAP } from './config/permissions.js';

// Load environment variables
dotenv.config();
dotenv.config({ path: './server/.env' });
mongoose.set('bufferCommands', false);

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI;

let cachedDb = global.mongoose;
if (!cachedDb) {
  cachedDb = global.mongoose = { conn: null, promise: null };
}

async function connectToDatabase() {
  if (cachedDb.conn) return cachedDb.conn;

  if (!cachedDb.promise) {
    cachedDb.promise = mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 5000
    }).then((mongoose) => mongoose);
  }

  cachedDb.conn = await cachedDb.promise;
  return cachedDb.conn;
}

// Database connection middleware for Serverless
app.use(async (req, res, next) => {
  try {
    await connectToDatabase();
    next();
  } catch (err) {
    console.error('❌ MongoDB connection error:', err);
    return res.status(500).json({
      message: 'Database connection failed. Please ensure MONGO_URI is correctly set in Vercel Environment Variables.',
      error: err.message
    });
  }
});

// Routes
import authRoutes from './routes/auth.js';
import warehousesRoutes from './routes/warehouses.js';
import locationsRoutes from './routes/locations.js';
import inventoryRoutes from './routes/inventory.js';
import receivingRoutes from './routes/receiving.js';
import transfersRoutes from './routes/transfers.js';
import pickingRoutes from './routes/picking.js';
import packingRoutes from './routes/packing.js';
import ordersRoutes from './routes/orders.js';
import ecommerceRoutes from './routes/ecommerce.js';
import shippingRoutes from './routes/shipping.js';
import carriersRoutes from './routes/carriers.js';
import returnsRoutes from './routes/returns.js';
import crmRoutes from './routes/crm.js';
import billingRoutes from './routes/billing.js';
import accountingRoutes from './routes/accounting.js';
import reportsRoutes from './routes/reports.js';
import settingsRoutes from './routes/settings.js';
import activityRoutes from './routes/activity.js';
import adminRoutes from './routes/admin.js';
import dashboardRoutes from './routes/dashboard.js';
import asnRoutes from './routes/asn.js';
import leadsRoutes from './routes/leads.js';
import carrierRulesRoutes from './routes/carrier_rules.js';
import incidentsRoutes from './routes/incidents.js';
import zonesRoutes from './routes/zones.js';
import storageRulesRoutes from './routes/storage_rules.js';
import stockCountsRoutes from './routes/stock_counts.js';
import documentsRoutes from './routes/documents.js';
import notificationsRoutes from './routes/notifications.js';
import qcRoutes from './routes/qc.js';
import putawayRoutes from './routes/putaway.js';
import clientsRoutes from './routes/clients.js';
import suppliersRoutes from './routes/suppliers.js';
import categoriesRoutes from './routes/categories.js';
import integrationsRoutes from './routes/integrations.js';

function mountModuleRoute(path, router) {
  const segment = path.replace('/api/v1/', '');
  const module = ROUTE_MODULE_MAP[segment];
  if (module) {
    app.use(path, protect, requireModuleAccess(module), router);
  } else {
    app.use(path, router);
  }
}

app.use('/api/v1/auth', authRoutes);
mountModuleRoute('/api/v1/warehouses', warehousesRoutes);
mountModuleRoute('/api/v1/locations', locationsRoutes);
mountModuleRoute('/api/v1/inventory', inventoryRoutes);
mountModuleRoute('/api/v1/receiving', receivingRoutes);
mountModuleRoute('/api/v1/qc', qcRoutes);
mountModuleRoute('/api/v1/putaway', putawayRoutes);
mountModuleRoute('/api/v1/asn', asnRoutes);
mountModuleRoute('/api/v1/transfers', transfersRoutes);
mountModuleRoute('/api/v1/picking', pickingRoutes);
mountModuleRoute('/api/v1/packing', packingRoutes);
mountModuleRoute('/api/v1/orders', ordersRoutes);
mountModuleRoute('/api/v1/ecommerce', ecommerceRoutes);
app.use('/api/v1/integrations', integrationsRoutes);
mountModuleRoute('/api/v1/shipping', shippingRoutes);
mountModuleRoute('/api/v1/carriers', carriersRoutes);
mountModuleRoute('/api/v1/returns', returnsRoutes);
mountModuleRoute('/api/v1/crm', crmRoutes);
mountModuleRoute('/api/v1/billing', billingRoutes);
mountModuleRoute('/api/v1/accounting', accountingRoutes);
mountModuleRoute('/api/v1/reports', reportsRoutes);
mountModuleRoute('/api/v1/settings', settingsRoutes);
mountModuleRoute('/api/v1/activity', activityRoutes);
mountModuleRoute('/api/v1/admin', adminRoutes);
mountModuleRoute('/api/v1/incidents', incidentsRoutes);
mountModuleRoute('/api/v1/dashboard', dashboardRoutes);
mountModuleRoute('/api/v1/leads', leadsRoutes);
mountModuleRoute('/api/v1/carrier-rules', carrierRulesRoutes);
mountModuleRoute('/api/v1/zones', zonesRoutes);
mountModuleRoute('/api/v1/storage-rules', storageRulesRoutes);
mountModuleRoute('/api/v1/stock-counts', stockCountsRoutes);
mountModuleRoute('/api/v1/documents', documentsRoutes);
mountModuleRoute('/api/v1/notifications', notificationsRoutes);
mountModuleRoute('/api/v1/clients', clientsRoutes);
mountModuleRoute('/api/v1/suppliers', suppliersRoutes);
mountModuleRoute('/api/v1/categories', categoriesRoutes);

app.get('/', (req, res) => {
  res.send('demologistics API is running');
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error(err.stack);

  if (err.name === 'ValidationError') {
    return res.status(400).json({ message: Object.values(err.errors).map(e => e.message).join(', ') });
  }
  if (err.code === 11000) {
    const fields = err.keyValue ? Object.keys(err.keyValue).join(', ') : 'field';
    const val = err.keyValue ? Object.values(err.keyValue).join(', ') : 'value';
    return res.status(400).json({ message: `Duplicate field error: ${fields} '${val}' already exists.` });
  }

  res.status(err.status || 500).json({
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

const PORT = process.env.PORT || 5000;
if (!process.env.VERCEL) {
  connectToDatabase().then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  }).catch(err => {
    console.error('Failed to connect to MongoDB:', err);
  });
}

export default app;
