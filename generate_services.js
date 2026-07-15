import fs from 'fs';
import path from 'path';

const services = [
  'warehouses', 'locations', 'inventory', 'receiving',
  'transfers', 'picking', 'packing', 'orders', 'ecommerce',
  'shipping', 'carriers', 'returns', 'crm', 'billing',
  'accounting', 'reports', 'settings', 'activity', 'admin', 'dashboard'
];

const servicesDir = path.join(process.cwd(), 'src', 'services');
if (!fs.existsSync(servicesDir)) {
  fs.mkdirSync(servicesDir, { recursive: true });
}

for (const name of services) {
  const capName = name.charAt(0).toUpperCase() + name.slice(1);
  const content = "import api from './api';\\n\\n" +
"export const " + name + "Service = {\\n" +
"  getAll: async (params = {}) => {\\n" +
"    const response = await api.get('/" + name + "', { params });\\n" +
"    return response.data;\\n" +
"  },\\n" +
"  getById: async (id) => {\\n" +
"    const response = await api.get('/" + name + "/' + id);\\n" +
"    return response.data;\\n" +
"  },\\n" +
"  create: async (data) => {\\n" +
"    const response = await api.post('/" + name + "', data);\\n" +
"    return response.data;\\n" +
"  },\\n" +
"  update: async (id, data) => {\\n" +
"    const response = await api.put('/" + name + "/' + id, data);\\n" +
"    return response.data;\\n" +
"  },\\n" +
"  delete: async (id) => {\\n" +
"    const response = await api.delete('/" + name + "/' + id);\\n" +
"    return response.data;\\n" +
"  }\\n" +
"};\\n";

  fs.writeFileSync(path.join(servicesDir, name + '.service.ts'), content);
}

console.log('✅ Created 20 frontend service files');
