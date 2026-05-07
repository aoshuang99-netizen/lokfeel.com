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
