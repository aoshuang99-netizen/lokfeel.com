/**
 * LokFeel IM Module — Main Entry Point
 * 
 * Architecture:
 * - Redis (Upstash): Presence, pace control, caching, seq generator
 * - WebSocket / Pusher: Real-time event delivery
 * - PostgreSQL (Neon): Persistent storage
 * - Rule Engine: Pre-send message validation
 * - Audit Logger: Hash-chained immutable audit trail
 * 
 * Cold/Hot Storage Strategy:
 * - Hot (PostgreSQL + Redis): Recent messages (30 days), active conversations, presence
 * - Cold (S3/Glacier): Archived messages (30+ days), exported data
 * - Migration: Background job moves messages from hot to cold
 */

// Types
export * from './types';

// Redis
export { redis, getRedis, RedisKeys } from './redis';

// Services
export {
  PaceController,
  paceController,
  PresenceManager,
  presenceManager,
  RuleEvaluator,
  ruleEvaluator,
  getUserRules,
  getDefaultRules,
  SeqGenerator,
  seqGenerator,
  AuditLogger,
  auditLogger,
} from './services';

// WebSocket
export { WebSocketManager, wsManager } from './websocket';
export {
  getPusher,
  pushToUser,
  pushToConversation,
  authorizePusherSubscription,
} from './websocket/pusher-bridge';

// Database Queries
export {
  // Conversation
  createConversation,
  getConversationsByUserId,
  getConversationById,
  updateConversationSettings,
  updateConversationState,
  // Messages
  createMessage,
  getMessagesByConversationId,
  getMessageById,
  editMessage,
  deleteMessage,
  // Read Receipts
  markMessagesAsRead,
  getUnreadCount,
  // Presence
  updateUserPresence,
  getUserPresence,
  getMultipleUserPresence,
  setUserOffline,
  // Message Reactions
  addReaction,
  removeReaction,
  removeAllUserReactions,
  getReactionsByMessageId,
  getReactionsForMessages,
  // Utilities
  archiveMessages,
  getConversationStats,
} from './queries';

export type {
  MessageReactionPayload,
  ReactionSummary,
} from './queries';
