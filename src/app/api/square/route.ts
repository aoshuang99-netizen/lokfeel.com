/**
 * Square API - 智能推荐广场
 * 
 * 核心功能:
 * - 基于用户标签偏好的自动化推荐
 * - 标签系统与匹配算法的深度集成
 * - 智能排序：匹配度 > 标签相关性 > 活跃度
 * - 无限滚动加载
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/auth';
import { db } from '@/lib/db';
import { calculateEnhancedMatchScore, EnhancedUserProfile } from '@/lib/matching/enhanced-engine';

export const dynamic = 'force-dynamic';

// 配置
const SQUARE_CONFIG = {
  PAGE_SIZE: 20,
  NEW_USER_DAYS: 7,
  MAX_BOTS_PER_PAGE: 10,
  MAX_NEW_USERS_PER_PAGE: 10,
  MIN_MATCH_SCORE: 50, // 降低阈值以显示更多结果
  PROFILE_COMPLETION_THRESHOLD: 50, // 降低阈值
};

// 标签到关系类型的映射
const TAG_TO_RELATIONSHIP_TYPE: Record<string, string> = {
  'MONOGAMY': 'MONOGAMY',
  'ETHICAL_NON_MONOGAMY': 'ETHICAL_NON_MONOGAMY',
  'POLYAMORY': 'POLYAMORY',
  'KINK_BDSM': 'KINK_BDSM',
  'CASUAL_DATING': 'CASUAL_DATING',
  'FRIENDSHIP_FIRST': 'FRIENDSHIP_FIRST',
};

// 标签到性取向的映射
const TAG_TO_ORIENTATION: Record<string, string> = {
  'STRAIGHT': 'STRAIGHT',
  'GAY': 'GAY',
  'LESBIAN': 'LESBIAN',
  'BISEXUAL': 'BISEXUAL',
  'PANSEXUAL': 'PANSEXUAL',
  'QUEER': 'QUEER',
  'ASEXUAL': 'ASEXUAL',
  'DEMISEXUAL': 'DEMISEXUAL',
};

/**
 * 计算资料完整度
 */
function calculateProfileCompletion(profile: any): number {
  if (!profile) return 0;

  const fields = [
    profile.displayName,
    profile.bio,
    profile.avatar,
    profile.age,
    profile.attachmentStyle,
    profile.communicationStyle,
    profile.conflictResolution,
    profile.loveLanguage,
    profile.lifePriorities,
    profile.relationshipGoal,
    profile.city,
    profile.boundaries,
    profile.emotionalAvailability,
  ];

  const filled = fields.filter((f) => f && f !== '' && f !== 'null').length;
  return Math.round((filled / fields.length) * 100);
}

/**
 * 将Profile转换为EnhancedUserProfile
 */
function toEnhancedUserProfile(profile: any): EnhancedUserProfile {
  return {
    id: profile.userId || profile.id,
    attachmentStyle: profile.attachmentStyle,
    communicationStyle: profile.communicationStyle,
    conflictResolution: profile.conflictResolution,
    loveLanguage: profile.loveLanguage,
    lifePriorities: profile.lifePriorities,
    relationshipGoal: profile.relationshipGoal,
    boundaries: profile.boundaries,
    dealbreakers: profile.dealbreakers,
    emotionalAvailability: profile.emotionalAvailability,
    preferredAgeMin: profile.preferredAgeMin,
    preferredAgeMax: profile.preferredAgeMax,
    preferredGender: profile.preferredGender,
    preferredDistance: profile.preferredDistance,
    age: profile.age,
    gender: profile.gender,
    city: profile.city,
    country: profile.country,
    relationshipType: profile.relationshipType || profile.selectedTags?.find((t: string) => TAG_TO_RELATIONSHIP_TYPE[t]),
    sexualOrientation: profile.sexualOrientation || profile.selectedTags?.find((t: string) => TAG_TO_ORIENTATION[t]),
  };
}

/**
 * 计算标签匹配分数
 */
function calculateTagMatchScore(userTags: string[], candidateTags: string[]): number {
  if (!userTags?.length || !candidateTags?.length) return 50;
  
  const matchingTags = userTags.filter(tag => candidateTags.includes(tag));
  return Math.round((matchingTags.length / Math.max(userTags.length, candidateTags.length)) * 100);
}

/**
 * 根据用户标签生成推荐用户
 */
async function generateRecommendations(
  currentUserProfile: any,
  options: {
    limit: number;
    offset: number;
    type: 'all' | 'bots' | 'new';
    oppositeGender: boolean;
  }
) {
  const { limit, offset, type, oppositeGender } = options;
  
  // 构建基础筛选条件
  const baseWhere: any = {
    userId: { not: currentUserProfile.userId },
    profileStatus: { in: ['APPROVED', 'DRAFT'] }, // 包含草稿状态以显示更多用户
  };
  
  // 异性筛选
  if (oppositeGender && currentUserProfile.gender) {
    if (currentUserProfile.gender === 'MALE') {
      baseWhere.gender = 'FEMALE';
    } else if (currentUserProfile.gender === 'FEMALE') {
      baseWhere.gender = 'MALE';
    }
  }
  
  // 用户偏好标签
  const userTags = currentUserProfile.selectedTags || [];
  
  // 获取候选人
  const candidates = await db.profile.findMany({
    where: baseWhere,
    include: {
      user: {
        select: {
          id: true,
          name: true,
          createdAt: true,
          isBot: true,
          _count: {
            select: { receivedMatches: true },
          },
        },
      },
      botProfile: true,
    },
    take: 100, // 获取更多用于排序
  });
  
  // 转换为EnhancedUserProfile并计算分数
  const currentUserEnhanced = toEnhancedUserProfile(currentUserProfile);
  
  const scoredCandidates = candidates.map(candidate => {
    const candidateEnhanced = toEnhancedUserProfile(candidate);
    const completion = calculateProfileCompletion(candidate);
    
    // 计算增强版匹配分数
    let matchScore = null;
    let matchReason = '';
    try {
      const score = calculateEnhancedMatchScore({
        userA: currentUserEnhanced,
        userB: candidateEnhanced,
      });
      matchScore = score.finalScore;
      matchReason = score.reason;
    } catch (e) {
      // 如果计算失败，使用基础分数
      matchScore = 50;
    }
    
    // 计算标签匹配分数
    const candidateTags = candidate.selectedTags || [];
    const tagMatchScore = calculateTagMatchScore(userTags, candidateTags);
    
    // 综合分数 (匹配度 70% + 标签匹配 30%)
    const combinedScore = Math.round(matchScore * 0.7 + tagMatchScore * 0.3);
    
    return {
      ...candidate,
      completion,
      matchScore,
      matchReason,
      tagMatchScore,
      combinedScore,
      isNew: !candidate.user.isBot && 
        new Date(candidate.user.createdAt) > new Date(Date.now() - SQUARE_CONFIG.NEW_USER_DAYS * 24 * 60 * 60 * 1000),
    };
  });
  
  // 过滤
  let filtered = scoredCandidates.filter(c => {
    // 类型过滤
    if (type === 'bots' && !c.user.isBot) return false;
    if (type === 'new' && (c.user.isBot || !c.isNew)) return false;
    
    // 资料完整度过滤
    if (c.completion < SQUARE_CONFIG.PROFILE_COMPLETION_THRESHOLD) return false;
    
    return true;
  });
  
  // 排序：综合分数 > 匹配度 > 标签匹配
  filtered.sort((a, b) => {
    if (b.combinedScore !== a.combinedScore) return b.combinedScore - a.combinedScore;
    if (b.matchScore !== a.matchScore) return (b.matchScore || 0) - (a.matchScore || 0);
    return (b.tagMatchScore || 0) - (a.tagMatchScore || 0);
  });
  
  // 分页
  const total = filtered.length;
  const paginated = filtered.slice(offset, offset + limit);
  
  return {
    users: paginated,
    total,
    hasMore: offset + limit < total,
  };
}

/**
 * GET /api/square - 获取智能推荐用户列表
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }
    
    const { searchParams } = new URL(request.url);
    const type = (searchParams.get('type') || 'all') as 'all' | 'bots' | 'new';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50);
    const oppositeGender = searchParams.get('oppositeGender') !== 'false';
    
    const offset = (page - 1) * limit;
    
    // 获取当前用户的完整Profile
    const currentUserProfile = await db.profile.findUnique({
      where: { userId: session.user.id },
      include: { user: true },
    });
    
    if (!currentUserProfile) {
      return NextResponse.json({ message: 'Profile not found' }, { status: 404 });
    }
    
    // 生成推荐
    const recommendations = await generateRecommendations(currentUserProfile, {
      limit,
      offset,
      type,
      oppositeGender,
    });
    
    // 格式化响应
    const formatUser = (profile: any) => ({
      id: profile.user.id,
      userId: profile.user.id,
      profileId: profile.id,
      displayName: profile.displayName,
      age: profile.age,
      gender: profile.gender,
      location: profile.city,
      bio: profile.bio?.slice(0, 150) + (profile.bio?.length > 150 ? '...' : ''),
      avatar: profile.avatar,
      avatarType: profile.avatarType,
      occupation: profile.occupation,
      company: profile.company,
      isBot: profile.user.isBot,
      isNew: profile.isNew,
      joinedAt: profile.user.createdAt,
      popularity: profile.user._count?.receivedMatches || 0,
      matchScore: profile.matchScore,
      matchReason: profile.matchReason,
      tagMatchScore: profile.tagMatchScore,
      combinedScore: profile.combinedScore,
      profileCompletion: profile.completion,
      tags: profile.selectedTags || [],
      linkedInVerified: profile.linkedInVerified,
      verificationBadge: profile.verificationBadge,
      ...(profile.user.isBot && profile.botProfile ? {
        botType: profile.botProfile.botType,
        activityLevel: profile.botProfile.activityLevel,
        interests: profile.botProfile.interests,
      } : {}),
    });
    
    // 获取统计
    const [totalBots, totalNewUsers] = await Promise.all([
      db.profile.count({
        where: {
          user: { isBot: true },
          profileStatus: { in: ['APPROVED', 'DRAFT'] },
        },
      }),
      db.profile.count({
        where: {
          user: {
            isBot: false,
            createdAt: {
              gte: new Date(Date.now() - SQUARE_CONFIG.NEW_USER_DAYS * 24 * 60 * 60 * 1000),
            },
          },
          profileStatus: { in: ['APPROVED', 'DRAFT'] },
        },
      }),
    ]);
    
    return NextResponse.json({
      success: true,
      data: {
        users: recommendations.users.map(formatUser),
        pagination: {
          page,
          limit,
          total: recommendations.total,
          hasMore: recommendations.hasMore,
        },
        stats: {
          totalBots,
          totalNewUsers,
        },
        userPreferences: {
          selectedTags: currentUserProfile.selectedTags || [],
          oppositeGender,
        },
      },
    });
    
  } catch (error) {
    console.error('[API] Square error:', error);
    return NextResponse.json(
      { message: 'Failed to fetch recommendations' },
      { status: 500 }
    );
  }
}
