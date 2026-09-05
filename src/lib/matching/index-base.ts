/**
 * LokFee! Matching Engine — API Integration (Base Version)
 *
 * This module provides the API layer for the base matching engine.
 * It handles:
 * - Weekly match generation (cron/scheduled)
 * - On-demand match generation (admin trigger)
 * - Match querying
 *
 * Performance notes (audit round 7):
 * - Candidate fetch now uses `select` (only the ~18 columns the scorer needs)
 *   instead of loading the full profile row + a dead `user` include.
 * - The user's own age preference is pushed into the DB `where` (equivalent to
 *   the in-JS filter in `findTopMatches`), shrinking the candidate pool early.
 * - The per-candidate "does a match already exist?" check is batched into a
 *   single `findMany` instead of one `findFirst` per candidate.
 * - `generateAllWeeklyMatches` fetches all approved profiles ONCE and passes
 *   them as `preloadedCandidates`/`preloadedSelf`, removing the previous
 *   O(N²) profile fetches (one full-table scan per user).
 */

import { db } from '@/lib/db'
import { calculateMatchScore, findTopMatches } from './engine'
import type { UserProfile } from './engine'

// Columns needed by the matching scorer (avoid over-fetching full profile rows)
const CANDIDATE_SELECT = {
  userId: true,
  attachmentStyle: true,
  communicationStyle: true,
  conflictResolution: true,
  loveLanguage: true,
  lifePriorities: true,
  relationshipGoal: true,
  boundaries: true,
  dealbreakers: true,
  emotionalAvailability: true,
  preferredAgeMin: true,
  preferredAgeMax: true,
  preferredGender: true,
  preferredDistance: true,
  age: true,
  gender: true,
  city: true,
  country: true,
} as const

type ProfileCandidate = Awaited<
  ReturnType<typeof db.profile.findMany<{ select: typeof CANDIDATE_SELECT }>>
>[number]

function toUserProfile(c: ProfileCandidate): UserProfile {
  return {
    id: c.userId,
    attachmentStyle: c.attachmentStyle,
    communicationStyle: c.communicationStyle,
    conflictResolution: c.conflictResolution,
    loveLanguage: c.loveLanguage,
    lifePriorities: c.lifePriorities,
    relationshipGoal: c.relationshipGoal ?? undefined,
    boundaries: c.boundaries,
    dealbreakers: c.dealbreakers,
    emotionalAvailability: c.emotionalAvailability,
    preferredAgeMin: c.preferredAgeMin,
    preferredAgeMax: c.preferredAgeMax,
    preferredGender: c.preferredGender,
    preferredDistance: c.preferredDistance,
    age: c.age,
    gender: c.gender,
    city: c.city,
    country: c.country,
  }
}

/**
 * Generate weekly matches for a specific user.
 * Called by the weekly cron job or manually by admin.
 */
export async function generateMatchesForUser(
  userId: string,
  limit: number = 5,
  matchType: 'WEEKLY' | 'AI_SUGGESTED' | 'MANUAL' = 'WEEKLY',
  preloadedCandidates?: UserProfile[],
  preloadedSelf?: UserProfile,
) {
  // Get user's profile (or reuse the preloaded self in batch mode)
  let userProfileData: UserProfile
  if (preloadedSelf) {
    userProfileData = preloadedSelf
  } else {
    const userProfile = await db.profile.findUnique({
      where: { userId },
    })
    if (!userProfile) {
      throw new Error('User profile not found')
    }
    if (userProfile.profileStatus !== 'APPROVED') {
      throw new Error('User profile must be approved to receive matches')
    }
    userProfileData = toUserProfile(userProfile)
  }

  // Get candidate profiles (or reuse the preloaded pool from batch mode)
  const candidateProfiles =
    preloadedCandidates ??
    (
      await db.profile.findMany({
        where: {
          userId: { not: userId },
          profileStatus: 'APPROVED',
          // Push the user's age preference into SQL (equivalent to the
          // in-JS filter in findTopMatches) to shrink the pool early.
          ...(userProfileData.preferredAgeMin != null
            ? { age: { gte: userProfileData.preferredAgeMin } }
            : {}),
          ...(userProfileData.preferredAgeMax != null
            ? { age: { lte: userProfileData.preferredAgeMax } }
            : {}),
        },
        select: CANDIDATE_SELECT,
      })
    ).map(toUserProfile)

  if (candidateProfiles.length === 0) {
    return []
  }

  // Find top matches
  const topMatches = findTopMatches(userProfileData, candidateProfiles, limit)

  // Batch the "does this match already exist?" check into one query instead of
  // one findFirst per candidate.
  const existingRows = await db.match.findMany({
    where: {
      OR: [{ senderId: userId }, { receiverId: userId }],
    },
    select: { senderId: true, receiverId: true },
  })
  const existingKeys = new Set(
    existingRows.map((m) => [m.senderId, m.receiverId].sort().join('|')),
  )

  // Create match records in database
  const createdMatches = []
  for (const match of topMatches) {
    const key = [userId, match.profile.id].sort().join('|')
    if (existingKeys.has(key)) continue

    const newMatch = await db.match.create({
      data: {
        senderId: userId,
        receiverId: match.profile.id,
        matchScore: match.score.total,
        matchReason: match.score.reason,
        conflictWarnings: match.score.conflictWarnings.length > 0
          ? JSON.stringify(match.score.conflictWarnings)
          : null,
        attachmentCompat: match.score.attachment,
        communicationCompat: match.score.communication,
        conflictCompat: match.score.conflict,
        valuesCompat: match.score.values,
        lifestyleCompat: match.score.lifestyle,
        matchType,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    })

    createdMatches.push(newMatch)
  }

  return createdMatches
}

/**
 * Generate matches for ALL approved users (batch operation for cron).
 *
 * Fetches all approved profiles once and reuses them across users — previously
 * this re-ran a full-table profile scan per user (O(N²) DB work).
 */
export async function generateAllWeeklyMatches() {
  const approvedProfiles = await db.profile.findMany({
    where: { profileStatus: 'APPROVED' },
    select: CANDIDATE_SELECT,
  })

  const results = []
  for (const profile of approvedProfiles) {
    try {
      const selfProfile = toUserProfile(profile)
      const candidateProfiles = approvedProfiles
        .filter((p) => p.userId !== profile.userId)
        .map(toUserProfile)

      const matches = await generateMatchesForUser(
        profile.userId,
        5,
        'WEEKLY',
        candidateProfiles,
        selfProfile,
      )
      results.push({ userId: profile.userId, matchesCreated: matches.length })
    } catch (error) {
      console.error(`Failed to generate matches for user ${profile.userId}:`, error)
      results.push({ userId: profile.userId, matchesCreated: 0, error: 'Failed' })
    }
  }

  return results
}
