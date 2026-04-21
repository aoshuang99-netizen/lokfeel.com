/**
 * IM Database Queries — Core CRUD operations for IM Module
 * 
 * This module provides low-level database access functions for the IM module.
 * All functions use Prisma client with proper error handling and transactions.
 * 
 * @module lib/im/queries
 */

import { db } from '@/lib/db';
import {
  IMMessageType,
  ConversationState,
  MessageDeliveryStatus,
  PresenceStatus,
  ConsentState,
  MediaAccessLevel,
  EncryptionMode,
  RuleEngineResult,
} from '@/generated';
import type {
  IMMessagePayload,
  ConversationPayload,
  ConversationListItem,
} from './types';

// ═══════════════════════════════════════════════════════════════════════════
// Type Extensions
// ═══════════════════════════════════════════════════════════════════════════

// Inline types for relation queries
interface IMMessageWithSender {
  id: string;
  clientMsgId: string | null;
  conversationId: string;
  senderId: string;
  receiverId: string;
  seq: number;
  msgType: IMMessageType;
  payload: string;
  metadata: string | null;
  encryptionMode: EncryptionMode;
  ephemeralPublicKey: string | null;
  boundaryVersion: string | null;
  complianceTags: string[];
  consentState: ConsentState;
  mediaLevel: MediaAccessLevel;
  ruleResult: RuleEngineResult;
  replyToMsgId: string | null;
  replyToPreview: string | null;
  isEdited: boolean;
  editedAt: Date | null;
  isDeleted: boolean;
  deletedAt: Date | null;
  deletedBy: string | null;
  mediaMetadata: string | null;
  status: MessageDeliveryStatus;
  createdAt: Date;
  sender: { id: string; name: string | null; image: string | null };
  receipts: { userId: string; readAt: Date | null }[];
}

interface ConversationWithParticipants {
  id: string;
  userAId: string;
  userBId: string;
  initiatorId: string;
  chatRoomId: string | null;
  state: ConversationState;
  stateReason: string | null;
  controllingUserId: string | null;
  activeBoundaryVersion: string | null;
  lastMessageAt: Date | null;
  messageCount: number;
  unreadCountA: number;
  unreadCountB: number;
  settings: string | null;
  vaultExpiresAt: Date | null;
  cachedConsentState: ConsentState;
  createdAt: Date;
  updatedAt: Date;
  participants: {
    id?: string;
    conversationId?: string;
    userId: string;
    isMuted: boolean;
    isPinned: boolean;
    isArchived: boolean;
    lastReadSeq: number | null;
    lastReadAt: Date | null;
    subscribedAt?: Date;
    user?: { id: string; name: string | null; image: string | null; presence: { status: PresenceStatus } | null };
  }[];
  imMessages?: { id: string; payload: string; msgType: IMMessageType; senderId: string; createdAt: Date; isDeleted: boolean }[];
}

// Type for message with sender and receipts relations
interface IMMessageWithRelations {
  id: string;
  clientMsgId: string | null;
  conversationId: string;
  senderId: string;
  receiverId: string;
  seq: number;
  msgType: IMMessageType;
  payload: string;
  metadata: string | null;
  encryptionMode: EncryptionMode;
  ephemeralPublicKey: string | null;
  boundaryVersion: string | null;
  complianceTags: string[];
  consentState: ConsentState;
  mediaLevel: MediaAccessLevel;
  ruleResult: RuleEngineResult;
  replyToMsgId: string | null;
  replyToPreview: string | null;
  isEdited: boolean;
  editedAt: Date | null;
  isDeleted: boolean;
  deletedAt: Date | null;
  deletedBy: string | null;
  mediaMetadata: string | null;
  status: MessageDeliveryStatus;
  createdAt: Date;
  sender: { id: string; name: string | null; image: string | null };
  receipts?: { userId: string; readAt: Date | null }[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Conversation Queries
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a new conversation between two users
 * Uses upsert to prevent duplicate conversations
 */
export async function createConversation(
  userAId: string,
  userBId: string,
  initiatorId: string,
  options?: {
    chatRoomId?: string;
    controllingUserId?: string;
    state?: ConversationState;
  }
): Promise<ConversationPayload> {
  // Ensure consistent ordering of user IDs for unique constraint
  const [firstId, secondId] = userAId < userBId ? [userAId, userBId] : [userBId, userAId];

  const conversation = await db.conversation.upsert({
    where: {
      userAId_userBId: { userAId: firstId, userBId: secondId },
    },
    create: {
      userAId: firstId,
      userBId: secondId,
      initiatorId,
      chatRoomId: options?.chatRoomId,
      controllingUserId: options?.controllingUserId,
      state: options?.state || 'ACTIVE',
      participants: {
        create: [
          { userId: firstId, isMuted: false, isPinned: false },
          { userId: secondId, isMuted: false, isPinned: false },
        ],
      },
    },
    update: {
      state: 'ACTIVE',
      stateReason: null,
    },
    include: {
      participants: true,
    },
  });

  return conversationToPayload(conversation);
}

/**
 * Get all conversations for a user with pagination
 * Returns conversations sorted by last message time
 */
export async function getConversationsByUserId(
  userId: string,
  options?: {
    limit?: number;
    cursor?: string;
    states?: ConversationState[];
  }
): Promise<{
  conversations: ConversationListItem[];
  nextCursor?: string;
  hasMore: boolean;
}> {
  const limit = options?.limit || 20;

  // Build where clause
  const where = {
    participants: { some: { userId } },
    state: { in: options?.states || ['ACTIVE', 'PAUSED'] },
  };

  // Get conversations with latest message
  const conversations = await db.conversation.findMany({
    where,
    take: limit + 1, // Fetch one extra to check if there are more
    ...(options?.cursor && { cursor: { id: options.cursor }, skip: 1 }),
    orderBy: { lastMessageAt: 'desc' },
    include: {
      participants: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              image: true,
              presence: {
                select: {
                  status: true,
                  lastSeenAt: true,
                },
              },
            },
          },
        },
      },
      imMessages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          id: true,
          payload: true,
          msgType: true,
          senderId: true,
          createdAt: true,
          isDeleted: true,
        },
      },
    },
  });

  const hasMore = conversations.length > limit;
  const items = hasMore ? conversations.slice(0, -1) : conversations;

  // Determine the other user in each conversation
  const result: ConversationListItem[] = items.map((conv) => {
    const otherParticipant = conv.participants.find((p) => p.userId !== userId);
    const currentParticipant = conv.participants.find((p) => p.userId === userId);
    const lastMessage = conv.imMessages?.[0];

    return {
      convId: conv.id,
      otherUser: otherParticipant
        ? {
            id: otherParticipant.user!.id,
            name: otherParticipant.user!.name || 'Unknown',
            avatar: otherParticipant.user!.image || undefined,
            presence: (otherParticipant.user!.presence?.status || 'OFFLINE') as PresenceStatus,
          }
        : { id: '', name: 'Unknown', presence: 'OFFLINE' as PresenceStatus },
      lastMessage: lastMessage && !lastMessage.isDeleted
        ? {
            content: lastMessage.payload,
            senderId: lastMessage.senderId,
            msgType: lastMessage.msgType as IMMessageType,
            timestamp: lastMessage.createdAt.getTime(),
          }
        : undefined,
      unreadCount: currentParticipant?.userId === conv.userAId
        ? conv.unreadCountA
        : conv.unreadCountB,
      isMuted: currentParticipant?.isMuted || false,
      isPinned: currentParticipant?.isPinned || false,
      state: conv.state,
      vaultExpiresAt: conv.vaultExpiresAt?.getTime(),
    };
  });

  return {
    conversations: result,
    nextCursor: hasMore ? items[items.length - 1].id : undefined,
    hasMore,
  };
}

/**
 * Get a single conversation by ID
 */
export async function getConversationById(
  conversationId: string,
  userId?: string
): Promise<ConversationPayload | null> {
  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
    include: {
      participants: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              image: true,
              presence: true,
            },
          },
        },
      },
    },
  });

  if (!conversation) return null;

  // Optionally verify user is a participant
  if (userId && !conversation.participants.some((p) => p.userId === userId)) {
    return null;
  }

  return conversationToPayload(conversation);
}

/**
 * Update conversation settings (mute, pin, archive)
 */
export async function updateConversationSettings(
  conversationId: string,
  userId: string,
  settings: {
    isMuted?: boolean;
    isPinned?: boolean;
    isArchived?: boolean;
  }
): Promise<void> {
  await db.conversationParticipant.update({
    where: {
      conversationId_userId: { conversationId, userId },
    },
    data: {
      isMuted: settings.isMuted,
      isPinned: settings.isPinned,
      isArchived: settings.isArchived,
    },
  });
}

/**
 * Archive or block a conversation
 */
export async function updateConversationState(
  conversationId: string,
  state: ConversationState,
  reason?: string
): Promise<void> {
  await db.conversation.update({
    where: { id: conversationId },
    data: {
      state,
      stateReason: reason,
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Message Queries
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a new message in a conversation
 * Uses transaction to ensure seq number consistency
 */
export async function createMessage(
  conversationId: string,
  senderId: string,
  receiverId: string,
  payload: string,
  options?: {
    msgType?: IMMessageType;
    clientMsgId?: string;
    replyToMsgId?: string;
    mediaMetadata?: string;
    encryptionMode?: EncryptionMode;
    ephemeralPublicKey?: string;
    boundaryVersion?: string;
    complianceTags?: string[];
    consentState?: ConsentState;
    mediaLevel?: MediaAccessLevel;
  }
): Promise<IMMessagePayload> {
  // Use transaction to atomically increment seq and create message
  const result = await db.$transaction(async (tx) => {
    // Get current max seq for this conversation
    const lastMessage = await tx.iMMessage.findFirst({
      where: { conversationId },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });

    const nextSeq = (lastMessage?.seq || 0) + 1;

    // Create the message
    const message = await tx.iMMessage.create({
      data: {
        conversationId,
        senderId,
        receiverId,
        seq: nextSeq,
        payload,
        msgType: options?.msgType || 'TEXT',
        clientMsgId: options?.clientMsgId,
        replyToMsgId: options?.replyToMsgId,
        mediaMetadata: options?.mediaMetadata,
        encryptionMode: options?.encryptionMode || 'SERVER',
        ephemeralPublicKey: options?.ephemeralPublicKey,
        boundaryVersion: options?.boundaryVersion,
        complianceTags: options?.complianceTags || [],
        consentState: options?.consentState || 'CONSENT_NONE',
        mediaLevel: options?.mediaLevel || 'L0_TEXT',
        status: 'SENT',
      },
      include: {
        sender: {
          select: { id: true, name: true, image: true },
        },
      },
    });

    // Update conversation metadata
    await tx.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: new Date(),
        messageCount: { increment: 1 },
        // Increment unread count for the receiver
        unreadCountB: receiverId === (await tx.conversation.findUnique({ where: { id: conversationId }, select: { userBId: true } }))?.userBId
          ? { increment: 1 }
          : undefined,
        unreadCountA: receiverId === (await tx.conversation.findUnique({ where: { id: conversationId }, select: { userAId: true } }))?.userAId
          ? { increment: 1 }
          : undefined,
      },
    });

    return message;
  });

  return messageToPayload(result);
}

/**
 * Get messages for a conversation with pagination
 * Returns messages in chronological order (oldest first for pagination)
 */
export async function getMessagesByConversationId(
  conversationId: string,
  userId: string,
  options?: {
    limit?: number;
    beforeSeq?: number;
    includeDeleted?: boolean;
  }
): Promise<{
  messages: IMMessagePayload[];
  hasMore: boolean;
  nextCursor?: string;
}> {
  const limit = options?.limit || 50;

  // Verify user is a participant
  const participant = await db.conversationParticipant.findUnique({
    where: {
      conversationId_userId: { conversationId, userId },
    },
  });

  if (!participant) {
    throw new Error('User is not a participant of this conversation');
  }

  const where = {
    conversationId,
    ...(options?.beforeSeq && { seq: { lt: options.beforeSeq } }),
    ...(options?.includeDeleted !== true && { isDeleted: false }),
  };

  const messages = await db.iMMessage.findMany({
    where,
    take: limit + 1,
    orderBy: { seq: 'desc' },
    include: {
      sender: {
        select: { id: true, name: true, image: true },
      },
      receipts: {
        where: { userId },
      },
    },
  });

  const hasMore = messages.length > limit;
  // Reverse to get chronological order
  const items = hasMore ? messages.slice(0, -1).reverse() : [...messages].reverse();

  return {
    messages: items.map(messageToPayload),
    hasMore,
    nextCursor: hasMore ? String(items[0].seq) : undefined,
  };
}

/**
 * Get a single message by ID
 */
export async function getMessageById(messageId: string): Promise<IMMessagePayload | null> {
  const message = await db.iMMessage.findUnique({
    where: { id: messageId },
    include: {
      sender: {
        select: { id: true, name: true, image: true },
      },
      receipts: true,
    },
  });

  return message ? messageToPayload(message) : null;
}

/**
 * Edit a message (sender only)
 */
export async function editMessage(
  messageId: string,
  senderId: string,
  newPayload: string
): Promise<IMMessagePayload | null> {
  const message = await db.iMMessage.findFirst({
    where: { id: messageId, senderId, isDeleted: false },
  });

  if (!message) return null;

  const updated = await db.iMMessage.update({
    where: { id: messageId },
    data: {
      payload: newPayload,
      isEdited: true,
      editedAt: new Date(),
    },
    include: {
      sender: {
        select: { id: true, name: true, image: true },
      },
      receipts: true,
    },
  });

  return messageToPayload(updated);
}

/**
 * Soft delete a message
 */
export async function deleteMessage(
  messageId: string,
  userId: string,
  deletedBy: 'sender' | 'admin' = 'sender'
): Promise<boolean> {
  const message = await db.iMMessage.findFirst({
    where: {
      id: messageId,
      ...(deletedBy === 'sender' ? { senderId: userId } : {}),
      isDeleted: false,
    },
  });

  if (!message) return false;

  await db.iMMessage.update({
    where: { id: messageId },
    data: {
      isDeleted: true,
      deletedAt: new Date(),
      deletedBy: deletedBy === 'admin' ? 'admin' : userId,
    },
  });

  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// Read Receipt Queries
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mark messages as read for a user
 * Updates both the participant's lastReadSeq and creates receipt records
 */
export async function markMessagesAsRead(
  conversationId: string,
  userId: string,
  upToSeq: number
): Promise<number> {
  const result = await db.$transaction(async (tx) => {
    // Find the message at or before upToSeq
    const lastReadMessage = await tx.iMMessage.findFirst({
      where: {
        conversationId,
        seq: { lte: upToSeq },
        isDeleted: false,
      },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });

    if (!lastReadMessage) return 0;

    // Update participant's lastReadSeq
    await tx.conversationParticipant.update({
      where: {
        conversationId_userId: { conversationId, userId },
      },
      data: {
        lastReadSeq: lastReadMessage.seq,
        lastReadAt: new Date(),
      },
    });

    // Create or update receipts for unread messages
    const unreadMessages = await tx.iMMessage.findMany({
      where: {
        conversationId,
        seq: { lte: lastReadMessage.seq },
        senderId: { not: userId },
        receipts: { none: { userId } },
        isDeleted: false,
      },
      select: { id: true },
    });

    if (unreadMessages.length > 0) {
      await tx.messageReceipt.createMany({
        data: unreadMessages.map((msg) => ({
          messageId: msg.id,
          conversationId,
          userId,
          deliveredAt: new Date(),
          readAt: new Date(),
        })),
        skipDuplicates: true,
      });

      // Reset unread count for this user
      const conversation = await tx.conversation.findUnique({
        where: { id: conversationId },
        select: { userAId: true, unreadCountA: true, unreadCountB: true },
      });

      if (conversation) {
        if (conversation.userAId === userId) {
          await tx.conversation.update({
            where: { id: conversationId },
            data: { unreadCountA: 0 },
          });
        } else {
          await tx.conversation.update({
            where: { id: conversationId },
            data: { unreadCountB: 0 },
          });
        }
      }
    }

    return unreadMessages.length;
  });

  return result;
}

/**
 * Get unread message count for a user in a conversation
 */
export async function getUnreadCount(
  conversationId: string,
  userId: string
): Promise<number> {
  const participant = await db.conversationParticipant.findUnique({
    where: {
      conversationId_userId: { conversationId, userId },
    },
  });

  if (!participant) return 0;

  const count = await db.iMMessage.count({
    where: {
      conversationId,
      seq: { gt: participant.lastReadSeq || 0 },
      senderId: { not: userId },
      isDeleted: false,
    },
  });

  return count;
}

// ═══════════════════════════════════════════════════════════════════════════
// Presence Queries
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Update user's online presence
 */
export async function updateUserPresence(
  userId: string,
  status: PresenceStatus,
  options?: {
    statusMessage?: string;
    deviceId?: string;
    platform?: string;
    appVersion?: string;
    connectionId?: string;
  }
): Promise<void> {
  await db.userPresence.upsert({
    where: { userId },
    create: {
      userId,
      status,
      statusMessage: options?.statusMessage,
      deviceId: options?.deviceId,
      platform: options?.platform,
      appVersion: options?.appVersion,
      connectionId: options?.connectionId,
      connectedAt: status === 'ONLINE' ? new Date() : undefined,
    },
    update: {
      status,
      statusMessage: options?.statusMessage,
      deviceId: options?.deviceId,
      platform: options?.platform,
      appVersion: options?.appVersion,
      connectionId: options?.connectionId,
      lastSeenAt: status !== 'ONLINE' ? new Date() : undefined,
      connectedAt: status === 'ONLINE' ? new Date() : undefined,
    },
  });
}

/**
 * Get user's current presence
 */
export async function getUserPresence(userId: string): Promise<{
  status: PresenceStatus;
  lastSeenAt?: Date;
  deviceId?: string;
  platform?: string;
} | null> {
  const presence = await db.userPresence.findUnique({
    where: { userId },
    select: {
      status: true,
      lastSeenAt: true,
      deviceId: true,
      platform: true,
    },
  });

  if (!presence) return null;

  return {
    status: presence.status,
    lastSeenAt: presence.lastSeenAt || undefined,
    deviceId: presence.deviceId || undefined,
    platform: presence.platform || undefined,
  };
}

/**
 * Get presence status for multiple users
 */
export async function getMultipleUserPresence(
  userIds: string[]
): Promise<Map<string, { status: PresenceStatus; lastSeenAt?: Date }>> {
  const presences = await db.userPresence.findMany({
    where: { userId: { in: userIds } },
    select: {
      userId: true,
      status: true,
      lastSeenAt: true,
    },
  });

  return new Map(presences.map((p) => [p.userId, { status: p.status, lastSeenAt: p.lastSeenAt || undefined }]));
}

/**
 * Mark user as offline (called on disconnect)
 */
export async function setUserOffline(userId: string): Promise<void> {
  await db.userPresence.update({
    where: { userId },
    data: {
      status: 'OFFLINE',
      lastSeenAt: new Date(),
      connectionId: null,
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════════════

function conversationToPayload(conv: ConversationWithParticipants): ConversationPayload {
  return {
    convId: conv.id,
    userAId: conv.userAId,
    userBId: conv.userBId,
    initiatorId: conv.initiatorId,
    state: conv.state as ConversationState,
    stateReason: conv.stateReason || undefined,
    controllingUserId: conv.controllingUserId || undefined,
    activeBoundaryVersion: conv.activeBoundaryVersion || undefined,
    lastMessageAt: conv.lastMessageAt?.getTime(),
    messageCount: conv.messageCount,
    unreadCountA: conv.unreadCountA,
    unreadCountB: conv.unreadCountB,
    vaultExpiresAt: conv.vaultExpiresAt?.getTime(),
    cachedConsentState: conv.cachedConsentState as ConsentState,
    settings: conv.settings ? JSON.parse(conv.settings) : undefined,
    createdAt: conv.createdAt.getTime(),
  };
}

function messageToPayload(msg: IMMessageWithRelations): IMMessagePayload {
  return {
    msgId: msg.id,
    clientMsgId: msg.clientMsgId || undefined,
    senderId: msg.senderId,
    receiverId: msg.receiverId,
    convId: msg.conversationId,
    seq: msg.seq,
    msgType: msg.msgType as IMMessageType,
    payload: msg.payload,
    encryptionMode: msg.encryptionMode as EncryptionMode,
    ephemeralPublicKey: msg.ephemeralPublicKey || undefined,
    boundaryVersion: msg.boundaryVersion || undefined,
    complianceTags: msg.complianceTags,
    consentState: msg.consentState as ConsentState,
    mediaLevel: msg.mediaLevel as MediaAccessLevel,
    ruleResult: msg.ruleResult as RuleEngineResult,
    replyToMsgId: msg.replyToMsgId || undefined,
    replyToPreview: msg.replyToPreview ? JSON.parse(msg.replyToPreview) : undefined,
    isEdited: msg.isEdited,
    isDeleted: msg.isDeleted,
    mediaMetadata: msg.mediaMetadata ? JSON.parse(msg.mediaMetadata) : undefined,
    status: msg.status as MessageDeliveryStatus,
    timestamp: msg.createdAt.getTime(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Batch Operations
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Archive old messages (for cold storage migration)
 */
export async function archiveMessages(
  conversationId: string,
  olderThan: Date
): Promise<{ count: number; messages: IMMessagePayload[] }> {
  const messages = await db.iMMessage.findMany({
    where: {
      conversationId,
      createdAt: { lt: olderThan },
      isDeleted: false,
    },
    include: {
      sender: {
        select: { id: true, name: true, image: true },
      },
      receipts: true,
    },
  });

  // Mark as archived (soft delete)
  if (messages.length > 0) {
    await db.iMMessage.updateMany({
      where: { id: { in: messages.map((m) => m.id) } },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: 'system-archive',
      },
    });
  }

  return {
    count: messages.length,
    messages: messages.map(messageToPayload),
  };
}

/**
 * Get conversation statistics
 */
export async function getConversationStats(
  conversationId: string
): Promise<{
  messageCount: number;
  participantCount: number;
  lastMessageAt?: Date;
  averageSeq: number;
}> {
  const [stats, participants] = await Promise.all([
    db.iMMessage.aggregate({
      where: { conversationId },
      _count: true,
      _avg: { seq: true },
    }),
    db.conversationParticipant.count({
      where: { conversationId },
    }),
  ]);

  const lastMessage = await db.iMMessage.findFirst({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  return {
    messageCount: stats._count,
    participantCount: participants,
    lastMessageAt: lastMessage?.createdAt,
    averageSeq: stats._avg.seq || 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Message Reaction Queries
// ═══════════════════════════════════════════════════════════════════════════

export interface MessageReactionPayload {
  id: string;
  messageId: string;
  userId: string;
  userName: string;
  emoji: string;
  createdAt: number;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  users: { id: string; name: string }[];
  hasReacted: boolean;
}

/**
 * Add a reaction to a message
 */
export async function addReaction(
  messageId: string,
  userId: string,
  emoji: string
): Promise<MessageReactionPayload> {
  const reaction = await db.messageReaction.create({
    data: {
      messageId,
      userId,
      emoji,
    },
    include: {
      user: { select: { name: true } },
    },
  });

  return {
    id: reaction.id,
    messageId: reaction.messageId,
    userId: reaction.userId,
    userName: reaction.user.name || 'Unknown',
    emoji: reaction.emoji,
    createdAt: reaction.createdAt.getTime(),
  };
}

/**
 * Remove a reaction from a message
 */
export async function removeReaction(
  messageId: string,
  userId: string,
  emoji: string
): Promise<boolean> {
  const result = await db.messageReaction.deleteMany({
    where: {
      messageId,
      userId,
      emoji,
    },
  });
  return result.count > 0;
}

/**
 * Remove all reactions from a message by a user
 */
export async function removeAllUserReactions(
  messageId: string,
  userId: string
): Promise<number> {
  const result = await db.messageReaction.deleteMany({
    where: {
      messageId,
      userId,
    },
  });
  return result.count;
}

/**
 * Get all reactions for a message
 */
export async function getReactionsByMessageId(
  messageId: string,
  currentUserId?: string
): Promise<ReactionSummary[]> {
  const reactions = await db.messageReaction.findMany({
    where: { messageId },
    include: {
      user: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  // Group by emoji
  const grouped = new Map<string, typeof reactions>();
  for (const reaction of reactions) {
    const existing = grouped.get(reaction.emoji) || [];
    existing.push(reaction);
    grouped.set(reaction.emoji, existing);
  }

  // Convert to summary
  const summaries: ReactionSummary[] = [];
  for (const [emoji, emojiReactions] of grouped) {
    summaries.push({
      emoji,
      count: emojiReactions.length,
      users: emojiReactions.map((r) => ({
        id: r.user.id,
        name: r.user.name || 'Unknown',
      })),
      hasReacted: currentUserId
        ? emojiReactions.some((r) => r.userId === currentUserId)
        : false,
    });
  }

  return summaries;
}

/**
 * Get reactions for multiple messages (batch)
 */
export async function getReactionsForMessages(
  messageIds: string[],
  currentUserId?: string
): Promise<Map<string, ReactionSummary[]>> {
  const reactions = await db.messageReaction.findMany({
    where: { messageId: { in: messageIds } },
    include: {
      user: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const grouped = new Map<string, ReactionSummary[]>();

  // Initialize with empty arrays
  for (const id of messageIds) {
    grouped.set(id, []);
  }

  // Group by messageId then emoji
  const tempMap = new Map<string, Map<string, typeof reactions>>();
  for (const reaction of reactions) {
    if (!tempMap.has(reaction.messageId)) {
      tempMap.set(reaction.messageId, new Map());
    }
    const emojiMap = tempMap.get(reaction.messageId)!;
    const existing = emojiMap.get(reaction.emoji) || [];
    existing.push(reaction);
    emojiMap.set(reaction.emoji, existing);
  }

  // Convert to summaries
  for (const [messageId, emojiMap] of tempMap) {
    const summaries: ReactionSummary[] = [];
    for (const [emoji, emojiReactions] of emojiMap) {
      summaries.push({
        emoji,
        count: emojiReactions.length,
        users: emojiReactions.map((r) => ({
          id: r.user.id,
          name: r.user.name || 'Unknown',
        })),
        hasReacted: currentUserId
          ? emojiReactions.some((r) => r.userId === currentUserId)
          : false,
      });
    }
    grouped.set(messageId, summaries);
  }

  return grouped;
}
