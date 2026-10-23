import crypto from 'crypto';
import Redis from 'ioredis';

/**
 * Distributed TOTP Rate Limiter
 *
 * Implements an atomic sliding-window rate limiter backed by Redis.
 * Designed for Vercel serverless execution and horizontally scaled containers.
 *
 * Policy:
 * - Maximum 5 failed verification attempts per 5-minute (300s) window.
 * - Atomic check-and-record via Redis Lua script (zero race conditions).
 * - Safe SHA-256 hashed keys (no raw user IDs, emails, OTPs, or secrets in keys/logs).
 * - Combined policy across TOTP and recovery-code verification.
 * - IP fallback for unauthenticated / malformed challenge attempts.
 * - Fail-closed in production if Redis is required but unreachable.
 * - Reusable connection singleton across serverless invocations.
 */

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_WINDOW_SECONDS = 300; // 5 minutes
const DEFAULT_WINDOW_MS = DEFAULT_WINDOW_SECONDS * 1000;

// Atomic Sliding-Window Lua Script
// KEYS[1]: rate limit key
// ARGV[1]: current timestamp in milliseconds
// ARGV[2]: window start timestamp in milliseconds (now - windowMs)
// ARGV[3]: window duration in seconds (key TTL)
// ARGV[4]: max allowed attempts
// ARGV[5]: unique member identifier (timestamp:random)
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window_start = tonumber(ARGV[2])
local window_seconds = tonumber(ARGV[3])
local max_attempts = tonumber(ARGV[4])
local member_id = ARGV[5]

-- Clean up expired entries older than the sliding window start
redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)

-- Count current attempts within the active sliding window
local current_count = redis.call('ZCARD', key)

if current_count >= max_attempts then
    -- Window limit exceeded: compute retry-after from the oldest attempt in window
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    local retry_after = 0
    if oldest and #oldest >= 2 then
        local oldest_time = tonumber(oldest[2])
        retry_after = math.ceil(((oldest_time + (window_seconds * 1000)) - now) / 1000)
        if retry_after < 0 then retry_after = 0 end
    end
    return {0, current_count, retry_after, ''}
end

-- Under limit: record this attempt and refresh key TTL
redis.call('ZADD', key, now, member_id)
redis.call('EXPIRE', key, window_seconds)

return {1, current_count + 1, 0, member_id}
`;

/**
 * Extract client IP respecting Express trust proxy settings
 */
export function resolveClientIp(req) {
  if (!req) return '127.0.0.1';
  const isProxyTrusted = req.app && req.app.get && req.app.get('trust proxy');
  if (isProxyTrusted && req.ip) {
    return req.ip;
  }
  return req.socket?.remoteAddress || req.ip || '127.0.0.1';
}

/**
 * Generate a privacy-safe hashed Redis key
 * Precludes PII, user IDs, or credentials from appearing in Redis keys or monitor logs.
 */
export function hashKey(prefix, rawIdentifier) {
  const hash = crypto.createHash('sha256').update(String(rawIdentifier)).digest('hex').slice(0, 32);
  return `rl:totp:${prefix}:${hash}`;
}

/**
 * In-Memory Sliding-Window Store Adapter
 * Used for hermetic unit testing and development when Redis is not provisioned.
 * Implements the exact same atomic sliding window semantics as the Redis Lua script.
 */
export class InMemorySlidingWindowStore {
  constructor() {
    this.storage = new Map(); // key -> Array<{ timestamp, memberId }>
  }

  async eval(script, numKeys, key, nowStr, windowStartStr, windowSecStr, maxAttemptsStr, memberId) {
    const now = Number(nowStr);
    const windowStart = Number(windowStartStr);
    const windowSeconds = Number(windowSecStr);
    const maxAttempts = Number(maxAttemptsStr);

    let entries = this.storage.get(key) || [];

    // Filter out expired entries older than sliding window start
    entries = entries.filter(e => e.timestamp > windowStart);

    if (entries.length >= maxAttempts) {
      const oldest = entries[0];
      let retryAfter = 0;
      if (oldest) {
        retryAfter = Math.ceil(((oldest.timestamp + (windowSeconds * 1000)) - now) / 1000);
        if (retryAfter < 0) retryAfter = 0;
      }
      this.storage.set(key, entries);
      return [0, entries.length, retryAfter, ''];
    }

    // Add current attempt
    entries.push({ timestamp: now, memberId });
    this.storage.set(key, entries);

    return [1, entries.length, 0, memberId];
  }

  async zrem(key, memberId) {
    let entries = this.storage.get(key) || [];
    entries = entries.filter(e => e.memberId !== memberId);
    this.storage.set(key, entries);
    return 1;
  }

  async removeMember(key, memberId) {
    return this.zrem(key, memberId);
  }

  async removeLatest(key) {
    let entries = this.storage.get(key) || [];
    if (entries.length > 0) {
      entries.pop();
      this.storage.set(key, entries);
    }
    return 1;
  }

  async del(key) {
    this.storage.delete(key);
    return 1;
  }

  clear() {
    this.storage.clear();
  }
}

// Global serverless singleton cache for Redis client
let cachedClient = global.__elvisRedisClient || null;
let testStoreOverride = null;

/**
 * Create or retrieve the Redis connection singleton
 */
export function getRedisClient() {
  if (testStoreOverride) {
    return testStoreOverride;
  }

  if (cachedClient) {
    return cachedClient;
  }

  const redisUrl = process.env.REDIS_URL;
  const redisHost = process.env.REDIS_HOST;

  if (!redisUrl && !redisHost) {
    return null;
  }

  const options = {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    commandTimeout: 2000,
    enableReadyCheck: false,
    retryStrategy: (times) => {
      if (times > 3) return null; // Do not hang serverless executions
      return Math.min(times * 100, 1000);
    }
  };

  if (process.env.REDIS_TLS === 'true') {
    options.tls = { rejectUnauthorized: process.env.NODE_ENV === 'production' };
  }

  if (redisUrl) {
    cachedClient = new Redis(redisUrl, options);
  } else {
    cachedClient = new Redis({
      host: redisHost,
      port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      ...options
    });
  }

  // Prevent unhandled error crashes
  cachedClient.on('error', (err) => {
    console.error('[REDIS_ERROR] Redis client error:', err.message);
  });

  global.__elvisRedisClient = cachedClient;
  return cachedClient;
}

/**
 * Allow test suites to configure an isolated mock/test store
 */
export function setTestStore(store) {
  testStoreOverride = store;
}

export function clearTestStore() {
  testStoreOverride = null;
}

// Default in-memory store for non-production environments when Redis is unset
const devInMemoryStore = new InMemorySlidingWindowStore();

/**
 * Rate Limiter Engine class
 * Can be instantiated directly or accessed via module singleton
 */
export class DistributedTotpRateLimiter {
  constructor(options = {}) {
    this.maxAttempts = options.maxAttempts || DEFAULT_MAX_ATTEMPTS;
    this.windowSeconds = options.windowSeconds || DEFAULT_WINDOW_SECONDS;
    this.customStore = options.store || null;
  }

  getStore() {
    if (this.customStore) {
      return this.customStore;
    }
    return getRedisClient() || devInMemoryStore;
  }

  /**
   * Check and record a verification attempt atomically
   *
   * @param {string|null} userId - The user's ID if known
   * @param {object} req - Express request object for IP resolution
   * @param {object} options - Custom overrides (maxAttempts, windowSeconds)
   * @returns {Promise<{ allowed: boolean, remaining?: number, retryAfter?: number, message: string, statusCode?: number }>}
   */
  async checkRateLimit(userId, req = null, options = {}) {
    const isProduction = process.env.NODE_ENV === 'production';
    const isPreview = process.env.NODE_ENV === 'preview';
    const client = this.getStore();
    const isRedisActive = client && (client instanceof Redis || (client.eval && client !== devInMemoryStore));

    // FAIL-CLOSED POLICY IN PRODUCTION ONLY:
    // In production, fail closed if Redis is unavailable
    // In preview, allow in-memory fallback for initial deployment testing
    if (isProduction && (!isRedisActive || client === devInMemoryStore)) {
      console.error(`[REDIS_SECURITY_ALERT] PRODUCTION mode active but Redis rate limiter is unavailable. Failing closed.`);
      return {
        allowed: false,
        statusCode: 503,
        retryAfter: 30,
        message: 'Authentication service temporarily unavailable. Please try again shortly.',
        error: 'SERVICE_UNAVAILABLE'
      };
    }

    // Preview mode: Warn but allow in-memory fallback
    if (isPreview && (!isRedisActive || client === devInMemoryStore)) {
      console.warn(`[RATE_LIMIT_WARNING] Preview mode using in-memory fallback. Redis not configured or unreachable.`);
    }

    const maxAttempts = options.maxAttempts || this.maxAttempts;
    const windowSeconds = options.windowSeconds || this.windowSeconds;
    const windowMs = windowSeconds * 1000;
    const now = Date.now();
    const windowStart = now - windowMs;
    const memberId = `${now}:${crypto.randomBytes(4).toString('hex')}`;

    // Target key: user-based if userId provided, otherwise IP-based fallback
    let key;
    if (userId) {
      key = hashKey('u', userId);
    } else {
      const ip = resolveClientIp(req);
      key = hashKey('ip', ip);
    }

    try {
      const result = await client.eval(
        SLIDING_WINDOW_LUA,
        1,
        key,
        String(now),
        String(windowStart),
        String(windowSeconds),
        String(maxAttempts),
        memberId
      );

      const allowed = result[0] === 1;
      const currentCount = result[1];
      const retryAfter = result[2] || 0;

      if (!allowed) {
        return {
          allowed: false,
          statusCode: 429,
          currentCount,
          retryAfter: retryAfter > 0 ? retryAfter : windowSeconds,
          message: 'Too many attempts. Please try again later.'
        };
      }

      return {
        allowed: true,
        currentCount,
        remaining: Math.max(0, maxAttempts - currentCount),
        memberId,
        message: 'OK'
      };
    } catch (err) {
      console.error('[RATE_LIMIT_ERROR] Failed to execute rate limit command:', err.message);

      // In production or preview, fail closed on Redis command errors
      if (isProduction || isPreview) {
        return {
          allowed: false,
          statusCode: 503,
          retryAfter: 30,
          message: 'Authentication service temporarily unavailable. Please try again shortly.',
          error: 'SERVICE_UNAVAILABLE'
        };
      }

      // Non-production fallback
      return devInMemoryStore.eval(
        SLIDING_WINDOW_LUA,
        1,
        key,
        String(now),
        String(windowStart),
        String(windowSeconds),
        String(maxAttempts),
        memberId
      ).then(res => ({
        allowed: res[0] === 1,
        statusCode: res[0] === 1 ? 200 : 429,
        currentCount: res[1],
        retryAfter: res[2] || 0,
        memberId,
        message: res[0] === 1 ? 'OK' : 'Too many attempts. Please try again later.'
      }));
    }
  }

  /**
   * Defines policy on successful verification.
   *
   * Crucial Security Rule:
   * Do NOT reset counters completely to 0 on success, which would permit unlimited repeated
   * alternating guess/success cycles. Instead, attempts age out naturally via the sliding window.
   * On success, we only remove the successful request itself (memberId), keeping all past
   * failed attempts firmly recorded in the sliding window.
   */
  async onSuccessfulVerification(userId, req = null, memberId = null) {
    const client = this.getStore();
    let key;
    if (userId) {
      key = hashKey('u', userId);
    } else {
      const ip = resolveClientIp(req);
      key = hashKey('ip', ip);
    }

    try {
      if (client) {
        if (memberId && typeof client.zrem === 'function') {
          await client.zrem(key, memberId);
        } else if (memberId && typeof client.removeMember === 'function') {
          await client.removeMember(key, memberId);
        } else if (typeof client.removeLatest === 'function') {
          await client.removeLatest(key);
        } else if (typeof client.zremrangebyrank === 'function') {
          await client.zremrangebyrank(key, -1, -1);
        }
      }
    } catch (err) {
      console.error('[RATE_LIMIT_ERROR] Failed to update rate limit on success:', err.message);
    }
    return true;
  }

  /**
   * Explicitly clear rate limit for an identifier (used in automated tests or admin resets)
   */
  async clearRateLimit(userId, req = null) {
    const client = this.getStore();
    let key;
    if (userId) {
      key = hashKey('u', userId);
    } else {
      const ip = resolveClientIp(req);
      key = hashKey('ip', ip);
    }

    try {
      if (client && typeof client.del === 'function') {
        await client.del(key);
      }
    } catch (err) {
      console.error('[RATE_LIMIT_ERROR] Failed to clear rate limit key:', err.message);
    }
  }
}

// Module default instance
export const defaultLimiter = new DistributedTotpRateLimiter();

/**
 * Public API matching existing totpService interface
 */
export async function checkRateLimit(userId, req = null, options = {}) {
  return defaultLimiter.checkRateLimit(userId, req, options);
}

export async function clearRateLimit(userId, req = null) {
  return defaultLimiter.clearRateLimit(userId, req);
}

export async function onSuccessfulVerification(userId, req = null, memberId = null) {
  return defaultLimiter.onSuccessfulVerification(userId, req, memberId);
}
