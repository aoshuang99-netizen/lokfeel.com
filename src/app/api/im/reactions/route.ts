/**
 * IM Reactions API Routes
 * 
 * Endpoints for managing message reactions (emoji reactions).
 * 
 * POST   /api/im/reactions     - Add a reaction
 * DELETE /api/im/reactions     - Remove a reaction
 * GET    /api/im/reactions/:messageId - Get reactions for a message
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { addReaction, removeReaction, getReactionsByMessageId } from '@/lib/im/queries';
import { db } from '@/lib/db';

/**
 * Verify the authed user is a participant of the conversation that owns `messageId`.
 * Prevents cross-conversation reaction reads/writes (S1 authz gap).
 * Returns a 403/404 NextResponse if not allowed, or null if allowed.
 */
async function requireMessageParticipant(
  messageId: string,
  userId: string
): Promise<NextResponse | null> {
  const msg = await db.iMMessage.findUnique({
    where: { id: messageId },
    select: { conversationId: true },
  });
  if (!msg) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Message not found' } },
      { status: 404 }
    );
  }
  const conv = await db.conversation.findFirst({
    where: { id: msg.conversationId, OR: [{ userAId: userId }, { userBId: userId }] },
    select: { id: true },
  });
  if (!conv) {
    return NextResponse.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'You are not a participant of this conversation' } },
      { status: 403 }
    );
  }
  return null;
}

// ============================================================================
// GET /api/im/reactions/:messageId
// Get reactions for a specific message
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Please sign in' } },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const messageId = searchParams.get('messageId');

    if (!messageId) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_REQUEST', message: 'messageId is required' } },
        { status: 400 }
      );
    }

    const denied = await requireMessageParticipant(messageId, session.user.id);
    if (denied) return denied;

    const reactions = await getReactionsByMessageId(messageId, session.user.id);

    return NextResponse.json({
      success: true,
      data: reactions,
    });
  } catch (error) {
    console.error('Error fetching reactions:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch reactions' } },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST /api/im/reactions
// Add a reaction to a message
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Please sign in' } },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { messageId, emoji } = body;

    if (!messageId || !emoji) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_REQUEST', message: 'messageId and emoji are required' } },
        { status: 400 }
      );
    }

    // Validate emoji is a single character or short string (basic validation)
    if (emoji.length > 10) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_REQUEST', message: 'Invalid emoji' } },
        { status: 400 }
      );
    }

    const denied = await requireMessageParticipant(messageId, session.user.id);
    if (denied) return denied;

    try {
      const reaction = await addReaction(messageId, session.user.id, emoji);
      return NextResponse.json({
        success: true,
        data: reaction,
      });
    } catch (error: any) {
      // P2002 = unique constraint violation (user already reacted with this emoji)
      if (error?.code === 'P2002') {
        return NextResponse.json({
          success: true,
          data: { alreadyReacted: true, messageId, userId: session.user.id, emoji },
        });
      }
      console.error('Error adding reaction:', error);
      return NextResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to add reaction' } },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error in POST /api/im/reactions:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Request processing error' } },
      { status: 500 }
    );
  }
}

// ============================================================================
// DELETE /api/im/reactions
// Remove a reaction from a message
// ============================================================================

export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Please sign in' } },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const messageId = searchParams.get('messageId');
    const emoji = searchParams.get('emoji');

    if (!messageId || !emoji) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_REQUEST', message: 'messageId and emoji are required' } },
        { status: 400 }
      );
    }

    const denied = await requireMessageParticipant(messageId, session.user.id);
    if (denied) return denied;

    const removed = await removeReaction(messageId, session.user.id, emoji);

    return NextResponse.json({
      success: true,
      data: { removed },
    });
  } catch (error) {
    console.error('Error removing reaction:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to remove reaction' } },
      { status: 500 }
    );
  }
}
