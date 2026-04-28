import { Profile } from "@/generated/client"
import { 
  MatchCompatibilityScores, 
  ConflictWarning,
  MatchExplanation 
} from '@/types'
import { MATCH_CONFIG } from '@/constants'

// ============================================================================
// Attachment Style Compatibility Matrix
// ============================================================================

const ATTACHMENT_COMPATIBILITY: Record<string, Record<string, number>> = {
  secure: { 
    secure: 95, 
    anxious: 80, 
    avoidant: 75, 
    disorganized: 65 
  },
  anxious: { 
    secure: 85, 
    anxious: 55, 
    avoidant: 35, 
    disorganized: 40 
  },
  avoidant: { 
    secure: 80, 
    anxious: 30, 
    avoidant: 50, 
    disorganized: 35 
  },
  disorganized: { 
    secure: 70, 
    anxious: 45, 
    avoidant: 40, 
    disorganized: 30 
  },
}

// ============================================================================
// Communication Style Compatibility Matrix
// ============================================================================

const COMMUNICATION_COMPATIBILITY: Record<string, Record<string, number>> = {
  direct: { 
    direct: 85, 
    indirect: 50, 
    analytical: 80, 
    emotional: 70 
  },
  indirect: { 
    direct: 45, 
    indirect: 80, 
    analytical: 55, 
    emotional: 65 
  },
  analytical: { 
    direct: 75, 
    indirect: 50, 
    analytical: 90, 
    emotional: 55 
  },
  emotional: { 
    direct: 65, 
    indirect: 60, 
    analytical: 50, 
    emotional: 85 
  },
}

// ============================================================================
// Conflict Resolution Compatibility Matrix
// ============================================================================

const CONFLICT_COMPATIBILITY: Record<string, Record<string, number>> = {
  collaborative: { 
    collaborative: 95, 
    compromising: 85, 
    accommodating: 70, 
    competing: 45 
  },
  compromising: { 
    collaborative: 85, 
    compromising: 80, 
    accommodating: 75, 
    competing: 50 
  },
  accommodating: { 
    collaborative: 75, 
    compromising: 75, 
    accommodating: 55, 
    competing: 35 
  },
  competing: { 
    collaborative: 40, 
    compromising: 45, 
    accommodating: 30, 
    competing: 35 
  },
}

// ============================================================================
// Scoring Functions
// ============================================================================

/**
 * Score attachment style compatibility (0-100)
 */
export function scoreAttachmentCompatibility(
  style1: string | null | undefined,
  style2: string | null | undefined
): number {
  if (!style1 || !style2) return 50
  
  const score = ATTACHMENT_COMPATIBILITY[style1]?.[style2]
  return score ?? 50
}

/**
 * Score communication style compatibility (0-100)
 */
export function scoreCommunicationCompatibility(
  style1: string | null | undefined,
  style2: string | null | undefined
): number {
  if (!style1 || !style2) return 50
  
  const score = COMMUNICATION_COMPATIBILITY[style1]?.[style2]
  return score ?? 50
}

/**
 * Score conflict resolution compatibility (0-100)
 */
export function scoreConflictCompatibility(
  style1: string | null | undefined,
  style2: string | null | undefined
): number {
  if (!style1 || !style2) return 50
  
  const score = CONFLICT_COMPATIBILITY[style1]?.[style2]
  return score ?? 50
}

/**
 * Score values/priorities compatibility (0-100)
 */
export function scoreValuesCompatibility(
  priorities1: string[],
  priorities2: string[]
): number {
  if (!priorities1?.length || !priorities2?.length) return 60
  
  const set1 = new Set(priorities1)
  const set2 = new Set(priorities2)
  
  // Count matches
  let matches = 0
  for (const p of set1) {
    if (set2.has(p)) matches++
  }
  
  // Calculate Jaccard similarity
  const union = new Set([...set1, ...set2])
  if (union.size === 0) return 60
  
  const similarity = matches / union.size
  
  // Scale to 0-100 with a baseline
  return Math.round(40 + similarity * 60)
}

/**
 * Score lifestyle compatibility (0-100)
 * Checks for dealbreaker conflicts
 */
export function scoreLifestyleCompatibility(
  dealbreakers1: string[],
  dealbreakers2: string[],
  interests1: string[] = [],
  interests2: string[] = []
): number {
  let score = 75 // Baseline
  
  // Check for dealbreaker conflicts
  if (dealbreakers1?.length && dealbreakers2?.length) {
    const conflicts = dealbreakers1.filter(db => dealbreakers2.includes(db))
    score -= conflicts.length * 25
  }
  
  // Bonus for shared interests
  if (interests1?.length && interests2?.length) {
    const shared = interests1.filter(i => interests2.includes(i))
    score += shared.length * 3
  }
  
  return Math.max(0, Math.min(100, score))
}

/**
 * Score love language compatibility (0-100)
 */
export function scoreLoveLanguageCompatibility(
  languages1: string[],
  languages2: string[]
): number {
  if (!languages1?.length || !languages2?.length) return 60
  
  // Check for complementary pairings
  const complementary: Record<string, string[]> = {
    words_of_affirmation: ['words_of_affirmation', 'quality_time'],
    acts_of_service: ['acts_of_service', 'words_of_affirmation'],
    receiving_gifts: ['receiving_gifts', 'quality_time'],
    quality_time: ['quality_time', 'words_of_affirmation', 'physical_touch'],
    physical_touch: ['physical_touch', 'quality_time'],
  }
  
  let score = 50
  
  for (const lang1 of languages1) {
    for (const lang2 of languages2) {
      if (lang1 === lang2) {
        score += 15 // Same love language
      } else if (complementary[lang1]?.includes(lang2)) {
        score += 10 // Complementary
      }
    }
  }
  
  return Math.min(100, score)
}

/**
 * Score relationship goal compatibility (0-100)
 */
export function scoreRelationshipGoalCompatibility(
  goal1: string | null | undefined,
  goal2: string | null | undefined
): number {
  if (!goal1 || !goal2) return 60
  
  if (goal1 === goal2) return 95
  
  // Some goals are more compatible than others (v3 enum values)
  const compatiblePairs: Record<string, string[]> = {
    MONOGAMY: ['CASUAL_DATING', 'FRIENDSHIP_FIRST'],
    ETHICAL_NON_MONOGAMY: ['POLYAMORY', 'CASUAL_DATING', 'KINK_BDSM'],
    POLYAMORY: ['ETHICAL_NON_MONOGAMY', 'CASUAL_DATING'],
    CASUAL_DATING: ['MONOGAMY', 'FRIENDSHIP_FIRST', 'ETHICAL_NON_MONOGAMY'],
    FRIENDSHIP_FIRST: ['MONOGAMY', 'CASUAL_DATING'],
    KINK_BDSM: ['ETHICAL_NON_MONOGAMY', 'POLYAMORY', 'CASUAL_DATING'],
  }
  
  if (compatiblePairs[goal1]?.includes(goal2)) {
    return 70
  }
  
  return 40
}

/**
 * Calculate overall weighted compatibility score
 */
export function calculateOverallScore(
  breakdown: Omit<MatchCompatibilityScores, 'overall'>
): number {
  // @ts-ignore
  const { weights } = MATCH_CONFIG.scoringWeights as { weights: Record<string, number> }
  
  const weighted =
    breakdown.attachment * (weights?.attachment ?? 0.25) +
    breakdown.communication * (weights?.communication ?? 0.20) +
    breakdown.conflict * (weights?.conflict ?? 0.20) +
    breakdown.values * (weights?.values ?? 0.20) +
    breakdown.lifestyle * (weights?.lifestyle ?? 0.15)
  
  return Math.round(weighted)
}

/**
 * Calculate complete compatibility breakdown between two profiles
 */
export function calculateCompatibilityBreakdown(
  profile1: Profile,
  profile2: Profile
): MatchCompatibilityScores {
  const attachment = scoreAttachmentCompatibility(
    profile1.attachmentStyle,
    profile2.attachmentStyle
  )
  
  const communication = scoreCommunicationCompatibility(
    profile1.communicationStyle,
    profile2.communicationStyle
  )
  
  const conflict = scoreConflictCompatibility(
    profile1.conflictResolution,
    profile2.conflictResolution
  )
  
  const values = scoreValuesCompatibility(
    // @ts-ignore
    profile1.priorities as string[] || [],
    // @ts-ignore
    profile2.priorities as string[] || []
  )
  
  const lifestyle = scoreLifestyleCompatibility(
    // @ts-ignore
    profile1.dealbreakers as string[] || [],
    // @ts-ignore
    profile2.dealbreakers as string[] || [],
    // @ts-ignore
    profile1.interests as string[] || [],
    // @ts-ignore
    profile2.interests as string[] || []
  )
  
  const overall = calculateOverallScore({
    attachment,
    communication,
    conflict,
    values,
    lifestyle,
  })
  
  return {
    overall,
    attachment,
    communication,
    conflict,
    values,
    lifestyle,
  }
}

/**
 * Identify potential conflict warnings between two profiles
 */
export function identifyConflictWarnings(
  profile1: Profile,
  profile2: Profile
): ConflictWarning[] {
  const warnings: ConflictWarning[] = []
  
  // Attachment style warnings
  const attachmentScore = scoreAttachmentCompatibility(
    profile1.attachmentStyle,
    profile2.attachmentStyle
  )
  
  if (attachmentScore < 50) {
    const isAnxiousAvoidant = 
      (profile1.attachmentStyle === 'anxious' && profile2.attachmentStyle === 'avoidant') ||
      (profile1.attachmentStyle === 'avoidant' && profile2.attachmentStyle === 'anxious')
    
    if (isAnxiousAvoidant) {
      warnings.push({
        type: 'attachment',
        severity: 'high',
        message: 'Anxious-Avoidant pairing can create a push-pull dynamic',
        suggestion: 'Both partners should communicate needs clearly and respect boundaries',
      })
    } else {
      warnings.push({
        type: 'attachment',
        severity: 'medium',
        message: 'Different attachment styles may require extra communication',
        suggestion: 'Practice patience and understanding with each other\'s needs',
      })
    }
  }
  
  // Communication style warnings
  const commScore = scoreCommunicationCompatibility(
    profile1.communicationStyle,
    profile2.communicationStyle
  )
  
  if (commScore < 55) {
    warnings.push({
      type: 'communication',
      severity: 'medium',
      message: 'Different communication styles may lead to misunderstandings',
      suggestion: 'Take time to understand how each other prefers to communicate',
    })
  }
  
  // Conflict resolution warnings
  const conflictScore = scoreConflictCompatibility(
    profile1.conflictResolution,
    profile2.conflictResolution
  )
  
  if (conflictScore < 50) {
    const hasCompeting = 
      profile1.conflictResolution === 'competing' || 
      profile2.conflictResolution === 'competing'
    
    warnings.push({
      type: 'conflict',
      severity: hasCompeting ? 'high' : 'medium',
      message: hasCompeting 
        ? 'Competing conflict styles can escalate disagreements'
        : 'Different approaches to conflict may need balancing',
      suggestion: hasCompeting
        ? 'Focus on finding win-win solutions rather than winning arguments'
        : 'Develop a shared approach to handling disagreements',
    })
  }
  
  // Values/dealbreaker warnings
  // @ts-ignore
  const dealbreakers1 = profile1.dealbreakers as string[] || []
  // @ts-ignore
  const dealbreakers2 = profile2.dealbreakers as string[] || []
  const conflicts = dealbreakers1.filter(db => dealbreakers2.includes(db))
  
  if (conflicts.length > 0) {
    warnings.push({
      type: 'values',
      severity: conflicts.length > 1 ? 'high' : 'medium',
      message: `Shared dealbreakers: ${conflicts.join(', ')}`,
      suggestion: 'Discuss these topics early to ensure compatibility',
    })
  }
  
  // Relationship goal mismatch
  const goalScore = scoreRelationshipGoalCompatibility(
    profile1.relationshipGoal,
    profile2.relationshipGoal
  )
  
  if (goalScore < 50) {
    warnings.push({
      type: 'lifestyle',
      severity: 'high',
      message: 'Different relationship goals may lead to mismatched expectations',
      suggestion: 'Have an honest conversation about what you\'re both looking for',
    })
  }
  
  return warnings
}

/**
 * Generate a human-readable explanation of the match
 */
export function generateMatchExplanation(
  profile1: Profile,
  profile2: Profile,
  scores: MatchCompatibilityScores
): MatchExplanation {
  const strengths: string[] = []
  const considerations: string[] = []
  const conversationStarters: string[] = []
  
  // Identify strengths
  if (scores.attachment >= 80) {
    strengths.push('Your attachment styles are highly compatible')
  }
  if (scores.communication >= 80) {
    strengths.push('You have complementary communication styles')
  }
  if (scores.conflict >= 80) {
    strengths.push('You handle conflict in compatible ways')
  }
  if (scores.values >= 80) {
    strengths.push('You share similar values and priorities')
  }
  if (scores.lifestyle >= 80) {
    strengths.push('Your lifestyles and interests align well')
  }
  
  // Identify considerations
  if (scores.attachment < 60) {
    considerations.push('Your attachment styles may need extra attention')
  }
  if (scores.communication < 60) {
    considerations.push('Communication styles differ - patience will help')
  }
  if (scores.conflict < 60) {
    considerations.push('You approach conflict differently - finding common ground is key')
  }
  
  // Generate conversation starters based on shared interests
  // @ts-ignore
  const interests1 = profile1.interests as string[] || []
  // @ts-ignore
  const interests2 = profile2.interests as string[] || []
  const sharedInterests = interests1.filter(i => interests2.includes(i))
  
  if (sharedInterests.length > 0) {
    conversationStarters.push(`I noticed we both enjoy ${sharedInterests[0]}!`)
  }
  
  // Add conversation starters based on love languages
  // @ts-ignore
  const loveLanguages1 = profile1.loveLanguages as string[] || []
  // @ts-ignore
  if (loveLanguages1.includes('quality_time')) {
    conversationStarters.push('What does your ideal weekend look like?')
  }
  // @ts-ignore
  if (loveLanguages1.includes('acts_of_service')) {
    conversationStarters.push('What\'s something thoughtful someone has done for you?')
  }
  // @ts-ignore
  if (loveLanguages1.includes('words_of_affirmation')) {
    conversationStarters.push('What kind of compliments mean the most to you?')
  }
  
  // Add generic starters if needed
  if (conversationStarters.length < 2) {
    conversationStarters.push('What brought you to LokFeel?')
    conversationStarters.push('What are you most passionate about right now?')
  }
  
  // Generate summary
  let summary: string
  if (scores.overall >= 85) {
    summary = 'Exceptional compatibility! You share strong foundations across multiple dimensions.'
  } else if (scores.overall >= 70) {
    summary = 'Great compatibility with solid potential for a meaningful connection.'
  } else if (scores.overall >= 60) {
    summary = 'Good compatibility with some areas to explore together.'
  } else {
    summary = 'Moderate compatibility - success will depend on communication and growth.'
  }
  
  return {
    summary,
    strengths,
    considerations,
    conversationStarters: conversationStarters.slice(0, 3),
  }
}
