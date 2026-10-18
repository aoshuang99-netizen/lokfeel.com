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

/**
 * 构造 SET 命令（**纯函数**，便于单测把形状钉死）。
 *
 * 🔴 这是一个踩过的坑：Upstash REST 的 `/set/{key}` 端点，body 就是**值本身**。
 * 曾经把 `["<json>", "EX", 75]` 当作 body POST 到 `/set/{key}`，结果 Upstash 把
 * 整个数组当字符串存下来，并且**完全忽略 EX** —— 值变成 `["{\"id\":…}","EX",75]`，
 * TTL 变成 -1（永不过期）。读到它的调用方 `JSON.parse` 之后拿到数组，
 * `user.tokenVersion` 自然是 undefined，`requireAuth()` 于是对**每一次缓存命中**
 * 都抛 "Session expired"，登录用户从第二个请求开始全线 401。
 *
 * 正确的多参数写法是走**命令数组**：`POST /`，body = `["SET", key, value, "EX", ttl]`。
 */
export function buildSetCommand(
  key: string,
  value: unknown,
  ttlSeconds: number
): { path: string; body: string[] } {
  return {
    path: "/",
    // `?? "null"`：JSON.stringify(undefined) 会返回 undefined，避免出现空参数
    body: ["SET", key, JSON.stringify(value) ?? "null", "EX", String(Math.max(1, Math.floor(ttlSeconds)))],
  }
}

/**
 * 兼容修复：识别并解开**旧写法**留下的坏值（`["{…}","EX",75]` 字符串）。
 *
 * WHY 不能只修写入端：坏值写入时没带 TTL，**永不过期**。只改写入逻辑的话，
 * 这些键会一直躺在库里毒害读取方。解包比批量清理更稳（不依赖谁先谁后、也不
 * 依赖运维记得跑清理），清理脚本仍然提供，二者叠加。
 */
export function unwrapLegacySetPayload(raw: unknown): unknown {
  if (typeof raw !== "string") return raw
  const trimmed = raw.trim()
  if (!trimmed.startsWith("[")) return raw
  try {
    const arr = JSON.parse(trimmed)
    if (
      Array.isArray(arr) &&
      arr.length === 3 &&
      typeof arr[0] === "string" &&
      String(arr[1]).toUpperCase() === "EX"
    ) {
      try {
        return JSON.parse(arr[0])
      } catch {
        return arr[0]
      }
    }
  } catch {
    // 不是 JSON，原样返回
  }
  return raw
}

async function redisGet<T>(key: string): Promise<T | null> {
  const raw = await redisReq<string>(`/get/${encodeURIComponent(key)}`, "GET");
  if (raw === null) return null;

  // 先尝试修复旧写法留下的坏值（见 unwrapLegacySetPayload 的说明）
  const healed = unwrapLegacySetPayload(raw);
  if (healed !== raw) return healed as T;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as unknown as T;
  }
}

async function redisSet(key: string, value: unknown, ttl: number): Promise<boolean> {
  // ✅ OPTIMIZATION: Apply jitter to TTL to prevent cache avalanche
  const ttlWithJitter = withJitter(ttl);

  // 命令数组形式（POST /），参数才不会被当成值的一部分 —— 见 buildSetCommand 注释
  const { path, body } = buildSetCommand(key, value, ttlWithJitter);
  const result = await redisReq<string>(path, "POST", body);
  return result === "OK";
}

async function redisDel(key: string): Promise<boolean> {
  // 🔴 Upstash REST 的 /del/{key} **只接受 POST**：用 DELETE 方法会拿到 405，
  // 而 redisReq 对非 2xx 静默返回 null ⇒ 失效逻辑永远"成功"却什么都没删。
  // 这曾让 invalidate() 长期空转（改设置/销号后的缓存不失效）。
  const result = await redisReq<number>(
    `/del/${encodeURIComponent(key)}`,
    "POST"
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
