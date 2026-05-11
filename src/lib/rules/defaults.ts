/**
 * Power Board Lite 默认规则配置
 * LokFee! IM 模块边界控制系统
 */

import {
  PowerBoardRules,
  PowerBoardLiteRules,
  PaceControl,
  MediaPolicy,
  ContentFilter,
  AutoReplyConfig,
  MediaAccessLevel,
  ContentType,
} from './types';

// ============================================================================
// 默认频率控制配置
// ============================================================================

export const DEFAULT_PACE_CONTROL: PaceControl = {
  maxMessagesPerHour: 20,
  maxMessagesPerDay: 100,
  cooldownMinutes: 5,
  enforceCooldown: false,
};

/** 严格模式频率控制 */
export const STRICT_PACE_CONTROL: PaceControl = {
  maxMessagesPerHour: 5,
  maxMessagesPerDay: 30,
  cooldownMinutes: 15,
  enforceCooldown: true,
};

/** 宽松模式频率控制 */
export const RELAXED_PACE_CONTROL: PaceControl = {
  maxMessagesPerHour: 50,
  maxMessagesPerDay: 300,
  cooldownMinutes: 1,
  enforceCooldown: false,
};

// ============================================================================
// 默认媒体策略配置
// ============================================================================

export const DEFAULT_MEDIA_POLICY: MediaPolicy = {
  defaultLevel: MediaAccessLevel.L0_TEXT,
  allowedLevels: [MediaAccessLevel.L0_TEXT],
  requireConsentFor: [ContentType.IMAGE, ContentType.VIDEO, ContentType.AUDIO],
};

/** 允许图片的媒体策略 */
export const IMAGE_ALLOWED_MEDIA_POLICY: MediaPolicy = {
  defaultLevel: MediaAccessLevel.L0_TEXT,
  allowedLevels: [MediaAccessLevel.L0_TEXT, MediaAccessLevel.L1_IMAGE],
  requireConsentFor: [ContentType.VIDEO, ContentType.AUDIO],
};

/** 允许所有媒体的策略 */
export const ALL_MEDIA_ALLOWED_POLICY: MediaPolicy = {
  defaultLevel: MediaAccessLevel.L0_TEXT,
  allowedLevels: [
    MediaAccessLevel.L0_TEXT,
    MediaAccessLevel.L1_IMAGE,
    MediaAccessLevel.L2_VOICE,
    MediaAccessLevel.L3_VIDEO,
  ],
  requireConsentFor: [],
};

// ============================================================================
// 默认内容过滤配置
// ============================================================================

/** 基础屏蔽关键词 */
export const DEFAULT_BLOCKED_KEYWORDS: string[] = [
  // 骚扰类
  'spam',
  'scam',
  'fake',
  // 不当内容
  'nude',
  'naked',
  'sex',
  'porn',
  // 威胁类
  'kill',
  'die',
  'hurt',
];

export const DEFAULT_CONTENT_FILTER: ContentFilter = {
  blockedKeywords: DEFAULT_BLOCKED_KEYWORDS,
  enableAIModeration: true,
  toxicityThreshold: 0.7,
};

/** 严格内容过滤 */
export const STRICT_CONTENT_FILTER: ContentFilter = {
  blockedKeywords: [
    ...DEFAULT_BLOCKED_KEYWORDS,
    'ugly',
    'stupid',
    'idiot',
    'loser',
    'hate',
    'damn',
    'hell',
  ],
  enableAIModeration: true,
  toxicityThreshold: 0.5,
};

/** 宽松内容过滤 */
export const RELAXED_CONTENT_FILTER: ContentFilter = {
  blockedKeywords: [],
  enableAIModeration: false,
  toxicityThreshold: 0.9,
};

// ============================================================================
// 默认自动回复配置
// ============================================================================

export const DEFAULT_AUTO_REPLY_CONFIG: AutoReplyConfig = {
  enabled: false,
  template: null,
  responseWindow: 24,
};

/** 常用自动回复模板 */
export const AUTO_REPLY_TEMPLATES = {
  BUSY: "Hi! I'm a bit busy right now but I'll get back to you within {{responseWindow}} hours. 💕",
  WORK: "Thanks for your message! I'm currently at work but will reply when I'm free. ⏰",
  SLEEP: "I'm catching some beauty sleep right now 💤 Will reply when I wake up!",
  WEEKEND: "Weekend mode activated! 🎉 I'll reply when I'm back online.",
  CUSTOM: null,
} as const;

// ============================================================================
// 默认完整规则配置
// ============================================================================

/**
 * 获取默认 Power Board 规则
 */
export function getDefaultPowerBoardRules(userId: string): PowerBoardRules {
  return {
    userId,
    version: '1.0.0',
    updatedAt: new Date(),
    pace: { ...DEFAULT_PACE_CONTROL },
    media: { ...DEFAULT_MEDIA_POLICY },
    filter: { ...DEFAULT_CONTENT_FILTER },
    autoReply: { ...DEFAULT_AUTO_REPLY_CONFIG },
  };
}

/**
 * 获取严格模式规则
 */
export function getStrictPowerBoardRules(userId: string): PowerBoardRules {
  return {
    userId,
    version: '1.0.0',
    updatedAt: new Date(),
    pace: { ...STRICT_PACE_CONTROL },
    media: { ...DEFAULT_MEDIA_POLICY },
    filter: { ...STRICT_CONTENT_FILTER },
    autoReply: { ...DEFAULT_AUTO_REPLY_CONFIG },
  };
}

/**
 * 获取宽松模式规则
 */
export function getRelaxedPowerBoardRules(userId: string): PowerBoardRules {
  return {
    userId,
    version: '1.0.0',
    updatedAt: new Date(),
    pace: { ...RELAXED_PACE_CONTROL },
    media: { ...ALL_MEDIA_ALLOWED_POLICY },
    filter: { ...RELAXED_CONTENT_FILTER },
    autoReply: { ...DEFAULT_AUTO_REPLY_CONFIG },
  };
}

// ============================================================================
// 默认 Lite 规则配置
// ============================================================================

export const DEFAULT_POWER_BOARD_LITE_RULES: PowerBoardLiteRules = {
  maxMessagesPerHour: 20,
  responseWindow: 24,
  allowedMediaLevels: [0],
  requireConsentFor: ['image', 'video', 'audio'],
  blockedKeywords: DEFAULT_BLOCKED_KEYWORDS,
  autoReplyTemplate: null,
};

/**
 * 将 Lite 规则转换为完整规则
 */
export function convertLiteToFullRules(
  liteRules: PowerBoardLiteRules,
  userId: string
): PowerBoardRules {
  return {
    userId,
    version: '1.0.0',
    updatedAt: new Date(),
    pace: {
      maxMessagesPerHour: liteRules.maxMessagesPerHour,
      maxMessagesPerDay: liteRules.maxMessagesPerHour * 5,
      cooldownMinutes: 5,
      enforceCooldown: false,
    },
    media: {
      defaultLevel: MediaAccessLevel.L0_TEXT,
      allowedLevels: liteRules.allowedMediaLevels.map(level => {
        switch (level) {
          case 0: return MediaAccessLevel.L0_TEXT;
          case 1: return MediaAccessLevel.L1_IMAGE;
          case 2: return MediaAccessLevel.L2_VOICE;
          case 3: return MediaAccessLevel.L3_VIDEO;
          default: return MediaAccessLevel.L0_TEXT;
        }
      }),
      requireConsentFor: liteRules.requireConsentFor.map(type => {
        switch (type) {
          case 'image': return ContentType.IMAGE;
          case 'video': return ContentType.VIDEO;
          case 'audio': return ContentType.AUDIO;
          case 'location': return ContentType.LOCATION;
          case 'contact': return ContentType.CONTACT;
          default: return ContentType.TEXT;
        }
      }),
    },
    filter: {
      blockedKeywords: liteRules.blockedKeywords,
      enableAIModeration: true,
      toxicityThreshold: 0.7,
    },
    autoReply: {
      enabled: !!liteRules.autoReplyTemplate,
      template: liteRules.autoReplyTemplate,
      responseWindow: liteRules.responseWindow,
    },
  };
}

/**
 * 将完整规则转换为 Lite 规则
 */
export function convertFullToLiteRules(fullRules: PowerBoardRules): PowerBoardLiteRules {
  return {
    maxMessagesPerHour: fullRules.pace.maxMessagesPerHour,
    responseWindow: fullRules.autoReply.responseWindow,
    allowedMediaLevels: fullRules.media.allowedLevels.map(level => {
      switch (level) {
        case MediaAccessLevel.L0_TEXT: return 0;
        case MediaAccessLevel.L1_IMAGE: return 1;
        case MediaAccessLevel.L2_VOICE: return 2;
        case MediaAccessLevel.L3_VIDEO: return 3;
        default: return 0;
      }
    }),
    requireConsentFor: fullRules.media.requireConsentFor.map(type => {
      switch (type) {
        case ContentType.IMAGE: return 'image';
        case ContentType.VIDEO: return 'video';
        case ContentType.AUDIO: return 'audio';
        case ContentType.LOCATION: return 'location';
        case ContentType.CONTACT: return 'contact';
        default: return 'text';
      }
    }),
    blockedKeywords: fullRules.filter.blockedKeywords,
    autoReplyTemplate: fullRules.autoReply.template,
  };
}

// ============================================================================
// 预设配置模板
// ============================================================================

export const RULE_PRESETS = {
  /** 默认配置 */
  DEFAULT: 'default',
  /** 严格配置 */
  STRICT: 'strict',
  /** 宽松配置 */
  RELAXED: 'relaxed',
  /** 仅文字 */
  TEXT_ONLY: 'text_only',
  /** 社交模式 */
  SOCIAL: 'social',
} as const;

export type RulePreset = typeof RULE_PRESETS[keyof typeof RULE_PRESETS];

/**
 * 根据预设获取规则配置
 */
export function getRulesByPreset(
  preset: RulePreset,
  userId: string
): PowerBoardRules {
  switch (preset) {
    case RULE_PRESETS.STRICT:
      return getStrictPowerBoardRules(userId);
    case RULE_PRESETS.RELAXED:
      return getRelaxedPowerBoardRules(userId);
    case RULE_PRESETS.TEXT_ONLY:
      return {
        ...getDefaultPowerBoardRules(userId),
        media: {
          defaultLevel: MediaAccessLevel.L0_TEXT,
          allowedLevels: [MediaAccessLevel.L0_TEXT],
          requireConsentFor: [ContentType.IMAGE, ContentType.VIDEO, ContentType.AUDIO],
        },
      };
    case RULE_PRESETS.SOCIAL:
      return {
        ...getDefaultPowerBoardRules(userId),
        pace: {
          maxMessagesPerHour: 30,
          maxMessagesPerDay: 150,
          cooldownMinutes: 3,
          enforceCooldown: false,
        },
        media: IMAGE_ALLOWED_MEDIA_POLICY,
      };
    case RULE_PRESETS.DEFAULT:
    default:
      return getDefaultPowerBoardRules(userId);
  }
}
