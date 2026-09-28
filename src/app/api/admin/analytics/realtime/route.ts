import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/with-permission';
import { success } from '@/lib/api-response';
import { db } from '@/lib/db';
import { countMessages, countDistinctMessageSenders } from '@/lib/im/stats';
import { startOfMinute } from 'date-fns';

export const dynamic = 'force-dynamic';

export const GET = withPermission('system.health')(async (req: NextRequest) => {
  try {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);

    // P1-6 阶段 5：改为统一迁移安全口径（见 lib/im/stats 模块头部的阶段对照表）。
    // 顺带修掉一个既有隐患：原实现在 Legacy 侧用了 `groupBy`，而 Turso/libSQL 上
    // `groupBy` 不稳定（同目录 analytics/route.ts 早有注释记录）。stats 封装统一走
    // `findMany + distinct`，与其它看板口径一致。
    const [activeUsers, messagesThisHour] = await Promise.all([
      countDistinctMessageSenders({ window: { gte: fiveMinAgo } }),
      countMessages({ window: { gte: oneHourAgo } }),
    ]);

    // Pending matches
    const pendingMatches = await db.match.count({
      where: { status: 'PENDING' },
    });

    // Recent signups
    const recentSignups = await db.user.count({
      where: { createdAt: { gte: oneHourAgo } },
    });

    // System health metrics (simulated)
    const apiLatency = Math.round(50 + Math.random() * 100);
    const errorRate = Math.round(Math.random() * 3 * 100) / 100;
    const uptime = 99.9 + Math.random() * 0.1;

    const metrics = {
      activeUsers: activeUsers || Math.floor(Math.random() * 20) + 5,
      messagesPerMinute: Math.round(messagesThisHour / 60) || Math.floor(Math.random() * 10),
      pendingMatches,
      recentSignups,
      system: {
        apiLatency: { value: apiLatency, unit: 'ms', status: apiLatency < 200 ? 'good' : 'warning' },
        errorRate: { value: errorRate, unit: '%', status: errorRate < 1 ? 'good' : 'warning' },
        uptime: { value: Math.round(uptime * 100) / 100, unit: '%', status: 'good' },
        dbConnections: { value: Math.floor(Math.random() * 20) + 5, unit: '', status: 'good' },
      },
    };

    return success({
      metrics,
      timestamp: now.toISOString(),
      trend: {
        users: Math.random() > 0.5 ? 'up' : 'down',
        messages: Math.random() > 0.5 ? 'up' : 'down',
      },
    });
  } catch (error: any) {
    console.error('Realtime API error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
});
