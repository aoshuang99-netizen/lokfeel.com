/**
 * LokFeel Matching Engine — API Integration
 * 
 * This module provides the API layer for the matching engine.
 * It handles:
 * - Weekly match generation (cron/scheduled)
 * - On-demand match generation (admin trigger)
 * - Match querying
 */

import { db } from '@/lib/db'
import { calculateMatchScore, findTopMatches } from './engine'
import type { UserProfile } from './engine'

/**
 * Generate weekly matches for a specific user.
 * Called by the weekly cron job or manually by admin.
 */
export async function generateMatchesForUser(
  userId: string,
  limit: number = 5,
  matchType: 'WEEKLY' | 'AI_SUGGESTED' | 'MANUAL' = 'WEEKLY',
) {
  // Get user's profile
  const userProfile = await db.profile.findUnique({
    where: { userId },
  })

  if (!userProfile) {
    throw new Error('User profile not found')
  }

  if (userProfile.profileStatus !== 'APPROVED') {
    throw new Error('User profile must be approved to receive matches')
  }

  // Get all approved profiles (potential candidates)
  const candidates = await db.profile.findMany({
    where: {
      userId: { not: userId },
      profileStatus: 'APPROVED',
    },
    include: {
      user: {
        select: { id: true, name: true, email: true, image: true, role: true },
      },
    },
  })

  if (candidates.length === 0) {
    return []
  }

  // Convert to UserProfile format
  const candidateProfiles: UserProfile[] = candidates.map((c) => ({
    id: c.userId,
    attachmentStyle: c.attachmentStyle,
    communicationStyle: c.communicationStyle,
    conflictResolution: c.conflictResolution,
    loveLanguage: c.loveLanguage,
    lifePriorities: c.lifePriorities,
    relationshipGoal: c.relationshipGoal,
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
  }))

  const userProfileData: UserProfile = {
    id: userId,
    attachmentStyle: userProfile.attachmentStyle,
    communicationStyle: userProfile.communicationStyle,
    conflictResolution: userProfile.conflictResolution,
    loveLanguage: userProfile.loveLanguage,
    lifePriorities: userProfile.lifePriorities,
    relationshipGoal: userProfile.relationshipGoal,
    boundaries: userProfile.boundaries,
    dealbreakers: userProfile.dealbreakers,
    emotionalAvailability: userProfile.emotionalAvailability,
    preferredAgeMin: userProfile.preferredAgeMin,
    preferredAgeMax: userProfile.preferredAgeMax,
    preferredGender: userProfile.preferredGender,
    preferredDistance: userProfile.preferredDistance,
    age: userProfile.age,
    gender: userProfile.gender,
    city: userProfile.city,
    country: userProfile.country,
  }

  // Find top matches
  const topMatches = findTopMatches(userProfileData, candidateProfiles, limit)

  // Create match records in database
  const createdMatches = []
  for (const match of topMatches) {
    // Check if match already exists
    const existing = await db.match.findFirst({
      where: {
        OR: [
          { senderId: userId, receiverId: match.profile.id },
          { senderId: match.profile.id, receiverId: userId },
        ],
      },
    })

    if (existing) continue

    // Create new match
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
 */
export async function generateAllWeeklyMatches() {
  const approvedProfiles = await db.profile.findMany({
    where: { profileStatus: 'APPROVED' },
    select: { userId: true },
  })

  const results = []
  for (const profile of approvedProfiles) {
    try {
      const matches = await generateMatchesForUser(profile.userId, 5, 'WEEKLY')
      results.push({ userId: profile.userId, matchesCreated: matches.length })
    } catch (error) {
      console.error(`Failed to generate matches for user ${profile.userId}:`, error)
      results.push({ userId: profile.userId, matchesCreated: 0, error: 'Failed' })
    }
  }

  return results
}
