/**
 * Power Board Lite 规则引擎类型定义
 * LokFeel IM 模块边界控制系统
 */

// ============================================================================
// 基础枚举类型
// ============================================================================

/** 规则引擎评估结果 */
export enum RuleEngineResult {
  PASS = 'PASS',           // 通过
  SOFT_BLOCK = 'SOFT_BLOCK', // 软拦截（可申诉）
  HARD_BLOCK = 'HARD_BLOCK', // 硬拦截
  PACE_LIMIT = 'PACE_LIMIT', // 频率限制
}

/** 消息类型 */
export enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
  VOICE = 'voice',
  VIDEO = 'video',
  FILE = 'file',
}

/** 媒体访问级别 */
export enum MediaAccessLevel {
  L0_TEXT = 0,      // 仅文字
  L1_IMAGE = 1,     // 图片
  L2_VOICE = 2,     // 语音
  L3_VIDEO = 3,     // 视频
}

/** 同意状态 */
export enum ConsentState {
  NONE = 'NONE',       // 无授权
  PENDING = 'PENDING', // 待处理
  GRANTED = 'GRANTED', // 已授权
  REVOKED = 'REVOKED', // 已撤销
}

/** 干预级别 */
export enum InterventionLevel {
  NONE = 0,      // 无干预
  NOTICE = 1,    // 提示
  WARNING = 2,   // 警告
  CONFIRM = 3,   // 确认
  BLOCK = 4,     // 拦截
}

/** 内容类型 */
export enum ContentType {
  TEXT = 'text',
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  LOCATION = 'location',
  CONTACT = 'contact',
}

// ============================================================================
// 规则配置类型
// ============================================================================

/** 频率控制配置 */
export interface PaceControl {
  maxMessagesPerHour: number;   // 每小时最大消息数
  maxMessagesPerDay: number;    // 每天最大消息数
  cooldownMinutes: number;      // 冷却时间（分钟）
  enforceCooldown: boolean;     // 是否强制执行冷却
}

/** 媒体策略配置 */
export interface MediaPolicy {
  defaultLevel: MediaAccessLevel;      // 默认媒体级别
  allowedLevels: MediaAccessLevel[];   // 允许的媒体级别
  requireConsentFor: ContentType[];    // 需要同意的内容类型
}

/** 内容过滤配置 */
export interface ContentFilter {
  blockedKeywords: string[];     // 屏蔽关键词列表
  enableAIModeration: boolean;   // 是否启用AI审核
  toxicityThreshold: number;     // 毒性阈值 (0-1)
}

/** 自动回复配置 */
export interface AutoReplyConfig {
  enabled: boolean;
  template: string | null;
  responseWindow: number;        // 回复期望时间（小时）
}

/** Power Board 完整规则配置 */
export interface PowerBoardRules {
  userId: string;
  version: string;               // 规则版本号 (semver)
  updatedAt: Date;
  
  // 频率控制
  pace: PaceControl;
  
  // 媒体策略
  media: MediaPolicy;
  
  // 内容过滤
  filter: ContentFilter;
  
  // 自动回复
  autoReply: AutoReplyConfig;
}

/** Power Board Lite 简化规则（用于快速配置） */
export interface PowerBoardLiteRules {
  maxMessagesPerHour: number;      // 每小时最大消息数
  responseWindow: number;          // 回复期望时间（小时）
  allowedMediaLevels: number[];    // 允许的媒体级别 [0,1,2,3]
  requireConsentFor: string[];     // 需要同意的内容类型
  blockedKeywords: string[];       // 屏蔽关键词
  autoReplyTemplate: string | null; // 自动回复模板
}

// ============================================================================
// 规则评估类型
// ============================================================================

/** 发送者历史行为 */
export interface SenderHistory {
  messageCount: number;
  lastMessageAt: Date | null;
  violations: number;
  firstMessageAt: Date;
}

/** 规则评估上下文 */
export interface RuleEvaluationContext {
  senderId: string;
  receiverId: string;
  messageType: MessageType;
  mediaLevel: MediaAccessLevel;
  content: string;
  conversationId: string;
  senderHistory: SenderHistory;
  rules: PowerBoardRules;
}

/** 规则违规项 */
export interface RuleViolation {
  ruleType: string;
  severity: 'low' | 'medium' | 'high';
  message: string;
  details?: Record<string, unknown>;
}

/** 规则评估结果 */
export interface RuleEvaluationResult {
  result: RuleEngineResult;
  reason: string;
  details: RuleViolation[];
  suggestions: string[];
  interventionLevel: InterventionLevel;
  cooldownSeconds?: number;
  metadata: {
    ruleVersion: string;
    evaluatedAt: number;
    processingTimeMs: number;
  };
}

/** 频率检查结果 */
export interface PaceCheckResult {
  allowed: boolean;
  reason?: string;
  remaining: number;
  cooldownUntil?: number;
  resetAfterMs?: number;
  hourlyCount: number;
  dailyCount: number;
}

/** 媒体级别检查结果 */
export interface MediaCheckResult {
  allowed: boolean;
  violated: boolean;
  requiresConsent: boolean;
  currentLevel: MediaAccessLevel;
  requestedLevel: MediaAccessLevel;
}

/** 内容过滤结果 */
export interface ContentCheckResult {
  allowed: boolean;
  violated: boolean;
  matches: Array<{
    keyword: string;
    position: number;
    severity: 'low' | 'medium' | 'high';
  }>;
  censoredText?: string;
  toxicityScore?: number;
}

/** 同意检查结果 */
export interface ConsentCheckResult {
  state: ConsentState;
  grantId?: string;
  requestId?: string;
  validUntil?: Date;
  expiresAt?: Date;
}

// ============================================================================
// 规则同步类型
// ============================================================================

/** 规则变更类型 */
export interface RuleChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  changedAt: Date;
}

/** 规则增量 */
export interface RuleDelta {
  changes: RuleChange[];
  removedFields: string[];
}

/** 规则更新 */
export interface RuleUpdate {
  newVersion: string;
  changes: RuleChange[];
  effectiveImmediately: boolean;
  changeSummary: string;
}

/** 规则响应类型 */
export type RulesResponse = 
  | { type: 'full'; rules: PowerBoardRules; serverTimestamp: number }
  | { type: 'delta'; delta: RuleDelta; baseVersion: string; targetVersion: string; serverTimestamp: number };

/** 离线评估结果 */
export interface OfflineEvaluationResult extends RuleEvaluationResult {
  evaluatedOffline: boolean;
  pendingSync: boolean;
}

// ============================================================================
// 缓存类型
// ============================================================================

/** 令牌桶状态 */
export interface TokenBucketState {
  tokens: number;
  lastRefill: number;
  hourlyCount: number;
  dailyCount: number;
  hourStart: number;
  dayStart: number;
}

/** 规则缓存条目 */
export interface RuleCacheEntry {
  rules: PowerBoardRules;
  cachedAt: number;
  expiresAt: number;
}

// ============================================================================
// API 请求/响应类型
// ============================================================================

/** 更新规则请求 */
export interface UpdateRulesRequest {
  pace?: Partial<PaceControl>;
  media?: Partial<MediaPolicy>;
  filter?: Partial<ContentFilter>;
  autoReply?: Partial<AutoReplyConfig>;
}

/** 更新规则响应 */
export interface UpdateRulesResponse {
  success: boolean;
  newVersion: string;
  appliedAt: Date;
  changes: RuleChange[];
}

/** 验证消息请求 */
export interface ValidateMessageRequest {
  senderId: string;
  receiverId: string;
  messageType: MessageType;
  mediaLevel?: MediaAccessLevel;
  content: string;
  conversationId: string;
}

/** 验证消息响应 */
export interface ValidateMessageResponse extends RuleEvaluationResult {}

/** 规则变更历史 */
export interface RuleChangeHistory {
  id: string;
  userId: string;
  version: string;
  changes: RuleChange[];
  changedAt: Date;
  changedBy: string;
}

// ============================================================================
// WebSocket 事件类型
// ============================================================================

/** 服务端规则事件 */
export interface ServerRuleEvents {
  'rules:updated': {
    userId: string;
    newVersion: string;
    changes: RuleChange[];
    effectiveAt: number;
  };
  'rules:message_blocked': {
    msgId: string;
    reason: string;
    ruleViolation: RuleViolation;
    canAppeal: boolean;
  };
  'rules:pace_warning': {
    messagesRemaining: number;
    resetAfterMinutes: number;
    currentHourlyCount: number;
  };
}

/** 客户端规则事件 */
export interface ClientRuleEvents {
  'rules:sync_request': {
    lastVersion?: string;
  };
  'rules:ack': {
    version: string;
    receivedAt: number;
  };
}

// ============================================================================
// 错误类型
// ============================================================================

/** 规则引擎错误码 */
export enum RuleEngineErrorCode {
  RULE_VIOLATION_PACE = 'RULE_VIOLATION_PACE',
  RULE_VIOLATION_MEDIA = 'RULE_VIOLATION_MEDIA',
  RULE_VIOLATION_CONTENT = 'RULE_VIOLATION_CONTENT',
  RULE_VIOLATION_CONSENT = 'RULE_VIOLATION_CONSENT',
  RULE_VERSION_MISMATCH = 'RULE_VERSION_MISMATCH',
  RULE_SYNC_FAILED = 'RULE_SYNC_FAILED',
  RULE_NOT_FOUND = 'RULE_NOT_FOUND',
  INVALID_RULE_CONFIG = 'INVALID_RULE_CONFIG',
}

/** 规则引擎错误 */
export class RuleEngineError extends Error {
  constructor(
    public code: RuleEngineErrorCode,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'RuleEngineError';
  }
}
