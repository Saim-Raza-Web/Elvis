/** Module keys align with Settings permissions matrix and frontend nav gating. */
export const PERMISSION_MODULES = [
  'dashboard',
  'warehouses',
  'inventory',
  'orders',
  'billing',
  'reports',
  'settings',
  'admin',
];

export const ROLE_PERMISSIONS = {
  admin: {
    dashboard: true,
    warehouses: true,
    inventory: true,
    orders: true,
    billing: true,
    reports: true,
    settings: true,
    admin: true,
  },
  manager: {
    dashboard: true,
    warehouses: true,
    inventory: true,
    orders: true,
    billing: false,
    reports: true,
    settings: false,
    admin: false,
  },
  warehouse_staff: {
    dashboard: true,
    warehouses: false,
    inventory: true,
    orders: false,
    billing: false,
    reports: false,
    settings: false,
    admin: false,
  },
};

/** Display metadata for Settings UI (maps to real User.role values). */
export const ROLE_DEFINITIONS = [
  {
    id: 'admin',
    name: 'Admin',
    description: 'Full access to all features and settings',
    color: 'text-primary bg-primary/10',
    permissions: ROLE_PERMISSIONS.admin,
  },
  {
    id: 'manager',
    name: 'Manager',
    description: 'Can manage warehouse operations and view reports',
    color: 'text-blue-500 bg-blue-500/10',
    permissions: ROLE_PERMISSIONS.manager,
  },
  {
    id: 'warehouse_staff',
    name: 'Warehouse Staff',
    description: 'Can perform picking, packing, receiving operations',
    color: 'text-success bg-success/10',
    permissions: ROLE_PERMISSIONS.warehouse_staff,
  },
];

export function canAccessModule(role, module) {
  const perms = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.warehouse_staff;
  return Boolean(perms[module]);
}

/** API route prefix (without /api/v1) → permission module */
export const ROUTE_MODULE_MAP = {
  orders: 'orders',
  warehouses: 'warehouses',
  inventory: 'inventory',
  locations: 'inventory',
  receiving: 'inventory',
  qc: 'inventory',
  putaway: 'inventory',
  asn: 'inventory',
  transfers: 'inventory',
  picking: 'inventory',
  packing: 'inventory',
  shipping: 'inventory',
  returns: 'inventory',
  incidents: 'inventory',
  'stock-counts': 'inventory',
  zones: 'inventory',
  'storage-rules': 'inventory',
  carriers: 'inventory',
  'carrier-rules': 'inventory',
  activity: 'inventory',
  notifications: 'inventory',
  crm: 'orders',
  leads: 'orders',
  ecommerce: 'orders',
  integrations: 'orders',
  billing: 'billing',
  accounting: 'billing',
  reports: 'reports',
  settings: 'settings',
  admin: 'admin',
  dashboard: 'dashboard',
  documents: 'inventory',
  clients: 'inventory',
  suppliers: 'inventory',
  categories: 'inventory',
};
