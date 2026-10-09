/**
 * WebRTC 信令的**客户端发送侧**（走服务端中继）。
 *
 * 为什么不直接 `channel.trigger`：Pusher 的客户端事件只能发到
 * 自己已授权的频道，而鉴权端点只为「自己的个人频道」签发授权，
 * 于是「呼叫方 trigger 到被叫方频道」机制上不可能成立（实测 403）。
 * 详见 `app/api/im/call/signal/route.ts` 的模块注释。
 *
 * @module lib/im/call-signal-client
 */

import type {
  VideoCallOffer,
  VideoCallAnswer,
  VideoCallDecline,
  ICECandidateMessage,
  VideoCallHangup,
  VideoCallTimeout,
} from '@/types/webrtc';
import {
  CALL_SIGNAL_EVENTS,
  type CallSignalEvent,
  type CallSignalPayload,
} from './call-signal';

/**
 * 把一条信令交给服务端中继投递。
 *
 * @returns 是否投递成功。失败时调用方应把通话状态置为错误，
 *          不要让 UI 静默停在「呼叫中」。
 */
export async function sendCallSignal(
  to: string,
  event: CallSignalEvent,
  payload: CallSignalPayload
): Promise<boolean> {
  if (!to) {
    console.warn('[CallSignal] Missing recipient, signal dropped:', event);
    return false;
  }

  try {
    const response = await fetch('/api/im/call/signal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, event, payload }),
    });

    if (!response.ok) {
      let detail = '';
      try {
        const data = (await response.json()) as { error?: string };
        detail = data?.error ?? '';
      } catch {
        /* 非 JSON 响应，忽略 */
      }
      console.error(
        `[CallSignal] Relay rejected ${event} (HTTP ${response.status})${detail ? `: ${detail}` : ''}`
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error(`[CallSignal] Relay failed for ${event}:`, error);
    return false;
  }
}

/** offer：呼叫方 → 被叫方。 */
export function sendOfferSignal(offer: VideoCallOffer): Promise<boolean> {
  return sendCallSignal(offer.calleeId, CALL_SIGNAL_EVENTS.OFFER, offer);
}

/** answer：被叫方 → 呼叫方。 */
export function sendAnswerSignal(answer: VideoCallAnswer): Promise<boolean> {
  return sendCallSignal(answer.callerId, CALL_SIGNAL_EVENTS.ANSWER, answer);
}

/** decline：被叫方 → 呼叫方。 */
export function sendDeclineSignal(decline: VideoCallDecline): Promise<boolean> {
  return sendCallSignal(decline.callerId, CALL_SIGNAL_EVENTS.DECLINE, decline);
}

/** ICE 候选：双向，目标是「对方」。 */
export function sendIceCandidateSignal(
  message: ICECandidateMessage,
  selfUserId: string
): Promise<boolean> {
  const to = message.callerId === selfUserId ? message.calleeId : message.callerId;
  return sendCallSignal(to, CALL_SIGNAL_EVENTS.ICE_CANDIDATE, message);
}

/** hangup：双向，目标是「对方」。 */
export function sendHangupSignal(
  hangup: VideoCallHangup,
  selfUserId: string
): Promise<boolean> {
  const to = hangup.callerId === selfUserId ? hangup.calleeId : hangup.callerId;
  return sendCallSignal(to, CALL_SIGNAL_EVENTS.HANGUP, hangup);
}

/** timeout：呼叫方 → 被叫方。 */
export function sendTimeoutSignal(timeout: VideoCallTimeout): Promise<boolean> {
  return sendCallSignal(timeout.calleeId, CALL_SIGNAL_EVENTS.TIMEOUT, timeout);
}
