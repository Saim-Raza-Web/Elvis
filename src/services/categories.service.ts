import api from './api';

export type ProductCategory = {
  _id: string;
  code: string;
  name: string;
  qc_behaviour?: string;
  recommended_zone?: string;
  description?: string;
  active?: boolean;
};

export const categoriesService = {
  getAll: async () => {
    const res = await api.get('/categories');
    return Array.isArray(res.data) ? res.data : (res.data?.data || []);
  },
  create: async (data: Partial<ProductCategory>) => {
    const res = await api.post('/categories', data);
    return res.data;
  },
  update: async (id: string, data: Partial<ProductCategory>) => {
    const res = await api.put(`/categories/${id}`, data);
    return res.data;
  },
  delete: async (id: string) => {
    const res = await api.delete(`/categories/${id}`);
    return res.data;
  }
};
