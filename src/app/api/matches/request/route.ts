/**
 * Match Request API - 发送连接申请
 * 
 * POST /api/matches/request - 向目标用户发送连接申请
 * 
 * 权限规则:
 * - 男用户: 免费5次，超出需购买套餐
 * - 女用户: 免费5次/周
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/auth';
import { db } from '@/lib/db';
import { calculateMatchScore } from '@/lib/matching/engine';

export const dynamic = 'force-dynamic';

// 每周免费连接次数配置
const CONNECTION_LIMITS = {
  MALE: {
    FREE: 5, // 男用户总共5次免费
    WEEKLY: 0, // 无周限制，用完即止
  },
  FEMALE: {
    FREE: Infinity, // 女用户免费次数无上限
    WEEKLY: 5, // 但每周限制5次
  },
};

/**
 * POST /api/matches/request - 发送连接申请
 * 
 * Body:
 * - targetUserId: string - 目标用户ID
 * - pitchMessage?: string - 申请信（可选）
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { message: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { targetUserId, pitchMessage } = body;

    if (!targetUserId) {
      return NextResponse.json(
        { message: 'Target user ID is required' },
        { status: 400 }
      );
    }

    // 不能向自己发送申请
    if (targetUserId === session.user.id) {
      return NextResponse.json(
        { message: 'Cannot send connection request to yourself' },
        { status: 400 }
      );
    }

    // 获取当前用户资料
    const currentUserProfile = await db.profile.findUnique({
      where: { userId: session.user.id },
      include: { user: true },
    });

    if (!currentUserProfile) {
      return NextResponse.json(
        { message: 'Profile not found' },
        { status: 404 }
      );
    }

    // 获取目标用户资料
    const targetUserProfile = await db.profile.findUnique({
      where: { userId: targetUserId },
      include: { user: true },
    });

    if (!targetUserProfile) {
      return NextResponse.json(
        { message: 'Target user not found' },
        { status: 404 }
      );
    }

    // 检查是否已经有进行中的匹配
    const existingMatch = await db.match.findFirst({
      where: {
        OR: [
          { senderId: session.user.id, receiverId: targetUserId },
          { senderId: targetUserId, receiverId: session.user.id },
        ],
        status: {
          in: ['PENDING', 'ACCEPTED'],
        },
      },
    });

    if (existingMatch) {
      return NextResponse.json(
        { message: 'A connection already exists with this user' },
        { status: 400 }
      );
    }

    // 检查连接次数限制
    const isMale = currentUserProfile.gender === 'MALE';
    
    // 检查是否有活跃订阅
    const subscription = await db.subscription.findFirst({
      where: {
        userId: session.user.id,
        status: 'ACTIVE',
        endsAt: {
          gt: new Date(),
        },
      },
    });

    const hasActiveSubscription = !!subscription;

    // 计算本周已使用的连接次数
    const now = new Date();
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
    
    const weeklyConnections = await db.match.count({
      where: {
        senderId: session.user.id,
        createdAt: {
          gte: weekStart,
        },
      },
    });

    // 计算总连接次数（男用户）
    const totalConnections = isMale ? await db.match.count({
      where: {
        senderId: session.user.id,
      },
    }) : 0;

    // 检查限制
    if (isMale && !hasActiveSubscription) {
      // 男用户：总共5次免费
      if (totalConnections >= CONNECTION_LIMITS.MALE.FREE) {
        return NextResponse.json(
          { 
            message: 'You have used all your free connections. Please upgrade to Premium.',
            code: 'UPGRADE_REQUIRED',
          },
          { status: 403 }
        );
      }
    } else {
      // 女用户：每周5次
      if (weeklyConnections >= CONNECTION_LIMITS.FEMALE.WEEKLY) {
        return NextResponse.json(
          { 
            message: 'You have reached your weekly connection limit. Please try again next week.',
            code: 'WEEKLY_LIMIT_REACHED',
          },
          { status: 403 }
        );
      }
    }

    // 计算匹配度
    const currentUserData = {
      id: currentUserProfile.userId,
      attachmentStyle: currentUserProfile.attachmentStyle,
      communicationStyle: currentUserProfile.communicationStyle,
      conflictResolution: currentUserProfile.conflictResolution,
      loveLanguage: currentUserProfile.loveLanguage,
      lifePriorities: currentUserProfile.lifePriorities,
      relationshipGoal: currentUserProfile.relationshipGoal,
      boundaries: currentUserProfile.boundaries,
      dealbreakers: currentUserProfile.dealbreakers,
      emotionalAvailability: currentUserProfile.emotionalAvailability,
      preferredAgeMin: currentUserProfile.preferredAgeMin,
      preferredAgeMax: currentUserProfile.preferredAgeMax,
      preferredGender: currentUserProfile.preferredGender,
      preferredDistance: currentUserProfile.preferredDistance,
      age: currentUserProfile.age,
      gender: currentUserProfile.gender,
      city: currentUserProfile.city,
      country: currentUserProfile.country,
    };

    const targetUserData = {
      id: targetUserProfile.userId,
      attachmentStyle: targetUserProfile.attachmentStyle,
      communicationStyle: targetUserProfile.communicationStyle,
      conflictResolution: targetUserProfile.conflictResolution,
      loveLanguage: targetUserProfile.loveLanguage,
      lifePriorities: targetUserProfile.lifePriorities,
      relationshipGoal: targetUserProfile.relationshipGoal,
      boundaries: targetUserProfile.boundaries,
      dealbreakers: targetUserProfile.dealbreakers,
      emotionalAvailability: targetUserProfile.emotionalAvailability,
      preferredAgeMin: targetUserProfile.preferredAgeMin,
      preferredAgeMax: targetUserProfile.preferredAgeMax,
      preferredGender: targetUserProfile.preferredGender,
      preferredDistance: targetUserProfile.preferredDistance,
      age: targetUserProfile.age,
      gender: targetUserProfile.gender,
      city: targetUserProfile.city,
      country: targetUserProfile.country,
    };

    const matchScore = calculateMatchScore(currentUserData, targetUserData);

    // 创建匹配
    const senderId = session.user.id;
    if (!senderId) {
      return NextResponse.json(
        { message: 'User ID not found' },
        { status: 401 }
      );
    }
    
    const match = await db.match.create({
      data: {
        senderId,
        receiverId: targetUserId,
        matchScore: matchScore.total,
        matchReason: matchScore.reason,
        attachmentCompat: matchScore.attachment,
        communicationCompat: matchScore.communication,
        conflictCompat: matchScore.conflict,
        valuesCompat: matchScore.values,
        lifestyleCompat: matchScore.lifestyle,
        status: 'PENDING',
        matchType: 'WEEKLY',
        pitchMessage: pitchMessage || null,
        isUnread: true,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7天后过期
      },
    });

    // 创建通知
    await db.notification.create({
      data: {
        userId: targetUserId,
        type: 'NEW_MATCH',
        title: 'New Connection Request',
        body: `${currentUserProfile.displayName} wants to connect with you!`,
        data: JSON.stringify({ matchId: match.id }),
        actionUrl: `/dashboard/matches/${match.id}`,
      },
    });

    // 计算剩余次数
    const remainingConnections = isMale && !hasActiveSubscription
      ? Math.max(0, CONNECTION_LIMITS.MALE.FREE - (totalConnections + 1))
      : Math.max(0, CONNECTION_LIMITS.FEMALE.WEEKLY - (weeklyConnections + 1));

    return NextResponse.json({
      success: true,
      message: 'Connection request sent successfully',
      data: {
        matchId: match.id,
        matchScore: matchScore.total,
        remainingConnections,
      },
    });

  } catch (error) {
    console.error('[API] Match request error:', error);
    return NextResponse.json(
      { message: 'Failed to send connection request' },
      { status: 500 }
    );
  }
}
