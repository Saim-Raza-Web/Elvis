import axios, { InternalAxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';

/**
 * Redirect guard — prevents multiple concurrent 401 responses from
 * each triggering their own window.location.href assignment.
 * This is a module-level variable; it resets to false automatically on
 * every full page load (JS modules are re-evaluated on each navigation).
 * NOTE: do NOT use 'unload' — it is blocked by the Permissions Policy
 * in modern browsers to enable BFCache optimisation.
 */
let isRedirecting = false;

/**
 * Extended Axios Config for PDA Slow-Network Optimization
 */
interface ExtendedAxiosRequestConfig extends InternalAxiosRequestConfig {
  _retryCount?: number;
  _skipRetry?: boolean;
  _skipDedupe?: boolean;
  /**
   * When true the 401 interceptor will NOT fire window.location.href redirect.
   * Use this for the session-bootstrap /auth/me call so App.tsx can handle
   * the rejection gracefully via React state rather than a hard navigation.
   */
  _skipRedirectOn401?: boolean;
}

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 15000, // 15-second timeout to prevent indefinite hangs on PDA cellular/Wi-Fi
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true, // Send cookies with requests
});

// Cache for short-lived, safe reference data reads (TTL: 30 seconds)
interface CacheEntry {
  data: any;
  timestamp: number;
}
const referenceCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30000;

// Set of endpoint path prefixes eligible for short-term safe caching
const CACHEABLE_READ_PREFIXES = [
  '/warehouses',
  '/locations',
  '/roles',
  '/shipping/methods',
  '/carrier-rules',
  '/categories'
];

/**
 * In-flight promise tracker for deduplicating identical concurrent GET requests
 */
const inflightGetRequests = new Map<string, Promise<AxiosResponse<any>>>();

function getRequestKey(config: InternalAxiosRequestConfig): string {
  const paramsStr = config.params ? JSON.stringify(config.params) : '';
  return `${config.method?.toUpperCase() || 'GET'}:${config.url || ''}:${paramsStr}`;
}

/**
 * Invalidate in-memory read cache whenever a state-changing mutation succeeds
 */
export function invalidateReferenceCache(): void {
  referenceCache.clear();
}

api.interceptors.request.use(
  (config: ExtendedAxiosRequestConfig) => {
    const method = (config.method || 'get').toLowerCase();

    // Add CSRF token for state-changing methods
    if (['post', 'put', 'patch', 'delete'].includes(method)) {
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
  (response: AxiosResponse) => {
    const method = (response.config.method || 'get').toLowerCase();

    // Cache invalidation: any successful mutation clears reference cache
    if (['post', 'put', 'patch', 'delete'].includes(method)) {
      invalidateReferenceCache();
    }

    // Cache write for eligible safe GET requests without query params
    if (method === 'get' && response.config.url && !response.config.params) {
      const isEligible = CACHEABLE_READ_PREFIXES.some(prefix => response.config.url?.startsWith(prefix));
      if (isEligible && response.status === 200) {
        referenceCache.set(response.config.url, {
          data: response.data,
          timestamp: Date.now(),
        });
      }
    }

    return response;
  },
  async (error: AxiosError) => {
    const config = error.config as ExtendedAxiosRequestConfig | undefined;

    // Handle 401 Unauthorized (session expiry)
    if (error.response?.status === 401) {
      const isAuthRoute = config?.url?.includes('/auth/login') || config?.url?.includes('/auth/register');
      const skipRedirect = (config as ExtendedAxiosRequestConfig)?._skipRedirectOn401 === true;

      if (!isAuthRoute && !skipRedirect && !isRedirecting) {
        isRedirecting = true;
        // Clear localStorage so the session-restore effect in App.tsx
        // does not immediately re-enter the dashboard → 401 loop.
        localStorage.removeItem('user');
        localStorage.removeItem('csrf_token');
        window.location.href = '/';
      }
      return Promise.reject(error);
    }

    // Bounded Retries for Safe Idempotent Reads
    // NEVER retry non-idempotent inventory mutations, payments, or bookings unless explicitly permitted
    if (config && !config._skipRetry) {
      const method = (config.method || 'get').toLowerCase();
      const isIdempotentRead = method === 'get' || Boolean(config.headers?.['idempotency-key'] || config.headers?.['Idempotency-Key']);
      
      const isNetworkError = !error.response || error.code === 'ECONNABORTED' || error.message?.includes('Network Error');
      const isTransientServerError = error.response?.status ? [502, 503, 504].includes(error.response.status) : false;

      if (isIdempotentRead && (isNetworkError || isTransientServerError)) {
        config._retryCount = config._retryCount || 0;
        const maxRetries = 2; // Maximum 2 retries (total 3 attempts)

        if (config._retryCount < maxRetries) {
          config._retryCount += 1;
          // Exponential backoff: 400ms, 800ms + random jitter
          const delay = Math.pow(2, config._retryCount) * 200 + Math.random() * 100;
          
          await new Promise(resolve => setTimeout(resolve, delay));
          return api(config);
        }
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

/**
 * Sequential Request Token Generator
 * Prevents stale asynchronous responses from overwriting newer user input or barcode scans.
 *
 * Example:
 *   const latestScan = createSequentialToken();
 *   onBarcodeScan(async (code) => {
 *     const isCurrent = latestScan.next();
 *     const result = await api.get(`/inventory/resolve-barcode?code=${code}`);
 *     if (!isCurrent()) return; // Discard stale response
 *     setProduct(result.data);
 *   });
 */
export function createSequentialToken() {
  let latestId = 0;
  return {
    next: () => {
      const currentId = ++latestId;
      return () => currentId === latestId;
    },
    reset: () => {
      latestId = 0;
    }
  };
}

export default api;
