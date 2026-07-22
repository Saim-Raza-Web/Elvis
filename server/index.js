import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import morgan from 'morgan';

// Load environment variables
dotenv.config();

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

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/warehouses', warehousesRoutes);
app.use('/api/v1/locations', locationsRoutes);
app.use('/api/v1/inventory', inventoryRoutes);
app.use('/api/v1/receiving', receivingRoutes);
app.use('/api/v1/asn', asnRoutes);
app.use('/api/v1/transfers', transfersRoutes);
app.use('/api/v1/picking', pickingRoutes);
app.use('/api/v1/packing', packingRoutes);
app.use('/api/v1/orders', ordersRoutes);
app.use('/api/v1/ecommerce', ecommerceRoutes);
app.use('/api/v1/shipping', shippingRoutes);
app.use('/api/v1/carriers', carriersRoutes);
app.use('/api/v1/returns', returnsRoutes);
app.use('/api/v1/crm', crmRoutes);
app.use('/api/v1/billing', billingRoutes);
app.use('/api/v1/accounting', accountingRoutes);
app.use('/api/v1/reports', reportsRoutes);
app.use('/api/v1/settings', settingsRoutes);
app.use('/api/v1/activity', activityRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/leads', leadsRoutes);
app.use('/api/v1/carrier-rules', carrierRulesRoutes);

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
    return res.status(400).json({ message: 'Duplicate field value entered' });
  }

  res.status(err.status || 500).json({
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

const PORT = process.env.PORT || 5000;
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
}

export default app;
