/**
 * Bot系统状态API
 * 用于监控数字用户系统的运行状态
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

const prisma = getDb();

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    // 统计数字用户信息
    const [
      totalBots,
      onlineBots,
      activeToday,
      totalMatches,
      totalMessages
    ] = await Promise.all([
      // 总Bot数
      prisma.botProfile.count(),
      
      // 在线Bot数（简化逻辑：最近1小时有活动的）
      prisma.botInteractionLog.groupBy({
        by: ['botProfileId' as any],
        where: {
          createdAt: {
            gte: new Date(Date.now() - 60 * 60 * 1000)
          }
        },
        _count: true
      }).then(logs => logs.length),
      
      // 今日活跃的Bot
      prisma.botInteractionLog.groupBy({
        by: ['botProfileId' as any],
        where: {
          createdAt: {
            gte: new Date(new Date().setHours(0, 0, 0, 0))
          }
        },
        _count: true
      }).then(logs => logs.length),
      
      // Bot参与的匹配数
      prisma.match.count({
        where: {
          OR: [
            { sender: { email: { endsWith: '@lokfeel.bot' } } },
            { receiver: { email: { endsWith: '@lokfeel.bot' } } }
          ]
        }
      }),
      
      // Bot发送的消息数
      prisma.message.count({
        where: {
          sender: { email: { endsWith: '@lokfeel.bot' } }
        }
      })
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

  } catch (error) {
    console.error('Bot状态API错误:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
