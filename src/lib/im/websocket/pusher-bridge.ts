/**
 * Pusher Bridge — Vercel-compatible real-time transport
 * 
 * For Vercel deployment (no native WebSocket support),
 * use Pusher (already in package.json) as the transport layer.
 * This bridge translates ServerEvent → Pusher events.
 */

import Pusher from 'pusher';
import type { ServerEvent, ServerEventType } from '../types';
import {
  userChannel,
  conversationChannel,
  parseConversationChannel,
} from '../channels';
import type { CallSignalEvent } from '../call-signal';

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
// 频道名一律来自 lib/im/channels.ts 的单一来源，勿在本文件另起前缀常量。

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
  const convId = parseConversationChannel(channelName);
  if (convId) {
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

// ─── WebRTC 信令中继 ──────────────────────────────────────────

/**
 * 把一条 WebRTC 信令投递到**目标用户**的个人频道。
 *
 * 为什么必须走服务端：Pusher 的客户端事件（`channel.trigger`）只能发到
 * **自己已授权**的频道，而鉴权端点只放行「自己的个人频道」这一种自有频道，
 * 所以「呼叫方 trigger 到被叫方频道」在机制上不可能成立（实测 403）。
 * 跨用户信令只能由服务端发起 —— 与 IM 消息走 `/api/im/send` 是同一个道理。
 *
 * @returns 是否投递成功（Pusher 未配置时返回 false，调用方可据此降级）
 */
export async function pushCallSignal(
  toUserId: string,
  event: CallSignalEvent,
  payload: Record<string, unknown>
): Promise<boolean> {
  const pusher = getPusher();
  if (!pusher) {
    console.warn('[Pusher] Not configured, call signal dropped');
    return false;
  }

  try {
    await pusher.trigger(userChannel(toUserId), event, payload);
    return true;
  } catch (error) {
    console.error(
      `[Pusher] Failed to push call signal ${event} to ${toUserId}:`,
      error
    );
    return false;
  }
}
