/**
 * Pusher 频道命名的**唯一来源**（client / server 两侧共用）。
 *
 * 为什么必须收敛到一处：
 * 前端订阅侧（hooks）与服务端鉴权侧（`lib/im/websocket/pusher-bridge.ts`、
 * `app/api/im/pusher/auth/route.ts`）曾各自维护一份前缀常量。WebRTC 信令侧
 * 写成了 `private-user-{id}`，而鉴权白名单要求 `private-im-` —— 只差 3 个字符，
 * 静态审查几乎发现不了，线上表现为**视频通话信令频道订阅被 403，通话完全不可用**。
 *
 * 现在两侧都从这里取名字；`npm run verify:pusher` 会断言所有
 * `pusher.subscribe(...)` 的实参都必须命中 `isAllowedImChannel`，
 * 防止同类漂移再次发生。
 *
 * @module lib/im/channels
 */

/** 所有 IM 私有频道的公共前缀，同时也是鉴权端点的白名单判据。 */
export const IM_CHANNEL_PREFIX = 'private-im';

/** 用户个人频道：承载 IM 事件与 WebRTC 信令事件。 */
export function userChannel(userId: string): string {
  return `${IM_CHANNEL_PREFIX}-user-${userId}`;
}

/** 会话频道：承载该会话内的群发事件。 */
export function conversationChannel(convId: string): string {
  return `${IM_CHANNEL_PREFIX}-conv-${convId}`;
}

/**
 * 鉴权端点的白名单判据。
 * 只有以 `private-im-` 开头的频道才**有可能**被授权（具体到某个频道还要过
 * 「是不是自己的个人频道 / 是不是自己参与的会话」两道检查）。
 */
export function isAllowedImChannel(name: unknown): boolean {
  return typeof name === 'string' && name.startsWith(`${IM_CHANNEL_PREFIX}-`);
}

/** `private-im-user-{userId}` → `userId`；不匹配返回 `null`。 */
export function parseUserChannel(name: string): string | null {
  const m = /^private-im-user-(.+)$/.exec(name);
  return m ? m[1] : null;
}

/** `private-im-conv-{convId}` → `convId`；不匹配返回 `null`。 */
export function parseConversationChannel(name: string): string | null {
  const m = /^private-im-conv-(.+)$/.exec(name);
  return m ? m[1] : null;
}
