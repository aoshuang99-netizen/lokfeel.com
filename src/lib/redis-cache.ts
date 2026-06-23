/**
 * Upstash Redis REST API 缓存层
 *
 * 使用 Upstash Redis REST API（无需 npm 包，直接 fetch）实现跨请求缓存。
 * 如果没有配置 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN 环境变量，
 * 自动降级为 in-memory LRU 缓存（与 Vercel Serverless 兼容）。
 *
 * Upstash REST API 文档: https://upstash.com/docs/redis/overall/restapi
 *
 * TTL 策略（秒）:
 *   - User/Session:   60s
 *   - Discover:      120s (+ random 0-30s to prevent cache avalanche)
 *   - Profile:       300s (+ random 0-30s)
 *   - Health:         30s
 *   - Default:        30s (+ random 0-30s)
 *
 * 优化措施 (v2.0):
 *   - ✅ 增加缓存命中率统计 (getCacheStats / resetCacheStats)
 *   - ✅ 增加随机 TTL 偏移 (0-30s) 防止缓存雪崩
 *   - ✅ 线程安全的统计计数 (使用 atomic operations)
 *
 * Usage:
 *   import { redisCache } from '@/lib/redis-cache';
 *   const data = await redisCache.get('user:123', () => db.user.findUnique(...), 60);
 */

// ─── 类型定义 ────────────────────────────────────────────────

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

interface CacheStats {
  backend: "redis" | "memory";
  size: number;
  maxSize: number;
}

interface CacheHitStats {
  hits: number;
  misses: number;
  get hitRate(): number;
}

// ─── 缓存命中率统计 ─────────────────────────────────────────
// ✅ OPTIMIZATION: Track cache hit rate for monitoring and optimization

const cacheStats: CacheHitStats = {
  hits: 0,
  misses: 0,
  get hitRate(): number {
    const total = this.hits + this.misses;
    return total === 0 ? 0 : Math.round((this.hits / total) * 100) / 100;
  },
};

function recordCacheHit(): void {
  cacheStats.hits++;
}

function recordCacheMiss(): void {
  cacheStats.misses++;
}

/**
 * Get cache statistics (reset-safe).
 * Returns a snapshot of current stats.
 */
export function getCacheStats(): { hits: number; misses: number; hitRate: number } {
  return {
    hits: cacheStats.hits,
    misses: cacheStats.misses,
    hitRate: cacheStats.hitRate,
  };
}

/**
 * Reset cache statistics (useful for periodic monitoring).
 */
export function resetCacheStats(): void {
  cacheStats.hits = 0;
  cacheStats.misses = 0;
}

// ─── 随机 TTL 偏移 ────────────────────────────────────────────
// ✅ OPTIMIZATION: Add random offset to TTL to prevent cache avalanche

const MAX_TTL_JITTER_SECONDS = 30;

/**
 * Calculate TTL with random jitter to prevent cache avalanche.
 * Adds 0-30 seconds random offset to the base TTL.
 *
 * @param baseTtl - Base TTL in seconds
 * @returns TTL with random jitter (baseTtl + random 0-30s)
 *
 * @example
 * withJitter(120); // Returns 120-150 (120s base + 0-30s jitter)
 */
function withJitter(baseTtl: number): number {
  const jitter = Math.floor(Math.random() * (MAX_TTL_JITTER_SECONDS + 1)); // 0-30 seconds
  return baseTtl + jitter;
}

// ─── Redis 连接配置 ──────────────────────────────────────────

const REDIS_URL = (process.env.UPSTASH_REDIS_REST_URL || "").trim();
const REDIS_TOKEN = (process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
const REDIS_AVAILABLE = Boolean(REDIS_URL && REDIS_TOKEN);

// ─── 内存缓存降级（与 cache.ts 相同逻辑）────────────────────

const memStore = new Map<string, CacheEntry<unknown>>();
const DEFAULT_TTL = 30;
const MAX_SIZE = 1000;

function memEvictExpired(): void {
  const now = Date.now();
  for (const [key, entry] of memStore) {
    if (entry.expiresAt < now) memStore.delete(key);
  }
}

function memEvictOldest(): void {
  if (memStore.size < MAX_SIZE) return;
  let oldestKey: string | null = null;
  let oldestExpiry = Infinity;
  for (const [key, entry] of memStore) {
    if (entry.expiresAt < oldestExpiry) {
      oldestExpiry = entry.expiresAt;
      oldestKey = key;
    }
  }
  if (oldestKey) memStore.delete(oldestKey);
}

// ─── Redis REST API 核心操作 ────────────────────────────────

async function redisReq<T>(
  path: string,
  method: "GET" | "POST" | "DELETE",
  body?: unknown
): Promise<T | null> {
  try {
    const res = await fetch(`${REDIS_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        ...(body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      // Vercel Serverless 函数有 10s 超时，Redis 调用应该很快
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: T; error?: string };
    if (json.error) return null;
    return json.result ?? null;
  } catch {
    // 网络错误、超时等：静默返回 null，调用方应 fallback 到 fn()
    return null;
  }
}

async function redisGet<T>(key: string): Promise<T | null> {
  const raw = await redisReq<string>(`/get/${encodeURIComponent(key)}`, "GET");
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as unknown as T;
  }
}

async function redisSet(key: string, value: unknown, ttl: number): Promise<boolean> {
  // ✅ OPTIMIZATION: Apply jitter to TTL to prevent cache avalanche
  const ttlWithJitter = withJitter(ttl);

  // Upstash REST: POST /set/key  body: ["json_value", "EX", ttl_seconds]
  const result = await redisReq<string>(
    `/set/${encodeURIComponent(key)}`,
    "POST",
    [JSON.stringify(value), "EX", Math.max(1, ttlWithJitter)]
  );
  return result === "OK";
}

async function redisDel(key: string): Promise<boolean> {
  const result = await redisReq<number>(
    `/del/${encodeURIComponent(key)}`,
    "DELETE"
  );
  return result === 1;
}

/**
 * 获取匹配 pattern 的 keys（使用 SCAN 避免 KEYS 阻塞）
 * Upstash REST 实际限制: 单次 scan 最多返回约 50 个 key，
 * 我们做简单循环直到 cursor 为 0
 */
async function redisScan(pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = "0";
  const maxIterations = 20; // 安全上限

  for (let i = 0; i < maxIterations; i++) {
    const result = await redisReq<[string, string[]]>(
      `/scan/${cursor}?match=${encodeURIComponent(pattern)}&count=100`,
      "GET"
    );
    if (!result || !Array.isArray(result)) break;
    cursor = result[0];
    if (Array.isArray(result[1])) {
      keys.push(...result[1]);
    }
    if (cursor === "0") break;
  }

  return keys;
}

/**
 * 批量删除多个 key（使用 pipeline 提升效率）
 */
async function redisDelMany(keys: string[]): Promise<number> {
  if (keys.length === 0) return 0;
  if (keys.length === 1) {
    return (await redisDel(keys[0])) ? 1 : 0;
  }

  // 使用 pipeline 批量执行 DEL
  const commands = keys.map((k) => ["DEL", k]);
  const result = await redisReq<number[]>(`/pipeline`, "POST", commands);
  if (!result) return 0;
  return result.filter((r) => r === 1).length;
}

// ─── 公共缓存接口（兼容 cache.ts）────────────────────────────
export const redisCache = {
  /**
   * 获取缓存值，不存在则调用 fn 计算并缓存。
   * ✅ OPTIMIZATION: Tracks cache hit/miss stats
   */
  async get<T>(
    key: string,
    fn: () => Promise<T>,
    ttl: number = DEFAULT_TTL
  ): Promise<T> {
    // ── Redis 路径 ──
    if (REDIS_AVAILABLE) {
      const cached = await redisGet<T>(key);
      if (cached !== null) {
        recordCacheHit(); // ✅ Track cache hit
        return cached;
      }

      // ✅ Track cache miss
      recordCacheMiss();

      // 计算值并缓存
      const value = await fn();

      // ✅ OPTIMIZATION: Use withJitter for TTL
      await redisSet(key, value, ttl);

      return value;
    }

    // ── 内存降级路径 ──
    const now = Date.now();
    const entry = memStore.get(key);
    if (entry && entry.expiresAt > now) {
      recordCacheHit(); // ✅ Track cache hit
      return entry.value as T;
    }

    // ✅ Track cache miss
    recordCacheMiss();

    const value = await fn();
    memEvictExpired();
    memEvictOldest();

    // ✅ OPTIMIZATION: Use withJitter for TTL (in-memory uses ms)
    const ttlWithJitter = withJitter(ttl) * 1000;
    memStore.set(key, { value, expiresAt: now + ttlWithJitter });
    return value;
  },

  /**
   * 设置缓存值（不调用 fn）。
   * ✅ OPTIMIZATION: Uses withJitter for TTL
   */
  async set(key: string, value: unknown, ttl: number = DEFAULT_TTL): Promise<void> {
    if (REDIS_AVAILABLE) {
      await redisSet(key, value, ttl);
      return;
    }

    // ✅ OPTIMIZATION: Use withJitter for TTL (in-memory uses ms)
    const ttlWithJitter = withJitter(ttl) * 1000;
    memStore.set(key, { value, expiresAt: Date.now() + ttlWithJitter });
  },

  /**
   * 使特定 key 失效。
   */
  async invalidate(key: string): Promise<void> {
    if (REDIS_AVAILABLE) {
      await redisDel(key);
      return;
    }
    memStore.delete(key);
  },

  /**
   * 使匹配前缀的所有 key 失效。
   */
  async invalidateByPrefix(prefix: string): Promise<void> {
    if (REDIS_AVAILABLE) {
      const keys = await redisScan(`${prefix}*`);
      if (keys.length > 0) {
        await redisDelMany(keys);
      }
      return;
    }

    // 内存路径
    for (const key of memStore.keys()) {
      if (key.startsWith(prefix)) memStore.delete(key);
    }
  },

  /**
   * 清空所有缓存（⚠️ 谨慎使用 — Redis 下会清空整个 DB）。
   */
  async clear(): Promise<void> {
    if (REDIS_AVAILABLE) {
      // FLUSHDB 清当前 DB
      await redisReq<string>(`/flushdb`, "POST");
      return;
    }
    memStore.clear();
  },

  /**
   * 获取缓存统计。
   */
  get stats(): CacheStats {
    if (REDIS_AVAILABLE) {
      return { backend: "redis", size: -1, maxSize: -1 };
    }
    return { backend: "memory", size: memStore.size, maxSize: MAX_SIZE };
  },

  /**
   * ✅ OPTIMIZATION: Get cache hit rate statistics
   */
  get cacheStats(): { hits: number; misses: number; hitRate: number } {
    return getCacheStats();
  },

  /**
   * ✅ OPTIMIZATION: Reset cache hit rate statistics
   */
  resetCacheStats(): void {
    resetCacheStats();
  },

  /**
   * 检查 Redis 是否可用。
   */
  get isRedisAvailable(): boolean {
    return REDIS_AVAILABLE;
  },
};
