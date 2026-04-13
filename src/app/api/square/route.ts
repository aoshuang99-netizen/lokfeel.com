/**
 * Square API - 广场功能
 * 
 * 功能:
 * - 浏览数字用户(Bot)列表
 * - 浏览新注册用户
 * - 基于关系匹配度的智能推荐
 * - 资料完整度过滤
 * - 筛选和排序
 * - 分页加载
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/auth';
import { db } from '@/lib/db';
import { calculateMatchScore, type UserProfile } from '@/lib/matching/engine';

export const dynamic = 'force-dynamic';

// 广场配置
const SQUARE_CONFIG = {
  PAGE_SIZE: 20,
  NEW_USER_DAYS: 7, // 7天内注册算新用户
  MAX_BOTS_PER_PAGE: 10, // 每页最多Bot数量
  MAX_NEW_USERS_PER_PAGE: 10, // 每页最多新用户数量
  MIN_MATCH_SCORE: 60, // 最低匹配度阈值
  PROFILE_COMPLETION_THRESHOLD: 70, // 资料完整度阈值(%)
};

/**
 * 计算资料完整度百分比
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
 * 将Profile转换为UserProfile格式用于匹配计算
 */
function toUserProfile(profile: any): UserProfile {
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
  };
}

/**
 * GET /api/square - 获取广场用户列表
 * 
 * Query params:
 * - type: 'bots' | 'new' | 'mixed' (default: mixed)
 * - gender: 'MALE' | 'FEMALE' | 'NON_BINARY' | 'ALL' (default: ALL)
 * - ageMin: number
 * - ageMax: number
 * - page: number (default: 1)
 * - limit: number (default: 20)
 * - minMatchScore: number (default: 60) - 最低匹配度过滤
 * - sortBy: 'match' | 'newest' | 'popular' (default: match) - 排序方式
 */
export async function GET(request: NextRequest) {
  try {
    // 验证用户登录
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { message: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'mixed';
    const gender = searchParams.get('gender') || 'ALL';
    const ageMin = parseInt(searchParams.get('ageMin') || '18');
    const ageMax = parseInt(searchParams.get('ageMax') || '65');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50);
    const minMatchScore = parseInt(searchParams.get('minMatchScore') || '60');
    const sortBy = searchParams.get('sortBy') || 'match';
    
    const skip = (page - 1) * limit;
    
    // 获取当前用户的完整Profile用于匹配计算
    const currentUserProfile = await db.profile.findUnique({
      where: { userId: session.user.id },
    });
    
    const currentUserProfileData = currentUserProfile ? toUserProfile(currentUserProfile) : null;
    const currentUserCompletion = calculateProfileCompletion(currentUserProfile);
    
    // 构建基础筛选条件
    const baseWhere: any = {
      age: { gte: ageMin, lte: ageMax },
    };
    
    if (gender !== 'ALL') {
      baseWhere.gender = gender;
    }
    
    let bots: any[] = [];
    let newUsers: any[] = [];
    let totalBots = 0;
    let totalNewUsers = 0;
    
    // 获取数字用户 (Bot) - 使用 isBot 字段而非 role 字段
    if (type === 'bots' || type === 'mixed') {
      const botWhere = {
        ...baseWhere,
        user: { isBot: true },
      };
      
      // 获取所有符合条件的Bot（用于计算匹配度）
      const allBots = await db.profile.findMany({
        where: botWhere,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              createdAt: true,
              _count: {
                select: {
                  receivedMatches: true,
                },
              },
            },
          },
          botProfile: true,
        },
        orderBy: [
          { user: { createdAt: 'desc' } },
          { displayName: 'asc' },
        ],
      });
      
      // 计算匹配度并过滤
      const botsWithScores = allBots.map(bot => {
        const botProfileData = toUserProfile(bot);
        const completion = calculateProfileCompletion(bot);
        
        // 如果当前用户资料完整，计算匹配度
        let matchScore = null;
        let matchReason = '';
        if (currentUserProfileData && currentUserCompletion >= SQUARE_CONFIG.PROFILE_COMPLETION_THRESHOLD) {
          const score = calculateMatchScore(currentUserProfileData, botProfileData);
          matchScore = score.total;
          matchReason = score.reason;
        }
        
        return {
          ...bot,
          completion,
          matchScore,
          matchReason,
        };
      });
      
      // 过滤：资料完整度达标，且匹配度达标（如果可计算）
      const filteredBots = botsWithScores.filter(bot => {
        // 基础要求：资料完整度
        if (bot.completion < SQUARE_CONFIG.PROFILE_COMPLETION_THRESHOLD) {
          return false;
        }
        // 如果当前用户资料完整，则要求匹配度达标
        if (currentUserProfileData && currentUserCompletion >= SQUARE_CONFIG.PROFILE_COMPLETION_THRESHOLD) {
          return bot.matchScore !== null && bot.matchScore >= minMatchScore;
        }
        return true;
      });
      
      totalBots = filteredBots.length;
      
      // 排序
      const sortedBots = sortBy === 'match' && currentUserProfileData
        ? filteredBots.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0))
        : sortBy === 'popular'
        ? filteredBots.sort((a, b) => (b.user._count?.receivedMatches || 0) - (a.user._count?.receivedMatches || 0))
        : filteredBots;
      
      // 分页
      bots = sortedBots.slice(skip, skip + (type === 'bots' ? limit : SQUARE_CONFIG.MAX_BOTS_PER_PAGE));
    }
    
    // 获取新用户 - 排除Bot用户
    if (type === 'new' || type === 'mixed') {
      const newUserDate = new Date();
      newUserDate.setDate(newUserDate.getDate() - SQUARE_CONFIG.NEW_USER_DAYS);
      
      const newUserWhere = {
        ...baseWhere,
        user: {
          isBot: false, // 只显示真实用户
          createdAt: { gte: newUserDate },
        },
      };
      
      // 获取所有符合条件的新用户
      const allNewUsers = await db.profile.findMany({
        where: newUserWhere,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              createdAt: true,
              _count: {
                select: {
                  receivedMatches: true,
                },
              },
            },
          },
        },
        orderBy: [
          { user: { createdAt: 'desc' } },
        ],
      });
      
      // 计算匹配度并过滤
      const newUsersWithScores = allNewUsers.map(user => {
        const userProfileData = toUserProfile(user);
        const completion = calculateProfileCompletion(user);
        
        // 如果当前用户资料完整，计算匹配度
        let matchScore = null;
        let matchReason = '';
        if (currentUserProfileData && currentUserCompletion >= SQUARE_CONFIG.PROFILE_COMPLETION_THRESHOLD) {
          const score = calculateMatchScore(currentUserProfileData, userProfileData);
          matchScore = score.total;
          matchReason = score.reason;
        }
        
        return {
          ...user,
          completion,
          matchScore,
          matchReason,
        };
      });
      
      // 过滤：资料完整度达标，且匹配度达标（如果可计算）
      const filteredNewUsers = newUsersWithScores.filter(user => {
        // 基础要求：资料完整度
        if (user.completion < SQUARE_CONFIG.PROFILE_COMPLETION_THRESHOLD) {
          return false;
        }
        // 如果当前用户资料完整，则要求匹配度达标
        if (currentUserProfileData && currentUserCompletion >= SQUARE_CONFIG.PROFILE_COMPLETION_THRESHOLD) {
          return user.matchScore !== null && user.matchScore >= minMatchScore;
        }
        return true;
      });
      
      totalNewUsers = filteredNewUsers.length;
      
      // 排序
      const sortedNewUsers = sortBy === 'match' && currentUserProfileData
        ? filteredNewUsers.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0))
        : sortBy === 'popular'
        ? filteredNewUsers.sort((a, b) => (b.user._count?.receivedMatches || 0) - (a.user._count?.receivedMatches || 0))
        : filteredNewUsers;
      
      // 分页
      newUsers = sortedNewUsers.slice(skip, skip + (type === 'new' ? limit : SQUARE_CONFIG.MAX_NEW_USERS_PER_PAGE));
    }
    
    // 格式化响应
    const formatUser = (profile: any, isBot: boolean) => ({
      id: profile.user.id,
      profileId: profile.id,
      displayName: profile.displayName,
      age: profile.age,
      gender: profile.gender,
      location: profile.location,
      bio: profile.bio?.slice(0, 150) + (profile.bio?.length > 150 ? '...' : ''),
      avatar: profile.avatar,
      avatarType: profile.avatarType,
      occupation: profile.occupation,
      company: profile.company,
      isBot,
      isNew: !isBot && new Date(profile.user.createdAt) > new Date(Date.now() - SQUARE_CONFIG.NEW_USER_DAYS * 24 * 60 * 60 * 1000),
      joinedAt: profile.user.createdAt,
      popularity: profile.user._count?.receivedMatches || 0,
      // 匹配度信息
      matchScore: profile.matchScore,
      matchReason: profile.matchReason,
      profileCompletion: profile.completion,
      // Bot特有字段
      ...(isBot && profile.botProfile ? {
        botType: profile.botProfile.botType,
        activityLevel: profile.botProfile.activityLevel,
        interests: profile.botProfile.interests,
      } : {}),
    });
    
    const formattedBots = bots.map(b => formatUser(b, true));
    const formattedNewUsers = newUsers.map(u => formatUser(u, false));
    
    // 混合模式下合并并按匹配度排序
    let users;
    if (type === 'mixed') {
      const combined = [...formattedBots, ...formattedNewUsers];
      users = sortBy === 'match' && currentUserProfileData
        ? combined.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0))
        : combined.sort(() => Math.random() - 0.5);
    } else {
      users = type === 'bots' ? formattedBots : formattedNewUsers;
    }
    
    // 分页
    const total = type === 'mixed' ? totalBots + totalNewUsers : type === 'bots' ? totalBots : totalNewUsers;
    const totalPages = Math.ceil(total / limit);
    
    return NextResponse.json({
      success: true,
      data: {
        users,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasMore: page < totalPages,
        },
        stats: {
          totalBots,
          totalNewUsers,
          showingBots: formattedBots.length,
          showingNewUsers: formattedNewUsers.length,
        },
        filters: {
          minMatchScore,
          profileCompletionThreshold: SQUARE_CONFIG.PROFILE_COMPLETION_THRESHOLD,
          currentUserCompletion,
          sortBy,
        },
      },
    });
    
  } catch (error) {
    console.error('[API] Square error:', error);
    return NextResponse.json(
      { message: 'Failed to fetch square users' },
      { status: 500 }
    );
  }
}
