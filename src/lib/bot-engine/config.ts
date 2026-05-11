/**
 * LokFee! Bot Behavior Engine — Configuration & Personality Presets
 *
 * Provides default behavior configurations for each personality type,
 * factory functions for creating bot configs, and global engine defaults.
 */

import type {
  BotBehaviorConfig,
  BotGender,
  EngineConfig,
  OnlineBehaviorConfig,
  BrowsingBehaviorConfig,
  MatchResponseConfig,
  ChatBehaviorConfig,
  PersonalityType,
} from './types';
import { clamp } from './utils';

// ═══════════════════════════════════════════════════════════════
// Personality-Based Default Configurations
// ═══════════════════════════════════════════════════════════════

const ONLINE_CONFIGS: Record<PersonalityType, OnlineBehaviorConfig> = {
  explorer: {
    avgSessionsPerDay: 4,
    avgSessionDurationMin: 25,
    peakHours: [20, 21, 22, 23],
    offPeakProbability: 0.3,
    activeDays: [0, 1, 2, 3, 4, 5, 6],
  },
  selective: {
    avgSessionsPerDay: 2,
    avgSessionDurationMin: 15,
    peakHours: [21, 22],
    offPeakProbability: 0.15,
    activeDays: [1, 3, 5, 6],
  },
  social: {
    avgSessionsPerDay: 5,
    avgSessionDurationMin: 35,
    peakHours: [19, 20, 21, 22, 23],
    offPeakProbability: 0.4,
    activeDays: [0, 1, 2, 3, 4, 5, 6],
  },
  passive: {
    avgSessionsPerDay: 1,
    avgSessionDurationMin: 10,
    peakHours: [22],
    offPeakProbability: 0.05,
    activeDays: [0, 3, 6],
  },
  enthusiastic: {
    avgSessionsPerDay: 6,
    avgSessionDurationMin: 20,
    peakHours: [18, 19, 20, 21, 22, 23],
    offPeakProbability: 0.35,
    activeDays: [0, 1, 2, 3, 4, 5, 6],
  },
  cautious: {
    avgSessionsPerDay: 2,
    avgSessionDurationMin: 30,
    peakHours: [20, 21],
    offPeakProbability: 0.1,
    activeDays: [1, 2, 4, 5],
  },
};

const BROWSING_CONFIGS: Record<PersonalityType, BrowsingBehaviorConfig> = {
  explorer: {
    avgProfilesPerSession: 15,
    avgProfileViewDurationSec: 8,
    profileViewDurationStdDev: 4,
    detailedViewProbability: 0.3,
    revisitProbability: 0.2,
  },
  selective: {
    avgProfilesPerSession: 5,
    avgProfileViewDurationSec: 25,
    profileViewDurationStdDev: 10,
    detailedViewProbability: 0.9,
    revisitProbability: 0.1,
  },
  social: {
    avgProfilesPerSession: 8,
    avgProfileViewDurationSec: 12,
    profileViewDurationStdDev: 6,
    detailedViewProbability: 0.6,
    revisitProbability: 0.3,
  },
  passive: {
    avgProfilesPerSession: 3,
    avgProfileViewDurationSec: 15,
    profileViewDurationStdDev: 8,
    detailedViewProbability: 0.5,
    revisitProbability: 0.15,
  },
  enthusiastic: {
    avgProfilesPerSession: 20,
    avgProfileViewDurationSec: 6,
    profileViewDurationStdDev: 3,
    detailedViewProbability: 0.4,
    revisitProbability: 0.25,
  },
  cautious: {
    avgProfilesPerSession: 6,
    avgProfileViewDurationSec: 35,
    profileViewDurationStdDev: 15,
    detailedViewProbability: 0.95,
    revisitProbability: 0.4,
  },
};

const MATCHING_CONFIGS: Record<PersonalityType, MatchResponseConfig> = {
  explorer: {
    baseAcceptProbability: 0.55,
    scoreInfluenceWeight: 0.3,
    superLikeProbability: 0.08,
    superLikeMinScore: 75,
    responseTimeMeanMin: 30,
    responseTimeStdDevMin: 20,
    ghostProbability: 0.15,
  },
  selective: {
    baseAcceptProbability: 0.3,
    scoreInfluenceWeight: 0.6,
    superLikeProbability: 0.02,
    superLikeMinScore: 85,
    responseTimeMeanMin: 120,
    responseTimeStdDevMin: 60,
    ghostProbability: 0.05,
  },
  social: {
    baseAcceptProbability: 0.65,
    scoreInfluenceWeight: 0.25,
    superLikeProbability: 0.05,
    superLikeMinScore: 70,
    responseTimeMeanMin: 15,
    responseTimeStdDevMin: 10,
    ghostProbability: 0.08,
  },
  passive: {
    baseAcceptProbability: 0.4,
    scoreInfluenceWeight: 0.2,
    superLikeProbability: 0.01,
    superLikeMinScore: 80,
    responseTimeMeanMin: 360,
    responseTimeStdDevMin: 180,
    ghostProbability: 0.35,
  },
  enthusiastic: {
    baseAcceptProbability: 0.7,
    scoreInfluenceWeight: 0.2,
    superLikeProbability: 0.12,
    superLikeMinScore: 65,
    responseTimeMeanMin: 5,
    responseTimeStdDevMin: 5,
    ghostProbability: 0.03,
  },
  cautious: {
    baseAcceptProbability: 0.25,
    scoreInfluenceWeight: 0.7,
    superLikeProbability: 0.01,
    superLikeMinScore: 90,
    responseTimeMeanMin: 240,
    responseTimeStdDevMin: 120,
    ghostProbability: 0.1,
  },
};

const CHAT_CONFIGS: Record<PersonalityType, ChatBehaviorConfig> = {
  explorer: {
    avgMessagesPerDay: 5,
    avgResponseTimeMin: 15,
    responseTimeStdDevMin: 10,
    initConversationProbability: 0.4,
    followUpProbability: 0.3,
    maxFollowUps: 1,
    avgConversationLength: 8,
    activeEndProbability: 0.2,
  },
  selective: {
    avgMessagesPerDay: 8,
    avgResponseTimeMin: 20,
    responseTimeStdDevMin: 15,
    initConversationProbability: 0.3,
    followUpProbability: 0.5,
    maxFollowUps: 2,
    avgConversationLength: 15,
    activeEndProbability: 0.1,
  },
  social: {
    avgMessagesPerDay: 15,
    avgResponseTimeMin: 8,
    responseTimeStdDevMin: 5,
    initConversationProbability: 0.7,
    followUpProbability: 0.6,
    maxFollowUps: 3,
    avgConversationLength: 25,
    activeEndProbability: 0.15,
  },
  passive: {
    avgMessagesPerDay: 2,
    avgResponseTimeMin: 90,
    responseTimeStdDevMin: 60,
    initConversationProbability: 0.1,
    followUpProbability: 0.15,
    maxFollowUps: 1,
    avgConversationLength: 5,
    activeEndProbability: 0.05,
  },
  enthusiastic: {
    avgMessagesPerDay: 12,
    avgResponseTimeMin: 3,
    responseTimeStdDevMin: 3,
    initConversationProbability: 0.85,
    followUpProbability: 0.5,
    maxFollowUps: 2,
    avgConversationLength: 18,
    activeEndProbability: 0.25,
  },
  cautious: {
    avgMessagesPerDay: 6,
    avgResponseTimeMin: 45,
    responseTimeStdDevMin: 30,
    initConversationProbability: 0.2,
    followUpProbability: 0.4,
    maxFollowUps: 2,
    avgConversationLength: 12,
    activeEndProbability: 0.08,
  },
};

/**
 * Gender-specific adjustments to behavior.
 * Applied on top of personality presets.
 */
const GENDER_ADJUSTMENTS: Record<BotGender, {
  onlineScale: number;
  matchAcceptOffset: number;
  chatInitiativeOffset: number;
  responseTimeScale: number;
}> = {
  male: {
    onlineScale: 1.1,         // Slightly more sessions
    matchAcceptOffset: 0.1,   // More likely to accept
    chatInitiativeOffset: 0.15, // More likely to initiate
    responseTimeScale: 0.8,   // Faster responses
  },
  female: {
    onlineScale: 0.9,
    matchAcceptOffset: -0.1,  // More selective
    chatInitiativeOffset: -0.1,
    responseTimeScale: 1.1,   // Slightly slower
  },
  non_binary: {
    onlineScale: 1.0,
    matchAcceptOffset: 0,
    chatInitiativeOffset: 0,
    responseTimeScale: 1.0,
  },
};

// ═══════════════════════════════════════════════════════════════
// Factory Functions
// ═══════════════════════════════════════════════════════════════

/**
 * Create a full BotBehaviorConfig for a given personality and gender.
 * @param userId - Used to derive the deterministic seed
 * @param personalityType - Bot personality archetype
 * @param gender - Bot gender for behavior adjustments
 */
export function createBotConfig(
  userId: string,
  personalityType: PersonalityType,
  gender: BotGender,
  seed?: number,
): BotBehaviorConfig {
  const genderAdj = GENDER_ADJUSTMENTS[gender];

  return {
    personalityType,
    seed: seed ?? (userId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)),
    online: {
      ...ONLINE_CONFIGS[personalityType],
      avgSessionsPerDay: Math.round(
        ONLINE_CONFIGS[personalityType].avgSessionsPerDay * genderAdj.onlineScale
      ),
    },
    browsing: { ...BROWSING_CONFIGS[personalityType] },
    matching: {
      ...MATCHING_CONFIGS[personalityType],
      baseAcceptProbability: clamp(
        MATCHING_CONFIGS[personalityType].baseAcceptProbability + genderAdj.matchAcceptOffset,
        0.05,
        0.95,
      ),
    },
    chat: {
      ...CHAT_CONFIGS[personalityType],
      initConversationProbability: clamp(
        CHAT_CONFIGS[personalityType].initConversationProbability + genderAdj.chatInitiativeOffset,
        0.01,
        0.99,
      ),
      avgResponseTimeMin: Math.round(
        CHAT_CONFIGS[personalityType].avgResponseTimeMin * genderAdj.responseTimeScale
      ),
    },
  };
}

/**
 * Get all supported personality types.
 */
export function getPersonalityTypes(): PersonalityType[] {
  return ['explorer', 'selective', 'social', 'passive', 'enthusiastic', 'cautious'];
}

/**
 * Serialize a BotBehaviorConfig to JSON string for storage in User.botConfig.
 */
export function serializeBotConfig(config: BotBehaviorConfig): string {
  return JSON.stringify(config);
}

/**
 * Deserialize a BotBehaviorConfig from JSON string.
 */
export function deserializeBotConfig(json: string): BotBehaviorConfig {
  return JSON.parse(json) as BotBehaviorConfig;
}

// ═══════════════════════════════════════════════════════════════
// Default Engine Configuration
// ═══════════════════════════════════════════════════════════════

/**
 * Default engine configuration. Can be overridden for dev/prod environments.
 */
export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  tickIntervalMs: 60_000,          // Check every minute
  maxActionsPerTick: 100,          // Process up to 100 actions per tick
  speedMultiplier: 1,              // Real-time by default
  enableLogging: true,
  maxConcurrentSessions: 50,
  minActionIntervalMs: 5_000,      // 5 seconds minimum between actions per bot
};

/**
 * Development engine config — faster simulation.
 */
export const DEV_ENGINE_CONFIG: EngineConfig = {
  ...DEFAULT_ENGINE_CONFIG,
  tickIntervalMs: 10_000,          // Every 10 seconds
  speedMultiplier: 10,             // 10x speed
  maxActionsPerTick: 50,
  enableLogging: true,
  maxConcurrentSessions: 20,
  minActionIntervalMs: 2_000,
};
