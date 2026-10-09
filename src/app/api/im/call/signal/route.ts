/**
 * POST /api/im/call/signal — WebRTC 信令中继
 *
 * ## 为什么需要这条路由（而不是客户端直发）
 *
 * 原实现让呼叫方直接 `channel.trigger()` 到被叫方的频道。这在 Pusher 上
 * **机制上不可能成立**：
 *   1. 客户端事件只能发到**自己已订阅**的频道；
 *   2. 而 `/api/im/pusher/auth` 只放行「自己的个人频道
 *      `private-im-user-{自己}`」与「自己参与的会话频道」，
 *      不会为「别人的个人频道」签发授权。
 * 于是该路径实测 403，视频通话永远停在「呼叫中」。
 *
 * 正确做法与服务端发 IM 消息（`/api/im/send`）一致：由服务端把信令
 * 投递到目标用户的个人频道。
 *
 * ## 守卫
 * - 必须登录；
 * - 事件名必须在白名单内（`call-signal.ts` 的 `CALL_SIGNAL_EVENTS`）；
 * - payload 必须带 `callerId` / `calleeId`，且**请求方必须是通话的一方**；
 * - `to` 必须恰是通话的另一方（不接受任意 userId，避免沦为骚扰/广播工具）；
 * - 双方之间必须已存在会话（陌生人无法凭空投递）；
 * - 按用户维度限流（ICE 候选天然高频，额度放宽但仍有上限）。
 *
 * @module app/api/im/call/signal
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { handleApiError } from '@/lib/api-handler';
import { db } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { pushCallSignal } from '@/lib/im/websocket/pusher-bridge';
import { isCallSignalEvent, partiesOf } from '@/lib/im/call-signal';

export const dynamic = 'force-dynamic';

/**
 * 限流：ICE 候选在一次通话里可能连发几十条，故额度按「每分钟 300 次」给，
 * 只用于拦住脚本化滥用，不干扰正常通话。
 */
const callSignalLimiter = rateLimit({ windowMs: 60_000, max: 300 });

/** 找到两人之间的会话（`Conversation` 对 userAId/userBId 有唯一约束且顺序固定）。 */
async function findConversationBetween(a: string, b: string) {
  const [userAId, userBId] = a < b ? [a, b] : [b, a];
  return db.conversation.findUnique({
    where: { userAId_userBId: { userAId, userBId } },
    select: { id: true, state: true, deletedAt: true },
  });
}

export async function POST(request: NextRequest) {
  return handleApiError(async () => {
    const { user } = await requireAuth();

    const limited = await callSignalLimiter(request);
    if (!limited.success) {
      return NextResponse.json(
        { success: false, error: 'Too many call signals, slow down' },
        { status: 429 }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    const raw = (body ?? {}) as Record<string, unknown>;
    const { to, event, payload } = raw;

    if (typeof to !== 'string' || to.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Missing "to"' },
        { status: 400 }
      );
    }

    if (!isCallSignalEvent(event)) {
      return NextResponse.json(
        { success: false, error: 'Unknown call signal event' },
        { status: 400 }
      );
    }

    const parties = partiesOf(payload);
    if (!parties) {
      return NextResponse.json(
        { success: false, error: 'payload must carry callerId and calleeId' },
        { status: 400 }
      );
    }

    // 请求方必须是这次通话的一方
    if (user.id !== parties.callerId && user.id !== parties.calleeId) {
      return NextResponse.json(
        { success: false, error: 'Not a party of this call' },
        { status: 403 }
      );
    }

    // 投递目标必须恰是通话的另一方
    const other = parties.callerId === user.id ? parties.calleeId : parties.callerId;
    if (to !== other) {
      return NextResponse.json(
        { success: false, error: 'Recipient must be the other party of the call' },
        { status: 403 }
      );
    }

    // 双方之间必须已存在会话
    const conversation = await findConversationBetween(user.id, other);
    if (!conversation || conversation.deletedAt) {
      return NextResponse.json(
        { success: false, error: 'No conversation with recipient' },
        { status: 403 }
      );
    }

    const delivered = await pushCallSignal(
      to,
      event,
      payload as Record<string, unknown>
    );

    if (!delivered) {
      // 实时通道未配置/不可用：明确告知，避免前端静默卡在「呼叫中」
      return NextResponse.json(
        { success: false, error: 'Realtime transport unavailable' },
        { status: 503 }
      );
    }

    return NextResponse.json({ success: true });
  });
}
