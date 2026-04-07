import { db } from '@/lib/db'
import { Gender, MatchStatus, Profile } from "@/generated/client"
import { 
  calculateCompatibilityBreakdown,
  identifyConflictWarnings,
  generateMatchExplanation,
} from './scoring'
import { 
  MatchCompatibilityScores, 
  ConflictWarning, 
  MatchExplanation,
  WeeklyMatch,
  WeeklyDigest,
  MatchCandidate,
  MatchWithProfiles,
} from '@/types'
import { MATCH_CONFIG } from '@/constants'

// ============================================================================
// Core Matching Functions
// ============================================================================

/**
 * Calculate comprehensive compatibility between two profiles
 */
export async function calculateCompatibility(
  profile1Id: string,
  profile2Id: string
): Promise<{
  scores: MatchCompatibilityScores
  explanation: MatchExplanation
  warnings: ConflictWarning[]
}> {
  const [profile1, profile2] = await Promise.all([
    db.profile.findUnique({ where: { userId: profile1Id } }),
    db.profile.findUnique({ where: { userId: profile2Id } }),
  ])

  if (!profile1 || !profile2) {
    throw new Error('One or both profiles not found')
  }

  const scores = calculateCompatibilityBreakdown(profile1, profile2)
  const explanation = generateMatchExplanation(profile1, profile2, scores)
  const warnings = identifyConflictWarnings(profile1, profile2)

  return { scores, explanation, warnings }
}

/**
 * Generate a human-readable explanation for a match
 */
export async function generateMatchExplanationAsync(
  profile1Id: string,
  profile2Id: string,
  scores: MatchCompatibilityScores
): Promise<MatchExplanation> {
  const [profile1, profile2] = await Promise.all([
    db.profile.findUnique({ where: { userId: profile1Id } }),
    db.profile.findUnique({ where: { userId: profile2Id } }),
  ])

  if (!profile1 || !profile2) {
    throw new Error('One or both profiles not found')
  }

  return generateMatchExplanation(profile1, profile2, scores)
}

/**
 * Identify potential conflict warnings between two users
 */
export async function identifyConflictWarningsAsync(
  profile1Id: string,
  profile2Id: string
): Promise<ConflictWarning[]> {
  const [profile1, profile2] = await Promise.all([
    db.profile.findUnique({ where: { userId: profile1Id } }),
    db.profile.findUnique({ where: { userId: profile2Id } }),
  ])

  if (!profile1 || !profile2) {
    throw new Error('One or both profiles not found')
  }

  return identifyConflictWarnings(profile1, profile2)
}

// ============================================================================
// Match Finding & Generation
// ============================================================================

/**
 * Find potential match candidates for a user
 */
export async function findMatchCandidates(
  userId: string,
  options: {
    excludeList?: string[]
    limit?: number
    minScore?: number
  } = {}
): Promise<MatchCandidate[]> {
  const { excludeList = [], limit = 20, minScore = MATCH_CONFIG.minCompatibilityScore } = options

  // Get user's profile and preferences
  const userProfile = await db.profile.findUnique({
    where: { userId },
  })

  if (!userProfile) {
    throw new Error('User profile not found')
  }

  // Get users they've already matched with
  const existingMatches = await db.match.findMany({
    where: {
      OR: [{ senderId: userId }, { receiverId: userId }],
    },
    select: {
      senderId: true,
      receiverId: true,
    },
  })

  const matchedUserIds = existingMatches.map((m: any) => 
    m.senderId === userId ? m.receiverId : m.senderId
  )

  // Build exclusion list
  const excludedIds = [...new Set([userId, ...matchedUserIds, ...excludeList])]

  // Find potential candidates
  const candidates = await db.profile.findMany({
    where: {
      userId: { notIn: excludedIds },
      profileStatus: 'APPROVED',
      // isVisible: true, // field not in schema
      // Basic filters based on user's preferences
      ...(userProfile.preferredGender?.length ? {
        gender: { in: userProfile.preferredGender.split(',') as Gender[] },
      } : {}),
      ...(userProfile.preferredAgeMin || userProfile.preferredAgeMax ? {
        age: {
          ...(userProfile.preferredAgeMin ? { gte: userProfile.preferredAgeMin } : {}),
          ...(userProfile.preferredAgeMax ? { lte: userProfile.preferredAgeMax } : {}),
        },
      } : {}),
    },
    take: limit * 3, // Get more than needed to filter by score
    include: {
      user: {
        select: {
          id: true,
          name: true,
          image: true,
          updatedAt: true,
        },
      },
    },
  })

  // Score and rank candidates
  const scoredCandidates: MatchCandidate[] = []

  for (const candidate of candidates) {
    const scores = calculateCompatibilityBreakdown(userProfile, candidate)
    
    if (scores.overall >= minScore) {
      const explanation = generateMatchExplanation(userProfile, candidate, scores)
      const warnings = identifyConflictWarnings(userProfile, candidate)

      scoredCandidates.push({
        userId: candidate.userId,
        profile: candidate,
        compatibilityScore: scores,
        explanation,
        warnings,
      })
    }
  }

  // Sort by overall score and return top matches
  return scoredCandidates
    .sort((a, b) => b.compatibilityScore.overall - a.compatibilityScore.overall)
    .slice(0, limit)
}

/**
 * Find weekly matches for a user
 */
export async function findWeeklyMatches(
  userId: string,
  excludeList: string[] = []
): Promise<WeeklyMatch[]> {
  // Get user's subscription to determine match limit
  const subscription = await db.subscription.findFirst({
    where: { userId },
  })

  const weeklyLimit = MATCH_CONFIG.weeklyMatches[
    subscription?.plan as keyof typeof MATCH_CONFIG.weeklyMatches
  ] || MATCH_CONFIG.weeklyMatches.FREE

  // Find candidates
  const candidates = await findMatchCandidates(userId, {
    excludeList,
    limit: weeklyLimit,
    minScore: MATCH_CONFIG.minCompatibilityScore,
  })

  // Create matches in database
  const weeklyMatches: WeeklyMatch[] = []

  for (const candidate of candidates) {
    const match = await db.match.create({
      data: {
        senderId: userId,
        receiverId: candidate.userId,
        status: MatchStatus.PENDING,
        matchScore: candidate.compatibilityScore.overall,
        matchReason: JSON.stringify(candidate.explanation),
        conflictWarnings: JSON.stringify(candidate.warnings),
        expiresAt: getMatchExpiryDate(),
      },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            image: true,
            profile: { select: { displayName: true, avatar: true, age: true, city: true } },
          },
        },
        receiver: {
          select: {
            id: true,
            name: true,
            image: true,
            profile: { select: { displayName: true, avatar: true, age: true, city: true } },
          },
        },
      },
    })

    // @ts-ignore - MatchWithProfiles type is stricter than what we need
    weeklyMatches.push({
      match: match as any,
      score: candidate.compatibilityScore,
      explanation: candidate.explanation,
      warnings: candidate.warnings,
    })
  }

  return weeklyMatches
}

/**
 * Generate weekly digest for a user
 */
export async function generateWeeklyDigest(userId: string): Promise<WeeklyDigest> {
  const weekStart = getWeekStartDate()
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 7)

  // Get matches from this week
  const matches = await db.match.findMany({
    where: {
      OR: [{ senderId: userId }, { receiverId: userId }],
      createdAt: {
        gte: weekStart,
        lt: weekEnd,
      },
    },
    include: {
      sender: {
        include: {
          profile: true,
          subscriptions: { select: { plan: true, status: true } },
        },
      },
      receiver: {
        include: {
          profile: true,
          subscriptions: { select: { plan: true, status: true } },
        },
      },
    },
  })

  const weeklyMatches: WeeklyMatch[] = matches.map((match: any) => ({
    match: match as unknown as MatchWithProfiles,
    score: {
      overall: match.matchScore,
      attachment: match.attachmentCompat ?? match.matchScore,
      communication: match.communicationCompat ?? match.matchScore,
      conflict: match.conflictCompat ?? match.matchScore,
      values: match.valuesCompat ?? match.matchScore,
      lifestyle: match.lifestyleCompat ?? match.matchScore,
    },
    explanation: {
      summary: match.matchReason,
      strengths: [],
      considerations: [],
      conversationStarters: [],
    },
    warnings: match.conflictWarnings ? JSON.parse(match.conflictWarnings as string) : [],
  }))

  // Calculate stats
  const scores = weeklyMatches.map((m: any) => m.score.overall)
  const averageScore = scores.length > 0 
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : 0
  const highestScore = scores.length > 0 ? Math.max(...scores) : 0

  return {
    userId,
    weekOf: weekStart,
    matches: weeklyMatches,
    stats: {
      totalMatches: matches.length,
      averageScore,
      highestScore,
    },
  }
}

// ============================================================================
// Match Management
// ============================================================================

/**
 * Accept a match
 */
export async function acceptMatch(matchId: string, userId: string) {
  const match = await db.match.findUnique({
    where: { id: matchId },
  })

  if (!match) {
    throw new Error('Match not found')
  }

  if (match.senderId !== userId && match.receiverId !== userId) {
    throw new Error('Unauthorized')
  }

  // Update the match reaction based on which user accepted
  // @ts-ignore - senderAction/receiverAction fields
  const actionField = match.senderId === userId ? 'senderAction' : 'receiverAction'

  // @ts-ignore
  const existingMatch = await db.match.findUnique({
    where: { id: matchId },
    select: { senderAction: true, receiverAction: true },
  })

  const bothAccepted = match.senderId === userId
    // @ts-ignore
    ? existingMatch?.receiverAction === 'ACCEPTED'
    // @ts-ignore
    : existingMatch?.senderAction === 'ACCEPTED'

  const updateData: Record<string, unknown> = {
    [actionField]: 'ACCEPTED',
  }

  if (bothAccepted) {
    updateData.status = MatchStatus.ACCEPTED
  }

  return db.match.update({
    where: { id: matchId },
    data: updateData,
    include: {
      sender: {
        include: { profile: true },
      },
      receiver: {
        include: { profile: true },
      },
    },
  })
}

/**
 * Decline a match
 */
export async function declineMatch(matchId: string, userId: string, reason?: string) {
  const match = await db.match.findUnique({
    where: { id: matchId },
  })

  if (!match) {
    throw new Error('Match not found')
  }

  if (match.senderId !== userId && match.receiverId !== userId) {
    throw new Error('Unauthorized')
  }

  const actionField = match.senderId === userId ? 'senderAction' : 'receiverAction'
  
  return db.match.update({
    where: { id: matchId },
    data: {
      status: MatchStatus.REJECTED,
      [actionField]: 'DECLINED',
      // @ts-ignore - reviewNotes field
      reviewNotes: reason || 'User declined',
    },
  })
}

/**
 * Expire old pending matches
 */
export async function expireOldMatches(): Promise<number> {
  const expired = await db.match.updateMany({
    where: {
      status: MatchStatus.PENDING,
      expiresAt: { lt: new Date() },
    },
    data: {
      status: MatchStatus.EXPIRED,
    },
  })

  return expired.count
}

/**
 * Get active matches for a user
 */
export async function getActiveMatches(userId: string) {
  return db.match.findMany({
    where: {
      OR: [{ senderId: userId }, { receiverId: userId }],
      status: MatchStatus.ACCEPTED,
    },
    include: {
      sender: {
        include: { profile: true },
      },
      receiver: {
        include: { profile: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * Get pending matches for a user
 */
export async function getPendingMatches(userId: string) {
  return db.match.findMany({
    where: {
      OR: [
        { senderId: userId, senderAction: null },
        { receiverId: userId, receiverAction: null },
      ],
      status: MatchStatus.PENDING,
      expiresAt: { gt: new Date() },
    },
    include: {
      sender: {
        include: { profile: true },
      },
      receiver: {
        include: { profile: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })
}

// ============================================================================
// Helper Functions
// ============================================================================

function getBirthDateForAge(age: number): Date {
  const date = new Date()
  date.setFullYear(date.getFullYear() - age)
  return date
}

function getMatchExpiryDate(): Date {
  const date = new Date()
  date.setDate(date.getDate() + MATCH_CONFIG.matchExpiryDays)
  return date
}

function getWeekStartDate(): Date {
  const now = new Date()
  const dayOfWeek = now.getDay()
  const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1) // Adjust for Monday start
  const monday = new Date(now.setDate(diff))
  monday.setHours(0, 0, 0, 0)
  return monday
}

// ============================================================================
// Batch Operations
// ============================================================================

/**
 * Generate matches for all eligible users
 * This should be run weekly by a cron job
 */
export async function generateMatchesForAllUsers(): Promise<{
  totalUsers: number
  matchesCreated: number
  errors: string[]
}> {
  const errors: string[] = []
  let matchesCreated = 0

  // Get all users with completed onboarding
  const users = await db.user.findMany({
    where: {
      profile: {
        profileStatus: 'APPROVED',
      },
    },
    select: { id: true },
  })

  for (const user of users) {
    try {
      // Check if user already has pending matches this week
      const existingMatches = await db.match.count({
        where: {
          OR: [{ senderId: user.id }, { receiverId: user.id }],
          createdAt: {
            gte: getWeekStartDate(),
          },
        },
      })

      if (existingMatches > 0) {
        continue // Skip users who already have matches this week
      }

      const weeklyMatches = await findWeeklyMatches(user.id)
      matchesCreated += weeklyMatches.length
    } catch (error) {
      errors.push(`Failed to generate matches for user ${user.id}: ${error}`)
    }
  }

  return {
    totalUsers: users.length,
    matchesCreated,
    errors,
  }
}

/**
 * Calculate match success rate
 */
export async function calculateMatchSuccessRate(): Promise<{
  totalMatches: number
  acceptedMatches: number
  declinedMatches: number
  expiredMatches: number
  successRate: number
}> {
  const [
    totalMatches,
    acceptedMatches,
    declinedMatches,
    expiredMatches,
  ] = await Promise.all([
    db.match.count(),
    db.match.count({ where: { status: MatchStatus.ACCEPTED } }),
    db.match.count({ where: { status: MatchStatus.REJECTED } }),
    db.match.count({ where: { status: MatchStatus.EXPIRED } }),
  ])

  const resolvedMatches = acceptedMatches + declinedMatches + expiredMatches
  const successRate = resolvedMatches > 0
    ? Math.round((acceptedMatches / resolvedMatches) * 100)
    : 0

  return {
    totalMatches,
    acceptedMatches,
    declinedMatches,
    expiredMatches,
    successRate,
  }
}
