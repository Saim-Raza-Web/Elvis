import fs from 'fs';
import path from 'path';

const routes = [
  'auth', 'warehouses', 'locations', 'inventory', 'receiving',
  'transfers', 'picking', 'packing', 'orders', 'ecommerce',
  'shipping', 'carriers', 'returns', 'crm', 'billing',
  'accounting', 'reports', 'settings', 'activity', 'admin', 'dashboard'
];

const routesDir = path.join(process.cwd(), 'server', 'routes');
if (!fs.existsSync(routesDir)) {
  fs.mkdirSync(routesDir, { recursive: true });
}

for (const name of routes) {
  const content = "import express from 'express';\\n" +
"import { protect } from '../middleware/auth.js';\\n\\n" +
"const router = express.Router();\\n\\n" +
"router.use(protect); // Secure all routes by default\\n\\n" +
"router.get('/', (req, res) => {\\n" +
"  res.json({ message: '" + name + " route works' });\\n" +
"});\\n\\n" +
"export default router;\\n";

  fs.writeFileSync(path.join(routesDir, name + '.js'), content);
}

// Special case for Auth (should not be protected by default on login)
const authContent = "import express from 'express';\\n" +
"import jwt from 'jsonwebtoken';\\n" +
"import User from '../models/User.js';\\n" +
"import { protect } from '../middleware/auth.js';\\n\\n" +
"const router = express.Router();\\n\\n" +
"// Public route\\n" +
"router.post('/login', async (req, res, next) => {\\n" +
"  try {\\n" +
"    const { email, password } = req.body;\\n" +
"    \\n" +
"    // Find user (ignoring password check for demo purposes if it matches the mock credentials)\\n" +
"    // Note: For a real app, use bcrypt to compare passwords\\n" +
"    \\n" +
"    if (email === 'admin@demologistics.io' && password === 'admin123') {\\n" +
"      const user = await User.findOne({ email });\\n" +
"      if (!user) {\\n" +
"        return res.status(401).json({ message: 'User not found in DB. Did you run the seed script?' });\\n" +
"      }\\n" +
"      \\n" +
"      const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {\\n" +
"        expiresIn: process.env.JWT_EXPIRES_IN\\n" +
"      });\\n" +
"      \\n" +
"      return res.json({ token, user });\\n" +
"    }\\n" +
"    \\n" +
"    return res.status(401).json({ message: 'Invalid credentials. Use admin@demologistics.io / admin123' });\\n" +
"  } catch (error) {\\n" +
"    next(error);\\n" +
"  }\\n" +
"});\\n\\n" +
"// Protected route\\n" +
"router.get('/me', protect, (req, res) => {\\n" +
"  res.json(req.user);\\n" +
"});\\n\\n" +
"export default router;\\n";
fs.writeFileSync(path.join(routesDir, 'auth.js'), authContent);

console.log('✅ Created 21 Express route files');
