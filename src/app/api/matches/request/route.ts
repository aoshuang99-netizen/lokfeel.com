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

// ═══ Connection limits by plan ═══
// Lady Free (women): 5/week, no total limit
// Free (men): 3/week, after that upgrade required
// Premium: 5/week, no total limit
const CONNECTION_LIMITS = {
  FREE: {
    WEEKLY: 3,
    TOTAL: 3, // 3 total free, then upgrade
  },
  LADY_FREE: {
    WEEKLY: 5,
    TOTAL: Infinity,
  },
  PREMIUM: {
    WEEKLY: 5,
    TOTAL: Infinity,
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

    // 检查连接次数限制 — Plan-based logic
    const isFemale = currentUserProfile.gender === 'FEMALE';
    
    // 检查是否有活跃订阅
    const subscription = await db.subscription.findFirst({
      where: {
        userId: session.user.id,
        status: 'ACTIVE',
      },
    });

    const hasActiveSubscription = !!subscription;
    
    // Determine plan: Premium > Lady Free > Free
    const planId = hasActiveSubscription
      ? (subscription.plan === 'LADY_FREE' ? 'LADY_FREE' : 'PREMIUM')
      : (isFemale ? 'LADY_FREE' : 'FREE'); // Fallback: detect gender for users without subscription record
    
    const limits = CONNECTION_LIMITS[planId as keyof typeof CONNECTION_LIMITS];

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

    // 计算总连接次数（Free男用户有总限制）
    const totalConnections = await db.match.count({
      where: {
        senderId: session.user.id,
      },
    });

    // 检查周限制
    if (weeklyConnections >= limits.WEEKLY) {
      const message = planId === 'FREE'
        ? 'You have reached your weekly connection limit (3/week). Upgrade to Premium for 5 matches/week.'
        : 'You have reached your weekly connection limit. Please try again next week.';
      return NextResponse.json(
        { message, code: planId === 'FREE' ? 'UPGRADE_REQUIRED' : 'WEEKLY_LIMIT_REACHED' },
        { status: 403 }
      );
    }

    // 检查总限制（Free用户只有3次总连接）
    if (limits.TOTAL !== Infinity && totalConnections >= limits.TOTAL) {
      return NextResponse.json(
        { 
          message: 'You have used all your free connections. Upgrade to Premium for unlimited matching.',
          code: 'UPGRADE_REQUIRED',
        },
        { status: 403 }
      );
    }

    // ═══ Card Verification Check ═══
    // After using free matches, ALL users (including Lady Free) must verify a card
    const userRecord = await db.user.findUnique({
      where: { id: session.user.id },
      select: { cardVerified: true },
    });

    const cardVerified = userRecord?.cardVerified ?? false;
    const freeMatchesUsed = totalConnections >= 2; // After 2 free matches, require card

    if (!cardVerified && freeMatchesUsed) {
      return NextResponse.json(
        {
          message: 'Please verify your card to continue matching. This is for identity verification only — no charges.',
          code: 'CARD_VERIFICATION_REQUIRED',
        },
        { status: 403 }
      );
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
    const remainingConnections = limits.TOTAL === Infinity
      ? Math.max(0, limits.WEEKLY - (weeklyConnections + 1))
      : Math.max(0, limits.TOTAL - (totalConnections + 1));

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
