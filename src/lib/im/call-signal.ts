/**
 * WebRTC 信令协议（**纯模块**，client / server 共用）。
 *
 * 事件名刻意不带 `client-` 前缀：Pusher 的 `client-` 前缀专属于
 * **客户端事件**（`channel.trigger`），而本项目里这类信令必须由
 * **服务端**投递 —— 因为 Pusher 只允许客户端向自己已授权的频道发事件，
 * 而鉴权端点只放行「自己的个人频道」，所以「呼叫方 trigger 到被叫方频道」
 * 在机制上不可能成立。详见 `lib/im/websocket/pusher-bridge.ts#pushCallSignal`。
 *
 * @module lib/im/call-signal
 */

import type {
  VideoCallOffer,
  VideoCallAnswer,
  VideoCallDecline,
  ICECandidateMessage,
  VideoCallHangup,
  VideoCallTimeout,
} from '@/types/webrtc';

/** 信令事件名（服务端 → 目标用户的 `private-im-user-{id}` 频道）。 */
export const CALL_SIGNAL_EVENTS = {
  OFFER: 'call:offer',
  ANSWER: 'call:answer',
  DECLINE: 'call:decline',
  ICE_CANDIDATE: 'call:ice-candidate',
  HANGUP: 'call:hangup',
  TIMEOUT: 'call:timeout',
} as const;

export type CallSignalEvent =
  (typeof CALL_SIGNAL_EVENTS)[keyof typeof CALL_SIGNAL_EVENTS];

const CALL_SIGNAL_EVENT_SET: ReadonlySet<string> = new Set(
  Object.values(CALL_SIGNAL_EVENTS)
);

export function isCallSignalEvent(value: unknown): value is CallSignalEvent {
  return typeof value === 'string' && CALL_SIGNAL_EVENT_SET.has(value);
}

/** 六种信令 payload 的并集。 */
export type CallSignalPayload =
  | VideoCallOffer
  | VideoCallAnswer
  | VideoCallDecline
  | ICECandidateMessage
  | VideoCallHangup
  | VideoCallTimeout;

/** 信令请求体（POST /api/im/call/signal）。 */
export interface CallSignalRequest {
  /** 接收方用户 ID（信令将被投递到 TA 的个人频道）。 */
  to: string;
  event: CallSignalEvent;
  payload: CallSignalPayload;
}

/**
 * 从 payload 里解出通话的收发双方。
 *
 * 六种信令 payload 都带 `callerId` / `calleeId`，服务端据此校验
 * 「发起请求的人必须是这次通话的一方」，避免任意用户向他人投递伪造信令。
 */
export function partiesOf(
  payload: unknown
): { callerId: string; calleeId: string } | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.callerId !== 'string' || typeof p.calleeId !== 'string') {
    return null;
  }
  return { callerId: p.callerId, calleeId: p.calleeId };
}
