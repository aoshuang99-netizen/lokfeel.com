/**
 * Power Board Lite 规则引擎入口
 * LokFee! IM 模块边界控制系统
 */

// 类型导出
export {
  // 枚举
  RuleEngineResult,
  MessageType,
  MediaAccessLevel,
  ConsentState,
  InterventionLevel,
  ContentType,
  RuleEngineErrorCode,
  
  // 错误类
  RuleEngineError,
} from './types';

// 类型定义导出
export type {
  // 规则配置
  PaceControl,
  MediaPolicy,
  ContentFilter,
  AutoReplyConfig,
  PowerBoardRules,
  PowerBoardLiteRules,
  
  // 评估相关
  SenderHistory,
  RuleEvaluationContext,
  RuleViolation,
  RuleEvaluationResult,
  PaceCheckResult,
  MediaCheckResult,
  ContentCheckResult,
  ConsentCheckResult,
  
  // 同步相关
  RuleChange,
  RuleDelta,
  RuleUpdate,
  RulesResponse,
  OfflineEvaluationResult,
  TokenBucketState,
  RuleCacheEntry,
  
  // API 相关
  UpdateRulesRequest,
  UpdateRulesResponse,
  ValidateMessageRequest,
  ValidateMessageResponse,
  RuleChangeHistory,
  
  // WebSocket 事件
  ServerRuleEvents,
  ClientRuleEvents,
} from './types';

// Schema 导出
export {
  // Schema 定义
  MessageTypeSchema,
  MediaAccessLevelSchema,
  ContentTypeSchema,
  PaceControlSchema,
  MediaPolicySchema,
  ContentFilterSchema,
  AutoReplyConfigSchema,
  PowerBoardRulesSchema,
  PowerBoardLiteRulesSchema,
  UpdateRulesRequestSchema,
  ValidateMessageRequestSchema,
  RuleChangeSchema,
  
  // 验证函数
  validatePowerBoardRules,
  validatePowerBoardLiteRules,
  validateUpdateRulesRequest,
  validateValidateMessageRequest,
  validateRuleChanges,
  
  // 类型推断
  type ValidatedPaceControl,
  type ValidatedMediaPolicy,
  type ValidatedContentFilter,
  type ValidatedAutoReplyConfig,
  type ValidatedPowerBoardRules,
  type ValidatedPowerBoardLiteRules,
  type ValidatedUpdateRulesRequest,
  type ValidatedValidateMessageRequest,
  type ValidatedRuleChange,
} from './schema';

// 默认配置导出
export {
  // 默认配置
  DEFAULT_PACE_CONTROL,
  DEFAULT_MEDIA_POLICY,
  DEFAULT_CONTENT_FILTER,
  DEFAULT_BLOCKED_KEYWORDS,
  DEFAULT_AUTO_REPLY_CONFIG,
  AUTO_REPLY_TEMPLATES,
  DEFAULT_POWER_BOARD_LITE_RULES,
  
  // 预设配置
  STRICT_PACE_CONTROL,
  RELAXED_PACE_CONTROL,
  IMAGE_ALLOWED_MEDIA_POLICY,
  ALL_MEDIA_ALLOWED_POLICY,
  STRICT_CONTENT_FILTER,
  RELAXED_CONTENT_FILTER,
  
  // 预设类型
  RULE_PRESETS,
  type RulePreset,
  
  // 函数
  getDefaultPowerBoardRules,
  getStrictPowerBoardRules,
  getRelaxedPowerBoardRules,
  getRulesByPreset,
  convertLiteToFullRules,
  convertFullToLiteRules,
} from './defaults';

// 引擎导出
export {
  RuleEngine,
  getRuleEngine,
  // IM 核心服务（供高级使用）
  getImUserRules,
  getImDefaultRules,
  ruleEvaluator,
  paceController,
  auditLogger,
} from './engine';

// 同步机制导出
export {
  // 类
  RuleVersionManager,
  RuleSyncManager,
  RuleWebSocketManager,
  OfflineRuleCache,
  
  // 单例获取函数
  getRuleSyncManager,
  getRuleWebSocketManager,
  getOfflineRuleCache,
  
  // 类型
  type WebSocketClient,
  type CachedRules,
} from './sync';
