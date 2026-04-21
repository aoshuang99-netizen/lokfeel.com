/**
 * Pusher Bridge — Vercel-compatible real-time transport
 * 
 * For Vercel deployment (no native WebSocket support),
 * use Pusher (already in package.json) as the transport layer.
 * This bridge translates ServerEvent → Pusher events.
 */

import Pusher from 'pusher';
import type { ServerEvent, ServerEventType } from '../types';

// ─── Pusher Client Singleton ──────────────────────────────────

let _pusher: Pusher | null = null;

export function getPusher(): Pusher | null {
  if (!_pusher) {
    const appId = process.env.PUSHER_APP_ID;
    const key = process.env.PUSHER_KEY;
    const secret = process.env.PUSHER_SECRET;
    const cluster = process.env.PUSHER_CLUSTER || 'us3';

    if (!appId || !key || !secret) {
      console.warn('[Pusher] Not configured, real-time events disabled');
      return null;
    }

    _pusher = new Pusher({
      appId,
      key,
      secret,
      cluster,
      useTLS: true,
    });
  }
  return _pusher;
}

// ─── Channel & Event Mapping ──────────────────────────────────

const CHANNEL_PREFIX = 'private-im';

/**
 * Get Pusher channel name for a user
 */
function userChannel(userId: string): string {
  return `${CHANNEL_PREFIX}-user-${userId}`;
}

/**
 * Get Pusher channel name for a conversation
 */
function conversationChannel(convId: string): string {
  return `${CHANNEL_PREFIX}-conv-${convId}`;
}

/**
 * Map server event type to Pusher event name
 */
function eventTypeName(type: ServerEventType): string {
  return `im:${type}`;
}

// ─── Bridge Functions ─────────────────────────────────────────

/**
 * Send event to a specific user
 */
export async function pushToUser(userId: string, event: ServerEvent): Promise<void> {
  const pusher = getPusher();
  if (!pusher) return;

  try {
    await pusher.trigger(userChannel(userId), eventTypeName(event.eventType), event);
  } catch (error) {
    console.error(`[Pusher] Failed to push to user ${userId}:`, error);
  }
}

/**
 * Broadcast event to all participants in a conversation
 */
export async function pushToConversation(
  convId: string,
  event: ServerEvent,
  excludeUserId?: string
): Promise<void> {
  const pusher = getPusher();
  if (!pusher) return;

  try {
    await pusher.trigger(
      conversationChannel(convId),
      eventTypeName(event.eventType),
      { ...event, excludeUserId }
    );
  } catch (error) {
    console.error(`[Pusher] Failed to push to conv ${convId}:`, error);
  }
}

/**
 * Authorize a Pusher subscription request
 * Verifies that the user is a participant in the requested channel
 */
export async function authorizePusherSubscription(
  socketId: string,
  channelName: string,
  userId: string
): Promise<string | null> {
  const pusher = getPusher();
  if (!pusher) return null;

  // User's private channel — always allowed
  if (channelName === userChannel(userId)) {
    const auth = pusher.authorizeChannel(socketId, channelName);
    return JSON.stringify(auth);
  }

  // Conversation channel — verify participation
  const convMatch = channelName.match(/^private-im-conv-(.+)$/);
  if (convMatch) {
    const convId = convMatch[1];
    const { db } = await import('@/lib/db');
    const participant = await db.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId: convId, userId } },
    });

    if (participant) {
      const auth = pusher.authorizeChannel(socketId, channelName);
      return JSON.stringify(auth);
    }
  }

  return null; // Deny
}
