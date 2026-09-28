/**
 * Presence Manager — Online/Offline status tracking via Redis
 *
 * Features:
 * - Heartbeat-based presence detection
 * - Per-user presence state (ONLINE, AWAY, BUSY, OFFLINE)
 * - Connection mapping (userId → connectionId[])
 * - Auto-expire on disconnect
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * G-4（2026-09-27）：全部读写改为 fail-open
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 改造前本类**没有任何 try/catch**。后果：
 *   · `/api/im/presence` 直接 500 —— 而 presence 只是"对方是否在线"的装饰信息，
 *     它失败不该让接口整体不可用；
 *   · `lib/socket/handlers.ts` 在连接/断开事件里 await 本类，抛错会打断
 *     连接注册/离线清理，留下**幽灵在线**（用户已断线但状态仍是 ONLINE，
 *     因为清理逻辑没跑完）。
 *
 * 因此每个公开方法都遵守：
 *   「失败 → 记一次熔断（后续请求走内存后端）→ 返回安全默认值（null / [] / no-op）」
 *
 * 安全默认值的取向是**宁缺勿错**：
 *   · 读操作返回"未知"（null / 空数组），由调用方决定如何展示；
 *   · 写操作静默失败 —— 在线状态是**带 TTL 的软状态**，一次写失败会在
 *     下一个心跳/连接事件时自愈，不需要让整条链路报错。
 *
 * ⚠️ 注意：这是 fail-open，不是 fail-silent。每次失败都会
 *    `markRedisUnavailable()` 并打日志，`/api/health` 也会显示降级状态。
 */

import { redis, RedisKeys, markRedisUnavailable } from '../redis';
import type { PresenceStatus } from '../types';

export interface PresenceInfo {
  userId: string;
  status: PresenceStatus;
  statusMessage?: string;
  lastSeenAt: number;
  platform?: string;
  connectionId?: string;
}

/** 记录一次 Redis 失败并触发熔断 */
function onRedisError(op: string, error: unknown): void {
  markRedisUnavailable(
    `presence.${op}: ${error instanceof Error ? error.message : String(error)}`,
  );
  console.warn(`[PresenceManager] Redis 操作失败（${op}），已按 fail-open 处理：`, error);
}

export class PresenceManager {
  /**
   * Set user as online with heartbeat
   */
  async setOnline(
    userId: string,
    connectionId: string,
    platform: string = 'web',
  ): Promise<void> {
    try {
      const key = RedisKeys.presence(userId);
      const now = Date.now();

      const data: PresenceInfo = {
        userId,
        status: 'ONLINE',
        lastSeenAt: now,
        platform,
        connectionId,
      };

      await redis.set(key, JSON.stringify(data), { ex: RedisKeys.presenceTtl });

      // Track connection
      const connKey = RedisKeys.connection(connectionId);
      await redis.set(connKey, JSON.stringify({ userId, connectedAt: now }), {
        ex: RedisKeys.connectionTtl,
      });

      // Add to user's connection set
      const userConnsKey = RedisKeys.userConnections(userId);
      await redis.sadd(userConnsKey, connectionId);
      await redis.expire(userConnsKey, RedisKeys.connectionTtl);
    } catch (e) {
      onRedisError('setOnline', e);
    }
  }

  /**
   * Set user presence status
   */
  async setPresence(
    userId: string,
    status: PresenceStatus,
    statusMessage?: string,
  ): Promise<void> {
    try {
      const key = RedisKeys.presence(userId);
      const existing = await this.getPresence(userId);

      const data: PresenceInfo = {
        userId,
        status,
        statusMessage,
        lastSeenAt: Date.now(),
        platform: existing?.platform,
        connectionId: existing?.connectionId,
      };

      await redis.set(key, JSON.stringify(data), { ex: RedisKeys.presenceTtl });
    } catch (e) {
      onRedisError('setPresence', e);
    }
  }

  /**
   * Mark user as offline (remove connection)
   */
  async setOffline(userId: string, connectionId: string): Promise<void> {
    try {
      // Remove from user's connection set
      const userConnsKey = RedisKeys.userConnections(userId);
      await redis.srem(userConnsKey, connectionId);

      // Remove connection record
      const connKey = RedisKeys.connection(connectionId);
      await redis.del(connKey);

      // Check if user has any remaining connections
      const remainingConns = await redis.smembers(userConnsKey);
      if (remainingConns.length === 0) {
        // No more connections — set offline
        const key = RedisKeys.presence(userId);
        const data: PresenceInfo = {
          userId,
          status: 'OFFLINE',
          lastSeenAt: Date.now(),
        };
        await redis.set(key, JSON.stringify(data), { ex: 86400 }); // Keep offline status for 24h
      }
    } catch (e) {
      onRedisError('setOffline', e);
    }
  }

  /**
   * Get user's current presence
   *
   * @returns null 表示"未知/不可用"（含 Redis 失败）。调用方应把它当作
   *          "不显示在线状态"，而不是"用户离线"—— 两者语义不同。
   */
  async getPresence(userId: string): Promise<PresenceInfo | null> {
    try {
      const key = RedisKeys.presence(userId);
      const raw = await redis.get(key);
      if (!raw) return null;
      try {
        return JSON.parse(raw as string) as PresenceInfo;
      } catch {
        return null;
      }
    } catch (e) {
      onRedisError('getPresence', e);
      return null;
    }
  }

  /**
   * Get presence for multiple users (batch)
   *
   * Redis 失败时返回空 Map：调用方据此渲染"全部无在线信息"，
   * 而不是让整个 `/api/im/presence` 500。
   */
  async getPresenceBatch(userIds: string[]): Promise<Map<string, PresenceInfo>> {
    const result = new Map<string, PresenceInfo>();
    try {
      // Sequential for now; can be parallelized with pipeline
      for (const userId of userIds) {
        const info = await this.getPresence(userId);
        if (info) {
          result.set(userId, info);
        }
      }
    } catch (e) {
      onRedisError('getPresenceBatch', e);
    }
    return result;
  }

  /**
   * Heartbeat — refresh TTL
   */
  async heartbeat(userId: string): Promise<void> {
    try {
      const key = RedisKeys.presence(userId);
      const raw = await redis.get(key);
      if (raw) {
        // Refresh TTL
        await redis.expire(key, RedisKeys.presenceTtl);
      } else {
        // Recreate with default online status
        await this.setOnline(userId, `heartbeat-${Date.now()}`);
      }
    } catch (e) {
      onRedisError('heartbeat', e);
    }
  }

  /**
   * Get all connection IDs for a user
   *
   * Redis 失败时返回 []：调用方（投递层）会退化为"不指定连接"，即不做定向投递。
   */
  async getUserConnections(userId: string): Promise<string[]> {
    try {
      const key = RedisKeys.userConnections(userId);
      return (await redis.smembers(key)) as string[];
    } catch (e) {
      onRedisError('getUserConnections', e);
      return [];
    }
  }

  /**
   * Get user ID from connection ID
   */
  async getUserIdByConnection(connectionId: string): Promise<string | null> {
    try {
      const key = RedisKeys.connection(connectionId);
      const raw = await redis.get(key);
      if (!raw) return null;
      try {
        const data = JSON.parse(raw as string);
        return data.userId;
      } catch {
        return null;
      }
    } catch (e) {
      onRedisError('getUserIdByConnection', e);
      return null;
    }
  }
}

// Singleton
export const presenceManager = new PresenceManager();
