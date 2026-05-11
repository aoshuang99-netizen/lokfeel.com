/**
 * LokFee! Relationship Structure Matching Engine
 * 
 * Core differentiation: Matches users based on relationship psychology dimensions,
 * NOT surface-level tags or swipe-based selection.
 * 
 * Dimensions:
 * 1. Attachment Style Compatibility (25%)
 * 2. Communication Style Compatibility (20%)
 * 3. Conflict Resolution Compatibility (20%)
 * 4. Values & Life Priorities Compatibility (20%)
 * 5. Lifestyle & Logistics Compatibility (15%)
 */

// ─── Type Definitions ───────────────────────────────────────────────

interface UserProfile {
  id: string;
  attachmentStyle?: string | null;
  communicationStyle?: string | null;
  conflictResolution?: string | null;
  loveLanguage?: string | null;
  lifePriorities?: string | null; // JSON array
  relationshipGoal?: string;
  boundaries?: string | null; // JSON array
  dealbreakers?: string | null; // JSON array
  emotionalAvailability?: string | null;
  preferredAgeMin?: number | null;
  preferredAgeMax?: number | null;
  preferredGender?: string | null;
  preferredDistance?: number | null;
  age: number;
  gender: string;
  city?: string | null;
  country?: string | null;
}

interface MatchScore {
  total: number;
  attachment: number;
  communication: number;
  conflict: number;
  values: number;
  lifestyle: number;
  reason: string;
  conflictWarnings: string[];
}

// ─── Attachment Compatibility Matrix ────────────────────────────────

/**
 * Based on attachment theory research:
 * - Secure + Secure: 95% (highest)
 * - Secure + Anxious: 75% (secure partner stabilizes anxious)
 * - Secure + Avoidant: 70% (secure partner provides safety)
 * - Anxious + Avoidant: 30% (anxious-avoidant trap)
 * - Anxious + Anxious: 50% (mutual anxiety reinforcement)
 * - Avoidant + Avoidant: 35% (mutual avoidance)
 */

const ATTACHMENT_COMPAT: Record<string, Record<string, number>> = {
  'Secure': {
    'Secure': 95,
    'Anxious-Preoccupied': 75,
    'Dismissive-Avoidant': 70,
    'Fearful-Avoidant': 65,
  },
  'Anxious-Preoccupied': {
    'Secure': 75,
    'Anxious-Preoccupied': 50,
    'Dismissive-Avoidant': 30,
    'Fearful-Avoidant': 45,
  },
  'Dismissive-Avoidant': {
    'Secure': 70,
    'Anxious-Preoccupied': 30,
    'Dismissive-Avoidant': 35,
    'Fearful-Avoidant': 55,
  },
  'Fearful-Avoidant': {
    'Secure': 65,
    'Anxious-Preoccupied': 45,
    'Dismissive-Avoidant': 55,
    'Fearful-Avoidant': 40,
  },
};

// ─── Communication Style Compatibility ──────────────────────────────

/**
 * Communication styles and their compatibility:
 * - Direct + Direct: 90% (clear, honest exchange)
 * - Direct + Reflective: 80% (complementary)
 * - Direct + Expressive: 70% (sometimes intense)
 * - Direct + Analytical: 75% (logic + directness)
 * - Reflective + Expressive: 85% (emotional depth)
 * - Reflective + Analytical: 65% (different pace)
 * - Expressive + Analytical: 55% (frustration potential)
 * - Same style bonus: +5%
 */

const COMM_COMPAT: Record<string, Record<string, number>> = {
  'Direct': { 'Direct': 90, 'Reflective': 80, 'Expressive': 70, 'Analytical': 75 },
  'Reflective': { 'Direct': 80, 'Reflective': 85, 'Expressive': 85, 'Analytical': 65 },
  'Expressive': { 'Direct': 70, 'Reflective': 85, 'Expressive': 80, 'Analytical': 55 },
  'Analytical': { 'Direct': 75, 'Reflective': 65, 'Expressive': 55, 'Analytical': 80 },
};

// ─── Conflict Resolution Compatibility ──────────────────────────────

/**
 * Conflict styles and their compatibility:
 * - Collaborative + Collaborative: 95% (ideal)
 * - Collaborative + any: 80%+ (collaborative lifts others)
 * - Compromising + Compromising: 80%
 * - Accommodating + Competing: 25% (danger zone)
 * - Avoiding + Avoiding: 20% (nothing gets resolved)
 */

const CONFLICT_COMPAT: Record<string, Record<string, number>> = {
  'Collaborative': {
    'Collaborative': 95,
    'Compromising': 82,
    'Accommodating': 78,
    'Competing': 60,
    'Avoiding': 50,
  },
  'Compromising': {
    'Collaborative': 82,
    'Compromising': 80,
    'Accommodating': 72,
    'Competing': 55,
    'Avoiding': 45,
  },
  'Accommodating': {
    'Collaborative': 78,
    'Compromising': 72,
    'Accommodating': 65,
    'Competing': 25,
    'Avoiding': 50,
  },
  'Competing': {
    'Collaborative': 60,
    'Compromising': 55,
    'Accommodating': 25,
    'Competing': 35,
    'Avoiding': 40,
  },
  'Avoiding': {
    'Collaborative': 50,
    'Compromising': 45,
    'Accommodating': 50,
    'Competing': 40,
    'Avoiding': 20,
  },
};

// ─── Love Language Compatibility ─────────────────────────────────────

const LOVE_LANGUAGES = [
  'Words of Affirmation',
  'Quality Time',
  'Physical Touch',
  'Acts of Service',
  'Gifts',
];

/**
 * Same love language: 85% (immediate understanding)
 * Adjacent love languages: 70% (compatible expression)
 * Different love languages: 55% (learning opportunity)
 */

const LOVE_LANG_ADJACENT: Record<string, string[]> = {
  'Words of Affirmation': ['Quality Time'],
  'Quality Time': ['Words of Affirmation', 'Physical Touch'],
  'Physical Touch': ['Quality Time', 'Acts of Service'],
  'Acts of Service': ['Physical Touch', 'Gifts'],
  'Gifts': ['Acts of Service'],
};

// ─── Emotional Availability Scale ───────────────────────────────────

const EMOTIONAL_AVAIL_SCALE: Record<string, number> = {
  'Fully Available': 100,
  'Building Trust': 65,
  'Processing Past': 40,
  'Needs Space': 25,
};

// ─── Core Scoring Functions ─────────────────────────────────────────

function scoreAttachmentStyle(a: string | null | undefined, b: string | null | undefined): { score: number; warnings: string[] } {
  const warnings: string[] = [];

  if (!a || !b) return { score: 50, warnings }; // No data = neutral

  const score = ATTACHMENT_COMPAT[a]?.[b] || ATTACHMENT_COMPAT[b]?.[a] || 50;

  if (score < 40) {
    warnings.push(`Potential attachment dynamic: ${a} + ${b} may create push-pull patterns. Awareness is key.`);
  }

  return { score, warnings };
}

function scoreCommunication(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b) return 50;
  return COMM_COMPAT[a]?.[b] || COMM_COMPAT[b]?.[a] || 50;
}

function scoreConflictResolution(a: string | null | undefined, b: string | null | undefined): { score: number; warnings: string[] } {
  const warnings: string[] = [];

  if (!a || !b) return { score: 50, warnings };

  const score = CONFLICT_COMPAT[a]?.[b] || CONFLICT_COMPAT[b]?.[a] || 50;

  if (score < 35) {
    warnings.push(`Conflict style mismatch: ${a} + ${b} may lead to unresolved tensions.`);
  }

  return { score, warnings };
}

function scoreLoveLanguages(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b) return 50;
  if (a === b) return 85;
  if (LOVE_LANG_ADJACENT[a]?.includes(b) || LOVE_LANG_ADJACENT[b]?.includes(a)) return 70;
  return 55;
}

function scoreLifePriorities(aStr: string | null | undefined, bStr: string | null | undefined): number {
  if (!aStr || !bStr) return 50;

  try {
    const a: string[] = JSON.parse(aStr);
    const b: string[] = JSON.parse(bStr);

    if (a.length === 0 || b.length === 0) return 50;

    // Count shared priorities
    const shared = a.filter((p) => b.includes(p));
    const overlap = shared.length / Math.max(a.length, b.length);

    return Math.round(50 + overlap * 50); // 50-100 range
  } catch {
    return 50;
  }
}

function scoreDealbreakers(userBreakers: string | null | undefined, otherProfile: UserProfile): { score: number; warnings: string[] } {
  const warnings: string[] = [];

  if (!userBreakers) return { score: 100, warnings };

  try {
    const breakers: string[] = JSON.parse(userBreakers);

    if (breakers.length === 0) return { score: 100, warnings };

    // Simple dealbreaker checking based on known patterns
    let violations = 0;
    const otherTraits: string[] = [
      otherProfile.attachmentStyle || '',
      otherProfile.communicationStyle || '',
      otherProfile.conflictResolution || '',
      otherProfile.emotionalAvailability || '',
      ...(otherProfile.lifePriorities ? JSON.parse(otherProfile.lifePriorities) : []),
    ].filter(Boolean);

    for (const breaker of breakers) {
      const breakerLower = breaker.toLowerCase();
      // Check if breaker is a negation pattern (e.g., "Not looking for casual")
      if (breakerLower.startsWith('not ') || breakerLower.startsWith("don't") || breakerLower.startsWith("no ")) {
        // Check if other user might violate this
        if (otherProfile.relationshipGoal === 'CASUAL_DATING' || otherProfile.emotionalAvailability === 'Needs Space') {
          violations++;
        }
      } else {
        // Positive requirement
        const matches = otherTraits.some((t) =>
          t.toLowerCase().includes(breakerLower) || breakerLower.includes(t.toLowerCase())
        );
        if (!matches) violations++;
      }
    }

    const score = Math.max(0, Math.round(100 - (violations / breakers.length) * 80));

    if (violations > 0) {
      warnings.push(`Potential dealbreaker(s) detected. Review the other person's profile carefully.`);
    }

    return { score, warnings };
  } catch {
    return { score: 100, warnings };
  }
}

function scoreLifestyle(userA: UserProfile, userB: UserProfile): number {
  let score = 50;

  // Age preference check
  if (userA.preferredAgeMin && userB.age < userA.preferredAgeMin) score -= 20;
  if (userA.preferredAgeMax && userB.age > userA.preferredAgeMax) score -= 20;
  if (userB.preferredAgeMin && userA.age < userB.preferredAgeMin) score -= 20;
  if (userB.preferredAgeMax && userA.age > userB.preferredAgeMax) score -= 20;

  // Gender preference check (case-insensitive)
  if (userA.preferredGender) {
    const pref = userA.preferredGender.toUpperCase();
    if (pref !== 'ANY' && pref !== 'EVERYONE' && userB.gender && pref !== userB.gender.toUpperCase()) {
      score -= 30;
    }
  }

  // Same country bonus
  if (userA.country && userB.country && userA.country === userB.country) {
    score += 10;
  }

  // Same city bonus
  if (userA.city && userB.city && userA.city === userB.city) {
    score += 15;
  }

  // Relationship goal alignment
  if (userA.relationshipGoal && userB.relationshipGoal) {
    if (userA.relationshipGoal === userB.relationshipGoal) score += 15;
    else if (userA.relationshipGoal === 'CASUAL_DATING' || userB.relationshipGoal === 'CASUAL_DATING') score -= 5;
    else score += 5;
  }

  return Math.max(0, Math.min(100, score));
}

// ─── Main Matching Function ─────────────────────────────────────────

/**
 * Calculate compatibility score between two user profiles.
 * Returns detailed breakdown and match explanation.
 */
export function calculateMatchScore(userA: UserProfile, userB: UserProfile): MatchScore {
  const allWarnings: string[] = [];

  // 1. Attachment Style (25%)
  const attachment = scoreAttachmentStyle(userA.attachmentStyle, userB.attachmentStyle);
  allWarnings.push(...attachment.warnings);

  // 2. Communication Style (20%)
  const communication = scoreCommunication(userA.communicationStyle, userB.communicationStyle);

  // 3. Conflict Resolution (20%)
  const conflict = scoreConflictResolution(userA.conflictResolution, userB.conflictResolution);
  allWarnings.push(...conflict.warnings);

  // 4. Values & Life Priorities (20%) — average of priorities + love languages
  const lifePriorities = scoreLifePriorities(userA.lifePriorities, userB.lifePriorities);
  const loveLanguages = scoreLoveLanguages(userA.loveLanguage, userB.loveLanguage);
  const values = Math.round((lifePriorities + loveLanguages) / 2);

  // 5. Lifestyle (15%) — logistics + goals
  const lifestyle = scoreLifestyle(userA, userB);

  // Dealbreaker check (can override)
  const dealbreakerCheckA = scoreDealbreakers(userA.dealbreakers, userB);
  const dealbreakerCheckB = scoreDealbreakers(userB.dealbreakers, userA);
  allWarnings.push(...dealbreakerCheckA.warnings, ...dealbreakerCheckB.warnings);

  // Weighted total
  const total = Math.round(
    attachment.score * 0.25 +
    communication * 0.20 +
    conflict.score * 0.20 +
    values * 0.20 +
    lifestyle * 0.15
  );

  // Apply dealbreaker penalty
  const dealbreakerPenalty = Math.min(dealbreakerCheckA.score, dealbreakerCheckB.score) / 100;
  const finalScore = Math.max(0, Math.min(100, Math.round(total * dealbreakerPenalty)));

  // Generate human-readable explanation
  const reason = generateMatchReason(userA, userB, attachment.score, communication, conflict.score, values, lifestyle);

  return {
    total: finalScore,
    attachment: attachment.score,
    communication,
    conflict: conflict.score,
    values,
    lifestyle,
    reason,
    conflictWarnings: [...new Set(allWarnings)],
  };
}

// ─── Match Reason Generation ────────────────────────────────────────

function generateMatchReason(
  a: UserProfile,
  b: UserProfile,
  attachScore: number,
  commScore: number,
  conflictScore: number,
  valuesScore: number,
  lifestyleScore: number,
): string {
  const reasons: string[] = [];

  if (attachScore >= 80) {
    reasons.push('Your attachment styles align well, creating a foundation of emotional safety');
  } else if (attachScore >= 60) {
    reasons.push('Complementary attachment patterns that can support mutual growth');
  } else if (attachScore < 40) {
    reasons.push('Different attachment styles — awareness and communication will be key');
  }

  if (commScore >= 80) {
    reasons.push('You communicate in compatible ways, which supports honest dialogue');
  } else if (commScore < 60) {
    reasons.push('Different communication styles may require patience and adaptation');
  }

  if (conflictScore >= 80) {
    reasons.push('Your conflict resolution approaches complement each other');
  } else if (conflictScore < 40) {
    reasons.push('Consider discussing conflict resolution early — different styles may cause friction');
  }

  if (valuesScore >= 80) {
    reasons.push('Shared values and life priorities point to aligned long-term goals');
  }

  if (lifestyleScore >= 80) {
    reasons.push('Similar lifestyle preferences and relationship goals');
  }

  if (a.relationshipGoal === b.relationshipGoal && a.relationshipGoal === 'MONOGAMY') {
    reasons.push('Both seeking a long-term committed relationship');
  }

  if (reasons.length === 0) {
    reasons.push('You have a baseline compatibility worth exploring');
  }

  return reasons.slice(0, 3).join('. ') + '.';
}

// ─── Batch Matching ─────────────────────────────────────────────────

/**
 * Find top N matches for a user from a pool of candidates.
 * Filters by basic preferences, then ranks by compatibility score.
 */
export function findTopMatches(
  user: UserProfile,
  candidates: UserProfile[],
  limit: number = 5,
): Array<{ profile: UserProfile; score: MatchScore }> {
  const scored = candidates
    .filter((candidate) => {
      // Skip self
      if (candidate.id === user.id) return false;

      // Basic preference filtering
      if (user.preferredAgeMin && candidate.age < user.preferredAgeMin) return false;
      if (user.preferredAgeMax && candidate.age > user.preferredAgeMax) return false;

      return true;
    })
    .map((candidate) => ({
      profile: candidate,
      score: calculateMatchScore(user, candidate),
    }))
    .sort((a, b) => b.score.total - a.score.total);

  return scored.slice(0, limit);
}

export type { UserProfile, MatchScore };
