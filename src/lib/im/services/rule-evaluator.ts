/**
 * Rule Evaluator — Power Board Rule Engine Core
 * Based on im_protocol_v2.proto & POWER_BOARD_RULE_ENGINE_SPEC.md
 * 
 * Evaluation Order:
 * 1. Pace Control (highest priority)
 * 2. Media Level Check
 * 3. Content Filter
 * 4. Consent State Check
 * 
 * Target: < 20ms evaluation time
 */

import { paceController } from './pace-controller';
import { redis, RedisKeys } from '../redis';
import { db } from '@/lib/db';
import type {
  RuleEvaluationContext,
  RuleEvaluationResult,
  RuleViolation,
  PowerBoardRulesPayload,
  PaceControl,
  MediaPolicy,
  ContentFilter,
  RuleEngineResult,
  ConsentState,
  MediaAccessLevel,
  IMMessageType,
} from '../types';

export class RuleEvaluator {
  /**
   * Main evaluation entry point
   */
  async evaluate(context: RuleEvaluationContext): Promise<RuleEvaluationResult> {
    const startTime = performance.now();

    try {
      // 1. Pace Control (highest priority)
      const paceResult = await this.checkPaceLimits(context);
      if (paceResult.result !== 'PASS') {
        return this.addTiming(paceResult, startTime, context.rules.version);
      }

      // 2. Media Level Check
      const mediaResult = this.checkMediaLevel(context);
      if (mediaResult.result !== 'PASS') {
        return this.addTiming(mediaResult, startTime, context.rules.version);
      }

      // 3. Content Filter Check
      const contentResult = await this.checkContentFilter(context);
      if (contentResult.result !== 'PASS') {
        return this.addTiming(contentResult, startTime, context.rules.version);
      }

      // 4. Consent State Check
      const consentResult = this.checkConsentState(context);
      if (consentResult.result !== 'PASS') {
        return this.addTiming(consentResult, startTime, context.rules.version);
      }

      // All checks passed
      return this.addTiming({
        result: 'PASS',
        reason: 'rules.passed',
        details: [],
        suggestions: [],
        metadata: {
          ruleVersion: context.rules.version,
          evaluatedAt: Date.now(),
          processingTimeMs: 0,
        },
      }, startTime, context.rules.version);
    } catch (error) {
      console.error('[RuleEvaluator] Evaluation error (fail-open):', error);
      // Fail-open: allow message but log the error
      return {
        result: 'PASS',
        reason: 'rules.eval_error_fail_open',
        details: [],
        suggestions: [],
        metadata: {
          ruleVersion: context.rules.version,
          evaluatedAt: Date.now(),
          processingTimeMs: performance.now() - startTime,
        },
      };
    }
  }

  /**
   * 1. Pace Control Check
   */
  private async checkPaceLimits(context: RuleEvaluationContext): Promise<RuleEvaluationResult> {
    const paceCheck = await paceController.checkRateLimit(
      context.senderId,
      context.receiverId,
      context.rules.pace
    );

    if (!paceCheck.allowed) {
      return {
        result: 'PACE_LIMIT',
        reason: 'pace.limit_exceeded',
        details: [{
          rule: 'pace_control',
          severity: 'MEDIUM',
          message: `Rate limit: ${paceCheck.hourlyCount}/${context.rules.pace.maxMessagesPerHour} per hour, ${paceCheck.dailyCount}/${context.rules.pace.maxMessagesPerDay} per day`,
          autoBlocked: true,
        }],
        suggestions: context.rules.pace.showRemainingQuota
          ? [`Wait ${paceCheck.paceLimit?.resetAfterMinutes} minutes before sending more messages`]
          : [],
        metadata: {
          ruleVersion: context.rules.version,
          evaluatedAt: Date.now(),
          processingTimeMs: 0,
        },
      };
    }

    return { result: 'PASS', reason: '', details: [], suggestions: [], metadata: { ruleVersion: '', evaluatedAt: 0, processingTimeMs: 0 } };
  }

  /**
   * 2. Media Level Check
   */
  private checkMediaLevel(context: RuleEvaluationContext): RuleEvaluationResult {
    const mediaRules = context.rules.media;

    // Get effective media level for this sender
    const effectiveLevel = mediaRules.perUserOverride[context.senderId] || mediaRules.defaultLevel;

    if (context.mediaLevel && this.getLevelPriority(context.mediaLevel) > this.getLevelPriority(effectiveLevel)) {
      // Sender requesting higher level than allowed
      const requiresConsent = mediaRules.requireConsentForUpgrade;

      return {
        result: requiresConsent ? 'SOFT_BLOCK' : 'HARD_BLOCK',
        reason: requiresConsent ? 'media.consent_required' : 'media.level_exceeded',
        details: [{
          rule: 'media_policy',
          severity: requiresConsent ? 'LOW' : 'HIGH',
          message: `Media level ${context.mediaLevel} exceeds allowed level ${effectiveLevel}`,
          autoBlocked: !requiresConsent,
        }],
        suggestions: requiresConsent
          ? ['Request consent from the recipient to share this type of media']
          : [],
        metadata: {
          ruleVersion: context.rules.version,
          evaluatedAt: Date.now(),
          processingTimeMs: 0,
        },
      };
    }

    return { result: 'PASS', reason: '', details: [], suggestions: [], metadata: { ruleVersion: '', evaluatedAt: 0, processingTimeMs: 0 } };
  }

  /**
   * 3. Content Filter Check
   */
  private async checkContentFilter(context: RuleEvaluationContext): Promise<RuleEvaluationResult> {
    const filterRules = context.rules.filter;
    const text = context.content.toLowerCase();
    const violations: RuleViolation[] = [];

    // L1: Keyword check (fast)
    for (const keyword of filterRules.blockedKeywords) {
      if (text.includes(keyword.toLowerCase())) {
        violations.push({
          rule: 'keyword_filter',
          severity: filterRules.sensitivityLevel >= 4 ? 'HIGH' : 'MEDIUM',
          message: `Blocked keyword detected`,
          autoBlocked: true,
        });
        break;
      }
    }

    // L2: Pattern check (regex)
    if (violations.length === 0 && filterRules.blockedPatterns.length > 0) {
      for (const pattern of filterRules.blockedPatterns) {
        try {
          if (new RegExp(pattern, 'i').test(text)) {
            violations.push({
              rule: 'pattern_filter',
              severity: 'HIGH',
              message: `Blocked pattern detected`,
              autoBlocked: true,
            });
            break;
          }
        } catch {
          // Invalid regex, skip
        }
      }
    }

    // L3: Profanity check
    if (filterRules.autoFlagProfanity && violations.length === 0) {
      // Simple profanity detection (can be upgraded to AI-based)
      const profanityPatterns = /\b(fuck|shit|damn|ass|bitch)\b/i;
      if (profanityPatterns.test(text)) {
        violations.push({
          rule: 'profanity_filter',
          severity: 'LOW',
          message: 'Profanity detected',
          autoBlocked: false,
        });
      }
    }

    if (violations.length > 0) {
      const hasHigh = violations.some(v => v.severity === 'HIGH' || v.severity === 'CRITICAL');
      return {
        result: hasHigh ? 'HARD_BLOCK' : 'SOFT_BLOCK',
        reason: 'content.violation',
        details: violations,
        suggestions: ['Please adjust your message content'],
        metadata: {
          ruleVersion: context.rules.version,
          evaluatedAt: Date.now(),
          processingTimeMs: 0,
        },
      };
    }

    return { result: 'PASS', reason: '', details: [], suggestions: [], metadata: { ruleVersion: '', evaluatedAt: 0, processingTimeMs: 0 } };
  }

  /**
   * 4. Consent State Check
   */
  private checkConsentState(context: RuleEvaluationContext): RuleEvaluationResult {
    // For media types above text level, consent is required
    if (context.messageType !== 'TEXT' && context.consentState === 'CONSENT_NONE') {
      return {
        result: 'SOFT_BLOCK',
        reason: 'consent.required',
        details: [{
          rule: 'consent_check',
          severity: 'LOW',
          message: `Consent required for ${context.messageType} messages`,
          autoBlocked: false,
        }],
        suggestions: ['Request consent before sharing this type of content'],
        metadata: {
          ruleVersion: context.rules.version,
          evaluatedAt: Date.now(),
          processingTimeMs: 0,
        },
      };
    }

    if (context.consentState === 'CONSENT_DENIED') {
      return {
        result: 'HARD_BLOCK',
        reason: 'consent.denied',
        details: [{
          rule: 'consent_check',
          severity: 'HIGH',
          message: 'Consent was denied by the recipient',
          autoBlocked: true,
        }],
        suggestions: [],
        metadata: {
          ruleVersion: context.rules.version,
          evaluatedAt: Date.now(),
          processingTimeMs: 0,
        },
      };
    }

    return { result: 'PASS', reason: '', details: [], suggestions: [], metadata: { ruleVersion: '', evaluatedAt: 0, processingTimeMs: 0 } };
  }

  // ─── Helpers ─────────────────────────────────────────────────

  private getLevelPriority(level: MediaAccessLevel): number {
    const priorities: Record<MediaAccessLevel, number> = {
      L0_TEXT: 0,
      L1_IMAGE: 1,
      L2_VOICE: 2,
      L3_VIDEO: 3,
      L4_LOCATION: 4,
      L5_CONTACT: 5,
    };
    return priorities[level] ?? 0;
  }

  private addTiming(
    result: RuleEvaluationResult,
    startTime: number,
    ruleVersion: string
  ): RuleEvaluationResult {
    result.metadata.processingTimeMs = performance.now() - startTime;
    result.metadata.ruleVersion = ruleVersion;
    return result;
  }
}

/**
 * Get or load user's Power Board rules
 * Uses Redis cache with 5-minute TTL
 */
export async function getUserRules(userId: string): Promise<PowerBoardRulesPayload> {
  // Try cache first
  const cacheKey = RedisKeys.rules(userId);
  const cached = await redis.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached as string);
    } catch {
      // Cache corrupt, continue to DB
    }
  }

  // Load from DB
  const ruleRecord = await db.powerBoardRule.findUnique({ where: { userId } });

  if (!ruleRecord) {
    // Create default rules
    return getDefaultRules(userId);
  }

  const rules: PowerBoardRulesPayload = {
    userId: ruleRecord.userId,
    version: ruleRecord.version,
    isActive: ruleRecord.isActive,
    pace: JSON.parse(ruleRecord.paceConfig),
    media: JSON.parse(ruleRecord.mediaConfig),
    filter: JSON.parse(ruleRecord.filterConfig),
    autoResponse: ruleRecord.autoResponse ? JSON.parse(ruleRecord.autoResponse) : undefined,
    privacy: JSON.parse(ruleRecord.privacyConfig),
    notifications: ruleRecord.notifConfig ? JSON.parse(ruleRecord.notifConfig) : undefined,
  };

  // Cache it
  await redis.set(cacheKey, JSON.stringify(rules), { ex: RedisKeys.rulesTtl });

  return rules;
}

/**
 * Default Power Board Rules for new users
 */
export function getDefaultRules(userId: string): PowerBoardRulesPayload {
  return {
    userId,
    version: '1.0.0',
    isActive: true,
    pace: {
      maxMessagesPerHour: 20,
      maxMessagesPerDay: 100,
      responseWindowHours: 24,
      enforceCooldown: true,
      cooldownMinutes: 5,
      showRemainingQuota: true,
    },
    media: {
      defaultLevel: 'L0_TEXT',
      perUserOverride: {},
      requireConsentForUpgrade: true,
      autoBlurImages: true,
      watermarkAllMedia: true,
    },
    filter: {
      blockedKeywords: [],
      blockedPatterns: [],
      blockExplicitImages: true,
      autoFlagProfanity: false,
      blockUnsolicitedContact: true,
      sensitivityLevel: 3,
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

// Singleton
export const ruleEvaluator = new RuleEvaluator();
