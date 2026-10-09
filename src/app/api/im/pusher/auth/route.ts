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

/**
 * 解析 pusher-js 的鉴权请求参数。
 *
 * ⚠️ 必须兼容多种编码，**不要**改回只用 `request.formData()`：
 *    pusher-js 的默认授权器发的是 `application/x-www-form-urlencoded`，
 *    但客户端曾把 `auth.headers['Content-Type']` 覆盖成 `application/json`。
 *    那时 `request.formData()` 会直接抛
 *    "Content-Type was not one of multipart/form-data or application/x-www-form-urlencoded"，
 *    端点返回 500，**所有私有频道订阅失败且完全静默**（实时消息 / 通话信令一起失效，
 *    只剩前端轮询兜底，表面上「还能用」）。这里按实际声明的类型解析，并保留
 *    「声明 JSON、实为 urlencoded」这类历史错配的兜底。
 */
async function readAuthParams(
  request: NextRequest
): Promise<{ socketId: string; channelName: string }> {
  const contentType = (request.headers.get('content-type') || '').toLowerCase();

  const fromParams = (text: string) => {
    const params = new URLSearchParams(text);
    return {
      socketId: params.get('socket_id') ?? '',
      channelName: params.get('channel_name') ?? '',
    };
  };

  if (contentType.includes('application/json')) {
    const text = await request.text().catch(() => '');
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      return {
        socketId: String(json.socket_id ?? ''),
        channelName: String(json.channel_name ?? ''),
      };
    } catch {
      // 声明 JSON 但实为 urlencoded（历史错配）
      return fromParams(text);
    }
  }

  if (
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('multipart/form-data')
  ) {
    const form = await request.formData();
    return {
      socketId: String(form.get('socket_id') ?? ''),
      channelName: String(form.get('channel_name') ?? ''),
    };
  }

  // Content-Type 缺失或不被识别：按 urlencoded 兜底
  return fromParams(await request.text().catch(() => ''));
}

export async function POST(request: NextRequest) {
  return handleApiError(async () => {
    // 1. Authenticate user
    const { user } = await requireAuth();

    // 2. Parse Pusher auth request
    const { socketId, channelName } = await readAuthParams(request);

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
