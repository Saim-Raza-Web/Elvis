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

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB Atlas'))
  .catch(err => {
    console.error('❌ MongoDB connection error:', err.message);
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

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/warehouses', warehousesRoutes);
app.use('/api/v1/locations', locationsRoutes);
app.use('/api/v1/inventory', inventoryRoutes);
app.use('/api/v1/receiving', receivingRoutes);
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

app.get('/', (req, res) => {
  res.send('demologistics API is running');
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error(err.stack);
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
