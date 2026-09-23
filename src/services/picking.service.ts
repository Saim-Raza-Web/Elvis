import api from './api';
import { fetchList, fetchPaginated, unwrapList } from './listApi';

// Get current user role from localStorage
const getCurrentUserRole = (): string => {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    return user.role || 'warehouse_staff';
  } catch {
    return 'warehouse_staff';
  }
};

export const pickingService = {
  getAll: async (params = {}) => {
    const role = getCurrentUserRole();
    // Add role-specific filtering
    const roleParams = { ...params };

    // warehouse_staff: only their assigned tasks
    // management: only tasks for their assigned warehouses
    // client_3pl: only tasks for their client
    // office: no picking tasks (blocked by permissions)
    // admin/manager: all tasks

    return fetchList('/picking', roleParams);
  },
  getPage: async (params = {}) => {
    const role = getCurrentUserRole();
    const roleParams = { ...params };

    return fetchPaginated('/picking', roleParams);
  },
  getById: async (id: string) => {
    const response = await api.get('/picking/' + id);
    return response.data;
  },
  create: async (data: any) => {
    const response = await api.post('/picking', data);
    return response.data;
  },
  update: async (id: string, data: any) => {
    const response = await api.put('/picking/' + id, data);
    return response.data;
  },
  delete: async (id: string) => {
    const response = await api.delete('/picking/' + id);
    return response.data;
  },
  lookup: async (code: string) => {
    const response = await api.get('/picking/lookup/' + encodeURIComponent(code));
    return response.data;
  },
  complete: async (id: string, payload: any) => {
    const response = await api.post(`/picking/${id}/complete`, payload);
    return response.data;
  },
  getBatches: async (params = {}) => {
    const response = await api.get('/picking/batches', { params: { ...params, all: true } });
    return unwrapList(response.data);
  },
  getBatchesPage: async (params = {}) => fetchPaginated('/picking/batches', params),
  createBatch: async (data: any) => {
    const response = await api.post('/picking/batches', data);
    return response.data;
  },
  updateBatch: async (id: string, data: any) => {
    const response = await api.put('/picking/batches/' + id, data);
    return response.data;
  },
  completeBatch: async (id: string) => {
    const response = await api.put('/picking/batches/' + id + '/complete');
    return response.data;
  },
  cancelBatch: async (id: string) => {
    const response = await api.put('/picking/batches/' + id + '/cancel');
    return response.data;
  },

  // Role-specific task queue filtering (frontend-side based on permissions)
  getRoleFilteredTasks: async (allTasks: any[], params = {}) => {
    const role = getCurrentUserRole();
    const currentUser = JSON.parse(localStorage.getItem('user') || '{}');

    // Apply role-specific filtering
    let filteredTasks = allTasks;

    switch (role) {
      case 'warehouse_staff':
        // Only show tasks assigned to current user or unassigned
        filteredTasks = allTasks.filter(task =>
          !task.assignee || task.assignee === currentUser.email || task.assignee === currentUser.name
        );
        break;
      case 'management':
        // Only show tasks for user's assigned warehouses
        if (currentUser.warehouses && currentUser.warehouses.length > 0) {
          filteredTasks = allTasks.filter(task =>
            currentUser.warehouses.includes(task.warehouse)
          );
        }
        break;
      case 'client_3pl':
        // Only show tasks for user's client
        if (currentUser.clientId) {
          filteredTasks = allTasks.filter(task =>
            task.owner === currentUser.clientName // Uses existing owner isolation
          );
        }
        break;
      case 'office':
        // Office users don't see picking tasks
        filteredTasks = [];
        break;
      case 'admin':
      case 'manager':
        // See all tasks
        filteredTasks = allTasks;
        break;
      default:
        filteredTasks = allTasks;
    }

    return filteredTasks;
  }
};
