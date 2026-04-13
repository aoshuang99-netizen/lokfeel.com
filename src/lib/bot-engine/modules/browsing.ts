/**
 * LokFeel Bot Behavior Engine — Browsing Simulation Module
 *
 * Simulates how bot users browse other user profiles:
 * - Profile viewing with realistic dwell times (normal distribution)
 * - Batched browsing sessions (browse multiple profiles per session)
 * - Detailed vs. thumbnail-only viewing
 * - Revisit behavior for interesting profiles
 * - Browse pattern variety based on personality type
 */

import type { BotBehaviorConfig, BehaviorEvent } from '../types';
import {
  createSeededRandom,
  normalRandom,
  clamp,
  randomInt,
  randomPick,
  shuffleArray,
  generateEventId,
} from '../utils';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface ProfileViewEvent {
  profileId: string;
  durationSec: number;
  isDetailedView: boolean;
  isRevisit: boolean;
  viewOrder: number; // Position in the browsing session
}

export interface BrowseSessionResult {
  events: BehaviorEvent[];
  totalProfilesViewed: number;
  totalDetailedViews: number;
  totalRevisits: number;
  avgDwellTimeSec: number;
}

// ═══════════════════════════════════════════════════════════════
// Core Browsing Simulation
// ═══════════════════════════════════════════════════════════════

/**
 * Simulate a full browsing session for a bot user.
 *
 * Generates a batch of profile view events with realistic patterns:
 * - Browse count follows the bot's avgProfilesPerSession with variance
 * - Each view has a dwell time drawn from normal distribution
 * - Some views are detailed (full profile), some are thumbnail-only
 * - Revisit probability is applied to previously-viewed profiles
 *
 * @param config - Bot behavior configuration
 * @param botUserId - The bot's user ID
 * @param availableProfileIds - Pool of profile IDs the bot can browse
 * @param previouslyViewedIds - Profiles the bot has already seen
 */
export function simulateBrowseSession(
  config: BotBehaviorConfig,
  botUserId: string,
  availableProfileIds: string[],
  previouslyViewedIds: string[] = [],
): BrowseSessionResult {
  const { browsing, seed } = config;
  const random = createSeededRandom(Date.now() + seed);
  const events: BehaviorEvent[] = [];

  // How many profiles to browse this session (Poisson-like distribution)
  const browseCount = clamp(
    Math.round(normalRandom(random, browsing.avgProfilesPerSession, browsing.avgProfilesPerSession * 0.3)),
    1, // At least 1
    browsing.avgProfilesPerSession * 3, // Cap at 3x average
  );

  // Filter out self and already-viewed (unless revisiting)
  const unviewedIds = availableProfileIds.filter(id =>
    id !== botUserId && !previouslyViewedIds.includes(id)
  );

  // Shuffle and pick profiles
  const profilePool = shuffleArray(random, unviewedIds).slice(0, browseCount);

  // Mix in some revisits
  const revisitCount = Math.floor(
    profilePool.length * browsing.revisitProbability
  );
  const revisitIds = shuffleArray(random, previouslyViewedIds).slice(0, revisitCount);
  const allViewIds = [...profilePool, ...revisitIds];

  let totalDetailedViews = 0;
  let totalRevisits = 0;
  let totalDwellTime = 0;

  for (let i = 0; i < allViewIds.length; i++) {
    const profileId = allViewIds[i];
    const isRevisit = revisitIds.includes(profileId);

    // Dwell time: detailed views take longer
    const isDetailed = random() < browsing.detailedViewProbability;
    const baseDwellTime = isDetailed
      ? browsing.avgProfileViewDurationSec * 2
      : browsing.avgProfileViewDurationSec;

    const dwellTime = clamp(
      Math.round(normalRandom(random, baseDwellTime, browsing.profileViewDurationStdDev)),
      2,    // Min 2 seconds
      180,  // Max 3 minutes
    );

    totalDwellTime += dwellTime;
    if (isDetailed) totalDetailedViews++;
    if (isRevisit) totalRevisits++;

    events.push({
      id: generateEventId(),
      botUserId,
      type: 'profile_view',
      timestamp: new Date(Date.now() + i * dwellTime * 1000), // Stagger by dwell time
      data: {
        profileId,
        durationSec: dwellTime,
        isDetailedView: isDetailed,
        isRevisit,
        viewOrder: i + 1,
      } satisfies ProfileViewEvent,
    });
  }

  // Generate a batch summary event
  events.push({
    id: generateEventId(),
    botUserId,
    type: 'profile_browse_batch',
    timestamp: new Date(),
    data: {
      totalProfiles: allViewIds.length,
      totalDetailedViews,
      totalRevisits,
      avgDwellTimeSec: totalDwellTime / allViewIds.length,
      profileIds: allViewIds,
    },
  });

  return {
    events,
    totalProfilesViewed: allViewIds.length,
    totalDetailedViews,
    totalRevisits,
    avgDwellTimeSec: totalDwellTime / allViewIds.length,
  };
}

/**
 * Generate a single profile view event.
 * Used for targeted browsing (e.g., bot views a specific match).
 */
export function generateSingleProfileView(
  config: BotBehaviorConfig,
  botUserId: string,
  profileId: string,
  isRevisit: boolean = false,
): BehaviorEvent {
  const { browsing, seed } = config;
  const random = createSeededRandom(Date.now() + seed);

  const isDetailed = random() < browsing.detailedViewProbability;
  const baseDwellTime = isDetailed
    ? browsing.avgProfileViewDurationSec * 2
    : browsing.avgProfileViewDurationSec;

  const dwellTime = clamp(
    Math.round(normalRandom(random, baseDwellTime, browsing.profileViewDurationStdDev)),
    2,
    180,
  );

  return {
    id: generateEventId(),
    botUserId,
    type: 'profile_view',
    timestamp: new Date(),
    data: {
      profileId,
      durationSec: dwellTime,
      isDetailedView: isDetailed,
      isRevisit,
      viewOrder: 1,
    },
  };
}

/**
 * Decide if a bot should browse during its current session.
 * Accounts for session fatigue (less likely to browse late in session).
 *
 * @param minutesIntoSession - How long the bot has been online this session
 * @param sessionDurationExpected - Expected total session duration
 */
export function shouldBrowseNow(
  config: BotBehaviorConfig,
  minutesIntoSession: number,
  sessionDurationExpected: number,
): boolean {
  const random = createSeededRandom(Date.now() + config.seed);

  // Browse probability decreases as session progresses (fatigue curve)
  const sessionProgress = minutesIntoSession / sessionDurationExpected;
  const fatigueFactor = Math.max(0.1, 1 - sessionProgress * 0.7);

  // Base browse probability per minute
  const baseBrowseProbability = 0.4;

  return random() < baseBrowseProbability * fatigueFactor;
}
