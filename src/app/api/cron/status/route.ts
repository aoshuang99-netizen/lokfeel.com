/**
 * Vercel Cron Job — Bot Engine Health & Status
 *
 * This endpoint provides an overview of the bot engine status.
 * CRON ONLY — Protected by CRON_SECRET (consistent with all other cron endpoints)
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { countMessages, countActiveBotChats } from '@/lib/im/stats';

export const dynamic = 'force-dynamic';

// GET /api/cron/status
export async function GET(request: Request) {
  // ─── Verify CRON_SECRET (same as all other cron endpoints) ───
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {

    // Get bot count
    const botCount = await db.user.count({
      where: { isBot: { not: false }, role: 'USER' },
    });

    // Get recent bot events (last hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentEvents = await db.analyticsEvent.count({
      where: {
        user: { isBot: { not: false } },
        createdAt: { gte: oneHourAgo },
      },
    });

    // Get pending matches
    const pendingMatches = await db.match.count({
      where: { status: 'PENDING' },
    });

    // Get active chat rooms with bots
    // P1-6 阶段 5：两处均改走 stats 统一口径（原直读 Legacy `ChatRoomMember` / `Message`）。
    //   ActiveBotChats 的归档语义在 IM 侧是 per-participant（见 stats 内注释）。
    const activeBotChats = await countActiveBotChats(oneHourAgo);

    // Get recent messages from bots
    const recentBotMessages = await countMessages({
      window: { gte: oneHourAgo },
      sender: { isBot: true },
    });

    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      engine: {
        botCount,
        isActive: botCount > 0,
      },
      activity: {
        lastHour: {
          events: recentEvents,
          messages: recentBotMessages,
          activeChats: activeBotChats,
        },
      },
      pending: {
        matches: pendingMatches,
      },
    });

  } catch (error: any) {
    if (error?.message?.includes('Unauthorized') || error?.message?.includes('Forbidden') || error?.message?.includes('Admin')) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }
    console.error('[Cron] Status error:', error);
    return NextResponse.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
