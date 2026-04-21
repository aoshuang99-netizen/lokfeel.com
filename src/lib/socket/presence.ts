/**
 * Socket Presence Manager — Online/Offline status tracking for Socket.io
 * 
 * Features:
 * - Socket.io socket-level presence tracking
 * - Heartbeat mechanism for liveness detection
 * - Presence broadcasting to conversations
 * - Automatic cleanup on disconnect
 */

import { Server as SocketIOServer } from 'socket.io';
import { redis, RedisKeys } from '@/lib/im/redis';
import type { PresenceStatus } from '@/lib/im/types';

// ─── Types ──────────────────────────────────────────────────────────

export interface SocketPresenceInfo {
  socketId: string;
  userId: string;
  status: PresenceStatus;
  statusMessage?: string;
  connectedAt: number;
  lastHeartbeat: number;
  platform?: string;
}

// ─── Presence Manager ────────────────────────────────────────────────

export class SocketPresenceManager {
  private io: SocketIOServer | null = null;
  private heartbeatTimers = new Map<string, NodeJS.Timeout>();
  private readonly HEARTBEAT_INTERVAL = 30000; // 30 seconds
  private readonly PRESENCE_TTL = 60; // 60 seconds (2x heartbeat)

  /**
   * Initialize with Socket.io server
   */
  initialize(io: SocketIOServer): void {
    this.io = io;
    console.log('[Socket Presence] Manager initialized');
  }

  /**
   * Register a socket connection
   */
  async registerSocket(
    socketId: string,
    userId: string,
    platform: string = 'web'
  ): Promise<void> {
    const now = Date.now();
    
    const info: SocketPresenceInfo = {
      socketId,
      userId,
      status: 'ONLINE',
      connectedAt: now,
      lastHeartbeat: now,
      platform,
    };

    // Store in Redis
    const key = RedisKeys.connection(socketId);
    await redis.set(key, JSON.stringify(info), { ex: RedisKeys.connectionTtl });

    // Add to user's socket set
    const userSocketsKey = RedisKeys.userConnections(userId);
    await redis.sadd(userSocketsKey, socketId);
    await redis.expire(userSocketsKey, RedisKeys.connectionTtl);

    // Update presence record
    const presenceKey = RedisKeys.presence(userId);
    await redis.set(presenceKey, JSON.stringify({
      userId,
      status: 'ONLINE',
      lastSeenAt: now,
      platform,
      socketId,
    }), { ex: this.PRESENCE_TTL });

    // Start heartbeat monitoring
    this.startHeartbeat(socketId, userId);

    // Broadcast presence change
    this.broadcastPresenceChange(userId, 'ONLINE');

    console.log(`[Socket Presence] Registered: socket ${socketId} → user ${userId}`);
  }

  /**
   * Unregister a socket connection
   */
  async unregisterSocket(socketId: string): Promise<void> {
    // Stop heartbeat
    this.stopHeartbeat(socketId);

    // Get socket info
    const key = RedisKeys.connection(socketId);
    const raw = await redis.get(key);
    
    if (!raw) return;

    let info: SocketPresenceInfo;
    try {
      info = JSON.parse(raw as string);
    } catch {
      return;
    }

    const { userId } = info;

    // Remove from Redis
    await redis.del(key);

    // Remove from user's socket set
    const userSocketsKey = RedisKeys.userConnections(userId);
    await redis.srem(userSocketsKey, socketId);

    // Check if user has any remaining connections
    const remainingSockets = await redis.smembers(userSocketsKey);
    
    if (remainingSockets.length === 0) {
      // No more connections — mark as offline
      const presenceKey = RedisKeys.presence(userId);
      await redis.set(presenceKey, JSON.stringify({
        userId,
        status: 'OFFLINE',
        lastSeenAt: Date.now(),
      }), { ex: 86400 }); // Keep offline status for 24h

      // Broadcast presence change
      this.broadcastPresenceChange(userId, 'OFFLINE');
    } else {
      // Update to another active socket (for multi-device support)
      const nextSocketId = remainingSockets[0];
      const nextSocketInfo = await redis.get(RedisKeys.connection(nextSocketId));
      if (nextSocketInfo) {
        try {
          const nextInfo = JSON.parse(nextSocketInfo as string);
          const presenceKey = RedisKeys.presence(userId);
          await redis.set(presenceKey, JSON.stringify({
            userId,
            status: 'ONLINE',
            lastSeenAt: Date.now(),
            platform: nextInfo.platform,
            socketId: nextSocketId,
          }), { ex: this.PRESENCE_TTL });
        } catch {
          // Ignore parse errors
        }
      }
    }

    console.log(`[Socket Presence] Unregistered: socket ${socketId} → user ${userId}`);
  }

  /**
   * Update user presence status
   */
  async updateStatus(
    userId: string,
    status: PresenceStatus,
    statusMessage?: string
  ): Promise<void> {
    const presenceKey = RedisKeys.presence(userId);
    const raw = await redis.get(presenceKey);
    
    if (!raw) return;

    try {
      const existing = JSON.parse(raw as string);
      await redis.set(presenceKey, JSON.stringify({
        ...existing,
        status,
        statusMessage,
        lastSeenAt: Date.now(),
      }), { ex: this.PRESENCE_TTL });

      this.broadcastPresenceChange(userId, status, statusMessage);
    } catch {
      // Ignore parse errors
    }
  }

  /**
   * Get user's current presence
   */
  async getPresence(userId: string): Promise<{
    status: PresenceStatus;
    statusMessage?: string;
    platform?: string;
    lastSeenAt?: number;
  } | null> {
    const key = RedisKeys.presence(userId);
    const raw = await redis.get(key);
    
    if (!raw) return null;

    try {
      return JSON.parse(raw as string);
    } catch {
      return null;
    }
  }

  /**
   * Get all active sockets for a user
   */
  async getUserSockets(userId: string): Promise<string[]> {
    const key = RedisKeys.userConnections(userId);
    return redis.smembers(key) as Promise<string[]>;
  }

  /**
   * Check if user is online
   */
  async isUserOnline(userId: string): Promise<boolean> {
    const sockets = await this.getUserSockets(userId);
    return sockets.length > 0;
  }

  /**
   * Handle heartbeat from client
   */
  async handleHeartbeat(socketId: string): Promise<boolean> {
    const key = RedisKeys.connection(socketId);
    const raw = await redis.get(key);
    
    if (!raw) return false;

    try {
      const info = JSON.parse(raw as string);
      info.lastHeartbeat = Date.now();
      
      // Refresh TTL
      await redis.set(key, JSON.stringify(info), { ex: RedisKeys.connectionTtl });
      
      // Refresh presence TTL
      const presenceKey = RedisKeys.presence(info.userId);
      await redis.expire(presenceKey, this.PRESENCE_TTL);

      return true;
    } catch {
      return false;
    }
  }

  // ─── Heartbeat Management ─────────────────────────────────────────

  private startHeartbeat(socketId: string, _userId: string): void {
    // Clear any existing heartbeat
    this.stopHeartbeat(socketId);

    const timer = setInterval(async () => {
      const alive = await this.checkHeartbeat(socketId);
      if (!alive) {
        console.log(`[Socket Presence] Heartbeat failed for socket ${socketId}`);
        // The socket will be cleaned up on disconnect
      }
    }, this.HEARTBEAT_INTERVAL);

    this.heartbeatTimers.set(socketId, timer);
  }

  private stopHeartbeat(socketId: string): void {
    const timer = this.heartbeatTimers.get(socketId);
    if (timer) {
      clearInterval(timer);
      this.heartbeatTimers.delete(socketId);
    }
  }

  private async checkHeartbeat(socketId: string): Promise<boolean> {
    const key = RedisKeys.connection(socketId);
    const raw = await redis.get(key);
    
    if (!raw) return false;

    try {
      const info = JSON.parse(raw as string);
      const now = Date.now();
      const lastHeartbeat = info.lastHeartbeat || info.connectedAt;
      
      // If no heartbeat in 2x interval, assume dead
      if (now - lastHeartbeat > this.HEARTBEAT_INTERVAL * 2) {
        await this.unregisterSocket(socketId);
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  // ─── Presence Broadcasting ────────────────────────────────────────

  private broadcastPresenceChange(
    userId: string,
    status: PresenceStatus,
    statusMessage?: string
  ): void {
    if (!this.io) return;

    // Broadcast to all rooms the user is in
    // This is handled by the socket's rooms, which Socket.io manages
    // We emit a global presence update event
    this.io.emit('presence_update', {
      userId,
      status,
      statusMessage,
      timestamp: Date.now(),
    });
  }

  /**
   * Broadcast presence update to a specific conversation
   */
  broadcastToConversation(
    convId: string,
    userId: string,
    status: PresenceStatus
  ): void {
    if (!this.io) return;

    const roomName = `conv:${convId}`;
    this.io.to(roomName).emit('presence_update', {
      userId,
      status,
      timestamp: Date.now(),
    });
  }

  // ─── Cleanup ─────────────────────────────────────────────────────

  /**
   * Cleanup all presence data (for shutdown)
   */
  async cleanup(): Promise<void> {
    // Clear all heartbeat timers
    for (const timer of this.heartbeatTimers.values()) {
      clearInterval(timer);
    }
    this.heartbeatTimers.clear();

    console.log('[Socket Presence] Cleanup complete');
  }
}

// Singleton
export const socketPresenceManager = new SocketPresenceManager();
