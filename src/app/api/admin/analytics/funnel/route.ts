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
    const [totalUsers, profileStarted, profileCompleted, activeUsers] = await Promise.all([
      db.user.count(),
      db.userProfile.count(),
      db.user.count({ where: { profile: { isNot: null } } }),
      db.message.count({ where: { createdAt: { gte: thirtyDaysAgo } }, distinct: ['senderId'] }),
    ]);

    const subscriptionCount = await db.subscription.count({ where: { status: 'ACTIVE' } });

    const funnel = [
      { stage: '注册用户', count: totalUsers, pct: 100 },
      { stage: '开始填写资料', count: profileStarted, pct: Math.round((profileStarted / totalUsers) * 100) },
      { stage: '资料已完成', count: profileCompleted, pct: Math.round((profileCompleted / totalUsers) * 100) },
      { stage: '活跃用户', count: activeUsers, pct: Math.round((activeUsers / totalUsers) * 100) },
      { stage: '付费订阅', count: subscriptionCount, pct: Math.round((subscriptionCount / totalUsers) * 100) },
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
