/**
 * IM Module — Type Definitions
 * Based on im_protocol_v2.proto & Power Board Rule Engine Spec
 */

// ═══════════════════════════════════════════════════════════════
// Enums (mirror Prisma schema enums)
// ═══════════════════════════════════════════════════════════════

export type ConversationState = 'ACTIVE' | 'PAUSED' | 'BLOCKED' | 'EXPIRED' | 'ARCHIVED';
export type ConsentState = 'CONSENT_NONE' | 'CONSENT_PENDING' | 'CONSENT_GRANTED' | 'CONSENT_DENIED' | 'CONSENT_EXPIRED';
export type MediaAccessLevel = 'L0_TEXT' | 'L1_IMAGE' | 'L2_VOICE' | 'L3_VIDEO' | 'L4_LOCATION' | 'L5_CONTACT';
export type RuleEngineResult = 'PASS' | 'SOFT_BLOCK' | 'HARD_BLOCK' | 'PACE_LIMIT';
export type EncryptionMode = 'E2EE' | 'SERVER' | 'HYBRID';
export type MessageDeliveryStatus = 'SENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
export type PresenceStatus = 'ONLINE' | 'AWAY' | 'BUSY' | 'OFFLINE';
export type IMMessageType = 'TEXT' | 'IMAGE' | 'VOICE' | 'FILE' | 'SYSTEM' | 'CONSENT_REQUEST' | 'CONSENT_RESPONSE' | 'RULE_UPDATE' | 'TYPING' | 'READ_RECEIPT';
export type ConsentRequestType = 'MEDIA' | 'LOCATION' | 'CONTACT' | 'INTIMATE';

// ═══════════════════════════════════════════════════════════════
// Core Message Types
// ═══════════════════════════════════════════════════════════════

export interface IMMessagePayload {
  msgId: string;
  clientMsgId?: string;
  senderId: string;
  receiverId: string;
  convId: string;
  seq: number;
  msgType: IMMessageType;
  payload: string;
  encryptionMode: EncryptionMode;
  ephemeralPublicKey?: string;
  
  // Boundary & compliance
  boundaryVersion?: string;
  complianceTags: string[];
  consentState: ConsentState;
  mediaLevel: MediaAccessLevel;
  ruleResult: RuleEngineResult;
  
  // Reply
  replyToMsgId?: string;
  replyToPreview?: ReplyPreview;
  
  // Edit & delete
  isEdited: boolean;
  isDeleted: boolean;
  
  // Media
  mediaMetadata?: MediaMetadataPayload;
  
  // Delivery
  status: MessageDeliveryStatus;
  
  timestamp: number;
}

export interface ReplyPreview {
  msgId: string;
  senderId: string;
  previewText: string;
  mediaLevel: MediaAccessLevel;
}

export interface MediaMetadataPayload {
  mediaId: string;
  level: MediaAccessLevel;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  durationMs?: number;
  thumbnailUrl?: string;
  watermarkHash?: string;
  isExpiring: boolean;
  expiresAt?: number;
}

// ═══════════════════════════════════════════════════════════════
// Conversation Types
// ═══════════════════════════════════════════════════════════════

export interface ConversationPayload {
  convId: string;
  userAId: string;
  userBId: string;
  initiatorId: string;
  state: ConversationState;
  stateReason?: string;
  controllingUserId?: string;
  activeBoundaryVersion?: string;
  lastMessageAt?: number;
  messageCount: number;
  unreadCountA: number;
  unreadCountB: number;
  vaultExpiresAt?: number;
  cachedConsentState: ConsentState;
  settings?: ConversationSettings;
  createdAt: number;
}

export interface ConversationSettings {
  [userId: string]: {
    isMuted: boolean;
    isPinned: boolean;
    isArchived: boolean;
  };
}

// ═══════════════════════════════════════════════════════════════
// Consent Types
// ═══════════════════════════════════════════════════════════════

export interface ConsentRequestPayload {
  requestId: string;
  requesterId: string;
  targetId: string;
  convId: string;
  consentType: ConsentRequestType;
  requestedLevel: MediaAccessLevel;
  contextMsgId?: string;
  reason?: string;
  previewPayload?: string;
  state: ConsentState;
  expiresAt: number;
  createdAt: number;
}

export interface ConsentResponsePayload {
  requestId: string;
  responderId: string;
  decision: ConsentState;
  note?: string;
  validUntil?: number;
  grantToken?: string;
}

// ═══════════════════════════════════════════════════════════════
// Power Board Rule Types
// ═══════════════════════════════════════════════════════════════

export interface PowerBoardRulesPayload {
  userId: string;
  version: string;
  isActive: boolean;
  pace: PaceControl;
  media: MediaPolicy;
  filter: ContentFilter;
  autoResponse?: AutoResponse;
  privacy: PrivacySettings;
  notifications?: NotificationPreferences;
}

export interface PaceControl {
  maxMessagesPerHour: number;
  maxMessagesPerDay: number;
  responseWindowHours: number;
  enforceCooldown: boolean;
  cooldownMinutes: number;
  showRemainingQuota: boolean;
}

export interface MediaPolicy {
  defaultLevel: MediaAccessLevel;
  perUserOverride: Record<string, MediaAccessLevel>;
  requireConsentForUpgrade: boolean;
  autoBlurImages: boolean;
  watermarkAllMedia: boolean;
}

export interface ContentFilter {
  blockedKeywords: string[];
  blockedPatterns: string[];
  blockExplicitImages: boolean;
  autoFlagProfanity: boolean;
  blockUnsolicitedContact: boolean;
  sensitivityLevel: number; // 1-5
}

export interface AutoResponse {
  enabled: boolean;
  messageTemplate: string;
  triggerAfterHours: number;
  onlyFirstMessage: boolean;
}

export interface PrivacySettings {
  preferredEncryption: EncryptionMode;
  allowScreenshotNotifications: boolean;
  autoExpireMessages: boolean;
  expireAfterDays: number;
  hideOnlineStatus: boolean;
  hideReadReceipts: boolean;
}

export interface NotificationPreferences {
  pushEnabled: boolean;
  soundEnabled: boolean;
  previewEnabled: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: number;
  quietHoursEnd: number;
}

// ═══════════════════════════════════════════════════════════════
// WebSocket Event Types
// ═══════════════════════════════════════════════════════════════

// Server → Client events
export type ServerEventType =
  | 'message'
  | 'message_status'
  | 'rule_update'
  | 'consent_request'
  | 'consent_response'
  | 'pace_limit'
  | 'typing'
  | 'read_receipt'
  | 'conversation_update'
  | 'system'
  | 'presence_update';

export interface ServerEvent {
  eventId: string;
  eventType: ServerEventType;
  timestamp: number;
  payload: IMMessagePayload
    | MessageStatusUpdate
    | PowerBoardRulesPayload
    | ConsentRequestPayload
    | ConsentResponsePayload
    | PaceLimitNotification
    | TypingIndicator
    | ReadReceiptPayload
    | ConversationUpdatePayload
    | SystemNotification;
}

export interface MessageStatusUpdate {
  msgId: string;
  convId: string;
  status: MessageDeliveryStatus;
  updatedAt: number;
  errorMessage?: string;
}

export interface PaceLimitNotification {
  convId: string;
  cooldownUntil: number;
  reason: string;
  messagesRemaining: number;
  maxMessages: number;
  resetAfterMinutes: number;
}

export interface TypingIndicator {
  userId: string;
  convId: string;
  isTyping: boolean;
  timestamp: number;
}

export interface ReadReceiptPayload {
  userId: string;
  convId: string;
  upToMsgId: string;
  upToSeq: number;
  readAt: number;
}

export interface ConversationUpdatePayload {
  convId: string;
  newState: ConversationState;
  reason: string;
  updatedAt: number;
}

export interface SystemNotification {
  level: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  title: string;
  message: string;
  actionUrl?: string;
  expiresAt?: number;
}

// Client → Server events
export type ClientEventType =
  | 'subscribe'
  | 'unsubscribe'
  | 'send_message'
  | 'ack_message'
  | 'typing'
  | 'read'
  | 'presence_update';

export interface ClientEvent {
  eventId: string;
  eventType: ClientEventType;
  timestamp: number;
  payload: SubscribeRequest
    | UnsubscribeRequest
    | SendMessageRequest
    | AckMessageRequest
    | TypingEvent
    | ReadEvent
    | PresenceUpdatePayload;
}

export interface SubscribeRequest {
  convId: string;
  lastSeenMsgId?: string;
}

export interface UnsubscribeRequest {
  convId: string;
}

export interface SendMessageRequest {
  message: IMMessagePayload;
  skipRuleCheck?: boolean;
}

export interface AckMessageRequest {
  msgId: string;
  convId: string;
}

export interface TypingEvent {
  convId: string;
  isTyping: boolean;
}

export interface ReadEvent {
  convId: string;
  upToMsgId: string;
}

export interface PresenceUpdatePayload {
  status: PresenceStatus;
  statusMessage?: string;
}

// ═══════════════════════════════════════════════════════════════
// API Request/Response Types
// ═══════════════════════════════════════════════════════════════

export interface SendMessageAPIRequest {
  conversationId: string;
  content: string;
  msgType?: IMMessageType;
  replyToMsgId?: string;
  clientMsgId?: string;
  mediaMetadata?: MediaMetadataPayload;
}

export interface SendMessageAPIResponse {
  success: boolean;
  message?: IMMessagePayload;
  error?: string;
  ruleResult?: RuleEngineResult;
  paceInfo?: PaceLimitNotification;
}

export interface GetConversationsAPIResponse {
  conversations: ConversationListItem[];
  hasMore: boolean;
  nextCursor?: string;
}

export interface ConversationListItem {
  convId: string;
  otherUser: {
    id: string;
    name: string;
    avatar?: string;
    presence: PresenceStatus;
  };
  lastMessage?: {
    content: string;
    senderId: string;
    msgType: IMMessageType;
    timestamp: number;
  };
  unreadCount: number;
  isMuted: boolean;
  isPinned: boolean;
  state: ConversationState;
  vaultExpiresAt?: number;
}

export interface GetMessagesAPIRequest {
  conversationId: string;
  beforeMsgId?: string;
  limit?: number;
  includeDeleted?: boolean;
}

export interface GetMessagesAPIResponse {
  messages: IMMessagePayload[];
  hasMore: boolean;
  nextCursor?: string;
}

export interface MarkReadAPIRequest {
  conversationId: string;
  upToMsgId: string;
}

export interface MarkReadAPIResponse {
  success: boolean;
  readCount: number;
}

// ═══════════════════════════════════════════════════════════════
// Rule Engine Evaluation Types
// ═══════════════════════════════════════════════════════════════

export interface RuleEvaluationContext {
  senderId: string;
  receiverId: string;
  messageType: IMMessageType;
  mediaLevel: MediaAccessLevel;
  content: string;
  conversationId: string;
  senderHistory: SenderHistory;
  rules: PowerBoardRulesPayload;
  consentState?: ConsentState;
}

export interface SenderHistory {
  messagesLastHour: number;
  messagesLastDay: number;
  lastMessageAt?: number;
  violationCount: number;
}

export interface RuleEvaluationResult {
  result: RuleEngineResult;
  reason: string;
  details: RuleViolation[];
  suggestions: string[];
  metadata: {
    ruleVersion: string;
    evaluatedAt: number;
    processingTimeMs: number;
  };
}

export interface RuleViolation {
  rule: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
  autoBlocked: boolean;
}
