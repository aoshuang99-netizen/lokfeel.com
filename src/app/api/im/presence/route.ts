/**
 * GET /api/im/presence — Get online status for users
 * POST /api/im/presence — Update own presence status
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { handleApiError } from '@/lib/api-handler';
import { presenceManager } from '@/lib/im';

export const dynamic = 'force-dynamic';

// GET — Batch get presence status
export async function GET(request: NextRequest) {
  return handleApiError(async () => {
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
  });
}

// POST — Update own presence
export async function POST(request: NextRequest) {
  return handleApiError(async () => {
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
  });
}
