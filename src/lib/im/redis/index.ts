/**
 * Redis 连接层 —— Upstash Redis 及其**可用的**降级路径。
 *
 * 覆盖能力：在线状态（Presence）/ 节奏控制（Pace Control，令牌桶）/
 * 消息投递队列 / 规则缓存 / 打字指示 / 连接映射（userId → connectionId）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * G-4 修复说明（2026-09-27）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **改造前的问题：降级路径存在，但它是坏的。**
 *
 * 原实现：
 *
 * ```ts
 * let _redis: Redis | null = null;
 * export function getRedis(): Redis {
 *   if (!_redis) {
 *     if (!url || !token) {
 *       return createInMemoryFallback();   // ← 每次调用新建一个空 Map
 *     }
 *     _redis = new Redis({ url, token });
 *   }
 *   return _redis;
 * }
 * ```
 *
 * 缺了 `_redis = createInMemoryFallback()` 这一步，于是**每次调用都返回一个全新的、
 * 空的存储**。后果不是"性能差"，而是**静默的能力失效**：
 *
 * | 能力 | 失效表现 | 危害 |
 * |---|---|---|
 * | 令牌桶节奏控制 | 桶永远是满的 | 反骚扰限流**完全失效**，且日志还打印"using in-memory fallback"，看起来正常工作 |
 * | 在线状态 | 写完即丢 | 所有人恒显示离线/在线状态错乱 |
 * | 打字指示 | 无法回读 | 功能静默不可用 |
 * | 连接映射 | 查不到连接 | 定向投递失败 |
 * | 通用限流（`lib/rate-limit.ts`） | `incr` 恒返回 1 | **所有请求都被放行**，且因为不抛错，调用方自己的内存兜底分支永远不会触发 |
 *
 * 这比"没有降级"更危险：没有降级会立刻 500，问题当场暴露；而坏掉的降级会
 * **安静地继续服务**，把安全能力一点点去掉。自托管（P1-1）与多租户（P0-2）
 * 恰恰是最依赖降级路径的场景。
 *
 * 本版本做了四件事：
 *
 * 1. **内存后端单例化** —— 进程内真正持久，令牌桶/在线状态/限流恢复正常语义。
 * 2. **显式后端探测** —— `getRedisBackend()` 让"我在降级"变成可读、可上报的事实，
 *    而不是一行没人看的 warn。
 * 3. **熔断（circuit breaker）** —— Upstash 已配置但**不可达**时（超时/配额耗尽/
 *    网络故障），失败一次后进入冷却窗口，窗口内直接走内存后端。
 *    没有熔断时，每个请求都要先等一次 Redis 超时才降级 —— 一次故障会让**整站变慢**，
 *    而不仅是聊天变慢。
 * 4. **可观测性** —— `/api/health` 汇报当前后端与降级原因，见 `getRedisStatus()`。
 *
 * ⚠️ 内存后端的固有局限（自托管部署必须知情）：
 *    · **仅进程内**：多实例部署时，限流与在线状态**不跨实例共享**。
 *      单实例自托管（Docker 单容器）语义完整；水平扩容时需接真实 Redis。
 *    · **重启即丢**：进程重启后令牌桶重置（相当于限流额度被刷新）。
 *    因此生产环境仍**建议**配置 Upstash；本降级路径的作用是"不因此不可用"，
 *    而非"与 Redis 等效"。
 *
 * @module lib/im/redis
 */

import { Redis } from '@upstash/redis';

// ─── 状态 ──────────────────────────────────────────────────────

/** 已建立的 Upstash 客户端（连接配置存在时才有值） */
let _upstash: Redis | null = null;

/** 内存后端的**单例**（G-4 的核心修复点：必须是单例） */
let _memory: Redis | null = null;

/** 熔断冷却截止时间戳（epoch ms）。早于此时间视为降级中 */
let _degradedUntil = 0;

/** 最近一次触发降级的原因（供 /api/health 与排障使用） */
let _degradedReason = '';

/** 降级发生次数（累计，便于观察抖动） */
let _degradeCount = 0;

/** 是否已经把当前降级状态打过日志（避免热点路径刷屏） */
let _loggedState = '';

/** 熔断冷却时长。取 60s：足够让短暂的网络抖动/配额恢复，又不会长时间停在降级态 */
const DEGRADE_COOLDOWN_MS = 60_000;

// ─── 配置探测 ──────────────────────────────────────────────────

function readConfig(): { url: string; token: string } {
  const url = (process.env.UPSTASH_REDIS_REST_URL || '').trim();
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
  return { url, token };
}

/** Upstash 凭据是否已配置（不代表可达） */
export function isRedisConfigured(): boolean {
  const { url, token } = readConfig();
  return Boolean(url && token);
}

export type RedisBackend = 'upstash' | 'memory';

/**
 * 当前实际生效的后端。
 *
 * 注意：这只表示"这一次调用会走哪个后端"，Upstash 是否真的可达需要靠
 * `probeRedis()` 主动探测或靠调用失败触发的熔断来发现。
 */
export function getRedisBackend(): RedisBackend {
  if (Date.now() < _degradedUntil) return 'memory';
  if (!isRedisConfigured()) return 'memory';
  return 'upstash';
}

export interface RedisStatus {
  backend: RedisBackend;
  configured: boolean;
  /** 是否处于熔断冷却中 */
  degraded: boolean;
  /** 冷却剩余毫秒（未降级时为 0） */
  degradedForMs: number;
  degradedReason: string;
  degradeCount: number;
}

/** 供健康检查与运维上报使用 */
export function getRedisStatus(): RedisStatus {
  const now = Date.now();
  const degraded = now < _degradedUntil;
  return {
    backend: getRedisBackend(),
    configured: isRedisConfigured(),
    degraded,
    degradedForMs: degraded ? _degradedUntil - now : 0,
    degradedReason: _degradedReason,
    degradeCount: _degradeCount,
  };
}

// ─── 熔断控制 ──────────────────────────────────────────────────

/**
 * 标记 Redis 不可用，进入熔断冷却窗口。
 *
 * 调用时机：任何 Redis 操作抛出异常的地方（尤其是有 fail-open 兜底的路径）。
 * 幂等：窗口内重复调用只累加计数，不重置窗口 —— 否则持续失败会无限延长熔断。
 *
 * @param reason 失败来源，例如 `'pace.checkRateLimit'`，用于排障
 */
export function markRedisUnavailable(reason: string): void {
  const now = Date.now();
  _degradeCount++;
  _degradedReason = reason;

  // 已在冷却窗口内：不要续期。否则持续故障会让熔断永不恢复
  // （而"永不恢复"意味着即使 Redis 已修好，也要等下一次重启才回切）。
  if (now < _degradedUntil) return;

  _degradedUntil = now + DEGRADE_COOLDOWN_MS;
  console.warn(
    `[IM/Redis] 后端不可用（${reason}）→ 进入 ${DEGRADE_COOLDOWN_MS / 1000}s 降级窗口，` +
      '期间使用进程内内存后端。注意：内存后端不跨实例共享，限流与在线状态在' +
      '多实例部署下弱化。',
  );
}

/** 手动清除熔断状态（供运维在确认 Redis 恢复后立即回切，或测试使用） */
export function clearRedisDegradation(): void {
  _degradedUntil = 0;
  _degradedReason = '';
}

/**
 * 主动探测 Upstash 可达性。成功则清除熔断状态。
 *
 * 与"等调用失败"相比，主动探测的价值在于：**在没有流量时也能判断状态**，
 * 适合放在 `/api/health` 或定时任务里。
 */
export async function probeRedis(timeoutMs = 2000): Promise<boolean> {
  if (!isRedisConfigured()) return false;

  const client = getUpstashClient();
  if (!client) return false;

  try {
    await Promise.race([
      client.ping(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('ping timeout')), timeoutMs),
      ),
    ]);
    // 探测成功 —— 立刻回切，不必等冷却窗口自然结束
    clearRedisDegradation();
    return true;
  } catch (e) {
    markRedisUnavailable(`probeRedis: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

// ─── 客户端获取 ────────────────────────────────────────────────

function getUpstashClient(): Redis | null {
  if (!isRedisConfigured()) return null;
  if (!_upstash) {
    const { url, token } = readConfig();
    _upstash = new Redis({ url, token });
  }
  return _upstash;
}

/**
 * 获取 Redis 客户端。
 *
 * 返回 Upstash 客户端或**进程内内存单例**，调用方无需区分 ——
 * 两者实现同一组被本仓库使用的方法（get/set/del/incr/expire/ttl/exists/
 * hset/hgetall/hmget/hmset/sadd/srem/smembers/publish/ping）。
 *
 * ⚠️ 调用方仍应保留自己的 fail-open 兜底：内存后端在极端情况（如进程 OOM 后重建）
 * 也会丢状态，且 `seq` 这类需要**跨实例单调**的语义无法用内存满足。
 */
export function getRedis(): Redis {
  const backend = getRedisBackend();

  if (backend === 'memory') {
    if (!_memory) _memory = createInMemoryFallback();
    logStateOnce('memory');
    return _memory;
  }

  const client = getUpstashClient();
  if (!client) {
    // 理论上不可达（backend==='upstash' 蕴含已配置），保守回退
    if (!_memory) _memory = createInMemoryFallback();
    logStateOnce('memory');
    return _memory;
  }

  logStateOnce('upstash');
  return client;
}

function logStateOnce(state: RedisBackend) {
  if (_loggedState === state) return;
  _loggedState = state;
  if (state === 'memory') {
    console.warn(
      isRedisConfigured()
        ? '[IM/Redis] 当前使用进程内内存后端（降级中）'
        : '[IM/Redis] 未配置 UPSTASH_REDIS_REST_URL/TOKEN → 使用进程内内存后端（自托管模式的预期行为）',
    );
  } else {
    console.log('[IM/Redis] 当前使用 Upstash Redis 后端');
  }
}

// Lazy proxy for default export (same pattern as db.ts)
export const redis: Redis = new Proxy({} as Redis, {
  get(_target, prop) {
    return (getRedis() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

// ─── 进程内内存后端 ────────────────────────────────────────────

/**
 * 最小可用的 Redis 兼容实现（进程内）。
 *
 * 与真实 Redis 的**已知语义差异**（调用方需知情）：
 *   · 不跨进程/实例共享 —— 多实例部署下限流与在线状态弱化
 *   · 进程重启即丢
 *   · `publish` 是 no-op（内存后端没有订阅方）
 *   · 哈希操作为"读-改-写"，非原子（单进程内 JS 单线程执行，实践中不会并发冲突）
 */
function createInMemoryFallback(): Redis {
  const store = new Map<string, { value: string; expiresAt?: number }>();

  const isExpired = (key: string) => {
    const entry = store.get(key);
    if (!entry) return true;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      store.delete(key);
      return true;
    }
    return false;
  };

  const readHash = (key: string): Record<string, string> => {
    if (isExpired(key)) return {};
    const raw = store.get(key)?.value;
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
    } catch {
      return {};
    }
  };

  /**
   * 归一化哈希写入的两种调用形式。
   *
   * Upstash 的 `hset` / `hmset` **同时支持**：
   *   · 对象形式：`hmset(key, { tokens: '9', hourlyCount: '1' })`
   *   · 变参形式：`hmset(key, 'tokens', '9', 'hourlyCount', '1')`
   *
   * 原降级实现只处理变参形式，因此 `PaceController` 用的对象形式
   * （`redis.hmset(key, {...})`）会被解析成 `{"[object Object]": "undefined"}` ——
   * 令牌桶状态**根本没写进去**，限流同样静默失效。
   * 这是 G-4 的第 4 个真实缺陷，靠运行时验证（而非读代码）才暴露出来。
   */
  const normalizeHashArgs = (args: unknown[]): Record<string, string> => {
    const fields: Record<string, string> = {};

    // 对象形式
    if (args.length === 1 && args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0])) {
      for (const [k, v] of Object.entries(args[0] as Record<string, unknown>)) {
        fields[k] = String(v);
      }
      return fields;
    }

    // 变参形式（可选：允许整体传数组）
    const flat = args.length === 1 && Array.isArray(args[0]) ? (args[0] as unknown[]) : args;
    for (let i = 0; i < flat.length; i += 2) {
      fields[String(flat[i])] = String(flat[i + 1]);
    }
    return fields;
  };

  /** 合并写入哈希字段（对齐真实 HSET 的语义：只覆盖给定字段，不清空其余字段） */
  const writeHash = (key: string, fields: Record<string, string>) => {
    const merged = { ...readHash(key), ...fields };
    store.set(key, { value: JSON.stringify(merged), expiresAt: store.get(key)?.expiresAt });
    return Object.keys(fields).length;
  };

  // Minimal Redis-compatible interface
  return {
    get: async (key: string) => {
      if (isExpired(key)) return null;
      return store.get(key)?.value ?? null;
    },
    set: async (key: string, value: string, opts?: { ex?: number; px?: number }) => {
      const expiresAt = opts?.ex
        ? Date.now() + opts.ex * 1000
        : opts?.px
          ? Date.now() + opts.px
          : undefined;
      store.set(key, { value, expiresAt });
      return 'OK';
    },
    del: async (...keys: string[]) => {
      let count = 0;
      for (const key of keys) {
        if (store.delete(key)) count++;
      }
      return count;
    },
    incr: async (key: string) => {
      const current = parseInt(store.get(key)?.value || '0', 10);
      const next = (Number.isNaN(current) ? 0 : current) + 1;
      store.set(key, { value: String(next), expiresAt: store.get(key)?.expiresAt });
      return next;
    },
    expire: async (key: string, seconds: number) => {
      const entry = store.get(key);
      if (!entry) return false;
      entry.expiresAt = Date.now() + seconds * 1000;
      return true;
    },
    ttl: async (key: string) => {
      if (isExpired(key)) return -2;
      const entry = store.get(key);
      if (!entry) return -2;
      if (!entry.expiresAt) return -1;
      const remaining = Math.floor((entry.expiresAt - Date.now()) / 1000);
      return remaining > 0 ? remaining : -2;
    },
    exists: async (...keys: string[]) => {
      let count = 0;
      for (const key of keys) {
        if (!isExpired(key) && store.has(key)) count++;
      }
      return count;
    },
    hset: async (key: string, ...args: unknown[]) => writeHash(key, normalizeHashArgs(args)),
    hgetall: async (key: string) => {
      const hash = readHash(key);
      return Object.keys(hash).length > 0 ? hash : {};
    },
    hmget: async (key: string, ...args: unknown[]) => {
      const hash = readHash(key);
      const fields =
        args.length === 1 && Array.isArray(args[0]) ? (args[0] as string[]) : (args as string[]);
      return fields.map((f) => hash[f] ?? null);
    },
    hmset: async (key: string, ...args: unknown[]) => {
      writeHash(key, normalizeHashArgs(args));
      return 'OK';
    },
    sadd: async (key: string, ...members: string[]) => {
      const raw = store.get(key)?.value;
      const set = raw ? new Set<string>(JSON.parse(raw)) : new Set<string>();
      let added = 0;
      for (const m of members) {
        if (!set.has(m)) {
          set.add(m);
          added++;
        }
      }
      store.set(key, { value: JSON.stringify([...set]), expiresAt: store.get(key)?.expiresAt });
      return added;
    },
    srem: async (key: string, ...members: string[]) => {
      const raw = store.get(key)?.value;
      if (!raw) return 0;
      const set = new Set<string>(JSON.parse(raw));
      let removed = 0;
      for (const m of members) {
        if (set.delete(m)) removed++;
      }
      store.set(key, { value: JSON.stringify([...set]), expiresAt: store.get(key)?.expiresAt });
      return removed;
    },
    smembers: async (key: string) => {
      if (isExpired(key)) return [];
      const raw = store.get(key)?.value;
      return raw ? JSON.parse(raw) : [];
    },
    publish: async (_channel: string, _message: string) => {
      return 0; // no-op in memory（无订阅方）
    },
    ping: async () => 'PONG',
  } as unknown as Redis;
}

// ─── Redis Key Patterns ────────────────────────────────────────

export const RedisKeys = {
  // Presence
  presence: (userId: string) => `im:presence:${userId}`,
  presenceTtl: 300, // 5 minutes

  // Pace Control (Token Bucket)
  pace: (senderId: string, receiverId: string) => `im:pace:${senderId}:${receiverId}`,
  paceTtl: 86400, // 24 hours

  // Connection mapping
  connection: (connectionId: string) => `im:conn:${connectionId}`,
  userConnections: (userId: string) => `im:user_conns:${userId}`,
  connectionTtl: 7200, // 2 hours

  // Typing indicator
  typing: (convId: string, userId: string) => `im:typing:${convId}:${userId}`,
  typingTtl: 5, // 5 seconds (auto-expire = not typing)

  // Message delivery queue
  deliveryQueue: (userId: string) => `im:delivery:${userId}`,
  deliveryQueueTtl: 3600, // 1 hour

  // Rule cache
  rules: (userId: string) => `im:rules:${userId}`,
  rulesTtl: 300, // 5 minutes

  // Consent cache
  consent: (granterId: string, granteeId: string, type: string) =>
    `im:consent:${granterId}:${granteeId}:${type}`,
  consentTtl: 600, // 10 minutes

  // Seq counter (per conversation)
  seqCounter: (convId: string) => `im:seq:${convId}`,
} as const;
