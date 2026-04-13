/**
 * LokFeel Bot Behavior Engine — Online Status Module
 *
 * Simulates realistic online/offline patterns for bot users:
 * - Timezone-aware peak activity hours
 * - Session-based online periods with natural duration variance
 * - Day-of-week activity patterns
 * - Gradual session start/end transitions
 */

import type { BotBehaviorConfig, BotOnlineState, BehaviorEvent } from '../types';
import {
  createSeededRandom,
  normalRandom,
  clamp,
  getCurrentHourInTimezone,
  getCurrentDayInTimezone,
  generateEventId,
  exponentialRandom,
} from '../utils';

// ═══════════════════════════════════════════════════════════════
// Activity Probability Calculation
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate the probability that a bot should be online right now,
 * based on its timezone, peak hours, and day preferences.
 *
 * Returns 0-1 where:
 * - 0 = should definitely be offline
 * - 1 = should definitely be online
 * - Between = roll the dice
 */
export function calculateOnlineProbability(
  config: BotBehaviorConfig,
  timezone: string,
): number {
  const { online } = config;
  const random = createSeededRandom(config.seed);
  const currentHour = getCurrentHourInTimezone(timezone);
  const currentDay = getCurrentDayInTimezone(timezone);

  // Base probability from sessions/day converted to per-hour
  // If 3 sessions/day, average ~3/24 ≈ 12.5% base probability per hour
  const baseProbability = online.avgSessionsPerDay / 24;

  // Peak hour multiplier
  const isPeakHour = online.peakHours.includes(currentHour);
  const peakMultiplier = isPeakHour ? 5.0 : 1.0;

  // Off-peak still has some probability
  const offPeakBonus = isPeakHour ? 0 : online.offPeakProbability * baseProbability;

  // Active day check
  const isActiveDay = online.activeDays.includes(currentDay);
  const dayMultiplier = isActiveDay ? 1.0 : 0.2; // 80% less likely on inactive days

  // Calculate final probability
  let probability = (baseProbability * peakMultiplier + offPeakBonus) * dayMultiplier;

  // Add some variance based on seed so not all bots act identically
  const variance = (random() - 0.5) * 0.1; // ±5% variance
  probability += variance;

  return clamp(probability, 0, 0.95);
}

/**
 * Calculate natural session duration based on bot personality.
 * Uses log-normal distribution for realistic right-skewed durations.
 */
export function calculateSessionDuration(
  config: BotBehaviorConfig,
): number {
  const { online, seed } = config;
  const random = createSeededRandom(Date.now() + seed);
  // Log-normal: most sessions are shorter than average, some are longer
  return Math.max(
    2, // Minimum 2 minutes
    Math.min(
      120, // Maximum 2 hours
      logNormalRandom(random, online.avgSessionDurationMin, 0.4),
    ),
  );
}

/**
 * Log-normal helper for session durations.
 */
function logNormalRandom(random: () => number, mean: number, spread: number): number {
  const normal = normalRandom(random, Math.log(mean), spread);
  return Math.exp(normal);
}

// ═══════════════════════════════════════════════════════════════
// Online State Management
// ═══════════════════════════════════════════════════════════════

/**
 * Create initial online state for a bot.
 */
export function createOnlineState(botUserId: string): BotOnlineState {
  return {
    botUserId,
    isOnline: false,
    currentSessionStart: null,
    sessionCount: 0,
    lastActivityAt: new Date(0),
  };
}

/**
 * Determine if a bot should go online, stay online, or go offline.
 * Returns the new state and any events generated.
 */
export function evaluateOnlineTransition(
  currentState: BotOnlineState,
  config: BotBehaviorConfig,
  timezone: string,
): { state: BotOnlineState; events: BehaviorEvent[] } {
  const events: BehaviorEvent[] = [];
  const newState = { ...currentState };
  const now = new Date();

  if (currentState.isOnline) {
    // Check if session should end
    if (currentState.currentSessionStart) {
      const sessionDurationMs = now.getTime() - currentState.currentSessionStart.getTime();
      const sessionDurationMin = sessionDurationMs / 60_000;
      const expectedDuration = calculateSessionDuration(config);

      // Probability of ending increases as session approaches expected duration
      if (sessionDurationMin > expectedDuration) {
        const random = createSeededRandom(config.seed + now.getHours());
        const overDuration = sessionDurationMin - expectedDuration;
        const endProbability = clamp(overDuration / 15, 0.1, 0.8); // Increases over time

        if (random() < endProbability) {
          // End session
          newState.isOnline = false;
          newState.currentSessionStart = null;
          newState.lastActivityAt = now;

          events.push({
            id: generateEventId(),
            botUserId: config.seed.toString(), // Placeholder — actual botUserId set by caller
            type: 'session_end',
            timestamp: now,
            data: {
              sessionDurationMin: Math.round(sessionDurationMin * 10) / 10,
              sessionCount: newState.sessionCount,
            },
          });
        }
      }
    }
    return { state: newState, events };
  }

  // Bot is offline — check if should come online
  const onlineProbability = calculateOnlineProbability(config, timezone);
  const random = createSeededRandom(
    config.seed +
    now.getFullYear() * 10000 +
    (now.getMonth() + 1) * 100 +
    now.getDate(),
  );

  if (random() < onlineProbability) {
    // Start session
    newState.isOnline = true;
    newState.currentSessionStart = now;
    newState.sessionCount += 1;
    newState.lastActivityAt = now;

    events.push({
      id: generateEventId(),
      botUserId: config.seed.toString(),
      type: 'session_start',
      timestamp: now,
      data: {
        sessionNumber: newState.sessionCount,
      },
    });
  }

  return { state: newState, events };
}

/**
 * Get a time-until-next-session estimate in minutes.
 * Useful for scheduling when to check again for an offline bot.
 */
export function estimateNextSessionDelay(
  config: BotBehaviorConfig,
  timezone: string,
): number {
  const currentHour = getCurrentHourInTimezone(timezone);
  const currentDay = getCurrentDayInTimezone(timezone);
  const { online } = config;

  // If current hour is a peak hour, next session could be soon
  const isPeakHour = online.peakHours.includes(currentHour);
  const isActiveDay = online.activeDays.includes(currentDay);

  if (isPeakHour && isActiveDay) {
    return exponentialRandom(createSeededRandom(Date.now()), 30); // ~30 min average
  }

  if (isActiveDay) {
    // Hours until next peak
    const nextPeak = online.peakHours
      .map(h => h > currentHour ? h - currentHour : (24 - currentHour + h))
      .sort((a, b) => a - b)[0];

    return nextPeak * 60 + Math.random() * 60; // Around next peak + some variance
  }

  // Inactive day — next session probably tomorrow
  return 24 * 60 + Math.random() * 12 * 60;
}
