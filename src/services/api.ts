import axios, { InternalAxiosRequestConfig } from 'axios';

const api = axios.create({
  baseURL: '/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true, // Send cookies with requests
});

api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // Add CSRF token for state-changing methods
    if (config.method && ['post', 'put', 'patch', 'delete'].includes(config.method.toLowerCase())) {
      const csrfToken = getCsrfToken();
      if (csrfToken && config.headers) {
        config.headers['X-CSRF-Token'] = csrfToken;
      }
    }
    return config;
  },
  (error: any) => Promise.reject(error)
);

api.interceptors.response.use(
  (response: any) => response,
  (error: any) => {
    if (error.response?.status === 401) {
      const isAuthRoute = error.config?.url?.includes('/auth/login') || error.config?.url?.includes('/auth/register');
      if (!isAuthRoute) {
        // Redirect to login page on 401
        window.location.href = '/';
      }
    }
    return Promise.reject(error);
  }
);

/**
 * Get CSRF token from cookie
 */
function getCsrfToken(): string | null {
  const match = document.cookie.match(/(^|;\s*)csrf_token=([^;]*)/);
  return match ? decodeURIComponent(match[2]) : null;
}

/**
 * Helper to add CSRF token to fetch options for state-changing requests
 */
export function getFetchWithCsrfOptions(method: string, options: RequestInit = {}): RequestInit {
  const isStateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());

  const fetchOptions: RequestInit = {
    ...options,
    credentials: 'include' as RequestCredentials,
  };

  if (isStateChanging) {
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      fetchOptions.headers = {
        ...fetchOptions.headers,
        'X-CSRF-Token': csrfToken,
      };
    }
  }

  return fetchOptions;
}

export default api;
