/**
 * Redis Connection Manager — Upstash Redis for IM Module
 * 
 * Usage:
 * - Online presence tracking
 * - Pace control (Token Bucket)
 * - Message delivery queue
 * - Rule cache
 * - Typing indicators
 * - Connection mapping (userId → connectionId)
 */

import { Redis } from '@upstash/redis';

// ─── Singleton Redis Client ────────────────────────────────────

let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (!_redis) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
      // Fallback: in-memory store for development
      console.warn('[IM] Upstash Redis not configured, using in-memory fallback');
      return createInMemoryFallback();
    }

    _redis = new Redis({ url, token });
  }
  return _redis;
}

// Lazy proxy for default export (same pattern as db.ts)
export const redis: Redis = new Proxy({} as Redis, {
  get(_target, prop) {
    return (getRedis() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

// ─── In-Memory Fallback for Development ────────────────────────

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

  // Minimal Redis-compatible interface
  return {
    get: async (key: string) => {
      if (isExpired(key)) return null;
      return store.get(key)?.value ?? null;
    },
    set: async (key: string, value: string, opts?: { ex?: number; px?: number }) => {
      const expiresAt = opts?.ex ? Date.now() + opts.ex * 1000 : 
                        opts?.px ? Date.now() + opts.px : undefined;
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
      const current = parseInt(store.get(key)?.value || '0');
      const next = current + 1;
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
    hset: async (key: string, ...args: any[]) => {
      // Simplified hash set
      const obj: Record<string, string> = {};
      for (let i = 0; i < args.length; i += 2) {
        obj[args[i]] = String(args[i + 1]);
      }
      store.set(key, { value: JSON.stringify(obj), expiresAt: store.get(key)?.expiresAt });
      return Object.keys(obj).length;
    },
    hgetall: async (key: string) => {
      if (isExpired(key)) return {};
      const raw = store.get(key)?.value;
      return raw ? JSON.parse(raw) : {};
    },
    hmget: async (key: string, ...fields: string[]) => {
      if (isExpired(key)) return fields.map(() => null);
      const raw = store.get(key)?.value;
      if (!raw) return fields.map(() => null);
      const obj = JSON.parse(raw);
      return fields.map(f => obj[f] ?? null);
    },
    hmset: async (key: string, ...args: any[]) => {
      const obj: Record<string, string> = {};
      for (let i = 0; i < args.length; i += 2) {
        obj[args[i]] = String(args[i + 1]);
      }
      store.set(key, { value: JSON.stringify(obj), expiresAt: store.get(key)?.expiresAt });
      return 'OK';
    },
    sadd: async (key: string, ...members: string[]) => {
      const raw = store.get(key)?.value;
      const set = raw ? new Set(JSON.parse(raw)) : new Set<string>();
      let added = 0;
      for (const m of members) {
        if (!set.has(m)) { set.add(m); added++; }
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
      return 0; // no-op in memory
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
  consent: (granterId: string, granteeId: string, type: string) => `im:consent:${granterId}:${granteeId}:${type}`,
  consentTtl: 600, // 10 minutes

  // Seq counter (per conversation)
  seqCounter: (convId: string) => `im:seq:${convId}`,
} as const;
