/**
 * POST /api/im/pusher/auth — Pusher Channel Authorization
 *
 * Authenticates subscription requests for private channels:
 * - private-im-user-{userId}  → user's private channel (always allowed for own)
 * - private-im-conv-{convId}  → conversation channel (verify participation)
 *
 * Called by pusher-js client automatically when subscribing to private channels.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { handleApiError } from '@/lib/api-handler';
import { authorizePusherSubscription } from '@/lib/im/websocket/pusher-bridge';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return handleApiError(async () => {
    // 1. Authenticate user
    const { user } = await requireAuth();

    // 2. Parse Pusher auth request
    const formData = await request.formData();
    const socketId = formData.get('socket_id') as string;
    const channelName = formData.get('channel_name') as string;

    if (!socketId || !channelName) {
      return NextResponse.json(
        { error: 'Missing socket_id or channel_name' },
        { status: 400 }
      );
    }

    // 3. Validate channel name format
    if (!channelName.startsWith('private-im-')) {
      return NextResponse.json(
        { error: 'Invalid channel prefix' },
        { status: 403 }
      );
    }

    // 4. Authorize subscription
    const authResponse = await authorizePusherSubscription(
      socketId,
      channelName,
      user.id
    );

    if (!authResponse) {
      return NextResponse.json(
        { error: 'Subscription not authorized' },
        { status: 403 }
      );
    }

    // 5. Return Pusher auth signature
    // Pusher expects: { auth: "app_key:signature" } (flat).
    // pusher-bridge returns JSON.stringify(auth), so parse it back to the
    // flat shape — otherwise pusher-js receives a double-encoded string and
    // private-channel subscriptions are rejected by the Pusher server.
    return NextResponse.json(JSON.parse(authResponse as string));
  });
}
