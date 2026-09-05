/**
 * POST /api/im/typing — Send typing indicator
 *
 * Stores typing state in Redis for cross-instance sync.
 * Clients should debounce typing indicators (e.g., send every 2-3 seconds).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { handleApiError } from '@/lib/api-handler';
import { pushToConversation } from '@/lib/im/websocket/pusher-bridge';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return handleApiError(async () => {
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

    // 2b. Verify the caller is a participant of this conversation (prevent injecting
    //     typing indicators into other users' private conversations — S3)
    const conv = await db.conversation.findFirst({
      where: { id: conversationId, OR: [{ userAId: user.id }, { userBId: user.id }] },
      select: { id: true },
    });
    if (!conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
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
  });
}
