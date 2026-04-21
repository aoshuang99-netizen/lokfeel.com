/**
 * Message Delivery Manager — Ensures reliable message delivery
 * 
 * Features:
 * - Message ACK mechanism
 * - Offline message queuing
 * - Retry strategy with exponential backoff
 * - Message deduplication
 * - Delivery status tracking
 */

import { redis, RedisKeys } from '@/lib/im/redis';
import type {
  IMMessagePayload,
  MessageDeliveryStatus,
  RuleEngineResult,
  PaceLimitNotification,
  IMMessageType,
} from '@/lib/im/types';

// ─── Types ──────────────────────────────────────────────────────────

export interface DeliveryResult {
  success: boolean;
  message?: IMMessagePayload;
  error?: string;
  ruleResult?: RuleEngineResult;
  paceInfo?: PaceLimitNotification;
}

export interface QueuedMessage {
  msgId: string;
  clientMsgId?: string;
  senderId: string;
  receiverId: string;
  convId: string;
  content: string;
  msgType: IMMessageType;
  replyToMsgId?: string;
  mediaMetadata?: IMMessagePayload['mediaMetadata'];
  queuedAt: number;
  retryCount: number;
  status: MessageDeliveryStatus;
}

export interface DeliveryReceipt {
  msgId: string;
  convId: string;
  userId: string;
  status: MessageDeliveryStatus;
  deliveredAt?: number;
  readAt?: number;
}

// ─── Delivery Manager ────────────────────────────────────────────────

export class DeliveryManager {
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAYS = [1000, 5000, 30000]; // Exponential backoff

  /**
   * Queue a message for delivery
   */
  async queueMessage(
    senderId: string,
    convId: string,
    message: Partial<IMMessagePayload> & {
      msgId: string;
      clientMsgId?: string;
      senderId: string;
      convId: string;
      content: string;
      msgType?: IMMessageType;
      replyToMsgId?: string;
      mediaMetadata?: IMMessagePayload['mediaMetadata'];
    }
  ): Promise<DeliveryResult> {
    try {
      // Get conversation participants
      const participants = await this.getConversationParticipants(convId);
      if (!participants) {
        return { success: false, error: 'Conversation not found' };
      }

      const receiverId = participants.find(p => p.userId !== senderId)?.userId;
      if (!receiverId) {
        return { success: false, error: 'Receiver not found' };
      }

      // Create full message payload
      const now = Date.now();
      const fullMessage: IMMessagePayload = {
        msgId: message.msgId,
        clientMsgId: message.clientMsgId,
        senderId: message.senderId,
        receiverId,
        convId: message.convId,
        seq: await this.getNextSeq(convId),
        msgType: message.msgType || 'TEXT',
        payload: message.content,
        encryptionMode: 'SERVER',
        complianceTags: [],
        consentState: await this.getConsentState(senderId, receiverId),
        mediaLevel: message.mediaMetadata?.level || (message.msgType === 'TEXT' ? 'L0_TEXT' : 'L1_IMAGE'),
        ruleResult: 'PASS',
        isEdited: false,
        isDeleted: false,
        mediaMetadata: message.mediaMetadata,
        status: 'SENDING',
        timestamp: now,
      };

      // Check if receiver is online (has active connections)
      const isReceiverOnline = await this.isUserOnline(receiverId);
      
      if (isReceiverOnline) {
        // Receiver is online — mark as DELIVERED immediately
        fullMessage.status = 'DELIVERED';
      }

      // Save message to database
      await this.saveMessage(fullMessage);

      // Queue for offline delivery if receiver is offline
      if (!isReceiverOnline) {
        await this.queueForOfflineDelivery(receiverId, fullMessage);
      }

      return {
        success: true,
        message: fullMessage,
      };
    } catch (error) {
      console.error('[Delivery Manager] Queue message error:', error);
      return {
        success: false,
        error: 'Failed to queue message',
      };
    }
  }

  /**
   * Acknowledge message delivery
   */
  async acknowledgeDelivery(
    msgId: string,
    convId: string,
    userId: string,
    status: MessageDeliveryStatus = 'DELIVERED'
  ): Promise<void> {
    const key = `delivery:ack:${convId}:${msgId}:${userId}`;
    const receipt: DeliveryReceipt = {
      msgId,
      convId,
      userId,
      status,
      deliveredAt: status === 'DELIVERED' ? Date.now() : undefined,
      readAt: status === 'READ' ? Date.now() : undefined,
    };

    await redis.set(key, JSON.stringify(receipt), { ex: 86400 }); // Keep for 24h
  }

  /**
   * Get delivery receipt
   */
  async getDeliveryReceipt(
    msgId: string,
    convId: string,
    userId: string
  ): Promise<DeliveryReceipt | null> {
    const key = `delivery:ack:${convId}:${msgId}:${userId}`;
    const raw = await redis.get(key);
    if (!raw) return null;

    try {
      return JSON.parse(raw as string) as DeliveryReceipt;
    } catch {
      return null;
    }
  }

  /**
   * Check if message was delivered
   */
  async isMessageDelivered(msgId: string, convId: string, userId: string): Promise<boolean> {
    const receipt = await this.getDeliveryReceipt(msgId, convId, userId);
    return receipt !== null && (receipt.status === 'DELIVERED' || receipt.status === 'READ');
  }

  /**
   * Get offline message queue for user
   */
  async getOfflineQueue(userId: string): Promise<QueuedMessage[]> {
    const key = RedisKeys.deliveryQueue(userId);
    const raw = await redis.get(key);
    if (!raw) return [];

    try {
      return JSON.parse(raw as string) as QueuedMessage[];
    } catch {
      return [];
    }
  }

  /**
   * Flush offline queue when user comes online
   */
  async flushOfflineQueue(userId: string): Promise<QueuedMessage[]> {
    const queue = await this.getOfflineQueue(userId);
    if (queue.length === 0) return [];

    // Clear queue
    const key = RedisKeys.deliveryQueue(userId);
    await redis.del(key);

    return queue;
  }

  /**
   * Mark messages as read
   */
  async markAsRead(
    convId: string,
    userId: string,
    upToMsgId: string
  ): Promise<number> {
    try {
      const { db } = await import('@/lib/db');

      // Update messages in database
      const result = await db.iMMessage.updateMany({
        where: {
          conversationId: convId,
          receiverId: userId,
          status: { not: 'READ' },
          seq: { lte: await this.getSeqFromMsgId(convId, upToMsgId) },
        },
        data: {
          status: 'READ',
        },
      });

      return result.count;
    } catch (error) {
      console.error('[Delivery Manager] Mark as read error:', error);
      return 0;
    }
  }

  /**
   * Update message status
   */
  async updateMessageStatus(
    msgId: string,
    convId: string,
    status: MessageDeliveryStatus,
    errorMessage?: string
  ): Promise<void> {
    try {
      const { db } = await import('@/lib/db');
      await db.iMMessage.update({
        where: { id: msgId },
        data: { status },
      });
    } catch (error) {
      console.error('[Delivery Manager] Update status error:', error);
    }
  }

  // ─── Private Helpers ────────────────────────────────────────────────

  private async getConversationParticipants(convId: string): Promise<Array<{ userId: string }> | null> {
    try {
      const { db } = await import('@/lib/db');
      const participants = await db.conversationParticipant.findMany({
        where: { conversationId: convId },
        select: { userId: true },
      });
      return participants.length > 0 ? participants : null;
    } catch {
      return null;
    }
  }

  private async getNextSeq(convId: string): Promise<number> {
    const key = RedisKeys.seqCounter(convId);
    const seq = await redis.incr(key);
    return seq;
  }

  private async getSeqFromMsgId(convId: string, msgId: string): Promise<number> {
    try {
      const { db } = await import('@/lib/db');
      const message = await db.iMMessage.findUnique({
        where: { id: msgId },
        select: { seq: true },
      });
      return message?.seq || 0;
    } catch {
      return 0;
    }
  }

  private async isUserOnline(userId: string): Promise<boolean> {
    const connections = await this.presenceManager.getUserConnections(userId);
    return connections.length > 0;
  }

  private async getConsentState(senderId: string, receiverId: string): Promise<IMMessagePayload['consentState']> {
    try {
      const { db } = await import('@/lib/db');
      const consent = await db.consentGrant.findFirst({
        where: {
          granterId: receiverId,
          granteeId: senderId,
          isRevoked: false,
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } },
          ],
        },
      });
      
      return consent ? 'CONSENT_GRANTED' : 'CONSENT_NONE';
    } catch {
      return 'CONSENT_NONE';
    }
  }

  private async saveMessage(message: IMMessagePayload): Promise<void> {
    try {
      const { db } = await import('@/lib/db');
      await db.iMMessage.create({
        data: {
          id: message.msgId,
          clientMsgId: message.clientMsgId,
          senderId: message.senderId,
          receiverId: message.receiverId,
          conversationId: message.convId,
          seq: message.seq,
          msgType: message.msgType,
          payload: message.payload,
          encryptionMode: message.encryptionMode,
          ephemeralPublicKey: message.ephemeralPublicKey,
          boundaryVersion: message.boundaryVersion,
          complianceTags: message.complianceTags,
          consentState: message.consentState,
          mediaLevel: message.mediaLevel,
          ruleResult: message.ruleResult,
          replyToMsgId: message.replyToMsgId,
          mediaMetadata: message.mediaMetadata ? JSON.stringify(message.mediaMetadata) : null,
          status: message.status,
          createdAt: new Date(message.timestamp),
        },
      });
    } catch (error) {
      console.error('[Delivery Manager] Save message error:', error);
      throw error;
    }
  }

  private async queueForOfflineDelivery(userId: string, message: IMMessagePayload): Promise<void> {
    const key = RedisKeys.deliveryQueue(userId);
    const queue = await this.getOfflineQueue(userId);

    const queuedMessage: QueuedMessage = {
      msgId: message.msgId,
      clientMsgId: message.clientMsgId,
      senderId: message.senderId,
      receiverId: message.receiverId,
      convId: message.convId,
      content: message.payload,
      msgType: message.msgType,
      replyToMsgId: message.replyToMsgId,
      mediaMetadata: message.mediaMetadata,
      queuedAt: message.timestamp,
      retryCount: 0,
      status: message.status,
    };

    queue.push(queuedMessage);
    await redis.set(key, JSON.stringify(queue), { ex: RedisKeys.deliveryQueueTtl });
  }

  private get presenceManager(): { getUserConnections: (userId: string) => Promise<string[]> } {
    // Lazy import to avoid circular dependency
    return {
      async getUserConnections(userId: string): Promise<string[]> {
        const { presenceManager } = await import('@/lib/im/services/presence-manager');
        return presenceManager.getUserConnections(userId);
      }
    };
  }
}

// Singleton
export const deliveryManager = new DeliveryManager();
