/**
 * LokFee! IM Chat Module Type Definitions
 * 
 * This file contains all the type definitions for the chat/IM system,
 * aligned with IM API v2 specification.
 */

// ============================================================================
// Message Types
// ============================================================================

/** Message types supported in the chat */
export type MessageType = 'TEXT' | 'IMAGE' | 'VOICE' | 'FILE';

/** Message delivery status */
export type MessageDeliveryStatus = 'SENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

/** Message encryption mode */
export type EncryptionMode = 'SERVER' | 'END_TO_END' | 'NONE';

/** Media content level */
export type MediaLevel = 'L0_TEXT' | 'L1_IMAGE' | 'L2_VOICE';

/** Consent state for messages */
export type ConsentState = 'CONSENT_NONE' | 'CONSENT_PENDING' | 'CONSENT_GRANTED';

/** Rule evaluation result */
export type RuleResult = 'PASS' | 'WARN' | 'BLOCK';

/** IM API v2 Message Payload */
export interface IMMessage {
  /** Unique message ID */
  msgId: string;
  /** Client-side message ID for optimistic updates */
  clientMsgId?: string;
  /** Sender user ID */
  senderId: string;
  /** Receiver user ID */
  receiverId: string;
  /** Conversation ID */
  convId: string;
  /** Message sequence number */
  seq: number;
  /** Message type */
  msgType: MessageType;
  /** Message content (text, URL, or duration for voice) */
  payload: string;
  /** Encryption mode */
  encryptionMode: EncryptionMode;
  /** Compliance tags */
  complianceTags: string[];
  /** Consent state */
  consentState: ConsentState;
  /** Media level (for content filtering) */
  mediaLevel: MediaLevel;
  /** Rule evaluation result */
  ruleResult: RuleResult;
  /** Whether message has been edited */
  isEdited: boolean;
  /** Whether message has been deleted */
  isDeleted: boolean;
  /** Message delivery status */
  status: MessageDeliveryStatus;
  /** Timestamp in milliseconds */
  timestamp: number;
  /** Sender info (populated from API) */
  sender?: {
    id: string;
    name: string;
    avatar?: string | null;
    isBot?: boolean;
  };
}

/** Extended message with additional UI data */
export interface ChatMessage extends IMMessage {
  /** Quoted message ID (for reply feature) */
  quotedMsgId?: string;
  /** Quoted message preview */
  quotedMessage?: {
    id: string;
    content: string;
    senderName?: string;
  };
  /** Reactions to this message */
  reactions?: MessageReaction[];
}

export interface MessageReaction {
  emoji: string;
  userId: string;
  createdAt: number;
}

/** Reaction summary for display (aggregated by emoji) */
export interface ReactionSummary {
  emoji: string;
  count: number;
  users: { id: string; name: string }[];
  hasReacted: boolean;
}

// ============================================================================
// Conversation Types
// ============================================================================

/** Presence status */
export type PresenceStatus = 'ONLINE' | 'OFFLINE' | 'AWAY' | 'BUSY';

/** Conversation participant */
export interface ConversationParticipant {
  userId: string;
  name: string;
  avatar?: string | null;
  presence: PresenceStatus;
  lastSeen?: number;
  isBot?: boolean;
}

/** Conversation info */
export interface Conversation {
  id: string;
  matchId?: string;
  participants: ConversationParticipant[];
  lastMessage?: ChatMessage;
  unreadCount: number;
  createdAt: number;
  updatedAt: number;
  isArchived?: boolean;
  isVault?: boolean;
  vaultExpiresAt?: number;
}

/** Conversation with full member info */
export interface ChatRoom {
  id: string;
  matchId: string;
  participants: ConversationParticipant[];
  lastMessage?: ChatMessage;
  unreadCount: number;
  createdAt: Date;
  updatedAt: Date;
  isArchived: boolean;
  messages: ChatMessage[];
  otherMember?: Pick<ConversationParticipant, 'userId' | 'name' | 'avatar'>;
  match?: MatchInfo;
}

export interface MatchInfo {
  id: string;
  compatibilityScore: number;
  explanation?: string;
  warnings?: ConflictWarning[];
}

export interface ConflictWarning {
  type: 'attachment' | 'communication' | 'conflict' | 'values' | 'lifestyle';
  severity: 'low' | 'medium' | 'high';
  message: string;
  suggestion: string;
}

// ============================================================================
// User & Limits Types
// ============================================================================

export interface UserLimits {
  isPremium: boolean;
  maxChats: number;
  currentChats: number;
  messagesSent: number;
  messagesRemaining: number;
}

// ============================================================================
// Real-time Event Types
// ============================================================================

export interface TypingIndicator {
  convId: string;
  userId: string;
  isTyping: boolean;
  timestamp: number;
}

export interface ReadReceiptPayload {
  convId: string;
  userId: string;
  upToMsgId: string;
  upToSeq: number;
  timestamp: number;
}

export interface ConversationUpdatePayload {
  convId: string;
  type: 'created' | 'updated' | 'archived' | 'deleted';
  lastMessage?: ChatMessage;
  unreadCount?: number;
  timestamp: number;
}

export interface PaceLimitNotification {
  convId: string;
  limit: number;
  remaining: number;
  resetAt: number;
}

export interface ConsentRequestPayload {
  convId: string;
  requesterId: string;
  requesterName: string;
  message?: string;
  timestamp: number;
}

export interface ConsentResponsePayload {
  convId: string;
  responderId: string;
  granted: boolean;
  timestamp: number;
}

export interface PowerBoardRulesPayload {
  rules: RuleInfo[];
  effectiveAt: number;
}

export interface RuleInfo {
  id: string;
  name: string;
  description: string;
  severity: 'warning' | 'mute' | 'block';
}

export interface MessageStatusUpdate {
  msgId: string;
  status: MessageDeliveryStatus;
  timestamp: number;
}

export interface SystemNotification {
  type: 'system' | 'match' | 'reminder' | 'promotion';
  title: string;
  body: string;
  actionUrl?: string;
  timestamp: number;
}

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface SendMessageRequest {
  conversationId: string;
  content: string;
  msgType: MessageType;
  clientMsgId?: string;
  quotedMsgId?: string;
}

export interface SendMessageResponse {
  success: boolean;
  message?: ChatMessage;
  error?: ApiError;
}

export interface GetMessagesRequest {
  limit?: number;
  before?: string;
  after?: string;
}

export interface GetMessagesResponse {
  success: boolean;
  messages: ChatMessage[];
  hasMore: boolean;
  error?: ApiError;
}

export interface GetConversationsRequest {
  limit?: number;
  offset?: number;
  includeArchived?: boolean;
}

export interface GetConversationsResponse {
  success: boolean;
  conversations: Conversation[];
  hasMore: boolean;
  error?: ApiError;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, string[]>;
}

// ============================================================================
// UI Component Types
// ============================================================================

export interface MessageBubbleUIProps {
  message: ChatMessage;
  currentUserId?: string;
  sender?: {
    id: string;
    name: string;
    avatar?: string | null;
    isBot?: boolean;
  };
  isGrouped?: boolean;
  showAvatar?: boolean;
  onRetry?: (msgId: string) => void;
  onCopy?: (content: string) => void;
  onDelete?: (msgId: string) => void;
  onReport?: (msgId: string, senderId: string) => void;
  onReply?: (message: ChatMessage) => void;
  quotedMessage?: ChatMessage['quotedMessage'];
}

export interface ConversationItemUIProps {
  id: string;
  matchId?: string | null;
  otherUser: {
    id: string;
    name: string;
    age?: number;
    avatar?: string | null;
    isOnline?: boolean;
    isBot?: boolean;
    lastSeen?: string;
  };
  lastMessage?: {
    content: string;
    timestamp: string;
    isFromMe?: boolean;
    msgType?: string;
  } | null;
  unreadCount?: number;
  isVault?: boolean;
  vaultExpiresAt?: string;
  isSelected?: boolean;
  onClick?: () => void;
}

export interface ChatInputUIProps {
  onSend: (message: string, quotedMsgId?: string) => void;
  onTyping?: (isTyping: boolean) => void;
  disabled?: boolean;
  quotedMessage?: ChatMessage['quotedMessage'];
  onCancelQuote?: () => void;
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export type {
  MessageBubbleProps,
  LegacyMessageBubbleProps,
} from '@/components/chat/message-bubble';

export type {
  ConversationListProps,
} from '@/components/chat/conversation-list';

export type {
  TypingIndicatorProps,
  SimpleTypingIndicatorProps,
} from '@/components/chat/typing-indicator';

export type {
  ChatEmptyStateProps,
} from '@/components/chat/empty-state';
