/**
 * Presence Manager — Online/Offline status tracking via Redis
 * 
 * Features:
 * - Heartbeat-based presence detection
 * - Per-user presence state (ONLINE, AWAY, BUSY, OFFLINE)
 * - Connection mapping (userId → connectionId[])
 * - Auto-expire on disconnect
 */

import { redis, RedisKeys } from '../redis';
import type { PresenceStatus } from '../types';

export interface PresenceInfo {
  userId: string;
  status: PresenceStatus;
  statusMessage?: string;
  lastSeenAt: number;
  platform?: string;
  connectionId?: string;
}

export class PresenceManager {
  /**
   * Set user as online with heartbeat
   */
  async setOnline(
    userId: string,
    connectionId: string,
    platform: string = 'web'
  ): Promise<void> {
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
    await redis.set(connKey, JSON.stringify({ userId, connectedAt: now }), { ex: RedisKeys.connectionTtl });

    // Add to user's connection set
    const userConnsKey = RedisKeys.userConnections(userId);
    await redis.sadd(userConnsKey, connectionId);
    await redis.expire(userConnsKey, RedisKeys.connectionTtl);
  }

  /**
   * Set user presence status
   */
  async setPresence(
    userId: string,
    status: PresenceStatus,
    statusMessage?: string
  ): Promise<void> {
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
  }

  /**
   * Mark user as offline (remove connection)
   */
  async setOffline(userId: string, connectionId: string): Promise<void> {
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
  }

  /**
   * Get user's current presence
   */
  async getPresence(userId: string): Promise<PresenceInfo | null> {
    const key = RedisKeys.presence(userId);
    const raw = await redis.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw as string) as PresenceInfo;
    } catch {
      return null;
    }
  }

  /**
   * Get presence for multiple users (batch)
   */
  async getPresenceBatch(userIds: string[]): Promise<Map<string, PresenceInfo>> {
    const result = new Map<string, PresenceInfo>();
    // Sequential for now; can be parallelized with pipeline
    for (const userId of userIds) {
      const info = await this.getPresence(userId);
      if (info) {
        result.set(userId, info);
      }
    }
    return result;
  }

  /**
   * Heartbeat — refresh TTL
   */
  async heartbeat(userId: string): Promise<void> {
    const key = RedisKeys.presence(userId);
    const raw = await redis.get(key);
    if (raw) {
      // Refresh TTL
      await redis.expire(key, RedisKeys.presenceTtl);
    } else {
      // Recreate with default online status
      await this.setOnline(userId, `heartbeat-${Date.now()}`);
    }
  }

  /**
   * Get all connection IDs for a user
   */
  async getUserConnections(userId: string): Promise<string[]> {
    const key = RedisKeys.userConnections(userId);
    return redis.smembers(key) as Promise<string[]>;
  }

  /**
   * Get user ID from connection ID
   */
  async getUserIdByConnection(connectionId: string): Promise<string | null> {
    const key = RedisKeys.connection(connectionId);
    const raw = await redis.get(key);
    if (!raw) return null;
    try {
      const data = JSON.parse(raw as string);
      return data.userId;
    } catch {
      return null;
    }
  }
}

// Singleton
export const presenceManager = new PresenceManager();
