import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sincerity/wallet
 * 
 * 获取用户诚意值钱包信息
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth();
    const userId = user.id;

    // 获取或创建钱包
    let wallet = await db.sincerityWallet.findUnique({
      where: { userId },
      include: {
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        }
      }
    });

    if (!wallet) {
      wallet = await db.sincerityWallet.create({
        data: {
          userId,
          balance: 0,
          totalEarned: 0,
          totalSpent: 0,
          totalGifted: 0,
          totalReceived: 0,
          tier: 'BRONZE',
          tierProgress: 0,
        },
        include: {
          transactions: {
            orderBy: { createdAt: 'desc' },
            take: 10,
          }
        }
      });
    }

    // 计算下一级所需积分
    const tierThresholds: Record<string, { next: string | null; min: number; max: number; nextMin: number | null }> = {
      BRONZE: { next: 'SILVER', min: 0, max: 499, nextMin: 500 },
      SILVER: { next: 'GOLD', min: 500, max: 1999, nextMin: 2000 },
      GOLD: { next: 'PLATINUM', min: 2000, max: 4999, nextMin: 5000 },
      PLATINUM: { next: null, min: 5000, max: Infinity, nextMin: null },
    };

    const currentTier = tierThresholds[wallet.tier];
    const progress = currentTier.nextMin 
      ? Math.min(100, ((wallet.totalEarned - currentTier.min) / (currentTier.nextMin - currentTier.min)) * 100)
      : 100;

    // 获取可赚取的任务
    const earningTasks = await getEarningTasks(userId);

    return NextResponse.json({
      wallet: {
        balance: wallet.balance,
        totalEarned: wallet.totalEarned,
        totalSpent: wallet.totalSpent,
        totalGifted: wallet.totalGifted,
        totalReceived: wallet.totalReceived,
        tier: wallet.tier,
        tierProgress: Math.round(progress * 100) / 100,
        nextTier: currentTier.next,
        pointsToNextTier: currentTier.nextMin ? currentTier.nextMin - wallet.totalEarned : 0,
      },
      recentTransactions: wallet.transactions.map((t: any) => ({
        id: t.id,
        type: t.type,
        amount: t.amount,
        source: t.source,
        description: t.description,
        createdAt: t.createdAt,
      })),
      earningTasks,
    });

  } catch (error) {
    console.error('Wallet API Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * 获取可赚取的任务列表
 */
async function getEarningTasks(userId: string) {
  const profile = await db.profile.findUnique({
    where: { userId },
    select: {
      bio: true,
      avatar: true,
      attachmentStyle: true,
      communicationStyle: true,
      conflictResolution: true,
      loveLanguage: true,
    }
  });

  const wallet = await db.sincerityWallet.findUnique({
    where: { userId }
  });

  const tasks = [
    {
      id: 'complete_profile',
      title: 'Complete Your Profile',
      description: 'Fill in all relationship blueprint fields',
      points: 100,
      completed: !!(profile?.bio && profile?.attachmentStyle && profile?.communicationStyle),
      action: '/onboarding',
    },
    {
      id: 'upload_avatar',
      title: 'Upload Profile Photo',
      description: 'Add a profile picture',
      points: 50,
      completed: !!profile?.avatar,
      action: '/settings/profile',
    },
    {
      id: 'daily_login',
      title: 'Daily Login Bonus',
      description: 'Login today to claim',
      points: 10,
      completed: false, // 需要检查今日是否已登录
      action: null,
      claimable: true,
    },
    {
      id: 'verify_email',
      title: 'Verify Email',
      description: 'Confirm your email address',
      points: 50,
      completed: true, // 假设已验证
      action: null,
    },
    {
      id: 'first_match',
      title: 'Get Your First Match',
      description: 'Receive your first match recommendation',
      points: 25,
      completed: (wallet?.totalEarned || 0) > 0,
      action: '/dashboard',
    },
    {
      id: 'send_pitch',
      title: 'Send a Pitch Message',
      description: 'Write a personalized message to a match',
      points: 15,
      completed: false, // 需要查询
      action: '/dashboard/matches',
    },
    {
      id: 'invite_friend',
      title: 'Invite a Friend',
      description: 'Share LokFeel with someone',
      points: 100,
      completed: false,
      action: '/invite',
    },
  ];

  return tasks;
}
