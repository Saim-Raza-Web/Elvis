/**
 * Module keys align with Settings permissions matrix and server-enforced route gating.
 * Granular modules include dedicated controls for Quality, Locations, Returns,
 * Receiving, Picking, Packing, Shipping, and core WMS domains.
 */
export const PERMISSION_MODULES = [
  'dashboard',
  'inventory',
  'locations',
  'receiving',
  'qc',
  'picking',
  'packing',
  'shipping',
  'returns',
  'orders',
  'warehouses',
  'billing',
  'reports',
  'settings',
  'admin',
];

export const ROLE_PERMISSIONS = {
  admin: {
    dashboard: true,
    inventory: true,
    locations: true,
    receiving: true,
    qc: true,
    picking: true,
    packing: true,
    shipping: true,
    returns: true,
    orders: true,
    warehouses: true,
    billing: true,
    reports: true,
    settings: true,
    admin: true,
  },
  manager: {
    dashboard: true,
    inventory: true,
    locations: true,
    receiving: true,
    qc: true,
    picking: true,
    packing: true,
    shipping: true,
    returns: true,
    orders: true,
    warehouses: true,
    billing: false,
    reports: true,
    settings: false,
    admin: false,
  },
  warehouse_staff: {
    dashboard: true,
    inventory: true,
    locations: false,
    receiving: true,
    qc: false,
    picking: true,
    packing: true,
    shipping: true,
    returns: true,
    orders: false,
    warehouses: false,
    billing: false,
    reports: false,
    settings: false,
    admin: false,
  },
  client_3pl: {
    dashboard: true,
    inventory: true,
    locations: false,
    receiving: false,
    qc: false,
    picking: false,
    packing: false,
    shipping: false,
    returns: false,
    orders: true,
    warehouses: false,
    billing: false,
    reports: false,
    settings: false,
    admin: false,
  },
  management: {
    dashboard: true,
    inventory: true,
    locations: true,
    receiving: true,
    qc: true,
    picking: true,
    packing: true,
    shipping: true,
    returns: true,
    orders: true,
    warehouses: true,
    billing: false,
    reports: true,
    settings: false,
    admin: false,
  },
  office: {
    dashboard: true,
    inventory: false,
    locations: false,
    receiving: false,
    qc: false,
    picking: false,
    packing: false,
    shipping: false,
    returns: true,
    orders: true,
    warehouses: false,
    billing: false,
    reports: true,
    settings: false,
    admin: false,
  },
};

/** Display metadata for Settings UI (maps to system User.role values). */
export const ROLE_DEFINITIONS = [
  {
    id: 'admin',
    name: 'Admin',
    description: 'Full access to all features and settings',
    color: 'text-primary bg-primary/10',
    permissions: ROLE_PERMISSIONS.admin,
    isSystem: true,
  },
  {
    id: 'manager',
    name: 'Manager',
    description: 'Can manage warehouse operations, quality, and view reports',
    color: 'text-blue-500 bg-blue-500/10',
    permissions: ROLE_PERMISSIONS.manager,
    isSystem: true,
  },
  {
    id: 'warehouse_staff',
    name: 'Warehouse Staff',
    description: 'Can perform picking, packing, receiving, and returns operations',
    color: 'text-success bg-success/10',
    permissions: ROLE_PERMISSIONS.warehouse_staff,
    isSystem: true,
  },
  {
    id: 'client_3pl',
    name: '3PL Client',
    description: 'Client with access to own inventory and orders only',
    color: 'text-purple-500 bg-purple-500/10',
    permissions: ROLE_PERMISSIONS.client_3pl,
    isSystem: true,
  },
  {
    id: 'management',
    name: 'Management',
    description: 'Warehouse-scoped manager with limited warehouse access',
    color: 'text-orange-500 bg-orange-500/10',
    permissions: ROLE_PERMISSIONS.management,
    isSystem: true,
  },
  {
    id: 'office',
    name: 'Office',
    description: 'Business and reporting access with customer returns handling',
    color: 'text-cyan-500 bg-cyan-500/10',
    permissions: ROLE_PERMISSIONS.office,
    isSystem: true,
  },
];

/**
 * Check if a role can access a module.
 * Supports dynamic company custom permissions passed as customPermissions.
 */
export function canAccessModule(role, module, customPermissions = null) {
  if (role === 'admin') return true;

  if (customPermissions && typeof customPermissions === 'object') {
    if (customPermissions instanceof Map) {
      if (customPermissions.has(module)) {
        return Boolean(customPermissions.get(module));
      }
    } else if (module in customPermissions) {
      return Boolean(customPermissions[module]);
    }
  }

  const perms = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.warehouse_staff;
  return Boolean(perms[module]);
}

/** API route prefix (without /api/v1) → permission module */
export const ROUTE_MODULE_MAP = {
  // Dedicated module endpoints
  locations: 'locations',
  'storage-rules': 'locations',
  zones: 'locations',

  qc: 'qc',
  returns: 'returns',

  receiving: 'receiving',
  putaway: 'receiving',
  'putaway-rules': 'receiving',
  asn: 'receiving',

  picking: 'picking',
  'picking-rules': 'picking',
  packing: 'packing',
  shipping: 'shipping',
  carriers: 'shipping',
  'carrier-rules': 'shipping',

  orders: 'orders',
  ecommerce: 'orders',
  integrations: 'orders',
  edi: 'orders',
  crm: 'orders',
  leads: 'orders',

  inventory: 'inventory',
  transfers: 'inventory',
  'stock-counts': 'inventory',
  'lot-recalls': 'inventory',
  recall: 'inventory',
  'expiry-alerts': 'inventory',
  replenishment: 'inventory',
  'abc-classification': 'inventory',
  sscc: 'inventory',
  documents: 'inventory',
  clients: 'inventory',
  suppliers: 'inventory',
  categories: 'inventory',
  'purchase-orders': 'inventory',
  tasks: 'inventory',
  overrides: 'inventory',
  activity: 'inventory',
  notifications: 'inventory',

  warehouses: 'warehouses',

  billing: 'billing',
  accounting: 'billing',
  'fiscal-periods': 'billing',
  payments: 'billing',
  compliance: 'billing',
  '3pl/billing': 'billing',

  reports: 'reports',
  settings: 'settings',
  admin: 'admin',
  roles: 'admin',
  simulators: 'settings',

  dashboard: 'dashboard',
  kpi: 'dashboard',
  'client-portal': 'dashboard',
};
