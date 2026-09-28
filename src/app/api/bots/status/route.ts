/**
 * Bot系统状态API
 * 用于监控数字用户系统的运行状态
 * ⚠️ ADMIN ONLY — Protected endpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { countMessages } from '@/lib/im/stats';
import { requireAdminAuth } from '@/lib/auth';
import {
  BOT_DISABLED_HTTP_STATUS,
  botDisabledBody,
  isBotEnabled,
} from '@/config/bot-policy';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireAdminAuth();

    // P0-5：Bot 模块总开关（鉴权之后判，避免匿名探测部署配置）
    if (!isBotEnabled()) {
      return NextResponse.json(botDisabledBody(), { status: BOT_DISABLED_HTTP_STATUS });
    }

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
      // P1-6 阶段 5：改走 stats 统一口径（原直读 Legacy `Message`，是删表阻断点）。
      // 该函数在 IM 侧同样按 `sender` 关联过滤，因此 Bot 消息在迁移前后计数一致。
      countMessages({
        sender: { email: { endsWith: '@lokfeel.bot' } }
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
