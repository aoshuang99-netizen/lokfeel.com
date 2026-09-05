/**
 * LokFee! Enhanced Matching Engine — API Integration v2.0
 *
 * 集成Chyrpe PRD核心概念的API层
 *
 * Performance notes (audit round 7): same optimizations as index-base —
 * `select` instead of full-row + dead `user` include, age preference pushed
 * into the DB `where`, batched existing-match lookup, and a one-shot profile
 * fetch for the batch generator (was O(N²)).
 */

import { db } from '@/lib/db'
import {
  calculateEnhancedMatchScore,
  findTopEnhancedMatches,
  EnhancedUserProfile,
  EnhancedMatchScore,
} from './enhanced-engine'

// Columns needed by the enhanced scorer. NOTE: `relationshipType` /
// `sexualOrientation` are NOT schema columns (legacy `(c as any)` reads),
// so they are intentionally omitted from the select.
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

function toEnhancedUserProfile(c: ProfileCandidate): EnhancedUserProfile {
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
    // 新增字段（非 schema 列，保持与旧行为一致：undefined）
    relationshipType: (c as any).relationshipType,
    sexualOrientation: (c as any).sexualOrientation,
  }
}

/**
 * 为特定用户生成增强版匹配
 */
export async function generateEnhancedMatchesForUser(
  userId: string,
  limit: number = 5,
  matchType: 'WEEKLY' | 'AI_SUGGESTED' | 'MANUAL' = 'WEEKLY',
  preloadedCandidates?: EnhancedUserProfile[],
  preloadedSelf?: EnhancedUserProfile,
) {
  // 获取用户Profile（或复用批处理预加载）
  let userProfileData: EnhancedUserProfile
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
    userProfileData = toEnhancedUserProfile(userProfile)
  }

  // 获取候选人（或复用批处理预加载池）
  const candidateProfiles =
    preloadedCandidates ??
    (
      await db.profile.findMany({
        where: {
          userId: { not: userId },
          profileStatus: 'APPROVED',
          ...(userProfileData.preferredAgeMin != null
            ? { age: { gte: userProfileData.preferredAgeMin } }
            : {}),
          ...(userProfileData.preferredAgeMax != null
            ? { age: { lte: userProfileData.preferredAgeMax } }
            : {}),
        },
        select: CANDIDATE_SELECT,
      })
    ).map(toEnhancedUserProfile)

  if (candidateProfiles.length === 0) {
    return []
  }

  // 查找最佳匹配
  const topMatches = findTopEnhancedMatches(userProfileData, candidateProfiles, limit)

  // 批量查已存在匹配（替代逐候选人 findFirst）
  const existingRows = await db.match.findMany({
    where: {
      OR: [{ senderId: userId }, { receiverId: userId }],
    },
    select: { senderId: true, receiverId: true },
  })
  const existingKeys = new Set(
    existingRows.map((m) => [m.senderId, m.receiverId].sort().join('|')),
  )

  // 创建匹配记录
  const createdMatches = []
  for (const match of topMatches) {
    const key = [userId, match.profile.id].sort().join('|')
    if (existingKeys.has(key)) continue

    const newMatch = await db.match.create({
      data: {
        senderId: userId,
        receiverId: match.profile.id,
        matchScore: match.score.finalScore,
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
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7天
      },
    })

    createdMatches.push({
      ...newMatch,
      enhancedScore: match.score,
    })
  }

  return createdMatches
}

/**
 * 为所有已批准用户生成增强版匹配（批量操作）
 *
 * 一次性获取所有已批准 profile 并复用（原先每个用户都全表扫描一次 → O(N²)）。
 */
export async function generateAllEnhancedWeeklyMatches() {
  const approvedProfiles = await db.profile.findMany({
    where: { profileStatus: 'APPROVED' },
    select: CANDIDATE_SELECT,
  })

  const results = []
  for (const profile of approvedProfiles) {
    try {
      const selfProfile = toEnhancedUserProfile(profile)
      const candidateProfiles = approvedProfiles
        .filter((p) => p.userId !== profile.userId)
        .map(toEnhancedUserProfile)

      const matches = await generateEnhancedMatchesForUser(
        profile.userId,
        5,
        'WEEKLY',
        candidateProfiles,
        selfProfile,
      )
      results.push({
        userId: profile.userId,
        matchesCreated: matches.length,
        topScore: matches[0]?.enhancedScore?.finalScore || 0,
      })
    } catch (error) {
      console.error(`Failed to generate matches for user ${profile.userId}:`, error)
      results.push({
        userId: profile.userId,
        matchesCreated: 0,
        error: 'Failed',
      })
    }
  }

  return results
}

/**
 * 获取匹配的详细兼容性分析
 */
export async function getMatchCompatibilityDetails(matchId: string, userId: string) {
  const match = await db.match.findUnique({
    where: { id: matchId },
    include: {
      sender: { include: { profile: true } },
      receiver: { include: { profile: true } },
    },
  })

  if (!match) {
    throw new Error('Match not found')
  }

  // 验证用户是匹配的参与者
  if (match.senderId !== userId && match.receiverId !== userId) {
    throw new Error('Unauthorized')
  }

  const otherUser = match.senderId === userId ? match.receiver : match.sender
  const myProfile = match.senderId === userId ? match.sender.profile : match.receiver.profile
  const otherProfile = otherUser.profile

  if (!myProfile || !otherProfile) {
    throw new Error('Profile not found')
  }

  // 构建EnhancedUserProfile
  const myEnhancedProfile: EnhancedUserProfile = {
    id: userId,
    attachmentStyle: myProfile.attachmentStyle,
    communicationStyle: myProfile.communicationStyle,
    conflictResolution: myProfile.conflictResolution,
    loveLanguage: myProfile.loveLanguage,
    lifePriorities: myProfile.lifePriorities,
    relationshipGoal: myProfile.relationshipGoal ?? undefined,
    boundaries: myProfile.boundaries,
    dealbreakers: myProfile.dealbreakers,
    emotionalAvailability: myProfile.emotionalAvailability,
    preferredAgeMin: myProfile.preferredAgeMin,
    preferredAgeMax: myProfile.preferredAgeMax,
    preferredGender: myProfile.preferredGender,
    preferredDistance: myProfile.preferredDistance,
    age: myProfile.age,
    gender: myProfile.gender,
    city: myProfile.city,
    country: myProfile.country,
    relationshipType: (myProfile as any).relationshipType,
    sexualOrientation: (myProfile as any).sexualOrientation,
  }

  const otherEnhancedProfile: EnhancedUserProfile = {
    id: otherUser.id,
    attachmentStyle: otherProfile.attachmentStyle,
    communicationStyle: otherProfile.communicationStyle,
    conflictResolution: otherProfile.conflictResolution,
    loveLanguage: otherProfile.loveLanguage,
    lifePriorities: otherProfile.lifePriorities,
    relationshipGoal: otherProfile.relationshipGoal ?? undefined,
    boundaries: otherProfile.boundaries,
    dealbreakers: otherProfile.dealbreakers,
    emotionalAvailability: otherProfile.emotionalAvailability,
    preferredAgeMin: otherProfile.preferredAgeMin,
    preferredAgeMax: otherProfile.preferredAgeMax,
    preferredGender: otherProfile.preferredGender,
    preferredDistance: otherProfile.preferredDistance,
    age: otherProfile.age,
    gender: otherProfile.gender,
    city: otherProfile.city,
    country: otherProfile.country,
    relationshipType: (otherProfile as any).relationshipType,
    sexualOrientation: (otherProfile as any).sexualOrientation,
  }

  // 计算增强版分数
  const enhancedScore = calculateEnhancedMatchScore({
    userA: myEnhancedProfile,
    userB: otherEnhancedProfile,
  })

  return {
    matchId: match.id,
    otherUser: {
      id: otherUser.id,
      name: otherProfile.displayName || otherUser.name,
      avatar: otherProfile.avatar || otherUser.image,
    },
    compatibility: {
      overall: enhancedScore.finalScore,
      breakdown: {
        attachment: enhancedScore.attachment,
        communication: enhancedScore.communication,
        conflict: enhancedScore.conflict,
        values: enhancedScore.values,
        lifestyle: enhancedScore.lifestyle,
        relationshipType: enhancedScore.relationshipType,
        sexualOrientation: enhancedScore.sexualOrientation,
        powerBoard: enhancedScore.powerBoardCompat,
      },
    },
    explanation: enhancedScore.reason,
    warnings: enhancedScore.conflictWarnings,
    learningAdjustments: enhancedScore.learningAdjustments,
  }
}
