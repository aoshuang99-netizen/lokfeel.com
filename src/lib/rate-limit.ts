/**
 * Rate Limiting — Redis-backed with in-memory fallback
 *
 * Uses Upstash Redis for distributed rate limiting in Vercel serverless.
 * Falls back to in-memory Map when Redis is unavailable.
 */

import { getRedis } from '@/lib/im/redis'

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

// In-memory fallback (for development / Redis unavailable)
const rateLimitStore = new Map<string, RateLimitEntry>();

export function rateLimit(options: {
  windowMs: number;
  max: number;
  key?: (request: Request) => string;
}) {
  return async (request: Request): Promise<{ success: boolean; remaining: number; resetAt: number }> => {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 
               request.headers.get('x-real-ip') || 
               'anonymous';
    const rateKey = options.key ? options.key(request) : ip;
    const windowSeconds = Math.ceil(options.windowMs / 1000);
    const redisKey = `ratelimit:${rateKey}`;

    // Try Redis first
    try {
      const redis = getRedis()
      const current = await redis.incr(redisKey)
      if (current === 1) {
        await redis.expire(redisKey, windowSeconds)
      }
      const ttl = await redis.ttl(redisKey)
      const resetAt = Date.now() + (ttl > 0 ? ttl * 1000 : options.windowMs)
      if (current > options.max) {
        return { success: false, remaining: 0, resetAt }
      }
      return { success: true, remaining: options.max - current, resetAt }
    } catch {
      // Redis unavailable — fall back to in-memory
    }
    
    const now = Date.now();
    const entry = rateLimitStore.get(rateKey);
    
    if (entry && entry.resetAt > now) {
      if (entry.count >= options.max) {
        return { success: false, remaining: 0, resetAt: entry.resetAt };
      }
      entry.count++;
      return { success: true, remaining: options.max - entry.count, resetAt: entry.resetAt };
    }
    
    const resetAt = now + options.windowMs
    rateLimitStore.set(rateKey, { count: 1, resetAt });
    return { success: true, remaining: options.max - 1, resetAt };
  };
}
