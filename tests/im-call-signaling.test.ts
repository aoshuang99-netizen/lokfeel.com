/**
 * Pusher 频道命名 / WebRTC 信令协议 的单元测试
 *
 * 覆盖 2026-10 修复的两类真实缺陷：
 *   ① 频道前缀漂移（`private-user-` vs 鉴权白名单 `private-im-`）→ 订阅 403
 *   ② 跨用户信令靠客户端 `channel.trigger` → 机制上不可能成立，必须走服务端中继
 */

import {
  IM_CHANNEL_PREFIX,
  userChannel,
  conversationChannel,
  isAllowedImChannel,
  parseUserChannel,
  parseConversationChannel,
} from '@/lib/im/channels';
import {
  CALL_SIGNAL_EVENTS,
  isCallSignalEvent,
  partiesOf,
} from '@/lib/im/call-signal';
import {
  sendCallSignal,
  sendOfferSignal,
  sendAnswerSignal,
  sendDeclineSignal,
  sendIceCandidateSignal,
  sendHangupSignal,
  sendTimeoutSignal,
} from '@/lib/im/call-signal-client';
import { getUserChannel, CHANNEL_PREFIX } from '@/config/webrtc.config';

// ============================================================================
// 频道命名
// ============================================================================

describe('lib/im/channels', () => {
  it('前缀是 private-im（与鉴权端点白名单一致）', () => {
    expect(IM_CHANNEL_PREFIX).toBe('private-im');
  });

  it('用户频道 / 会话频道命名固定', () => {
    expect(userChannel('u1')).toBe('private-im-user-u1');
    expect(conversationChannel('c1')).toBe('private-im-conv-c1');
  });

  it('🔴 所有构造器产物必须命中鉴权白名单', () => {
    // 这是本次修复的核心不变量：历史上 WebRTC 侧用的是 private-user-，
    // 与白名单只差 3 个字符，导致信令订阅 403。
    const ids = ['u1', 'user-123@example.com', '', '中文 id'];
    for (const id of ids) {
      expect(isAllowedImChannel(userChannel(id))).toBe(true);
      expect(isAllowedImChannel(conversationChannel(id))).toBe(true);
      expect(isAllowedImChannel(getUserChannel(id))).toBe(true);
    }
  });

  it('WebRTC 侧的 getUserChannel 与 IM 侧同源', () => {
    expect(CHANNEL_PREFIX).toBe('private-im-user');
    expect(getUserChannel('abc')).toBe(userChannel('abc'));
  });

  it('isAllowedImChannel 拒绝非字符串与非法前缀', () => {
    expect(isAllowedImChannel(undefined)).toBe(false);
    expect(isAllowedImChannel(null)).toBe(false);
    expect(isAllowedImChannel(123)).toBe(false);
    expect(isAllowedImChannel('private-user-u1')).toBe(false);
    expect(isAllowedImChannel('public-im-user-u1')).toBe(false);
  });

  it('频道名可反解出主体 id', () => {
    expect(parseUserChannel('private-im-user-u1')).toBe('u1');
    expect(parseConversationChannel('private-im-conv-c1')).toBe('c1');
    expect(parseUserChannel('private-im-conv-c1')).toBeNull();
    expect(parseConversationChannel('private-im-user-u1')).toBeNull();
  });
});

// ============================================================================
// 信令协议
// ============================================================================

describe('lib/im/call-signal', () => {
  it('事件名不带 client- 前缀（那是 Pusher 客户端事件专用）', () => {
    for (const name of Object.values(CALL_SIGNAL_EVENTS)) {
      expect(name.startsWith('client-')).toBe(false);
      expect(name.startsWith('call:')).toBe(true);
    }
  });

  it('isCallSignalEvent 只放行白名单内的事件', () => {
    expect(isCallSignalEvent('call:offer')).toBe(true);
    expect(isCallSignalEvent('call:ice-candidate')).toBe(true);
    expect(isCallSignalEvent('call:evil')).toBe(false);
    expect(isCallSignalEvent('im:message')).toBe(false);
    expect(isCallSignalEvent(undefined)).toBe(false);
    expect(isCallSignalEvent({})).toBe(false);
  });

  it('partiesOf 解出通话双方；缺失字段时返回 null', () => {
    expect(partiesOf({ callerId: 'a', calleeId: 'b' })).toEqual({
      callerId: 'a',
      calleeId: 'b',
    });
    expect(partiesOf({ callerId: 'a' })).toBeNull();
    expect(partiesOf(null)).toBeNull();
    expect(partiesOf('a')).toBeNull();
  });
});

// ============================================================================
// 客户端发送侧：目标选择 + 走服务端中继
// ============================================================================

describe('lib/im/call-signal-client', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function mockFetch(ok = true, status = 200) {
    const fn = jest.fn().mockResolvedValue({
      ok,
      status,
      json: async () => ({}),
    });
    global.fetch = fn as unknown as typeof fetch;
    return fn;
  }

  function bodyOf(fn: jest.Mock) {
    const [, init] = fn.mock.calls[0] as [string, RequestInit];
    return JSON.parse(String(init.body)) as {
      to: string;
      event: string;
      payload: Record<string, unknown>;
    };
  }

  it('offer 投递给被叫方，事件名为 call:offer', async () => {
    const fn = mockFetch();
    const offer = {
      callId: 'call-1',
      callerId: 'me',
      calleeId: 'them',
      offer: { type: 'offer', sdp: 'x' },
      timestamp: 1,
    };

    await expect(sendOfferSignal(offer as never)).resolves.toBe(true);

    expect(fn).toHaveBeenCalledWith('/api/im/call/signal', expect.anything());
    expect(bodyOf(fn)).toMatchObject({ to: 'them', event: 'call:offer' });
  });

  it('answer / decline 投递给呼叫方', async () => {
    const answerFn = mockFetch();
    await sendAnswerSignal({
      callId: 'c1',
      callerId: 'them',
      calleeId: 'me',
      answer: { type: 'answer', sdp: 'x' },
    } as never);
    expect(bodyOf(answerFn)).toMatchObject({ to: 'them', event: 'call:answer' });

    const declineFn = mockFetch();
    await sendDeclineSignal({
      callId: 'c1',
      callerId: 'them',
      calleeId: 'me',
      reason: 'declined',
    } as never);
    expect(bodyOf(declineFn)).toMatchObject({ to: 'them', event: 'call:decline' });
  });

  it('ICE / hangup 按当前用户身份定向到「对方」', async () => {
    const iceFn = mockFetch();
    await sendIceCandidateSignal(
      {
        callId: 'c1',
        callerId: 'me',
        calleeId: 'them',
        candidate: { candidate: 'x' },
      } as never,
      'me'
    );
    expect(bodyOf(iceFn)).toMatchObject({ to: 'them', event: 'call:ice-candidate' });

    // 以被叫方身份发送 → 目标应变成呼叫方
    const iceFn2 = mockFetch();
    await sendIceCandidateSignal(
      {
        callId: 'c1',
        callerId: 'them',
        calleeId: 'me',
        candidate: { candidate: 'x' },
      } as never,
      'me'
    );
    expect(bodyOf(iceFn2)).toMatchObject({ to: 'them' });

    const hangupFn = mockFetch();
    await sendHangupSignal(
      { callId: 'c1', callerId: 'me', calleeId: 'them', reason: 'completed', duration: 3, timestamp: 2 } as never,
      'them'
    );
    expect(bodyOf(hangupFn)).toMatchObject({
      to: 'me',
      event: 'call:hangup',
    });
  });

  it('timeout 投递给被叫方', async () => {
    const fn = mockFetch();
    await sendTimeoutSignal({
      callId: 'c1',
      callerId: 'me',
      calleeId: 'them',
    } as never);
    expect(bodyOf(fn)).toMatchObject({ to: 'them', event: 'call:timeout' });
  });

  it('服务端拒绝时返回 false，不抛异常（调用方据此置错误态）', async () => {
    mockFetch(false, 403);
    await expect(
      sendCallSignal('them', CALL_SIGNAL_EVENTS.OFFER, {
        callId: 'c1',
        callerId: 'me',
        calleeId: 'them',
        offer: { type: 'offer', sdp: 'x' },
        timestamp: 1,
      } as never)
    ).resolves.toBe(false);
  });

  it('缺少收件人时直接返回 false，不发请求', async () => {
    const fn = mockFetch();
    await expect(
      sendCallSignal('', CALL_SIGNAL_EVENTS.OFFER, {
        callId: 'c1',
        callerId: 'me',
        calleeId: '',
        offer: { type: 'offer', sdp: 'x' },
        timestamp: 1,
      } as never)
    ).resolves.toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it('网络异常时返回 false，不抛异常', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as never;
    await expect(
      sendCallSignal('them', CALL_SIGNAL_EVENTS.HANGUP, {
        callId: 'c1',
        callerId: 'me',
        calleeId: 'them',
        reason: 'completed',
        duration: 1,
        timestamp: 1,
      } as never)
    ).resolves.toBe(false);
  });
});
