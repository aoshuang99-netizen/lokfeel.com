/**
 * Bot系统状态API
 * 用于监控数字用户系统的运行状态
 * ⚠️ ADMIN ONLY — Protected endpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdminAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireAdminAuth();

    // 统计数字用户信息
    const [totalBots, totalMatches, totalMessages] = await Promise.all([
      // 总Bot数
      db.botProfile.count(),

      // Bot参与的匹配数
      db.match.count({
        where: {
          OR: [
            { sender: { email: { endsWith: '@lokfeel.bot' } } },
            { receiver: { email: { endsWith: '@lokfeel.bot' } } }
          ]
        }
      }),

      // Bot发送的消息数
      db.message.count({
        where: {
          sender: { email: { endsWith: '@lokfeel.bot' } }
        }
      })
    ]);

    // Count distinct active bots — Turso-compatible (no groupBy)
    // groupBy is unstable on Turso/libSQL, use distinct + findMany instead
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const startOfDay = new Date(new Date().setHours(0, 0, 0, 0));

    const [onlineBots, activeToday] = await Promise.all([
      db.botInteractionLog.findMany({
        where: { createdAt: { gte: oneHourAgo } },
        select: { botUserId: true },
        distinct: ['botUserId'],
      }).then(logs => logs.length),

      db.botInteractionLog.findMany({
        where: { createdAt: { gte: startOfDay } },
        select: { botUserId: true },
        distinct: ['botUserId'],
      }).then(logs => logs.length),
    ]);

    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      stats: {
        totalBots,
        onlineBots,
        activeToday,
        totalMatches,
        totalMessages,
        activityRate: totalBots > 0 ? Math.round((activeToday / totalBots) * 100) : 0
      }
    });

  } catch (error: any) {
    if (error?.message?.includes('Unauthorized') || error?.message?.includes('Forbidden') || error?.message?.includes('Admin')) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }
    console.error('Bot状态API错误:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
