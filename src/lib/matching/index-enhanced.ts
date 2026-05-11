/**
 * LokFee! Enhanced Matching Engine — API Integration v2.0
 * 
 * 集成Chyrpe PRD核心概念的API层
 */

import { db } from '@/lib/db'
import { 
  calculateEnhancedMatchScore, 
  findTopEnhancedMatches,
  EnhancedUserProfile,
  EnhancedMatchScore 
} from './enhanced-engine'

/**
 * 为特定用户生成增强版匹配
 */
export async function generateEnhancedMatchesForUser(
  userId: string,
  limit: number = 5,
  matchType: 'WEEKLY' | 'AI_SUGGESTED' | 'MANUAL' = 'WEEKLY',
) {
  // 获取用户Profile
  const userProfile = await db.profile.findUnique({
    where: { userId },
  })

  if (!userProfile) {
    throw new Error('User profile not found')
  }

  if (userProfile.profileStatus !== 'APPROVED') {
    throw new Error('User profile must be approved to receive matches')
  }

  // 获取所有已批准的候选人
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

  // 转换为EnhancedUserProfile格式
  const candidateProfiles: EnhancedUserProfile[] = candidates.map((c) => ({
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
    // 新增字段
    relationshipType: (c as any).relationshipType,
    sexualOrientation: (c as any).sexualOrientation,
  }))

  const userProfileData: EnhancedUserProfile = {
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
    // 新增字段
    relationshipType: (userProfile as any).relationshipType,
    sexualOrientation: (userProfile as any).sexualOrientation,
  }

  // 查找最佳匹配
  const topMatches = findTopEnhancedMatches(
    userProfileData, 
    candidateProfiles, 
    limit
  )

  // 创建匹配记录
  const createdMatches = []
  for (const match of topMatches) {
    // 检查是否已存在匹配
    const existing = await db.match.findFirst({
      where: {
        OR: [
          { senderId: userId, receiverId: match.profile.id },
          { senderId: match.profile.id, receiverId: userId },
        ],
      },
    })

    if (existing) continue

    // 创建新匹配
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
        // 新增维度存储（需要扩展schema）
        // relationshipTypeCompat: match.score.relationshipType,
        // sexualOrientationCompat: match.score.sexualOrientation,
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
 */
export async function generateAllEnhancedWeeklyMatches() {
  const approvedProfiles = await db.profile.findMany({
    where: { profileStatus: 'APPROVED' },
    select: { userId: true },
  })

  const results = []
  for (const profile of approvedProfiles) {
    try {
      const matches = await generateEnhancedMatchesForUser(
        profile.userId, 
        5, 
        'WEEKLY'
      )
      results.push({ 
        userId: profile.userId, 
        matchesCreated: matches.length,
        topScore: matches[0]?.enhancedScore?.finalScore || 0
      })
    } catch (error) {
      console.error(`Failed to generate matches for user ${profile.userId}:`, error)
      results.push({ 
        userId: profile.userId, 
        matchesCreated: 0, 
        error: 'Failed' 
      })
    }
  }

  return results
}

/**
 * 获取匹配的详细兼容性分析
 */
export async function getMatchCompatibilityDetails(
  matchId: string,
  userId: string
) {
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
    relationshipGoal: myProfile.relationshipGoal,
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
    relationshipGoal: otherProfile.relationshipGoal,
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
