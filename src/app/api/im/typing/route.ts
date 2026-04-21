/**
 * POST /api/im/typing — Send typing indicator
 *
 * Stores typing state in Redis for cross-instance sync.
 * Clients should debounce typing indicators (e.g., send every 2-3 seconds).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { pushToConversation } from '@/lib/im/websocket/pusher-bridge';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate user
    const { user } = await requireAuth();

    // 2. Parse request body
    const body = await request.json();
    const { conversationId, isTyping } = body;

    if (!conversationId || typeof isTyping !== 'boolean') {
      return NextResponse.json(
        { error: 'Missing conversationId or isTyping' },
        { status: 400 }
      );
    }

    // 3. Broadcast to conversation participants via Pusher
    await pushToConversation(conversationId, {
      eventId: `evt_${Date.now()}`,
      eventType: 'typing',
      timestamp: Date.now(),
      payload: {
        userId: user.id,
        isTyping,
      } as any,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[IM Typing] Error:', error);
    return NextResponse.json(
      { error: 'Failed to send typing indicator' },
      { status: 500 }
    );
  }
}
