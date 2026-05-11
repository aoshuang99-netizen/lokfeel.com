/**
 * Power Board Lite 规则引擎适配层
 * LokFee! IM 模块 - 适配 backend-architect 提供的核心服务
 * 
 * 适配目标：
 * - 复用 src/lib/im/services/ 中的核心服务
 * - 提供符合 Power Board Lite 规范的 API
 * - 支持规则 CRUD、评估、同步
 */

import {
  ruleEvaluator,
  getUserRules as getImUserRules,
  getDefaultRules as getImDefaultRules,
} from '@/lib/im/services/rule-evaluator';
import { paceController } from '@/lib/im/services/pace-controller';
import { auditLogger } from '@/lib/im/services/audit-logger';
import { redis, RedisKeys } from '@/lib/im/redis';
import { db } from '@/lib/db';
import type {
  RuleEvaluationContext as ImRuleEvaluationContext,
  RuleEvaluationResult as ImRuleEvaluationResult,
  PowerBoardRulesPayload,
  SenderHistory as ImSenderHistory,
  PaceControl,
  MediaPolicy,
  ContentFilter,
  AutoResponse,
  PrivacySettings,
  NotificationPreferences,
  MediaAccessLevel,
  IMMessageType,
  ConsentState,
} from '@/lib/im/types';

import {
  RuleEngineResult,
  InterventionLevel,
  RuleEvaluationContext,
  RuleEvaluationResult,
  RuleViolation,
  PaceCheckResult,
  PowerBoardRules,
  PowerBoardLiteRules,
  RuleChange,
  UpdateRulesResponse,
  MediaAccessLevel as LiteMediaAccessLevel,
  MessageType as LiteMessageType,
  ConsentState as LiteConsentState,
  ContentType,
} from './types';

import {
  getDefaultPowerBoardRules,
  convertFullToLiteRules,
  convertLiteToFullRules,
} from './defaults';

// ============================================================================
// 类型转换工具
// ============================================================================

function convertLiteMessageTypeToIm(type: LiteMessageType): IMMessageType {
  const mapping: Record<LiteMessageType, IMMessageType> = {
    [LiteMessageType.TEXT]: 'TEXT',
    [LiteMessageType.IMAGE]: 'IMAGE',
    [LiteMessageType.VOICE]: 'VOICE',
    [LiteMessageType.VIDEO]: 'FILE',
    [LiteMessageType.FILE]: 'FILE',
  };
  return mapping[type] || 'TEXT';
}

function convertLiteMediaLevelToIm(level: LiteMediaAccessLevel): MediaAccessLevel {
  const mapping: Record<LiteMediaAccessLevel, MediaAccessLevel> = {
    [LiteMediaAccessLevel.L0_TEXT]: 'L0_TEXT',
    [LiteMediaAccessLevel.L1_IMAGE]: 'L1_IMAGE',
    [LiteMediaAccessLevel.L2_VOICE]: 'L2_VOICE',
    [LiteMediaAccessLevel.L3_VIDEO]: 'L3_VIDEO',
  };
  return mapping[level] || 'L0_TEXT';
}

function convertLiteConsentStateToIm(state: LiteConsentState): ConsentState {
  const mapping: Record<LiteConsentState, ConsentState> = {
    [LiteConsentState.NONE]: 'CONSENT_NONE',
    [LiteConsentState.PENDING]: 'CONSENT_PENDING',
    [LiteConsentState.GRANTED]: 'CONSENT_GRANTED',
    [LiteConsentState.REVOKED]: 'CONSENT_DENIED',
  };
  return mapping[state] || 'CONSENT_NONE';
}

function convertImRuleResultToLite(result: ImRuleEvaluationResult['result']): RuleEngineResult {
  const mapping: Record<ImRuleEvaluationResult['result'], RuleEngineResult> = {
    'PASS': RuleEngineResult.PASS,
    'SOFT_BLOCK': RuleEngineResult.SOFT_BLOCK,
    'HARD_BLOCK': RuleEngineResult.HARD_BLOCK,
    'PACE_LIMIT': RuleEngineResult.PACE_LIMIT,
  };
  return mapping[result] || RuleEngineResult.PASS;
}

function convertImViolationToLite(violation: {
  rule: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
  autoBlocked: boolean;
}): RuleViolation {
  const severityMap: Record<string, 'low' | 'medium' | 'high'> = {
    'LOW': 'low',
    'MEDIUM': 'medium',
    'HIGH': 'high',
    'CRITICAL': 'high',
  };
  
  return {
    ruleType: violation.rule,
    severity: severityMap[violation.severity] || 'medium',
    message: violation.message,
    details: { autoBlocked: violation.autoBlocked },
  };
}

function convertImPaceResultToLite(result: {
  allowed: boolean;
  remaining: number;
  hourlyCount: number;
  dailyCount: number;
  cooldownUntil?: number;
  resetAfterMs?: number;
}): PaceCheckResult {
  return {
    allowed: result.allowed,
    remaining: result.remaining,
    hourlyCount: result.hourlyCount,
    dailyCount: result.dailyCount,
    cooldownUntil: result.cooldownUntil,
    resetAfterMs: result.resetAfterMs,
  };
}

function convertFullRulesToLite(rules: PowerBoardRulesPayload): PowerBoardRules {
  return {
    userId: rules.userId,
    version: rules.version,
    updatedAt: new Date(),
    pace: {
      maxMessagesPerHour: rules.pace.maxMessagesPerHour,
      maxMessagesPerDay: rules.pace.maxMessagesPerDay,
      cooldownMinutes: rules.pace.cooldownMinutes,
      enforceCooldown: rules.pace.enforceCooldown,
    },
    media: {
      defaultLevel: convertImMediaLevelToLite(rules.media.defaultLevel),
      allowedLevels: [convertImMediaLevelToLite(rules.media.defaultLevel)],
      requireConsentFor: rules.media.requireConsentForUpgrade ? [ContentType.IMAGE, ContentType.AUDIO, ContentType.VIDEO] : [],
    },
    filter: {
      blockedKeywords: rules.filter.blockedKeywords,
      enableAIModeration: rules.filter.blockExplicitImages,
      toxicityThreshold: rules.filter.sensitivityLevel / 5,
    },
    autoReply: {
      enabled: rules.autoResponse?.enabled || false,
      template: rules.autoResponse?.messageTemplate || null,
      responseWindow: rules.autoResponse?.triggerAfterHours || 24,
    },
  };
}

function convertImMediaLevelToLite(level: MediaAccessLevel): LiteMediaAccessLevel {
  const mapping: Record<MediaAccessLevel, LiteMediaAccessLevel> = {
    'L0_TEXT': LiteMediaAccessLevel.L0_TEXT,
    'L1_IMAGE': LiteMediaAccessLevel.L1_IMAGE,
    'L2_VOICE': LiteMediaAccessLevel.L2_VOICE,
    'L3_VIDEO': LiteMediaAccessLevel.L3_VIDEO,
    'L4_LOCATION': LiteMediaAccessLevel.L3_VIDEO,
    'L5_CONTACT': LiteMediaAccessLevel.L3_VIDEO,
  };
  return mapping[level] || LiteMediaAccessLevel.L0_TEXT;
}

function convertImMediaLevelToIm(level: MediaAccessLevel): LiteMediaAccessLevel {
  const mapping: Record<MediaAccessLevel, LiteMediaAccessLevel> = {
    'L0_TEXT': LiteMediaAccessLevel.L0_TEXT,
    'L1_IMAGE': LiteMediaAccessLevel.L1_IMAGE,
    'L2_VOICE': LiteMediaAccessLevel.L2_VOICE,
    'L3_VIDEO': LiteMediaAccessLevel.L3_VIDEO,
    'L4_LOCATION': LiteMediaAccessLevel.L3_VIDEO,
    'L5_CONTACT': LiteMediaAccessLevel.L3_VIDEO,
  };
  return mapping[level] || LiteMediaAccessLevel.L0_TEXT;
}

function convertLiteRulesToPayload(rules: PowerBoardRules): PowerBoardRulesPayload {
  return {
    userId: rules.userId,
    version: rules.version,
    isActive: true,
    pace: {
      maxMessagesPerHour: rules.pace.maxMessagesPerHour,
      maxMessagesPerDay: rules.pace.maxMessagesPerDay,
      responseWindowHours: rules.autoReply.responseWindow,
      enforceCooldown: rules.pace.enforceCooldown,
      cooldownMinutes: rules.pace.cooldownMinutes,
      showRemainingQuota: true,
    },
    media: {
      defaultLevel: convertLiteMediaLevelToIm(rules.media.defaultLevel),
      perUserOverride: {},
      requireConsentForUpgrade: rules.media.requireConsentFor.length > 0,
      autoBlurImages: true,
      watermarkAllMedia: true,
    },
    filter: {
      blockedKeywords: rules.filter.blockedKeywords,
      blockedPatterns: [],
      blockExplicitImages: rules.filter.enableAIModeration,
      autoFlagProfanity: true,
      blockUnsolicitedContact: true,
      sensitivityLevel: Math.round(rules.filter.toxicityThreshold * 5),
    },
    autoResponse: {
      enabled: rules.autoReply.enabled,
      messageTemplate: rules.autoReply.template || '',
      triggerAfterHours: rules.autoReply.responseWindow,
      onlyFirstMessage: false,
    },
    privacy: {
      preferredEncryption: 'SERVER',
      allowScreenshotNotifications: true,
      autoExpireMessages: false,
      expireAfterDays: 0,
      hideOnlineStatus: false,
      hideReadReceipts: false,
    },
  };
}

// ============================================================================
// 规则缓存
// ============================================================================

class RuleCache {
  private readonly TTL = 5 * 60; // 5分钟 (Redis TTL in seconds)

  async get(userId: string): Promise<PowerBoardRules | null> {
    const key = RedisKeys.rules(userId);
    const cached = await redis.get(key);
    if (cached) {
      try {
        const payload = JSON.parse(cached as string) as PowerBoardRulesPayload;
        return convertFullRulesToLite(payload);
      } catch {
        return null;
      }
    }
    return null;
  }

  async set(userId: string, rules: PowerBoardRules): Promise<void> {
    const key = RedisKeys.rules(userId);
    const payload = convertLiteRulesToPayload(rules);
    await redis.set(key, JSON.stringify(payload), { ex: this.TTL });
  }

  async invalidate(userId: string): Promise<void> {
    const key = RedisKeys.rules(userId);
    await redis.del(key);
  }
}

// ============================================================================
// 规则引擎主类
// ============================================================================

export class RuleEngine {
  private cache: RuleCache;

  constructor() {
    this.cache = new RuleCache();
  }

  /**
   * 获取用户规则
   * 优先从缓存获取，否则从 IM 服务加载
   */
  async getUserRules(userId: string): Promise<PowerBoardRules> {
    // 1. 检查缓存
    const cached = await this.cache.get(userId);
    if (cached) return cached;

    // 2. 从 IM 服务加载
    try {
      const imRules = await getImUserRules(userId);
      const liteRules = convertFullRulesToLite(imRules);
      await this.cache.set(userId, liteRules);
      return liteRules;
    } catch (error) {
      console.error('[RuleEngine] Failed to load rules:', error);
    }

    // 3. 返回默认规则
    const defaultRules = getDefaultPowerBoardRules(userId);
    return defaultRules;
  }

  /**
   * 更新用户规则
   * 仅女性用户可操作，更新后清除缓存并记录审计日志
   */
  async updateUserRules(
    userId: string,
    updates: Partial<PowerBoardRules>,
    changedBy: string
  ): Promise<{ rules: PowerBoardRules; changes: RuleChange[] }> {
    const currentRules = await this.getUserRules(userId);
    
    // 构建变更记录
    const changes: RuleChange[] = [];
    const now = new Date();

    if (updates.pace) {
      changes.push({
        field: 'pace',
        oldValue: currentRules.pace,
        newValue: { ...currentRules.pace, ...updates.pace },
        changedAt: now,
      });
    }

    if (updates.media) {
      changes.push({
        field: 'media',
        oldValue: currentRules.media,
        newValue: { ...currentRules.media, ...updates.media },
        changedAt: now,
      });
    }

    if (updates.filter) {
      changes.push({
        field: 'filter',
        oldValue: currentRules.filter,
        newValue: { ...currentRules.filter, ...updates.filter },
        changedAt: now,
      });
    }

    if (updates.autoReply) {
      changes.push({
        field: 'autoReply',
        oldValue: currentRules.autoReply,
        newValue: { ...currentRules.autoReply, ...updates.autoReply },
        changedAt: now,
      });
    }

    // 构建新规则
    const newRules: PowerBoardRules = {
      ...currentRules,
      ...updates,
      userId,
      version: this.incrementVersion(currentRules.version),
      updatedAt: now,
    };

    // 更新数据库
    try {
      const payload = convertLiteRulesToPayload(newRules);
      
      await db.powerBoardRule.upsert({
        where: { userId },
        create: {
          userId,
          version: newRules.version,
          isActive: true,
          paceConfig: JSON.stringify(payload.pace),
          mediaConfig: JSON.stringify(payload.media),
          filterConfig: JSON.stringify(payload.filter),
          autoResponse: JSON.stringify(payload.autoResponse),
          privacyConfig: JSON.stringify(payload.privacy),
        },
        update: {
          version: newRules.version,
          paceConfig: JSON.stringify(payload.pace),
          mediaConfig: JSON.stringify(payload.media),
          filterConfig: JSON.stringify(payload.filter),
          autoResponse: JSON.stringify(payload.autoResponse),
        },
      });

      // 记录审计日志
      await auditLogger.record({
        userId,
        action: 'boundary_changed',
        actorId: changedBy,
        details: {
          changes,
          oldVersion: currentRules.version,
          newVersion: newRules.version,
        },
      });

      // 清除缓存
      await this.cache.invalidate(userId);

      // 推送规则更新事件
      await this.pushRuleUpdate(userId, newRules.version, changes);

    } catch (error) {
      console.error('[RuleEngine] Failed to update rules:', error);
      throw new Error('Failed to update rules');
    }

    return { rules: newRules, changes };
  }

  /**
   * 评估消息
   * 使用 IM 核心服务的 ruleEvaluator
   */
  async evaluateMessage(context: RuleEvaluationContext): Promise<RuleEvaluationResult> {
    const startTime = performance.now();

    try {
      // 获取接收者的规则 (IM 格式)
      const imRules = await getImUserRules(context.receiverId);

      // 构建 IM 评估上下文
      const imContext: ImRuleEvaluationContext = {
        senderId: context.senderId,
        receiverId: context.receiverId,
        messageType: convertLiteMessageTypeToIm(context.messageType),
        mediaLevel: convertLiteMediaLevelToIm(context.mediaLevel),
        content: context.content,
        conversationId: context.conversationId,
        senderHistory: {
          messagesLastHour: context.senderHistory.messageCount,
          messagesLastDay: context.senderHistory.messageCount,
          lastMessageAt: context.senderHistory.lastMessageAt?.getTime(),
          violationCount: context.senderHistory.violations,
        },
        rules: imRules,
      };

      // 执行评估
      const imResult = await ruleEvaluator.evaluate(imContext);

      // 转换为 Lite 格式
      const result: RuleEvaluationResult = {
        result: convertImRuleResultToLite(imResult.result),
        reason: imResult.reason,
        details: imResult.details.map(convertImViolationToLite),
        suggestions: imResult.suggestions,
        interventionLevel: this.getInterventionLevel(imResult.result),
        metadata: {
          ruleVersion: imResult.metadata.ruleVersion,
          evaluatedAt: imResult.metadata.evaluatedAt,
          processingTimeMs: performance.now() - startTime,
        },
      };

      // 记录审计日志（如果被拦截）
      if (imResult.result !== 'PASS') {
        await auditLogger.record({
          userId: context.receiverId,
          action: imResult.result === 'HARD_BLOCK' ? 'message_blocked' : 'rule_violation',
          actorId: context.senderId,
          targetId: context.receiverId,
          conversationId: context.conversationId,
          details: {
            reason: imResult.reason,
            violations: imResult.details,
          },
        });
      }

      return result;

    } catch (error) {
      console.error('[RuleEngine] Evaluation error:', error);
      
      // Fail-open: 允许消息通过但记录错误
      return {
        result: RuleEngineResult.PASS,
        reason: 'rules.eval_error_fail_open',
        details: [],
        suggestions: [],
        interventionLevel: InterventionLevel.NONE,
        metadata: {
          ruleVersion: 'error',
          evaluatedAt: Date.now(),
          processingTimeMs: performance.now() - startTime,
        },
      };
    }
  }

  /**
   * 检查频率限制
   * 使用 IM 核心服务的 paceController
   */
  async checkRateLimit(senderId: string, receiverId: string): Promise<PaceCheckResult> {
    try {
      const imRules = await getImUserRules(receiverId);
      const result = await paceController.checkRateLimit(
        senderId,
        receiverId,
        imRules.pace
      );
      return convertImPaceResultToLite(result);
    } catch (error) {
      console.error('[RuleEngine] Pace check error:', error);
      // Fail-open
      return {
        allowed: true,
        remaining: -1,
        hourlyCount: 0,
        dailyCount: 0,
      };
    }
  }

  /**
   * 获取干预级别
   */
  getInterventionLevel(result: RuleEngineResult | import('@/lib/im/types').RuleEngineResult): InterventionLevel {
    switch (result) {
      case RuleEngineResult.PASS:
      case 'PASS':
        return InterventionLevel.NONE;
      case RuleEngineResult.SOFT_BLOCK:
      case 'SOFT_BLOCK':
        return InterventionLevel.CONFIRM;
      case RuleEngineResult.PACE_LIMIT:
      case 'PACE_LIMIT':
        return InterventionLevel.WARNING;
      case RuleEngineResult.HARD_BLOCK:
      case 'HARD_BLOCK':
        return InterventionLevel.BLOCK;
      default:
        return InterventionLevel.NONE;
    }
  }

  /**
   * 获取规则变更历史
   */
  async getRuleHistory(
    userId: string,
    options?: {
      limit?: number;
      from?: Date;
      to?: Date;
    }
  ): Promise<Array<{
    id: string;
    version: string;
    changes: RuleChange[];
    changedAt: Date;
    changedBy: string;
  }>> {
    const entries = await auditLogger.getEntries(userId, {
      action: 'boundary_changed',
      limit: options?.limit || 20,
      from: options?.from,
      to: options?.to,
    });

    return entries.map(entry => ({
      id: entry.id,
      version: (entry.details as any)?.newVersion || 'unknown',
      changes: (entry.details as any)?.changes || [],
      changedAt: entry.createdAt,
      changedBy: entry.actorId || 'system',
    }));
  }

  /**
   * 推送规则更新到用户
   */
  private async pushRuleUpdate(
    userId: string,
    newVersion: string,
    changes: RuleChange[]
  ): Promise<void> {
    try {
      // 使用 IM 的推送服务
      const { pushToUser } = await import('@/lib/im/services');
      const payload: import('@/lib/im/types').SystemNotification = {
        level: 'INFO',
        title: '规则已更新',
        message: JSON.stringify({
          userId,
          newVersion,
          changes,
          effectiveAt: Date.now(),
        }),
      };
      await pushToUser(userId, {
        eventId: crypto.randomUUID(),
        eventType: 'system',
        timestamp: Date.now(),
        payload,
      });
    } catch (error) {
      console.error('[RuleEngine] Failed to push rule update:', error);
    }
  }

  /**
   * 递增版本号
   */
  private incrementVersion(version: string): string {
    const parts = version.split('.').map(Number);
    parts[2] = (parts[2] || 0) + 1;
    return parts.join('.');
  }
}

// ============================================================================
// 单例导出
// ============================================================================

let globalRuleEngine: RuleEngine | null = null;

export function getRuleEngine(): RuleEngine {
  if (!globalRuleEngine) {
    globalRuleEngine = new RuleEngine();
  }
  return globalRuleEngine;
}

// 导出 IM 服务类型（供其他模块使用）
export {
  getImUserRules,
  getImDefaultRules,
  ruleEvaluator,
  paceController,
  auditLogger,
};
