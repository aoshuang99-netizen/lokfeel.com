/**
 * Socket Event Handlers — IM Real-time Message Processing
 * 
 * Handles all WebSocket/Socket.io events for IM module:
 * - join_conversation / leave_conversation
 * - send_message / message events
 * - typing_start / typing_stop
 * - message_read / read_receipt
 */

import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { presenceManager } from '@/lib/im/services/presence-manager';
import { redis, RedisKeys } from '@/lib/im/redis';
import { deliveryManager } from './delivery';
import type {
  IMMessagePayload,
  TypingIndicator,
  ReadReceiptPayload,
  MessageStatusUpdate,
} from '@/lib/im/types';

// ─── Types ──────────────────────────────────────────────────────────

export interface AuthenticatedSocket extends Socket {
  userId?: string;
  authenticatedAt?: number;
}

export interface JoinConversationPayload {
  convId: string;
  lastSeenMsgId?: string;
  lastSeenSeq?: number;
}

export interface SendMessagePayload {
  convId: string;
  content: string;
  msgType?: 'TEXT' | 'IMAGE' | 'VOICE' | 'FILE';
  clientMsgId?: string;
  replyToMsgId?: string;
  mediaMetadata?: IMMessagePayload['mediaMetadata'];
}

export interface TypingPayload {
  convId: string;
  isTyping: boolean;
}

export interface ReadReceiptPayloadClient {
  convId: string;
  upToMsgId: string;
  upToSeq?: number;
}

// ─── Event Names ────────────────────────────────────────────────────

export const SOCKET_EVENTS = {
  // Client → Server
  JOIN_CONVERSATION: 'join_conversation',
  LEAVE_CONVERSATION: 'leave_conversation',
  SEND_MESSAGE: 'send_message',
  TYPING_START: 'typing_start',
  TYPING_STOP: 'typing_stop',
  MESSAGE_READ: 'message_read',
  HEARTBEAT: 'heartbeat',
  
  // Server → Client
  MESSAGE: 'im:message',
  MESSAGE_SENT: 'im:message_sent',
  MESSAGE_FAILED: 'im:message_failed',
  TYPING: 'im:typing',
  READ_RECEIPT: 'im:read_receipt',
  MESSAGE_STATUS: 'im:message_status',
  PACE_LIMIT: 'im:pace_limit',
  CONVERSATION_UPDATE: 'im:conversation_update',
  CONSENT_REQUEST: 'im:consent_request',
  CONSENT_RESPONSE: 'im:consent_response',
  RULE_UPDATE: 'im:rule_update',
  PRESENCE_UPDATE: 'im:presence_update',
  ERROR: 'im:error',
  AUTH_SUCCESS: 'im:auth_success',
  AUTH_FAILED: 'im:auth_failed',
} as const;

// ─── JWT Authentication ──────────────────────────────────────────────

export async function authenticateSocket(socket: AuthenticatedSocket, token: string): Promise<boolean> {
  try {
    const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
    if (!secret) {
      console.error('[Socket Handler] No AUTH_SECRET configured');
      return false;
    }

    const decoded = jwt.verify(token, secret) as { sub?: string; id?: string; userId?: string };
    const userId = decoded.sub || decoded.id || decoded.userId;

    if (!userId) {
      console.error('[Socket Handler] No userId in JWT payload');
      return false;
    }

    socket.userId = userId;
    socket.authenticatedAt = Date.now();

    // Track connection in Redis
    await presenceManager.setOnline(userId, socket.id);

    console.log(`[Socket Handler] Authenticated: socket ${socket.id} → user ${userId}`);
    return true;
  } catch (error) {
    console.error('[Socket Handler] Auth failed:', error);
    return false;
  }
}

// ─── Verify Conversation Participant ────────────────────────────────

async function verifyParticipant(userId: string, convId: string): Promise<boolean> {
  try {
    const { db } = await import('@/lib/db');
    const participant = await db.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId: convId, userId } },
    });
    return !!participant;
  } catch (error) {
    console.error('[Socket Handler] Participant verification error:', error);
    return false;
  }
}

// ─── Typing Indicator Management ────────────────────────────────────

export async function setTypingIndicator(
  convId: string,
  userId: string,
  isTyping: boolean
): Promise<void> {
  const key = RedisKeys.typing(convId, userId);
  if (isTyping) {
    await redis.set(key, '1', { ex: RedisKeys.typingTtl });
  } else {
    await redis.del(key);
  }
}

export async function getTypingUsers(_convId: string): Promise<string[]> {
  // In production, use Redis SCAN for pattern matching
  // Simple approach: check both users based on conversation
  return [];
}

// ─── Join Conversation Handler ──────────────────────────────────────

export async function handleJoinConversation(
  io: Server,
  socket: AuthenticatedSocket,
  payload: JoinConversationPayload
): Promise<void> {
  if (!socket.userId) {
    socket.emit(SOCKET_EVENTS.ERROR, { code: 'NOT_AUTHENTICATED', message: 'Not authenticated' });
    return;
  }

  const { convId } = payload;

  // Verify participant
  const isParticipant = await verifyParticipant(socket.userId, convId);
  if (!isParticipant) {
    socket.emit(SOCKET_EVENTS.ERROR, { code: 'FORBIDDEN', message: 'Not a participant in this conversation' });
    return;
  }

  // Join Socket.io room
  const roomName = `conv:${convId}`;
  await socket.join(roomName);
  
  // Track subscription
  const subKey = `socket:subs:${socket.id}`;
  const subs = await redis.smembers(subKey);
  if (!subs.includes(roomName)) {
    await redis.sadd(subKey, roomName);
    await redis.expire(subKey, 86400); // 24h TTL
  }

  console.log(`[Socket Handler] User ${socket.userId} joined conversation ${convId}`);

  // Send confirmation
  socket.emit(SOCKET_EVENTS.AUTH_SUCCESS, {
    convId,
    joinedAt: Date.now(),
  });

  // Notify other participants
  socket.to(roomName).emit(SOCKET_EVENTS.PRESENCE_UPDATE, {
    userId: socket.userId,
    status: 'ONLINE',
    timestamp: Date.now(),
  });
}

// ─── Leave Conversation Handler ─────────────────────────────────────

export async function handleLeaveConversation(
  io: Server,
  socket: AuthenticatedSocket,
  payload: { convId: string }
): Promise<void> {
  if (!socket.userId) return;

  const { convId } = payload;
  const roomName = `conv:${convId}`;

  await socket.leave(roomName);

  // Remove from subscriptions
  const subKey = `socket:subs:${socket.id}`;
  await redis.srem(subKey, roomName);

  console.log(`[Socket Handler] User ${socket.userId} left conversation ${convId}`);

  // Notify others
  socket.to(roomName).emit(SOCKET_EVENTS.PRESENCE_UPDATE, {
    userId: socket.userId,
    status: 'OFFLINE',
    timestamp: Date.now(),
  });
}

// ─── Send Message Handler ────────────────────────────────────────────

export async function handleSendMessage(
  io: Server,
  socket: AuthenticatedSocket,
  payload: SendMessagePayload
): Promise<void> {
  if (!socket.userId) {
    socket.emit(SOCKET_EVENTS.ERROR, { code: 'NOT_AUTHENTICATED', message: 'Not authenticated' });
    return;
  }

  const { convId, content, msgType = 'TEXT', clientMsgId, replyToMsgId, mediaMetadata } = payload;

  // Verify participant
  const isParticipant = await verifyParticipant(socket.userId, convId);
  if (!isParticipant) {
    socket.emit(SOCKET_EVENTS.MESSAGE_FAILED, {
      clientMsgId,
      error: 'Not a participant in this conversation',
    });
    return;
  }

  // Generate message ID
  const msgId = clientMsgId || `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  try {
    // Process message through delivery manager
    const result = await deliveryManager.queueMessage(socket.userId, convId, {
      msgId,
      clientMsgId,
      senderId: socket.userId,
      convId,
      content,
      msgType,
      replyToMsgId,
      mediaMetadata,
    });

    if (result.success) {
      // Message queued successfully
      socket.emit(SOCKET_EVENTS.MESSAGE_SENT, {
        clientMsgId,
        msgId: result.message?.msgId,
        seq: result.message?.seq,
        timestamp: result.message?.timestamp,
      });

      // Broadcast to conversation room
      const roomName = `conv:${convId}`;
      io.to(roomName).emit(SOCKET_EVENTS.MESSAGE, {
        message: result.message,
      });

      // Send status update
      socket.emit(SOCKET_EVENTS.MESSAGE_STATUS, {
        msgId: result.message?.msgId,
        convId,
        status: 'SENT',
        updatedAt: Date.now(),
      } as MessageStatusUpdate);
    } else {
      // Message failed (e.g., rule engine blocked)
      socket.emit(SOCKET_EVENTS.MESSAGE_FAILED, {
        clientMsgId,
        error: result.error || 'Message failed',
        ruleResult: result.ruleResult,
        paceInfo: result.paceInfo,
      });

      // Send pace limit notification if applicable
      if (result.paceInfo) {
        socket.emit(SOCKET_EVENTS.PACE_LIMIT, result.paceInfo);
      }
    }
  } catch (error) {
    console.error('[Socket Handler] Send message error:', error);
    socket.emit(SOCKET_EVENTS.MESSAGE_FAILED, {
      clientMsgId,
      error: 'Internal error',
    });
  }
}

// ─── Typing Handler ──────────────────────────────────────────────────

export async function handleTyping(
  io: Server,
  socket: AuthenticatedSocket,
  payload: TypingPayload
): Promise<void> {
  if (!socket.userId) return;

  const { convId, isTyping } = payload;

  // Set typing indicator in Redis (auto-expires)
  await setTypingIndicator(convId, socket.userId, isTyping);

  // Broadcast to conversation
  const roomName = `conv:${convId}`;
  socket.to(roomName).emit(SOCKET_EVENTS.TYPING, {
    userId: socket.userId,
    convId,
    isTyping,
    timestamp: Date.now(),
  } as TypingIndicator);
}

// ─── Message Read Handler ────────────────────────────────────────────

export async function handleMessageRead(
  io: Server,
  socket: AuthenticatedSocket,
  payload: ReadReceiptPayloadClient
): Promise<void> {
  if (!socket.userId) return;

  const { convId, upToMsgId, upToSeq } = payload;

  // Verify participant
  const isParticipant = await verifyParticipant(socket.userId, convId);
  if (!isParticipant) return;

  // Broadcast read receipt
  const roomName = `conv:${convId}`;
  const receipt: ReadReceiptPayload = {
    userId: socket.userId,
    convId,
    upToMsgId,
    upToSeq: upToSeq || 0,
    readAt: Date.now(),
  };

  socket.to(roomName).emit(SOCKET_EVENTS.READ_RECEIPT, receipt);
}

// ─── Heartbeat Handler ──────────────────────────────────────────────

export async function handleHeartbeat(
  socket: AuthenticatedSocket
): Promise<void> {
  if (!socket.userId) return;
  
  await presenceManager.heartbeat(socket.userId);
  
  // Send ACK
  socket.emit(SOCKET_EVENTS.PRESENCE_UPDATE, {
    userId: socket.userId,
    status: 'ONLINE',
    timestamp: Date.now(),
  });
}

// ─── Disconnect Handler ─────────────────────────────────────────────

export async function handleDisconnect(
  io: Server,
  socket: AuthenticatedSocket
): Promise<void> {
  if (!socket.userId) return;

  console.log(`[Socket Handler] User ${socket.userId} disconnected (socket ${socket.id})`);

  // Remove from all subscribed rooms
  const subKey = `socket:subs:${socket.id}`;
  const subs = await redis.smembers(subKey);
  
  for (const roomName of subs) {
    await socket.leave(roomName);
    
    // Notify others in room
    socket.to(roomName).emit(SOCKET_EVENTS.PRESENCE_UPDATE, {
      userId: socket.userId,
      status: 'OFFLINE',
      timestamp: Date.now(),
    });
  }

  // Clean up subscription tracking
  await redis.del(subKey);

  // Update presence
  await presenceManager.setOffline(socket.userId, socket.id);
}

// ─── Register All Handlers ──────────────────────────────────────────

export function registerSocketHandlers(io: Server): void {
  io.on('connection', async (socket: AuthenticatedSocket) => {
    console.log(`[Socket Handler] New connection: ${socket.id}`);

    // ── Authentication ──────────────────────────────────────────────
    socket.on('authenticate', async (data: { token: string }) => {
      const success = await authenticateSocket(socket, data.token);
      if (success) {
        socket.emit(SOCKET_EVENTS.AUTH_SUCCESS, { connectedAt: Date.now() });
      } else {
        socket.emit(SOCKET_EVENTS.AUTH_FAILED, { error: 'Authentication failed' });
        socket.disconnect();
      }
    });

    // ── Conversation Management ───────────────────────────────────
    socket.on(SOCKET_EVENTS.JOIN_CONVERSATION, async (payload: JoinConversationPayload) => {
      await handleJoinConversation(io, socket, payload);
    });

    socket.on(SOCKET_EVENTS.LEAVE_CONVERSATION, async (payload: { convId: string }) => {
      await handleLeaveConversation(io, socket, payload);
    });

    // ── Messaging ──────────────────────────────────────────────────
    socket.on(SOCKET_EVENTS.SEND_MESSAGE, async (payload: SendMessagePayload) => {
      await handleSendMessage(io, socket, payload);
    });

    // ── Real-time Indicators ────────────────────────────────────────
    socket.on(SOCKET_EVENTS.TYPING_START, async (payload: { convId: string }) => {
      await handleTyping(io, socket, { ...payload, isTyping: true });
    });

    socket.on(SOCKET_EVENTS.TYPING_STOP, async (payload: { convId: string }) => {
      await handleTyping(io, socket, { ...payload, isTyping: false });
    });

    socket.on(SOCKET_EVENTS.MESSAGE_READ, async (payload: ReadReceiptPayloadClient) => {
      await handleMessageRead(io, socket, payload);
    });

    // ── Heartbeat ──────────────────────────────────────────────────
    socket.on(SOCKET_EVENTS.HEARTBEAT, async () => {
      await handleHeartbeat(socket);
    });

    // ── Disconnect ──────────────────────────────────────────────────
    socket.on('disconnect', async () => {
      await handleDisconnect(io, socket);
    });
  });

  console.log('[Socket Handler] All handlers registered');
}
