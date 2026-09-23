/** Keep in sync with server/config/permissions.js */
export type PermissionModule =
  | 'dashboard'
  | 'warehouses'
  | 'inventory'
  | 'orders'
  | 'billing'
  | 'reports'
  | 'settings'
  | 'admin';

export type UserRole = 'admin' | 'manager' | 'warehouse_staff' | 'client_3pl' | 'management' | 'office';

export const PERMISSION_MODULES: PermissionModule[] = [
  'dashboard',
  'warehouses',
  'inventory',
  'orders',
  'billing',
  'reports',
  'settings',
  'admin',
];

export const ROLE_PERMISSIONS: Record<UserRole, Record<PermissionModule, boolean>> = {
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
  client_3pl: {
    dashboard: true,
    warehouses: false,
    inventory: true,
    orders: true,
    billing: false,
    reports: false,
    settings: false,
    admin: false,
  },
  management: {
    dashboard: true,
    warehouses: true,
    inventory: true,
    orders: true,
    billing: false,
    reports: true,
    settings: false,
    admin: false,
  },
  office: {
    dashboard: true,
    warehouses: false,
    inventory: false,
    orders: true,
    billing: false,
    reports: true,
    settings: false,
    admin: false,
  },
};

export const ROLE_DEFINITIONS = [
  {
    id: 'admin' as UserRole,
    name: 'Admin',
    description: 'Full access to all features and settings',
    color: 'text-primary bg-primary/10',
    permissions: ROLE_PERMISSIONS.admin,
  },
  {
    id: 'manager' as UserRole,
    name: 'Manager',
    description: 'Can manage warehouse operations and view reports',
    color: 'text-blue-500 bg-blue-500/10',
    permissions: ROLE_PERMISSIONS.manager,
  },
  {
    id: 'warehouse_staff' as UserRole,
    name: 'Warehouse Staff',
    description: 'Can perform picking, packing, receiving operations',
    color: 'text-success bg-success/10',
    permissions: ROLE_PERMISSIONS.warehouse_staff,
  },
  {
    id: 'client_3pl' as UserRole,
    name: '3PL Client',
    description: 'Client with access to own inventory and orders only',
    color: 'text-purple-500 bg-purple-500/10',
    permissions: ROLE_PERMISSIONS.client_3pl,
  },
  {
    id: 'management' as UserRole,
    name: 'Management',
    description: 'Warehouse-scoped manager with limited warehouse access',
    color: 'text-orange-500 bg-orange-500/10',
    permissions: ROLE_PERMISSIONS.management,
  },
  {
    id: 'office' as UserRole,
    name: 'Office',
    description: 'Business and reporting access, no warehouse operations',
    color: 'text-cyan-500 bg-cyan-500/10',
    permissions: ROLE_PERMISSIONS.office,
  },
];

export function canAccessModule(role: string | undefined, module: PermissionModule): boolean {
  const r = (role || 'warehouse_staff') as UserRole;
  const perms = ROLE_PERMISSIONS[r] || ROLE_PERMISSIONS.warehouse_staff;
  return Boolean(perms[module]);
}

/** AppShell page id → permission module */
export const PAGE_MODULE_MAP: Record<string, PermissionModule> = {
  dashboard: 'dashboard',
  warehouses: 'warehouses',
  locations: 'inventory',
  inventory: 'inventory',
  receiving: 'inventory',
  transfers: 'inventory',
  'stock-counts': 'inventory',
  picking: 'inventory',
  packing: 'inventory',
  shipping: 'inventory',
  returns: 'inventory',
  incidents: 'inventory',
  activity: 'inventory',
  orders: 'orders',
  ecommerce: 'orders',
  crm: 'orders',
  carriers: 'inventory',
  billing: 'billing',
  accounting: 'billing',
  reports: 'reports',
  settings: 'settings',
  admin: 'admin',
  subscription: 'settings',
};
