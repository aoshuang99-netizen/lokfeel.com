/**
 * Power Board Lite 规则验证 Schema (Zod)
 * LokFeel IM 模块边界控制系统
 */

import { z } from 'zod';
import {
  MessageType,
  MediaAccessLevel,
  ContentType,
} from './types';

// ============================================================================
// 基础枚举 Schema
// ============================================================================

export const MessageTypeSchema = z.nativeEnum(MessageType);

export const MediaAccessLevelSchema = z.nativeEnum(MediaAccessLevel);

export const ContentTypeSchema = z.nativeEnum(ContentType);

// ============================================================================
// 规则配置 Schema
// ============================================================================

/** 频率控制配置 Schema */
export const PaceControlSchema = z.object({
  maxMessagesPerHour: z.number()
    .int()
    .min(1, '每小时最大消息数至少为1')
    .max(100, '每小时最大消息数不能超过100')
    .default(20),
  
  maxMessagesPerDay: z.number()
    .int()
    .min(1, '每天最大消息数至少为1')
    .max(500, '每天最大消息数不能超过500')
    .default(100),
  
  cooldownMinutes: z.number()
    .int()
    .min(0, '冷却时间不能为负数')
    .max(1440, '冷却时间不能超过24小时')
    .default(5),
  
  enforceCooldown: z.boolean().default(false),
});

/** 媒体策略配置 Schema */
export const MediaPolicySchema = z.object({
  defaultLevel: MediaAccessLevelSchema.default(MediaAccessLevel.L0_TEXT),
  
  allowedLevels: z.array(MediaAccessLevelSchema)
    .min(1, '至少允许一个媒体级别')
    .default([MediaAccessLevel.L0_TEXT]),
  
  requireConsentFor: z.array(ContentTypeSchema)
    .default([ContentType.IMAGE, ContentType.VIDEO, ContentType.AUDIO]),
});

/** 内容过滤配置 Schema */
export const ContentFilterSchema = z.object({
  blockedKeywords: z.array(z.string().min(1).max(100))
    .max(1000, '关键词数量不能超过1000')
    .default([]),
  
  enableAIModeration: z.boolean().default(true),
  
  toxicityThreshold: z.number()
    .min(0)
    .max(1)
    .default(0.7),
});

/** 自动回复配置 Schema */
export const AutoReplyConfigSchema = z.object({
  enabled: z.boolean().default(false),
  
  template: z.string()
    .max(500, '自动回复模板不能超过500字符')
    .nullable()
    .default(null),
  
  responseWindow: z.number()
    .int()
    .min(1)
    .max(168, '回复期望时间不能超过1周')
    .default(24),
});

/** Power Board 完整规则 Schema */
export const PowerBoardRulesSchema = z.object({
  userId: z.string().uuid(),
  
  version: z.string()
    .regex(/^\d+\.\d+\.\d+$/, '版本号必须符合 semver 格式')
    .default('1.0.0'),
  
  updatedAt: z.date().default(() => new Date()),
  
  pace: PaceControlSchema,
  
  media: MediaPolicySchema,
  
  filter: ContentFilterSchema,
  
  autoReply: AutoReplyConfigSchema,
});

/** Power Board Lite 简化规则 Schema */
export const PowerBoardLiteRulesSchema = z.object({
  maxMessagesPerHour: z.number().int().min(1).max(100).default(20),
  responseWindow: z.number().int().min(1).max(168).default(24),
  allowedMediaLevels: z.array(z.number().int().min(0).max(3)).default([0]),
  requireConsentFor: z.array(z.string()).default(['image', 'video', 'audio']),
  blockedKeywords: z.array(z.string().min(1).max(100)).max(1000).default([]),
  autoReplyTemplate: z.string().max(500).nullable().default(null),
});

// ============================================================================
// API 请求 Schema
// ============================================================================

/** 更新规则请求 Schema */
export const UpdateRulesRequestSchema = z.object({
  pace: PaceControlSchema.partial().optional(),
  media: MediaPolicySchema.partial().optional(),
  filter: ContentFilterSchema.partial().optional(),
  autoReply: AutoReplyConfigSchema.partial().optional(),
});

/** 验证消息请求 Schema */
export const ValidateMessageRequestSchema = z.object({
  senderId: z.string().uuid(),
  receiverId: z.string().uuid(),
  messageType: MessageTypeSchema,
  mediaLevel: MediaAccessLevelSchema.optional(),
  content: z.string().max(10000, '消息内容不能超过10000字符'),
  conversationId: z.string().uuid(),
});

/** 规则变更 Schema */
export const RuleChangeSchema = z.object({
  field: z.string(),
  oldValue: z.unknown(),
  newValue: z.unknown(),
  changedAt: z.date(),
});

// ============================================================================
// 验证函数
// ============================================================================

/**
 * 验证 Power Board 规则配置
 */
export function validatePowerBoardRules(
  data: unknown
): { success: true; data: z.infer<typeof PowerBoardRulesSchema> } | { success: false; errors: z.ZodError } {
  const result = PowerBoardRulesSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error };
}

/**
 * 验证 Power Board Lite 规则配置
 */
export function validatePowerBoardLiteRules(
  data: unknown
): { success: true; data: z.infer<typeof PowerBoardLiteRulesSchema> } | { success: false; errors: z.ZodError } {
  const result = PowerBoardLiteRulesSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error };
}

/**
 * 验证更新规则请求
 */
export function validateUpdateRulesRequest(
  data: unknown
): { success: true; data: z.infer<typeof UpdateRulesRequestSchema> } | { success: false; errors: z.ZodError } {
  const result = UpdateRulesRequestSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error };
}

/**
 * 验证消息请求
 */
export function validateValidateMessageRequest(
  data: unknown
): { success: true; data: z.infer<typeof ValidateMessageRequestSchema> } | { success: false; errors: z.ZodError } {
  const result = ValidateMessageRequestSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error };
}

/**
 * 验证规则变更
 */
export function validateRuleChanges(
  data: unknown[]
): { success: true; data: z.infer<typeof RuleChangeSchema>[] } | { success: false; errors: z.ZodError } {
  const schema = z.array(RuleChangeSchema);
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error };
}

// ============================================================================
// 类型推断
// ============================================================================

export type ValidatedPaceControl = z.infer<typeof PaceControlSchema>;
export type ValidatedMediaPolicy = z.infer<typeof MediaPolicySchema>;
export type ValidatedContentFilter = z.infer<typeof ContentFilterSchema>;
export type ValidatedAutoReplyConfig = z.infer<typeof AutoReplyConfigSchema>;
export type ValidatedPowerBoardRules = z.infer<typeof PowerBoardRulesSchema>;
export type ValidatedPowerBoardLiteRules = z.infer<typeof PowerBoardLiteRulesSchema>;
export type ValidatedUpdateRulesRequest = z.infer<typeof UpdateRulesRequestSchema>;
export type ValidatedValidateMessageRequest = z.infer<typeof ValidateMessageRequestSchema>;
export type ValidatedRuleChange = z.infer<typeof RuleChangeSchema>;
