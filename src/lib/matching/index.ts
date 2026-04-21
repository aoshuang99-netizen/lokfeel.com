/**
 * LokFeel Matching Engine — Unified Export
 * 
 * 导出所有匹配引擎功能（基础版 + 增强版）
 */

// 基础引擎
export { calculateMatchScore, findTopMatches } from './engine'
export type { UserProfile, MatchScore } from './engine'

// 增强引擎
export { 
  calculateEnhancedMatchScore, 
  findTopEnhancedMatches,
  scoreRelationshipType,
  scoreSexualOrientation,
  scorePowerBoardCompatibility,
  calculateLearningAdjustments,
} from './enhanced-engine'
export type { 
  EnhancedUserProfile, 
  EnhancedMatchScore,
  PowerBoardSettings,
} from './enhanced-engine'

// API集成
export { 
  generateMatchesForUser, 
  generateAllWeeklyMatches 
} from './index-base'

export { 
  generateEnhancedMatchesForUser, 
  generateAllEnhancedWeeklyMatches,
  getMatchCompatibilityDetails,
} from './index-enhanced'
