/**
 * Square API - 广场功能
 * 
 * 功能:
 * - 浏览数字用户(Bot)列表
 * - 浏览新注册用户
 * - 筛选和排序
 * - 分页加载
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/auth';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// 广场配置
const SQUARE_CONFIG = {
  PAGE_SIZE: 20,
  NEW_USER_DAYS: 7, // 7天内注册算新用户
  MAX_BOTS_PER_PAGE: 10, // 每页最多Bot数量
  MAX_NEW_USERS_PER_PAGE: 10, // 每页最多新用户数量
};

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
    
    const skip = (page - 1) * limit;
    
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
      
      totalBots = await db.profile.count({ where: botWhere });
      
      bots = await db.profile.findMany({
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
        skip: type === 'bots' ? skip : 0,
        take: type === 'bots' ? limit : SQUARE_CONFIG.MAX_BOTS_PER_PAGE,
        orderBy: [
          { user: { createdAt: 'desc' } },
          { displayName: 'asc' },
        ],
      });
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
      
      totalNewUsers = await db.profile.count({ where: newUserWhere });
      
      newUsers = await db.profile.findMany({
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
        skip: type === 'new' ? skip : 0,
        take: type === 'new' ? limit : SQUARE_CONFIG.MAX_NEW_USERS_PER_PAGE,
        orderBy: [
          { user: { createdAt: 'desc' } },
        ],
      });
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
      // Bot特有字段
      ...(isBot && profile.botProfile ? {
        botType: profile.botProfile.botType,
        activityLevel: profile.botProfile.activityLevel,
        interests: profile.botProfile.interests,
      } : {}),
    });
    
    const formattedBots = bots.map(b => formatUser(b, true));
    const formattedNewUsers = newUsers.map(u => formatUser(u, false));
    
    // 混合模式下合并并打乱
    let users = type === 'mixed' 
      ? [...formattedBots, ...formattedNewUsers].sort(() => Math.random() - 0.5)
      : type === 'bots' ? formattedBots : formattedNewUsers;
    
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
