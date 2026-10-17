/**
 * Rate Limiting — Redis-backed with in-memory fallback
 *
 * Uses Upstash Redis for distributed rate limiting in serverless.
 * Falls back to in-memory Map when Redis is unavailable.
 *
 * ── 为什么必须有 `name`（2026-10-17 修）─────────────────────────────
 * 早先的键是 `ratelimit:${rateKey}`，而仓里三处调用**都没传 `key`** ⇒
 * `public:mission-preview`（120 / 5min）与 `im:call-signal`（300 / 1min）
 * 落进**同一个桶** `ratelimit:<ip>`，而且**窗口长度由最先创建该条目的请求决定**：
 *   · 预览先建条目（5 分钟窗）⇒ 信令的「300 次/分钟」实际变成「300 次/5 分钟」；
 *   · 信令先建条目（1 分钟窗）⇒ 预览的「5 分钟」只持续 1 分钟，限流被削弱。
 * 两个方向的错法都是**静默**的（额度多给或少给，都不报错）。
 *
 * 所以现在：`name` **必填**，键 = `ratelimit:<name>:<rateKey>`。
 * 而且同名不同配置会在**注册期**抛错 —— 光靠"记得传 name"挡不住下一个人，
 * 但「同一个名字配两套额度」是能确定性检出的。
 *
 * ⚠️ 内存回落路径（`rateLimitStore`）是**按进程**的：先前的缺陷在单进程里能复现，
 * 而 Next 把每条 route 打成独立 chunk 后反而各自一份，看起来"没事"；
 * 生产接上 Upstash 之后桶是**真共享**的 ⇒ 缺陷从"理论"变成"线上"。
 * 这正是本修的前提（#51 之后必修）。
 *
 * @module lib/rate-limit
 */

import { getRedis } from '@/lib/im/redis'

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

export type RateLimitVerdict = {
  success: boolean;
  remaining: number;
  resetAt: number;
};

export type RateLimitOptions = {
  /**
   * 桶名（必填）。**每个限流器一个名字** —— 共用名字就等于共用额度与窗口。
   * 允许小写字母 / 数字 / `:` / `_` / `-`，如 `public:mission-preview`。
   */
  name: string;
  windowMs: number;
  max: number;
  /** 自定义取键；缺省按客户端 IP。 */
  key?: (request: Request) => string;
};

export type RateLimiter = (
  request: Request,
  /** 显式取键覆盖（如已登录场景按 userId 计数，无需伪造请求头）。 */
  keyOverride?: string
) => Promise<RateLimitVerdict>;

// In-memory fallback (for development / Redis unavailable)
const rateLimitStore = new Map<string, RateLimitEntry>();

/** 已注册的桶名 → 配置。用于在注册期挡住「同名不同额度」。 */
const registeredBuckets = new Map<string, { windowMs: number; max: number }>();

const NAME_PATTERN = /^[a-z0-9][a-z0-9:_-]{0,63}$/;

/** 取客户端 IP。`x-forwarded-for` 的首段是链路上最靠近客户端的一跳。 */
export function clientIpOf(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'anonymous'
  );
}

/** 429 响应该带多少秒 `Retry-After`（至少 1，避免 0 被客户端理解成"立刻重试"）。 */
export function retryAfterSeconds(verdict: RateLimitVerdict): number {
  return Math.max(1, Math.ceil((verdict.resetAt - Date.now()) / 1000));
}

export function rateLimit(options: RateLimitOptions): RateLimiter {
  const { name, windowMs, max } = options;

  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
    throw new Error(
      `rateLimit: 必须给出合法桶名 name（小写字母/数字/:/_/-，≤64 字符），收到 ${JSON.stringify(name)}`
    )
  }
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error(`rateLimit("${name}"): windowMs 必须是正数，收到 ${windowMs}`)
  }
  if (!Number.isFinite(max) || max <= 0) {
    throw new Error(`rateLimit("${name}"): max 必须是正数，收到 ${max}`)
  }

  const prev = registeredBuckets.get(name)
  if (prev && (prev.windowMs !== windowMs || prev.max !== max)) {
    throw new Error(
      `rateLimit: 桶名 "${name}" 已被注册为 ${prev.windowMs}ms/${prev.max} 次，` +
        `本次是 ${windowMs}ms/${max} 次 —— 同一个桶两套额度会让窗口互相污染，请换名`
    )
  }
  if (!prev) registeredBuckets.set(name, { windowMs, max })

  const redisKeyOf = (rateKey: string) => `ratelimit:${name}:${rateKey}`

  return async (request: Request, keyOverride?: string): Promise<RateLimitVerdict> => {
    const rateKey = keyOverride ?? (options.key ? options.key(request) : clientIpOf(request))
    const redisKey = redisKeyOf(rateKey)
    const windowSeconds = Math.ceil(windowMs / 1000)

    // Try Redis first
    try {
      const redis = getRedis()
      const current = await redis.incr(redisKey)
      // TTL 只在「新建」或「TTL 丢失」时设置。
      // 早先只在 `current === 1` 时 expire：一旦那次 expire 失败（网络抖动 / 客户端重建），
      // 键就**永不过期** ⇒ 该 IP 的额度被永久耗尽。用 ttl < 0 兜住两种缺失。
      let ttl = await redis.ttl(redisKey)
      if (ttl < 0) {
        await redis.expire(redisKey, windowSeconds)
        ttl = windowSeconds
      }
      const resetAt = Date.now() + ttl * 1000
      if (current > max) {
        return { success: false, remaining: 0, resetAt }
      }
      return { success: true, remaining: Math.max(0, max - current), resetAt }
    } catch {
      // Redis unavailable — fall back to in-memory
    }

    const now = Date.now();
    const entry = rateLimitStore.get(redisKey);

    if (entry && entry.resetAt > now) {
      if (entry.count >= max) {
        return { success: false, remaining: 0, resetAt: entry.resetAt };
      }
      entry.count++;
      return { success: true, remaining: max - entry.count, resetAt: entry.resetAt };
    }

    const resetAt = now + windowMs
    rateLimitStore.set(redisKey, { count: 1, resetAt });
    return { success: true, remaining: max - 1, resetAt };
  };
}
