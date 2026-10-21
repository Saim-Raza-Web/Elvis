import api from './api';

export const authService = {
  login: async (email: string, password: string) => {
    const response = await api.post('/auth/login', { email, password });
    // Store user data in localStorage (non-sensitive data only)
    if (response.data.user) {
      localStorage.setItem('user', JSON.stringify(response.data.user));
    }
    // Store CSRF token for state-changing requests
    if (response.data.csrfToken) {
      localStorage.setItem('csrf_token', response.data.csrfToken);
    }
    return response.data;
  },
  register: async (email: string, password: string, name: string) => {
    const response = await api.post('/auth/register', { email, password, name });
    // Store user data in localStorage (non-sensitive data only)
    if (response.data.user) {
      localStorage.setItem('user', JSON.stringify(response.data.user));
    }
    // Store CSRF token for state-changing requests
    if (response.data.csrfToken) {
      localStorage.setItem('csrf_token', response.data.csrfToken);
    }
    return response.data;
  },
  logout: async () => {
    // Call backend logout to clear cookies
    try {
      await api.post('/auth/logout');
    } catch (error) {
      console.error('Logout API call failed:', error);
    }
    // Clear localStorage user data
    localStorage.removeItem('user');
    localStorage.removeItem('csrf_token');
  },
  getCurrentUser: () => {
    const user = localStorage.getItem('user');
    return user ? JSON.parse(user) : null;
  },
  isAuthenticated: async () => {
    // Check session by calling /me endpoint
    try {
      const response = await api.get('/auth/me');
      // Update user data in localStorage
      if (response.data.user) {
        localStorage.setItem('user', JSON.stringify(response.data.user));
      }
      if (response.data.csrfToken) {
        localStorage.setItem('csrf_token', response.data.csrfToken);
      }
      return true;
    } catch (error) {
      // Session not valid
      localStorage.removeItem('user');
      localStorage.removeItem('csrf_token');
      return false;
    }
  },
  getCompanies: async () => {
    const response = await api.get('/auth/companies');
    return response.data;
  },
  switchCompany: async (companyId: string) => {
    const response = await api.put(`/auth/company/${companyId}`);
    if (response.data) {
      localStorage.setItem('user', JSON.stringify(response.data));
    }
    return response.data;
  },
  createCompany: async (name: string) => {
    const response = await api.post('/auth/companies', { name });
    if (response.data.user) {
      localStorage.setItem('user', JSON.stringify(response.data.user));
    }
    return response.data;
  },
  changePassword: async (currentPassword: string, newPassword: string) => {
    const response = await api.put('/auth/password', { currentPassword, newPassword });
    return response.data;
  },
  // TOTP 2FA methods
  get2FAStatus: async () => {
    const response = await api.get('/auth/2fa/status');
    return response.data;
  },
  setup2FA: async () => {
    const response = await api.post('/auth/2fa/setup');
    return response.data;
  },
  verify2FA: async (code: string) => {
    const response = await api.post('/auth/2fa/verify', { code });
    return response.data;
  },
  disable2FA: async (password: string) => {
    const response = await api.post('/auth/2fa/disable', { password });
    return response.data;
  },
  regenerateRecoveryCodes: async (password: string) => {
    const response = await api.post('/auth/2fa/regenerate-codes', { password });
    return response.data;
  },
  cancel2FASetup: async () => {
    const response = await api.post('/auth/2fa/cancel-setup');
    return response.data;
  },
  verify2FALogin: async (challengeToken: string, code: string, isRecoveryCode: boolean = false) => {
    const response = await api.post('/auth/2fa/verify-login', { challengeToken, code, isRecoveryCode });
    // Store user data in localStorage (non-sensitive data only)
    if (response.data.user) {
      localStorage.setItem('user', JSON.stringify(response.data.user));
    }
    // Store CSRF token for state-changing requests
    if (response.data.csrfToken) {
      localStorage.setItem('csrf_token', response.data.csrfToken);
    }
    return response.data;
  },
};
