/** Keep in sync with server/config/permissions.js */
export type PermissionModule =
  | 'dashboard'
  | 'inventory'
  | 'locations'
  | 'receiving'
  | 'qc'
  | 'picking'
  | 'packing'
  | 'shipping'
  | 'returns'
  | 'orders'
  | 'warehouses'
  | 'billing'
  | 'reports'
  | 'settings'
  | 'admin';

export type UserRole = 'admin' | 'manager' | 'warehouse_staff' | 'client_3pl' | 'management' | 'office' | string;

export const PERMISSION_MODULES: PermissionModule[] = [
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

export const ROLE_PERMISSIONS: Record<string, Record<PermissionModule, boolean>> = {
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

export function canAccessModule(role: string | undefined, module: PermissionModule, customRolePermissions?: Record<string, boolean>): boolean {
  if (role === 'admin') return true;

  if (customRolePermissions && typeof customRolePermissions === 'object') {
    if (module in customRolePermissions) {
      return Boolean(customRolePermissions[module]);
    }
  }

  const r = (role || 'warehouse_staff');
  const perms = ROLE_PERMISSIONS[r] || ROLE_PERMISSIONS.warehouse_staff;
  return Boolean(perms[module]);
}

/** AppShell page id → permission module */
export const PAGE_MODULE_MAP: Record<string, PermissionModule> = {
  dashboard: 'dashboard',
  warehouses: 'warehouses',
  locations: 'locations',
  inventory: 'inventory',
  receiving: 'receiving',
  transfers: 'inventory',
  'stock-counts': 'inventory',
  picking: 'picking',
  packing: 'packing',
  shipping: 'shipping',
  returns: 'returns',
  qc: 'qc',
  incidents: 'inventory',
  activity: 'inventory',
  orders: 'orders',
  ecommerce: 'orders',
  crm: 'orders',
  carriers: 'shipping',
  billing: 'billing',
  accounting: 'billing',
  reports: 'reports',
  settings: 'settings',
  admin: 'admin',
  subscription: 'settings',
  'client-portal': 'dashboard',
};
