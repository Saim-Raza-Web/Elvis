import fs from 'fs';
import path from 'path';

const routesDir = path.join(process.cwd(), 'server', 'routes');

const operationalRoutes = [
  'inventory.js',
  'orders.js',
  'receiving.js',
  'picking.js',
  'packing.js',
  'shipping.js',
  'carriers.js',
  'locations.js',
  'transfers.js',
  'stock_counts.js',
  'ecommerce.js',
  'returns.js',
  'crm.js',
  'incidents.js',
  'leads.js',
  'carrier_rules.js',
  'storage_rules.js',
  'asn.js'
];

for (const file of operationalRoutes) {
  const filePath = path.join(routesDir, file);
  if (!fs.existsSync(filePath)) {
    console.log(`Skipping ${file} - does not exist.`);
    continue;
  }
  
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Update import if needed
  if (!content.includes('requireRole')) {
    content = content.replace(/import\s+{\s*protect\s*}\s+from\s+['"]\.\.\/middleware\/auth\.js['"];?/, "import { protect, requireRole } from '../middleware/auth.js';");
  }
  
  // Define ops role middleware
  if (!content.includes('requireOpsRole')) {
    content = content.replace(/router\.use\(protect\);([^\n]*)/, "router.use(protect);$1\n\nconst requireOpsRole = requireRole('admin', 'manager');");
  }
  
  // Inject into post, put, delete
  content = content.replace(/router\.(post|put|delete)\(\s*(['"][^'"]+['"])\s*,\s*(?!requireOpsRole)(async\s*\(\s*req)/g, "router.$1($2, requireOpsRole, $3");
  
  fs.writeFileSync(filePath, content);
  console.log(`Updated ${file}`);
}
