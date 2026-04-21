/**
 * GET /api/im/presence — Get online status for users
 * POST /api/im/presence — Update own presence status
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { presenceManager } from '@/lib/im';

export const dynamic = 'force-dynamic';

// GET — Batch get presence status
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth();
    const { searchParams } = new URL(request.url);
    const userIds = searchParams.get('userIds')?.split(',').filter(Boolean) || [];

    if (userIds.length === 0) {
      return NextResponse.json({ presences: {} });
    }

    // Limit batch size
    const limitedIds = userIds.slice(0, 50);
    const presenceMap = await presenceManager.getPresenceBatch(limitedIds);

    const presences: Record<string, any> = {};
    for (const [userId, info] of presenceMap) {
      presences[userId] = {
        status: info.status,
        lastSeenAt: info.lastSeenAt,
        platform: info.platform,
      };
    }

    return NextResponse.json({ presences });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[IM Presence GET] Error:', error);
    return NextResponse.json({ error: 'Failed to get presence' }, { status: 500 });
  }
}

// POST — Update own presence
export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuth();
    const { status, statusMessage } = await request.json();

    if (!status || !['ONLINE', 'AWAY', 'BUSY', 'OFFLINE'].includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status. Must be: ONLINE, AWAY, BUSY, or OFFLINE' },
        { status: 400 }
      );
    }

    await presenceManager.setPresence(user.id, status, statusMessage);

    // Also update DB record for persistence
    const { db } = await import('@/lib/db');
    await db.userPresence.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        status,
        statusMessage,
        lastSeenAt: new Date(),
      },
      update: {
        status,
        statusMessage,
        lastSeenAt: new Date(),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[IM Presence POST] Error:', error);
    return NextResponse.json({ error: 'Failed to update presence' }, { status: 500 });
  }
}
