import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/with-permission';
import { db } from '@/lib/db';
import { success } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

export const GET = withPermission('analytics.view')(async (req: NextRequest) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Funnel stages (simulated based on real data)
    const [totalUsers, profileStarted, profileCompleted, recentMessages] = await Promise.all([
      db.user.count(),
      db.profile.count(),
      db.user.count({ where: { profile: { isNot: null } } }),
      db.message.groupBy({
        by: ['senderId'],
        where: { createdAt: { gte: thirtyDaysAgo } },
      }),
    ]);

    const subscriptionCount = await db.subscription.count({ where: { status: 'ACTIVE' } });

    const funnel = [
      { stage: '注册用户', count: totalUsers, pct: 100 },
      { stage: '开始填写资料', count: profileStarted, pct: Math.round((profileStarted / totalUsers) * 100) || 0 },
      { stage: '资料已完成', count: profileCompleted, pct: Math.round((profileCompleted / totalUsers) * 100) || 0 },
      { stage: '活跃用户', count: recentMessages.length, pct: Math.round((recentMessages.length / totalUsers) * 100) || 0 },
      { stage: '付费订阅', count: subscriptionCount, pct: Math.round((subscriptionCount / totalUsers) * 100) || 0 },
    ];

    return success({ funnel, total: totalUsers });
  } catch (error: any) {
    console.error('Funnel API error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
});
