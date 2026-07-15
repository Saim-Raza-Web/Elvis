import mongoose from 'mongoose';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

import User from './models/User.js';
import Company from './models/Company.js';
import Warehouse from './models/Warehouse.js';
import Product from './models/Product.js';
import Order from './models/Order.js';

dotenv.config();

const seedDatabase = async () => {
  try {
    console.log('⏳ Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected.');

    console.log('⏳ Clearing existing data...');
    await Promise.all([
      User.deleteMany(),
      Company.deleteMany(),
      Warehouse.deleteMany(),
      Product.deleteMany(),
      Order.deleteMany()
    ]);

    console.log('⏳ Seeding Company and User...');
    const company = await Company.create({
      name: 'demologistics',
      plan: 'professional'
    });

    const hashedPassword = await bcrypt.hash('admin123', 10);
    const admin = await User.create({
      email: 'admin@demologistics.io',
      password: hashedPassword,
      name: 'Admin User',
      role: 'admin',
      company: company._id
    });

    console.log('⏳ Seeding Warehouses...');
    const warehousesData = [
      { name: "Miami Hub", code: "MIA", location: "Miami, FL", country: "US", capacity: 5000, used: 3842, status: "active", manager: "Carlos Rivera", temp: "22°C", company: company._id },
      { name: "Los Angeles DC", code: "LAX", location: "Los Angeles, CA", country: "US", capacity: 8000, used: 7621, status: "active", manager: "Sarah Chen", temp: "24°C", company: company._id },
      { name: "Chicago Distribution", code: "ORD", location: "Chicago, IL", country: "US", capacity: 6500, used: 2100, status: "active", manager: "Mike Johnson", temp: "20°C", company: company._id },
      { name: "New York East", code: "JFK", location: "Newark, NJ", country: "US", capacity: 4000, used: 3100, status: "active", manager: "Priya Patel", temp: "21°C", company: company._id },
      { name: "Dallas Central", code: "DAL", location: "Dallas, TX", country: "US", capacity: 7000, used: 4500, status: "active", manager: "Tom Williams", temp: "26°C", company: company._id },
      { name: "Seattle North", code: "SEA", location: "Seattle, WA", country: "US", capacity: 3500, used: 800, status: "inactive", manager: "Emma Davis", temp: "18°C", company: company._id },
    ];
    const warehouses = await Warehouse.insertMany(warehousesData);

    console.log('⏳ Seeding Products...');
    const productsData = [
      { sku: "SKU-1001", name: "Wireless Earbuds Pro", category: "Electronics", warehouse: warehouses[0]._id, price: 129.99, qty_available: 450, qty_reserved: 50, qty_blocked: 0, status: "ok", company: company._id },
      { sku: "SKU-1002", name: "Mechanical Keyboard", category: "Hardware", warehouse: warehouses[1]._id, price: 149.50, qty_available: 15, qty_reserved: 10, qty_blocked: 5, status: "low", company: company._id },
      { sku: "SKU-1003", name: "Ergonomic Mouse", category: "Hardware", warehouse: warehouses[2]._id, price: 79.99, qty_available: 1200, qty_reserved: 300, qty_blocked: 0, status: "ok", company: company._id },
    ];
    await Product.insertMany(productsData);

    console.log('⏳ Seeding Orders...');
    const ordersData = [
      { orderId: "ORD-98234", customer: "Acme Corp", email: "procurement@acme.com", channel: "Shopify", warehouse: warehouses[0]._id, items: 45, total: 2450.00, status: "pending", company: company._id },
      { orderId: "ORD-98235", customer: "TechNova Inc", email: "orders@technova.io", channel: "Amazon", warehouse: warehouses[1]._id, items: 12, total: 890.50, status: "processing", company: company._id },
      { orderId: "ORD-98236", customer: "Global Retail", email: "buyer@globalretail.net", channel: "Direct", warehouse: warehouses[2]._id, items: 150, total: 12400.00, status: "shipped", company: company._id },
    ];
    await Order.insertMany(ordersData);

    console.log('✅ Database seeded successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Seeding failed:', err);
    process.exit(1);
  }
};

seedDatabase();
