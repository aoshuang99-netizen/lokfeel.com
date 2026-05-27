/**
 * 缓存层 — 自动选择最优后端
 *
 * - 如果配置了 UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN，使用 Redis（跨请求共享）
 * - 否则降级为 in-memory LRU 缓存（单请求内有效）
 *
 * 用法不变:
 *   import { cache } from '@/lib/cache';
 *   const data = await cache.get('user:123', () => db.user.findUnique(...), 60);
 */

import { redisCache } from './redis-cache';

export const cache = redisCache;
