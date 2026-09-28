import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/with-permission';
import { db } from '@/lib/db';
import { countDistinctMessageSenders } from '@/lib/im/stats';
import { success } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

export const GET = withPermission('analytics.view')(async (req: NextRequest) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Funnel stages (simulated based on real data)
    // P1-6 阶段 5：「活跃用户」一档原读 Legacy `Message` 表（groupBy），是删表阻断点。
    // 改为 stats 封装后口径与 analytics/real-time 一致，且不再依赖 libSQL 上不稳定的 groupBy。
    const [totalUsers, profileStarted, profileCompleted, recentActiveUsers] = await Promise.all([
      db.user.count(),
      db.profile.count(),
      db.user.count({ where: { profile: { isNot: null } } }),
      countDistinctMessageSenders({ window: { gte: thirtyDaysAgo } }),
    ]);

    const subscriptionCount = await db.subscription.count({ where: { status: 'ACTIVE' } });

    const funnel = [
      { stage: '注册用户', count: totalUsers, pct: 100 },
      { stage: '开始填写资料', count: profileStarted, pct: Math.round((profileStarted / totalUsers) * 100) || 0 },
      { stage: '资料已完成', count: profileCompleted, pct: Math.round((profileCompleted / totalUsers) * 100) || 0 },
      { stage: '活跃用户', count: recentActiveUsers, pct: Math.round((recentActiveUsers / totalUsers) * 100) || 0 },
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
