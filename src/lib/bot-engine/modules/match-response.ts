/**
 * LokFeel Bot Behavior Engine — Match Response Module
 *
 * Simulates how bot users respond to match suggestions:
 * - Score-based accept/reject decision making
 * - Personality-influenced thresholds and biases
 * - Realistic response time delays (log-normal distribution)
 * - Super Like behavior for exceptionally high scores
 * - Ghosting probability for passive/disinterested bots
 */

import type {
  BotBehaviorConfig,
  MatchReactionDecision,
  MatchReactionResult,
  BehaviorEvent,
} from '../types';
import {
  createSeededRandom,
  clamp,
  normalRandom,
  exponentialRandom,
  generateEventId,
} from '../utils';

// ═══════════════════════════════════════════════════════════════
// Core Match Decision Logic
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate the effective acceptance probability for a given match score.
 *
 * The formula combines:
 * - Base probability (personality-driven)
 * - Score influence (higher scores → higher acceptance)
 * - Sigmoid curve for natural-looking decision boundary
 *
 * @param config - Bot behavior configuration
 * @param matchScore - The compatibility score (0-100)
 * @returns Probability of acceptance (0-1)
 */
export function calculateAcceptProbability(
  config: BotBehaviorConfig,
  matchScore: number,
): number {
  const { matching } = config;
  const random = createSeededRandom(config.seed + matchScore);

  // Normalize match score to 0-1
  const normalizedScore = matchScore / 100;

  // Sigmoid-based score influence
  // At score=50 (average), influence = 0.5
  // Higher scores push acceptance probability up, lower scores push it down
  const scoreInfluence =
    1 / (1 + Math.exp(-matching.scoreInfluenceWeight * 10 * (normalizedScore - 0.5)));

  // Combine base probability with score influence
  // Base: personality's general willingness to match
  // Score: how much this specific match score affects the decision
  const rawProbability =
    matching.baseAcceptProbability * (1 - matching.scoreInfluenceWeight) +
    scoreInfluence * matching.scoreInfluenceWeight;

  // Add small random noise for natural variation
  const noise = (random() - 0.5) * 0.05;

  return clamp(rawProbability + noise, 0, 0.99);
}

/**
 * Make a match reaction decision for a bot user.
 *
 * Returns a complete MatchReactionResult including the decision,
 * response delay, and reasoning.
 *
 * @param config - Bot behavior configuration
 * @param botUserId - Bot's user ID
 * @param matchId - The match being reacted to
 * @param matchScore - Compatibility score (0-100)
 */
export function makeMatchDecision(
  config: BotBehaviorConfig,
  botUserId: string,
  matchId: string,
  matchScore: number,
): MatchReactionResult {
  const random = createSeededRandom(
    config.seed +
    botUserId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) +
    matchScore
  );
  const { matching } = config;

  // Step 1: Check ghost probability first
  if (random() < matching.ghostProbability) {
    return {
      botUserId,
      matchId,
      matchScore,
      decision: 'ghost',
      responseDelayMin: Infinity, // Will never respond
      reason: 'Bot personality倾向于不回应 (ghost)',
    };
  }

  // Step 2: Calculate acceptance probability
  const acceptProb = calculateAcceptProbability(config, matchScore);

  // Step 3: Check for Super Like
  if (
    matchScore >= matching.superLikeMinScore &&
    random() < matching.superLikeProbability
  ) {
    return {
      botUserId,
      matchId,
      matchScore,
      decision: 'super_like',
      responseDelayMin: calculateResponseDelay(config, random, 0.3), // Faster for Super Like
      reason: `匹配分数${matchScore}分，触发Super Like (≥${matching.superLikeMinScore}阈值)`,
    };
  }

  // Step 4: Main accept/reject decision
  if (random() < acceptProb) {
    // High score → accept
    if (matchScore >= 75) {
      return {
        botUserId,
        matchId,
        matchScore,
        decision: 'accept',
        responseDelayMin: calculateResponseDelay(config, random, 0.7),
        reason: `匹配分数${matchScore}分，超过高匹配阈值(≥75)，接受匹配`,
      };
    }

    // Medium score → maybe
    if (matchScore >= 50) {
      // 20% chance of "maybe" instead of accept for medium scores
      if (random() < 0.2) {
        return {
          botUserId,
          matchId,
          matchScore,
          decision: 'maybe',
          responseDelayMin: calculateResponseDelay(config, random, 1.0), // Takes longer
          reason: `匹配分数${matchScore}分，中等匹配度，选择"了解更多"`,
        };
      }
      return {
        botUserId,
        matchId,
        matchScore,
        decision: 'accept',
        responseDelayMin: calculateResponseDelay(config, random, 0.8),
        reason: `匹配分数${matchScore}分，接受匹配`,
      };
    }

    // Below 50 but still accepted (personality bias)
    return {
      botUserId,
      matchId,
      matchScore,
      decision: 'accept',
      responseDelayMin: calculateResponseDelay(config, random, 1.2),
      reason: `匹配分数${matchScore}分，但性格倾向接受`,
    };
  }

  // Rejected
  return {
    botUserId,
    matchId,
    matchScore,
    decision: 'reject',
    responseDelayMin: calculateResponseDelay(config, random, 1.0),
    reason: `匹配分数${matchScore}分，低于接受阈值`,
  };
}

/**
 * Calculate realistic response delay using log-normal distribution.
 * Most responses are quick, some take hours.
 *
 * @param config - Bot behavior configuration
 * @param random - Seeded random function
 * @param speedFactor - Multiplier for response urgency (0.3 = fast, 1.0 = normal, 2.0 = slow)
 */
function calculateResponseDelay(
  config: BotBehaviorConfig,
  random: () => number,
  speedFactor: number = 1.0,
): number {
  const { matching } = config;

  // Log-normal distribution: most responses within mean, long tail
  const baseDelay = Math.log(matching.responseTimeMeanMin);
  const spread = matching.responseTimeStdDevMin / matching.responseTimeMeanMin;

  const delay = Math.max(1, Math.round(
    Math.exp(normalRandom(random, baseDelay, spread)) * speedFactor
  ));

  return delay;
}

// ═══════════════════════════════════════════════════════════════
// Batch Processing
// ═══════════════════════════════════════════════════════════════

export interface PendingMatch {
  matchId: string;
  matchScore: number;
  createdAt: Date;
}

/**
 * Process all pending matches for a bot and return decisions.
 * Orders matches by score (highest first — bots review best matches first).
 */
export function processPendingMatches(
  config: BotBehaviorConfig,
  botUserId: string,
  pendingMatches: PendingMatch[],
): MatchReactionResult[] {
  // Sort by match score descending (review best matches first)
  const sorted = [...pendingMatches].sort((a, b) => b.matchScore - a.matchScore);

  return sorted.map((match) =>
    makeMatchDecision(config, botUserId, match.matchId, match.matchScore)
  );
}

/**
 * Generate a behavior event for a match reaction.
 */
export function createMatchReactionEvent(
  result: MatchReactionResult,
): BehaviorEvent {
  const eventType = result.decision === 'super_like'
    ? 'super_like'
    : 'match_reaction';

  return {
    id: generateEventId(),
    botUserId: result.botUserId,
    type: eventType,
    timestamp: new Date(),
    data: {
      matchId: result.matchId,
      matchScore: result.matchScore,
      decision: result.decision,
      responseDelayMin: result.responseDelayMin,
      reason: result.reason,
    },
  };
}
