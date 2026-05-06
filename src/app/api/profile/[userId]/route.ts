export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/auth"
import { handleApiError } from "@/lib/api-handler";
import { calculateMatchScore } from '@/lib/matching/engine';
import { jsonArr } from '@/lib/json-helpers';

interface RouteParams {
  params: Promise<{ userId: string }>;
}

// 每周免费连接次数
const WEEKLY_FREE_CONNECTIONS = {
  MALE: 5,
  FEMALE: 5,
};

export async function GET(request: NextRequest, { params }: RouteParams) {
  return handleApiError(async () => {
    const { user } = await requireAuth();
    const { userId } = await params;

    // 获取目标用户资料
    const profile = await db.profile.findUnique({
      where: { userId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            createdAt: true,
            isBot: true,
            _count: {
              select: {
                receivedMatches: true,
              },
            },
          },
        },
        botProfile: true,
      },
    });

    if (!profile) {
      return NextResponse.json(
        { message: 'Profile not found' },
        { status: 404 }
      );
    }

    // 获取当前用户资料
    const currentUserProfile = await db.profile.findUnique({
      where: { userId: user.id },
      include: { user: true },
    });

    if (!currentUserProfile) {
      return NextResponse.json(
        { message: 'Current user profile not found' },
        { status: 404 }
      );
    }

    // 计算匹配度
    let matchScore = null;
    let matchReason = '';

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
      id: profile.userId,
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

    const score = calculateMatchScore(currentUserData, targetUserData);
    matchScore = score.total;
    matchReason = score.reason;

    // 获取标签
    const tags: string[] = [];
    const sexuality = profile.sexuality?.toLowerCase() || '';
    if (sexuality.includes('gay')) tags.push('Gay');
    if (sexuality.includes('lesbian')) tags.push('Lesbian');
    if (sexuality.includes('bisexual')) tags.push('Bisexual');
    if (sexuality.includes('pansexual')) tags.push('Pansexual');
    if (sexuality.includes('queer')) tags.push('Queer');

    const relationshipGoal = profile.relationshipGoal?.toLowerCase() || '';
    if (relationshipGoal.includes('open') || relationshipGoal.includes('poly')) {
      tags.push('Open Relationship');
    }
    if (relationshipGoal.includes('kink') || relationshipGoal.includes('bdsm')) {
      tags.push('Kink');
    }

    // 获取当前用户的连接次数状态
    const now = new Date();
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());

    const weeklyConnections = await db.match.count({
      where: {
        senderId: user.id,
        createdAt: {
          gte: weekStart,
        },
      },
    });

    // 检查是否有活跃订阅
    const subscription = await db.subscription.findFirst({
      where: {
        userId: user.id,
        status: 'ACTIVE',
        endsAt: {
          gt: new Date(),
        },
      },
    });

    const hasActiveSubscription = !!subscription;
    const isMale = currentUserProfile.gender === 'MALE';

    // 计算剩余连接次数
    const weeklyLimit = isMale && !hasActiveSubscription
      ? WEEKLY_FREE_CONNECTIONS.MALE
      : WEEKLY_FREE_CONNECTIONS.FEMALE;
    const remainingConnections = Math.max(0, weeklyLimit - weeklyConnections);

    // 格式化响应
    const formattedProfile = {
      id: profile.user.id,
      userId: profile.user.id,
      profileId: profile.id,
      displayName: profile.displayName,
      age: profile.age,
      gender: profile.gender,
      location: profile.city,
      bio: profile.bio,
      avatar: profile.avatar,
      avatarType: profile.avatarType,
      occupation: profile.occupation,
      company: profile.company,
      industry: profile.industry,
      education: null,
      isBot: profile.user.isBot,
      isNew: new Date(profile.user.createdAt) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      joinedAt: profile.user.createdAt,
      popularity: profile.user._count?.receivedMatches || 0,
      matchScore,
      matchReason,
      tags,
      linkedInVerified: profile.linkedInVerified,
      verificationBadge: profile.verificationBadge,
      // 详细资料
      attachmentStyle: profile.attachmentStyle,
      communicationStyle: profile.communicationStyle,
      conflictResolution: profile.conflictResolution,
      loveLanguage: profile.loveLanguage,
      lifePriorities: profile.lifePriorities ? JSON.parse(profile.lifePriorities) : [],
      relationshipGoal: profile.relationshipGoal,
      boundaries: profile.boundaries ? JSON.parse(profile.boundaries) : [],
      dealbreakers: profile.dealbreakers ? JSON.parse(profile.dealbreakers) : [],
      emotionalAvailability: profile.emotionalAvailability,
      interests: jsonArr(profile.botProfile?.interests),
      photos: profile.avatar ? [profile.avatar] : [],
    };

    return NextResponse.json({
      success: true,
      profile: formattedProfile,
      currentUser: {
        gender: currentUserProfile.gender,
        remainingConnections,
        hasActiveSubscription,
        subscriptionPlan: subscription?.plan,
      },
    });
  });
}
