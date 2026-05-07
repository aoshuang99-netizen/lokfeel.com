/**
 * LokFeel Enhanced Matching Engine v2.0
 * 
 * 结合Chyrpe PRD核心概念与现有匹配引擎的增强版本
 * 
 * 核心增强：
 * 1. 关系类型匹配维度 (Relationship Type Compatibility)
 * 2. 性取向匹配维度 (Sexual Orientation Compatibility)
 * 3. Power Board规则引擎集成 (边界设置匹配)
 * 4. 群体智慧增强 (Collective Intelligence)
 * 5. 季节性偏好调整 (Seasonal Adjustment)
 * 
 * 权重分配：
 * - Attachment Style: 20% (from 25%)
 * - Communication Style: 15% (from 20%)
 * - Conflict Resolution: 15% (from 20%)
 * - Values & Priorities: 15% (from 20%)
 * - Lifestyle: 10% (from 15%)
 * - Relationship Type: 15% (NEW)
 * - Sexual Orientation: 10% (NEW)
 */

import { calculateMatchScore as baseCalculateMatchScore, UserProfile as BaseUserProfile, MatchScore as BaseMatchScore } from './engine'

// ═══════════════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════

export interface EnhancedUserProfile extends BaseUserProfile {
  // 新增：关系类型
  relationshipType?: string | null  // "MONOGAMY", "ETHICAL_NON_MONOGAMY", "POLYAMORY", "KINK_BDSM", "CASUAL_DATING", "FRIENDSHIP_FIRST"
  // 新增：性取向
  sexualOrientation?: string | null // "STRAIGHT", "GAY", "LESBIAN", "BISEXUAL", "PANSEXUAL", "QUEER", "ASEXUAL", "DEMISEXUAL", "QUESTIONING"
  // Power Board设置
  powerBoardSettings?: PowerBoardSettings | null
}

export interface PowerBoardSettings {
  // 内容过滤设置
  contentFilter: {
    enabled: boolean
    strictness: 'none' | 'low' | 'medium' | 'high'
    blacklistTerms: string[]
  }
  // 节奏控制
  paceControl: {
    enabled: boolean
    maxDailyMessages: number
    responseWindowHours: number
  }
  // 媒体权限
  mediaPermissions: {
    text: boolean
    image: boolean
    voice: boolean
    video: boolean
  }
  // 同意门控
  consentGate: {
    enabled: boolean
    triggerKeywords: string[]
  }
}

export interface EnhancedMatchScore extends BaseMatchScore {
  // 新增维度分数
  relationshipType: number
  sexualOrientation: number
  // Power Board兼容性
  powerBoardCompat: number
  // 学习系统调整
  learningAdjustments?: {
    botPreferenceBoost: number
    collaborativeFilterBoost: number
    collectiveIntelBoost: number
    seasonalBoost: number
  }
  // 最终分数
  finalScore: number
}

// ═══════════════════════════════════════════════════════════════
// RELATIONSHIP TYPE COMPATIBILITY MATRIX
// ═══════════════════════════════════════════════════════════════

/**
 * 关系类型兼容性矩阵
 * 
 * 设计理念：
 * - 相同类型 = 高兼容性 (90-95%)
 * - 互补类型 = 中等兼容性 (60-80%)
 * - 冲突类型 = 低兼容性 (20-40%)
 */
const RELATIONSHIP_TYPE_COMPAT: Record<string, Record<string, number>> = {
  'MONOGAMY': {
    'MONOGAMY': 95,
    'ETHICAL_NON_MONOGAMY': 30,
    'POLYAMORY': 20,
    'KINK_BDSM': 60,
    'CASUAL_DATING': 40,
    'FRIENDSHIP_FIRST': 70,
  },
  'ETHICAL_NON_MONOGAMY': {
    'MONOGAMY': 30,
    'ETHICAL_NON_MONOGAMY': 90,
    'POLYAMORY': 85,
    'KINK_BDSM': 75,
    'CASUAL_DATING': 70,
    'FRIENDSHIP_FIRST': 65,
  },
  'POLYAMORY': {
    'MONOGAMY': 20,
    'ETHICAL_NON_MONOGAMY': 85,
    'POLYAMORY': 95,
    'KINK_BDSM': 70,
    'CASUAL_DATING': 65,
    'FRIENDSHIP_FIRST': 60,
  },
  'KINK_BDSM': {
    'MONOGAMY': 60,
    'ETHICAL_NON_MONOGAMY': 75,
    'POLYAMORY': 70,
    'KINK_BDSM': 95,
    'CASUAL_DATING': 65,
    'FRIENDSHIP_FIRST': 50,
  },
  'CASUAL_DATING': {
    'MONOGAMY': 40,
    'ETHICAL_NON_MONOGAMY': 70,
    'POLYAMORY': 65,
    'KINK_BDSM': 65,
    'CASUAL_DATING': 90,
    'FRIENDSHIP_FIRST': 75,
  },
  'FRIENDSHIP_FIRST': {
    'MONOGAMY': 70,
    'ETHICAL_NON_MONOGAMY': 65,
    'POLYAMORY': 60,
    'KINK_BDSM': 50,
    'CASUAL_DATING': 75,
    'FRIENDSHIP_FIRST': 85,
  },
}

// ═══════════════════════════════════════════════════════════════
// SEXUAL ORIENTATION COMPATIBILITY MATRIX
// ═══════════════════════════════════════════════════════════════

/**
 * 性取向兼容性矩阵
 * 
 * 设计理念：
 * - 基于性别和性取向的匹配逻辑
 * - 泛性恋(Pansexual)和酷儿(Queer)具有较高开放性
 * - 无性恋(Asexual)需要特殊考虑
 */
const SEXUAL_ORIENTATION_COMPAT: Record<string, Record<string, number>> = {
  'STRAIGHT': {
    'STRAIGHT': 95,
    'BISEXUAL': 70,
    'PANSEXUAL': 65,
    'QUEER': 50,
    'DEMISEXUAL': 60,
    'QUESTIONING': 55,
    'GAY': 10,
    'LESBIAN': 10,
    'ASEXUAL': 30,
  },
  'GAY': {
    'GAY': 95,
    'BISEXUAL': 70,
    'PANSEXUAL': 65,
    'QUEER': 75,
    'DEMISEXUAL': 60,
    'QUESTIONING': 55,
    'STRAIGHT': 10,
    'LESBIAN': 10,
    'ASEXUAL': 30,
  },
  'LESBIAN': {
    'LESBIAN': 95,
    'BISEXUAL': 70,
    'PANSEXUAL': 65,
    'QUEER': 75,
    'DEMISEXUAL': 60,
    'QUESTIONING': 55,
    'STRAIGHT': 10,
    'GAY': 10,
    'ASEXUAL': 30,
  },
  'BISEXUAL': {
    'BISEXUAL': 95,
    'PANSEXUAL': 85,
    'QUEER': 80,
    'STRAIGHT': 70,
    'GAY': 70,
    'LESBIAN': 70,
    'DEMISEXUAL': 75,
    'QUESTIONING': 70,
    'ASEXUAL': 50,
  },
  'PANSEXUAL': {
    'PANSEXUAL': 95,
    'BISEXUAL': 85,
    'QUEER': 85,
    'STRAIGHT': 65,
    'GAY': 65,
    'LESBIAN': 65,
    'DEMISEXUAL': 70,
    'QUESTIONING': 70,
    'ASEXUAL': 55,
  },
  'QUEER': {
    'QUEER': 95,
    'BISEXUAL': 80,
    'PANSEXUAL': 85,
    'GAY': 75,
    'LESBIAN': 75,
    'DEMISEXUAL': 70,
    'QUESTIONING': 75,
    'STRAIGHT': 50,
    'ASEXUAL': 50,
  },
  'ASEXUAL': {
    'ASEXUAL': 95,
    'DEMISEXUAL': 85,
    'BISEXUAL': 50,
    'PANSEXUAL': 55,
    'QUEER': 50,
    'QUESTIONING': 45,
    'STRAIGHT': 30,
    'GAY': 30,
    'LESBIAN': 30,
  },
  'DEMISEXUAL': {
    'DEMISEXUAL': 95,
    'ASEXUAL': 85,
    'BISEXUAL': 75,
    'PANSEXUAL': 70,
    'QUEER': 70,
    'QUESTIONING': 65,
    'STRAIGHT': 60,
    'GAY': 60,
    'LESBIAN': 60,
  },
  'QUESTIONING': {
    'QUESTIONING': 90,
    'BISEXUAL': 70,
    'PANSEXUAL': 70,
    'QUEER': 75,
    'DEMISEXUAL': 65,
    'STRAIGHT': 55,
    'GAY': 55,
    'LESBIAN': 55,
    'ASEXUAL': 45,
  },
}

// ═══════════════════════════════════════════════════════════════
// POWER BOARD COMPATIBILITY SCORING
// ═══════════════════════════════════════════════════════════════

/**
 * 计算Power Board设置兼容性
 * 
 * 理念：边界设置越相似，兼容性越高
 * 但互补的边界设置也可能产生有趣的动态
 */
function scorePowerBoardCompatibility(
  settingsA: PowerBoardSettings | null | undefined,
  settingsB: PowerBoardSettings | null | undefined
): { score: number; warnings: string[] } {
  const warnings: string[] = []
  
  // 如果没有设置，返回中性分数
  if (!settingsA || !settingsB) {
    return { score: 70, warnings }
  }

  let totalScore = 0
  let factorCount = 0

  // 1. 内容过滤严格度兼容性 (0-100)
  const strictnessMap: Record<string, number> = {
    'none': 0,
    'low': 25,
    'medium': 50,
    'high': 100,
  }
  const strictnessA = strictnessMap[settingsA.contentFilter?.strictness || 'none']
  const strictnessB = strictnessMap[settingsB.contentFilter?.strictness || 'none']
  // 严格度差异越小越好
  const strictnessDiff = Math.abs(strictnessA - strictnessB)
  const strictnessScore = Math.max(0, 100 - strictnessDiff)
  totalScore += strictnessScore
  factorCount++

  if (strictnessDiff > 50) {
    warnings.push('One of you has much stricter content boundaries than the other')
  }

  // 2. 节奏控制兼容性
  const paceA = settingsA.paceControl?.maxDailyMessages || 10
  const paceB = settingsB.paceControl?.maxDailyMessages || 10
  // 节奏偏好差异
  const paceDiff = Math.abs(paceA - paceB)
  const paceScore = Math.max(0, 100 - paceDiff * 5)
  totalScore += paceScore
  factorCount++

  if (paceDiff > 5) {
    warnings.push('Different communication pace preferences - discuss expectations early')
  }

  // 3. 媒体权限兼容性
  const mediaTypes = ['text', 'image', 'voice', 'video'] as const
  let mediaMatch = 0
  mediaTypes.forEach(type => {
    const permA = settingsA.mediaPermissions?.[type] ?? true
    const permB = settingsB.mediaPermissions?.[type] ?? true
    if (permA === permB) mediaMatch++
  })
  const mediaScore = (mediaMatch / mediaTypes.length) * 100
  totalScore += mediaScore
  factorCount++

  // 4. 同意门控设置
  const consentA = settingsA.consentGate?.enabled ?? false
  const consentB = settingsB.consentGate?.enabled ?? false
  // 双方都有同意门控 = 高兼容性
  // 一方有，一方没有 = 中等兼容性
  // 双方都没有 = 中性
  let consentScore = 50
  if (consentA && consentB) consentScore = 90
  else if (consentA || consentB) consentScore = 70
  totalScore += consentScore
  factorCount++

  const finalScore = Math.round(totalScore / factorCount)

  return { score: finalScore, warnings }
}

// ═══════════════════════════════════════════════════════════════
// CORE SCORING FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function scoreRelationshipType(
  typeA: string | null | undefined,
  typeB: string | null | undefined
): { score: number; warnings: string[] } {
  const warnings: string[] = []

  if (!typeA || !typeB) {
    return { score: 60, warnings }
  }

  const score = RELATIONSHIP_TYPE_COMPAT[typeA]?.[typeB] || 
                RELATIONSHIP_TYPE_COMPAT[typeB]?.[typeA] || 50

  // 生成警告
  if (score < 40) {
    warnings.push(`Different relationship structures: ${typeA} and ${typeB} may have conflicting expectations`)
  } else if (score < 60) {
    warnings.push(`Complementary but different approaches to relationships`)
  }

  return { score, warnings }
}

function scoreSexualOrientation(
  orientationA: string | null | undefined,
  orientationB: string | null | undefined,
  genderA: string,
  genderB: string
): { score: number; warnings: string[] } {
  const warnings: string[] = []

  if (!orientationA || !orientationB) {
    return { score: 60, warnings }
  }

  // 基础性取向兼容性
  let score = SEXUAL_ORIENTATION_COMPAT[orientationA]?.[orientationB] || 50

  // 根据性别进行额外调整
  // 例如：Straight女性 + Straight男性 = 高兼容
  // 但需要考虑双方的性取向是否匹配对方的性别
  
  // 检查潜在的性别-性取向不匹配
  const potentialMismatch = checkGenderOrientationMismatch(
    orientationA, genderA, 
    orientationB, genderB
  )
  
  if (potentialMismatch) {
    score = Math.max(0, score - 40)
    warnings.push('Potential gender-orientation mismatch - verify compatibility')
  }

  return { score, warnings }
}

/**
 * 检查性别与性取向的潜在不匹配
 */
function checkGenderOrientationMismatch(
  orientationA: string,
  genderA: string,
  orientationB: string,
  genderB: string
): boolean {
  // 简化的不匹配检测逻辑
  // 实际应用中可能需要更复杂的逻辑
  
  // Straight + 同性 = 不匹配
  if (orientationA === 'STRAIGHT' && orientationB === 'STRAIGHT') {
    // 如果性别相同，两个Straight是不匹配的
    if (genderA === genderB) return true
  }
  
  // Gay + 异性 = 不匹配
  if (orientationA === 'GAY' && genderB === 'FEMALE') return true
  if (orientationB === 'GAY' && genderA === 'FEMALE') return true
  
  // Lesbian + 男性 = 不匹配
  if (orientationA === 'LESBIAN' && genderB === 'MALE') return true
  if (orientationB === 'LESBIAN' && genderA === 'MALE') return true
  
  return false
}

// ═══════════════════════════════════════════════════════════════
// LEARNING SYSTEM INTEGRATION
// ═══════════════════════════════════════════════════════════════

interface CollectiveIntelligenceStore {
  globalStats: {
    averageAcceptanceRate: number
  }
  featureCombinationStats: Map<string, {
    attempts: number
    successes: number
    score: number
  }>
}

interface BotPreferenceVector {
  implicit: {
    relationshipType?: Record<string, number>
    sexualOrientation?: Record<string, number>
  }
  learning: {
    confidenceScore: number
  }
}

/**
 * 计算学习系统增强
 */
function calculateLearningAdjustments(
  userA: EnhancedUserProfile,
  userB: EnhancedUserProfile,
  botPrefs?: BotPreferenceVector,
  collectiveIntel?: CollectiveIntelligenceStore
): { 
  botPreferenceBoost: number
  collaborativeFilterBoost: number
  collectiveIntelBoost: number
  seasonalBoost: number
  total: number
} {
  const adjustments = {
    botPreferenceBoost: 0,
    collaborativeFilterBoost: 0,
    collectiveIntelBoost: 0,
    seasonalBoost: 0,
    total: 0,
  }

  // 1. Bot偏好增强
  if (botPrefs) {
    let boost = 0
    let featureCount = 0

    // 关系类型偏好
    if (userB.relationshipType && botPrefs.implicit?.relationshipType) {
      const pref = botPrefs.implicit.relationshipType[userB.relationshipType]
      if (pref !== undefined) {
        boost += pref * 0.03
        featureCount++
      }
    }

    // 性取向偏好
    if (userB.sexualOrientation && botPrefs.implicit?.sexualOrientation) {
      const pref = botPrefs.implicit.sexualOrientation[userB.sexualOrientation]
      if (pref !== undefined) {
        boost += pref * 0.02
        featureCount++
      }
    }

    const confidenceFactor = botPrefs.learning?.confidenceScore || 0
    adjustments.botPreferenceBoost = boost * confidenceFactor / Math.max(1, featureCount)
  }

  // 2. 群体智慧增强
  if (collectiveIntel) {
    const features: Record<string, string> = {}
    if (userA.relationshipType) features['a_rel_type'] = userA.relationshipType
    if (userB.relationshipType) features['b_rel_type'] = userB.relationshipType
    if (userA.sexualOrientation) features['a_orientation'] = userA.sexualOrientation
    if (userB.sexualOrientation) features['b_orientation'] = userB.sexualOrientation

    const featureKey = Object.entries(features)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join('|')

    const stats = collectiveIntel.featureCombinationStats.get(featureKey)
    if (stats && stats.attempts >= 5) {
      const globalAvg = collectiveIntel.globalStats.averageAcceptanceRate
      const relativePerformance = (stats.score - globalAvg) / globalAvg
      adjustments.collectiveIntelBoost = Math.max(-0.03, Math.min(0.03, relativePerformance * 0.03))
    }
  }

  // 3. 季节性调整
  const currentMonth = new Date().getMonth() + 1
  const seasonalPatterns: Record<string, Record<number, number>> = {
    'relationshipType.MONOGAMY': { 1: 1.15, 2: 1.1, 12: 1.1 }, // 新年、情人节、年末
    'relationshipType.CASUAL_DATING': { 6: 1.15, 7: 1.2, 8: 1.15 }, // 夏季
  }

  if (userA.relationshipType) {
    const pattern = seasonalPatterns[`relationshipType.${userA.relationshipType}`]
    if (pattern && pattern[currentMonth]) {
      adjustments.seasonalBoost = (pattern[currentMonth] - 1) * 0.02
    }
  }

  // 计算总调整（限制在 ±10%）
  adjustments.total = Math.max(-0.1, Math.min(0.1, 
    adjustments.botPreferenceBoost + 
    adjustments.collaborativeFilterBoost + 
    adjustments.collectiveIntelBoost + 
    adjustments.seasonalBoost
  ))

  return adjustments
}

// ═══════════════════════════════════════════════════════════════
// ENHANCED MATCH REASON GENERATION
// ═══════════════════════════════════════════════════════════════

function generateEnhancedMatchReason(
  a: EnhancedUserProfile,
  b: EnhancedUserProfile,
  scores: {
    attachment: number
    communication: number
    conflict: number
    values: number
    lifestyle: number
    relationshipType: number
    sexualOrientation: number
    powerBoard: number
  }
): string {
  const reasons: string[] = []

  // 关系类型兼容性
  if (scores.relationshipType >= 85) {
    reasons.push(`You both seek ${a.relationshipType?.toLowerCase().replace('_', ' ')} connections`)
  } else if (scores.relationshipType >= 60) {
    reasons.push('Your relationship approaches can complement each other')
  }

  // 性取向兼容性
  if (scores.sexualOrientation >= 80) {
    reasons.push('Your orientations align well for meaningful connection')
  }

  // 依恋风格
  if (scores.attachment >= 80) {
    reasons.push('Your attachment styles create a foundation of emotional safety')
  } else if (scores.attachment >= 60) {
    reasons.push('Complementary attachment patterns that can support mutual growth')
  }

  // 沟通风格
  if (scores.communication >= 80) {
    reasons.push('You communicate in compatible ways')
  }

  // 冲突解决
  if (scores.conflict >= 80) {
    reasons.push('Your conflict resolution approaches complement each other')
  }

  // 价值观
  if (scores.values >= 80) {
    reasons.push('Shared values and life priorities point to aligned goals')
  }

  // Power Board
  if (scores.powerBoard >= 80) {
    reasons.push('Similar boundaries and communication preferences')
  }

  // 生活方式
  if (scores.lifestyle >= 80) {
    reasons.push('Similar lifestyle preferences')
  }

  if (reasons.length === 0) {
    reasons.push('You have a baseline compatibility worth exploring')
  }

  return reasons.slice(0, 3).join('. ') + '.'
}

// ═══════════════════════════════════════════════════════════════
// MAIN ENHANCED MATCHING FUNCTION
// ═══════════════════════════════════════════════════════════════

interface EnhancedMatchParams {
  userA: EnhancedUserProfile
  userB: EnhancedUserProfile
  botPrefs?: BotPreferenceVector
  collectiveIntel?: CollectiveIntelligenceStore
}

/**
 * 增强版匹配评分 - 集成Chyrpe PRD核心概念
 */
export function calculateEnhancedMatchScore(
  params: EnhancedMatchParams
): EnhancedMatchScore {
  const { userA, userB, botPrefs, collectiveIntel } = params

  // 1. 计算基础匹配分数（使用原有引擎）
  const baseScore = baseCalculateMatchScore(userA, userB)

  // 2. 计算新增维度分数
  const relationshipTypeScore = scoreRelationshipType(
    userA.relationshipType,
    userB.relationshipType
  )

  const sexualOrientationScore = scoreSexualOrientation(
    userA.sexualOrientation,
    userB.sexualOrientation,
    userA.gender,
    userB.gender
  )

  const powerBoardScore = scorePowerBoardCompatibility(
    userA.powerBoardSettings,
    userB.powerBoardSettings
  )

  // 3. 计算学习系统调整
  const learningAdjustments = calculateLearningAdjustments(
    userA,
    userB,
    botPrefs,
    collectiveIntel
  )

  // 4. 加权计算总分（新权重分配）
  const weightedBase = 
    baseScore.attachment * 0.20 +      // 20% (from 25%)
    baseScore.communication * 0.15 +    // 15% (from 20%)
    baseScore.conflict * 0.15 +         // 15% (from 20%)
    baseScore.values * 0.15 +           // 15% (from 20%)
    baseScore.lifestyle * 0.10          // 10% (from 15%)

  const weightedNew =
    relationshipTypeScore.score * 0.15 +    // 15% (NEW)
    sexualOrientationScore.score * 0.10     // 10% (NEW)

  // Power Board作为调整因子（±5%）
  const powerBoardAdjustment = (powerBoardScore.score - 50) / 1000 // -5% to +5%

  // 计算原始总分
  let rawTotal = weightedBase + weightedNew
  
  // 应用Power Board调整
  rawTotal = rawTotal * (1 + powerBoardAdjustment)
  
  // 应用学习系统调整
  rawTotal = rawTotal * (1 + learningAdjustments.total)

  // 限制在0-100范围内
  const finalScore = Math.max(0, Math.min(100, Math.round(rawTotal)))

  // 5. 合并所有警告
  const allWarnings = [
    ...baseScore.conflictWarnings,
    ...relationshipTypeScore.warnings,
    ...sexualOrientationScore.warnings,
    ...powerBoardScore.warnings,
  ]

  // 6. 生成增强版匹配解释
  const reason = generateEnhancedMatchReason(userA, userB, {
    attachment: baseScore.attachment,
    communication: baseScore.communication,
    conflict: baseScore.conflict,
    values: baseScore.values,
    lifestyle: baseScore.lifestyle,
    relationshipType: relationshipTypeScore.score,
    sexualOrientation: sexualOrientationScore.score,
    powerBoard: powerBoardScore.score,
  })

  return {
    ...baseScore,
    total: finalScore,
    relationshipType: relationshipTypeScore.score,
    sexualOrientation: sexualOrientationScore.score,
    powerBoardCompat: powerBoardScore.score,
    learningAdjustments: {
      botPreferenceBoost: learningAdjustments.botPreferenceBoost,
      collaborativeFilterBoost: learningAdjustments.collaborativeFilterBoost,
      collectiveIntelBoost: learningAdjustments.collectiveIntelBoost,
      seasonalBoost: learningAdjustments.seasonalBoost,
    },
    finalScore,
    reason,
    conflictWarnings: [...new Set(allWarnings)],
  }
}

// ═══════════════════════════════════════════════════════════════
// BATCH MATCHING WITH ENHANCED ENGINE
// ═══════════════════════════════════════════════════════════════

export function findTopEnhancedMatches(
  user: EnhancedUserProfile,
  candidates: EnhancedUserProfile[],
  limit: number = 5,
  botPrefs?: BotPreferenceVector,
  collectiveIntel?: CollectiveIntelligenceStore
): Array<{ profile: EnhancedUserProfile; score: EnhancedMatchScore }> {
  // Normalize preferredGender for case-insensitive comparison
  const normalizeGenderPref = (g: string | null | undefined, target: string | null | undefined): boolean => {
    if (!g || g.toUpperCase() === 'ANY' || g.toUpperCase() === 'EVERYONE') return true;
    if (!target) return true;
    return g.toUpperCase() === target.toUpperCase();
  };

  const scored = candidates
    .filter((candidate) => {
      // Skip self
      if (candidate.id === user.id) return false

      // Basic preference filtering
      if (user.preferredAgeMin && candidate.age < user.preferredAgeMin) return false
      if (user.preferredAgeMax && candidate.age > user.preferredAgeMax) return false

      // 性别偏好过滤 (case-insensitive)
      if (!normalizeGenderPref(user.preferredGender, candidate.gender)) return false

      return true
    })
    .map((candidate) => ({
      profile: candidate,
      score: calculateEnhancedMatchScore({
        userA: user,
        userB: candidate,
        botPrefs,
        collectiveIntel,
      }),
    }))
    .sort((a, b) => b.score.finalScore - a.score.finalScore)

  return scored.slice(0, limit)
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export {
  scoreRelationshipType,
  scoreSexualOrientation,
  scorePowerBoardCompatibility,
  calculateLearningAdjustments,
}
