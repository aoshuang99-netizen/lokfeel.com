/**
 * Vercel Cron Job — Bot Engine Health & Status
 *
 * This endpoint provides an overview of the bot engine status.
 * CRON ONLY — Protected by CRON_SECRET (consistent with all other cron endpoints)
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

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
      where: { isBot: true, role: 'USER' },
    });

    // Get recent bot events (last hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentEvents = await db.analyticsEvent.count({
      where: {
        user: { isBot: true },
        createdAt: { gte: oneHourAgo },
      },
    });

    // Get pending matches
    const pendingMatches = await db.match.count({
      where: { status: 'PENDING' },
    });

    // Get active chat rooms with bots
    const activeBotChats = await db.chatRoomMember.count({
      where: {
        user: { isBot: true },
        room: {
          isArchived: false,
          lastMessageAt: { gte: oneHourAgo },
        },
      },
    });

    // Get recent messages from bots
    const recentBotMessages = await db.message.count({
      where: {
        sender: { isBot: true },
        createdAt: { gte: oneHourAgo },
      },
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
      cronEndpoints: [
        { path: '/api/cron/bot-tick', schedule: 'Every minute', purpose: 'Process tick' },
        { path: '/api/cron/bot-online', schedule: 'Every 15 min', purpose: 'Online status' },
        { path: '/api/cron/bot-match', schedule: 'Every hour', purpose: 'Match responses' },
        { path: '/api/cron/bot-chat', schedule: 'Every 5 min', purpose: 'Chat responses' },
      ],
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
