/**
 * WebSocket Manager — IM Real-time Connection Layer
 * 
 * Architecture:
 * - Uses native WebSocket (Next.js custom server mode)
 * - JWT-based connection authentication
 * - Room-based subscription (per conversation)
 * - Event-driven message dispatch
 * 
 * Note: Next.js App Router doesn't natively support WebSocket.
 * This module provides a standalone WebSocket server that runs
 * alongside the Next.js app, typically on a separate port.
 * 
 * For Vercel deployment, use Pusher (already in dependencies)
 * as the real-time transport, with this module providing
 * the server-side event dispatch logic.
 */

import type { Server as HTTPServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { presenceManager } from '../services/presence-manager';
import { redis, RedisKeys } from '../redis';
import type {
  ServerEvent,
  ClientEvent,
  ServerEventType,
  IMMessagePayload,
  TypingIndicator,
  ReadReceiptPayload,
  ConversationUpdatePayload,
  MessageStatusUpdate,
  PaceLimitNotification,
  SystemNotification,
} from '../types';

// ─── Connection Registry ──────────────────────────────────────

interface ConnectionInfo {
  ws: WebSocket;
  userId: string;
  connectionId: string;
  subscriptions: Set<string>; // conversation IDs
  authenticated: boolean;
  connectedAt: number;
  lastActivityAt: number;
}

export class WebSocketManager {
  private wss: WebSocketServer | null = null;
  private connections = new Map<string, ConnectionInfo>(); // connectionId → info
  private userConnections = new Map<string, Set<string>>(); // userId → connectionId set

  /**
   * Initialize WebSocket server
   */
  initialize(server: HTTPServer): void {
    this.wss = new WebSocketServer({ server, path: '/ws/im' });

    this.wss.on('connection', (ws, req) => {
      const connectionId = `conn_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const info: ConnectionInfo = {
        ws,
        userId: '',
        connectionId,
        subscriptions: new Set(),
        authenticated: false,
        connectedAt: Date.now(),
        lastActivityAt: Date.now(),
      };

      this.connections.set(connectionId, info);
      console.log(`[WS] Connection opened: ${connectionId}`);

      // Send authentication challenge
      this.sendToConnection(ws, {
        eventId: `auth_${connectionId}`,
        eventType: 'system',
        timestamp: Date.now(),
        payload: {
          level: 'INFO' as const,
          title: 'Authentication Required',
          message: 'Please send an authentication event with your JWT token',
        } as SystemNotification,
      });

      ws.on('message', (data) => this.handleMessage(connectionId, data));
      ws.on('close', () => this.handleDisconnect(connectionId));
      ws.on('error', (error) => {
        console.error(`[WS] Error on ${connectionId}:`, error.message);
      });

      // Auth timeout: disconnect if not authenticated within 30s
      setTimeout(() => {
        const conn = this.connections.get(connectionId);
        if (conn && !conn.authenticated) {
          this.sendToConnection(ws, {
            eventId: `auth_timeout_${connectionId}`,
            eventType: 'system',
            timestamp: Date.now(),
            payload: {
              level: 'WARNING' as const,
              title: 'Authentication Timeout',
              message: 'Connection closed due to authentication timeout',
            } as SystemNotification,
          });
          ws.close(4001, 'Authentication timeout');
        }
      }, 30000);
    });

    console.log('[WS] WebSocket server initialized on /ws/im');
  }

  /**
   * Authenticate a WebSocket connection using JWT
   */
  async authenticate(connectionId: string, token: string): Promise<boolean> {
    const conn = this.connections.get(connectionId);
    if (!conn) return false;

    try {
      const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
      if (!secret) {
        console.error('[WS] No AUTH_SECRET configured');
        return false;
      }

      const decoded = jwt.verify(token, secret) as { sub?: string; id?: string };
      const userId = decoded.sub || decoded.id;

      if (!userId) {
        console.error('[WS] No userId in JWT payload');
        return false;
      }

      conn.userId = userId;
      conn.authenticated = true;

      // Register connection
      this.addUserConnection(userId, connectionId);
      await presenceManager.setOnline(userId, connectionId);

      console.log(`[WS] Authenticated: ${connectionId} → user:${userId}`);

      // Send auth success
      this.sendToConnection(conn.ws, {
        eventId: `auth_ok_${connectionId}`,
        eventType: 'system',
        timestamp: Date.now(),
        payload: {
          level: 'INFO' as const,
          title: 'Authenticated',
          message: `Connected as ${userId}`,
        } as SystemNotification,
      });

      return true;
    } catch (error) {
      console.error(`[WS] Auth failed for ${connectionId}:`, error);
      return false;
    }
  }

  /**
   * Handle incoming WebSocket message
   */
  private async handleMessage(connectionId: string, data: any): Promise<void> {
    const conn = this.connections.get(connectionId);
    if (!conn) return;

    conn.lastActivityAt = Date.now();

    try {
      const event: ClientEvent = JSON.parse(data.toString());

      // Handle authentication
      if (!conn.authenticated) {
        if (event.eventType === 'presence_update') {
          // Use presence_update as auth carrier during initial handshake
          const token = (event.payload as any)?.token;
          if (token) {
            const success = await this.authenticate(connectionId, token);
            if (!success) {
              conn.ws.close(4003, 'Authentication failed');
            }
          }
        }
        return;
      }

      // Route authenticated events
      switch (event.eventType) {
        case 'subscribe':
          await this.handleSubscribe(conn, event.payload as any);
          break;
        case 'unsubscribe':
          await this.handleUnsubscribe(conn, event.payload as any);
          break;
        case 'typing':
          await this.handleTyping(conn, event.payload as any);
          break;
        case 'read':
          await this.handleRead(conn, event.payload as any);
          break;
        case 'send_message':
          // Handled by REST API for reliability; WS is for real-time push only
          break;
        case 'ack_message':
          await this.handleAck(conn, event.payload as any);
          break;
        case 'presence_update':
          await this.handlePresenceUpdate(conn, event.payload as any);
          break;
      }
    } catch (error) {
      console.error(`[WS] Message parse error on ${connectionId}:`, error);
    }
  }

  /**
   * Handle connection disconnect
   */
  private async handleDisconnect(connectionId: string): Promise<void> {
    const conn = this.connections.get(connectionId);
    if (!conn) return;

    // Remove from user connections
    if (conn.userId) {
      this.removeUserConnection(conn.userId, connectionId);
      await presenceManager.setOffline(conn.userId, connectionId);
    }

    this.connections.delete(connectionId);
    console.log(`[WS] Disconnected: ${connectionId} (user: ${conn.userId || 'unauth'})`);
  }

  // ─── Event Handlers ──────────────────────────────────────────

  private async handleSubscribe(conn: ConnectionInfo, payload: { convId: string; lastSeenMsgId?: string }): Promise<void> {
    // Verify user is a participant
    const participant = await this.verifyParticipant(conn.userId, payload.convId);
    if (!participant) {
      this.sendError(conn.ws, 'Forbidden: Not a participant in this conversation');
      return;
    }

    conn.subscriptions.add(payload.convId);
    console.log(`[WS] User ${conn.userId} subscribed to conv:${payload.convId}`);
  }

  private async handleUnsubscribe(conn: ConnectionInfo, payload: { convId: string }): Promise<void> {
    conn.subscriptions.delete(payload.convId);
  }

  private async handleTyping(conn: ConnectionInfo, payload: { convId: string; isTyping: boolean }): Promise<void> {
    if (!conn.subscriptions.has(payload.convId)) return;

    // Set typing indicator in Redis (auto-expire)
    const key = RedisKeys.typing(payload.convId, conn.userId);
    if (payload.isTyping) {
      await redis.set(key, '1', { ex: RedisKeys.typingTtl });
    } else {
      await redis.del(key);
    }

    // Broadcast to other participant
    const indicator: TypingIndicator = {
      userId: conn.userId,
      convId: payload.convId,
      isTyping: payload.isTyping,
      timestamp: Date.now(),
    };

    await this.broadcastToConversation(payload.convId, {
      eventId: `typing_${Date.now()}`,
      eventType: 'typing',
      timestamp: Date.now(),
      payload: indicator,
    }, conn.userId); // exclude sender
  }

  private async handleRead(conn: ConnectionInfo, payload: { convId: string; upToMsgId: string }): Promise<void> {
    // Broadcast read receipt to other participant
    const receipt: ReadReceiptPayload = {
      userId: conn.userId,
      convId: payload.convId,
      upToMsgId: payload.upToMsgId,
      upToSeq: 0, // will be filled from DB
      readAt: Date.now(),
    };

    await this.broadcastToConversation(payload.convId, {
      eventId: `read_${Date.now()}`,
      eventType: 'read_receipt',
      timestamp: Date.now(),
      payload: receipt,
    }, conn.userId);
  }

  private async handleAck(conn: ConnectionInfo, payload: { msgId: string; convId: string }): Promise<void> {
    // Message acknowledgment - can be used for delivery tracking
    console.log(`[WS] ACK: user ${conn.userId} acked msg ${payload.msgId}`);
  }

  private async handlePresenceUpdate(conn: ConnectionInfo, payload: { status: string; statusMessage?: string }): Promise<void> {
    await presenceManager.setPresence(
      conn.userId,
      payload.status as any,
      payload.statusMessage
    );
  }

  // ─── Public Broadcasting Methods ────────────────────────────

  /**
   * Send event to a specific user (all their connections)
   */
  async sendToUser(userId: string, event: ServerEvent): Promise<void> {
    const connIds = this.userConnections.get(userId);
    if (!connIds) return;

    const message = JSON.stringify(event);
    for (const connId of connIds) {
      const conn = this.connections.get(connId);
      if (conn && conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(message);
      }
    }
  }

  /**
   * Broadcast event to all participants in a conversation
   * Optionally exclude a userId
   */
  async broadcastToConversation(
    convId: string,
    event: ServerEvent,
    excludeUserId?: string
  ): Promise<void> {
    const message = JSON.stringify(event);

    for (const [, conn] of this.connections) {
      if (conn.subscriptions.has(convId) && conn.userId !== excludeUserId) {
        if (conn.ws.readyState === WebSocket.OPEN) {
          conn.ws.send(message);
        }
      }
    }
  }

  /**
   * Broadcast system notification to all connected users
   */
  broadcastSystem(notification: SystemNotification): void {
    const event: ServerEvent = {
      eventId: `sys_${Date.now()}`,
      eventType: 'system',
      timestamp: Date.now(),
      payload: notification,
    };

    const message = JSON.stringify(event);
    for (const [, conn] of this.connections) {
      if (conn.authenticated && conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(message);
      }
    }
  }

  // ─── Helper Methods ─────────────────────────────────────────

  private sendToConnection(ws: WebSocket, event: ServerEvent): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }

  private sendError(ws: WebSocket, message: string): void {
    this.sendToConnection(ws, {
      eventId: `err_${Date.now()}`,
      eventType: 'system',
      timestamp: Date.now(),
      payload: {
        level: 'ERROR',
        title: 'Error',
        message,
      } as SystemNotification,
    });
  }

  private addUserConnection(userId: string, connectionId: string): void {
    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, new Set());
    }
    this.userConnections.get(userId)!.add(connectionId);
  }

  private removeUserConnection(userId: string, connectionId: string): void {
    const conns = this.userConnections.get(userId);
    if (conns) {
      conns.delete(connectionId);
      if (conns.size === 0) {
        this.userConnections.delete(userId);
      }
    }
  }

  private async verifyParticipant(userId: string, convId: string): Promise<boolean> {
    const { db } = await import('@/lib/db');
    const participant = await db.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId: convId, userId } },
    });
    return !!participant;
  }

  /**
   * Get connection stats (for monitoring)
   */
  getStats(): { totalConnections: number; authenticatedUsers: number; activeSubscriptions: number } {
    let authedUsers = 0;
    let activeSubs = 0;
    const seenUsers = new Set<string>();

    for (const [, conn] of this.connections) {
      if (conn.authenticated) {
        seenUsers.add(conn.userId);
        activeSubs += conn.subscriptions.size;
      }
    }

    return {
      totalConnections: this.connections.size,
      authenticatedUsers: seenUsers.size,
      activeSubscriptions: activeSubs,
    };
  }
}

// Singleton
export const wsManager = new WebSocketManager();
