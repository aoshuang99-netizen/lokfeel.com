/**
 * Pusher 信令 Hook
 * 监听和触发 WebRTC 信令事件
 * 复用现有 useIMConversation 的 Pusher 模式
 */

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Pusher, { Channel } from 'pusher-js';
import {
  VideoCallOffer,
  VideoCallAnswer,
  VideoCallDecline,
  ICECandidateMessage,
  VideoCallHangup,
  VideoCallTimeout,
  HangupReason,
} from '@/types/webrtc';
import { PUSHER_EVENTS, getUserChannel } from '@/config/webrtc.config';
import { getIMPusherClient } from './use-im-pusher';

// ============================================================================
// Pusher 客户端（复用现有的 IM Pusher 客户端）
// ============================================================================

/**
 * 获取用户的视频通话频道
 * 复用现有的 Pusher 连接
 */
function getVideoCallChannel(userId: string): string {
  return getUserChannel(userId); // 复用 private-user-{userId} 频道
}

// ============================================================================
// 获取当前用户 ID（从 auth session）
// ============================================================================

/**
 * 获取当前登录用户的 ID
 * 复用 useCurrentUser hook
 */
function useCurrentUserId(): string | null {
  // 注意：这个函数不能在 Hook 外部调用
  // 实际实现中，应该在 usePusherSignaling 内部调用 useCurrentUser
  return null; // 占位，实际在 Hook 内部实现
}

// ============================================================================
// Hook 返回值类型
// ============================================================================

export interface UsePusherSignalingReturn {
  // 状态
  isConnected: boolean;
  error: Error | null;
  
  // 发送信令
  sendOffer: (offer: VideoCallOffer) => void;
  sendAnswer: (answer: VideoCallAnswer) => void;
  sendDecline: (decline: VideoCallDecline) => void;
  sendIceCandidate: (message: ICECandidateMessage) => void;
  sendHangup: (hangup: VideoCallHangup) => void;
  sendTimeout: (timeout: VideoCallTimeout) => void;
}

// ============================================================================
// usePusherSignaling Hook
// ============================================================================

/**
 * usePusherSignaling Hook
 * @param userId - 当前用户 ID
 * @param onOffer - 收到 Offer 回调
 * @param onAnswer - 收到 Answer 回调
 * @param onDecline - 收到拒绝回调
 * @param onIceCandidate - 收到 ICE 候选回调
 * @param onHangup - 收到挂断回调
 * @param onTimeout - 收到超时回调
 */
export function usePusherSignaling(
  userId?: string | null,
  onOffer?: (offer: VideoCallOffer) => void,
  onAnswer?: (answer: VideoCallAnswer) => void,
  onDecline?: (decline: VideoCallDecline) => void,
  onIceCandidate?: (message: ICECandidateMessage) => void,
  onHangup?: (hangup: VideoCallHangup) => void,
  onTimeout?: (timeout: VideoCallTimeout) => void
): UsePusherSignalingReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  const pusherRef = useRef<Pusher | null>(null);
  const userChannelRef = useRef<Channel | null>(null);
  const callbacksRef = useRef({
    onOffer,
    onAnswer,
    onDecline,
    onIceCandidate,
    onHangup,
    onTimeout,
  });

  // 更新回调引用
  useEffect(() => {
    callbacksRef.current = {
      onOffer,
      onAnswer,
      onDecline,
      onIceCandidate,
      onHangup,
      onTimeout,
    };
  }, [onOffer, onAnswer, onDecline, onIceCandidate, onHangup, onTimeout]);

  // ============================================================================
  // 初始化 Pusher 订阅
  // ============================================================================

  useEffect(() => {
    if (!userId) return;

    console.log('[PusherSignaling] Initializing for user:', userId);

    // 复用现有的 Pusher 客户端
    const pusher = getIMPusherClient();
    if (!pusher) {
      setError(new Error('Pusher not available'));
      return;
    }

    pusherRef.current = pusher;

    // 订阅用户频道（复用现有的 private-user-{userId}）
    const channelName = getVideoCallChannel(userId);
    const channel = pusher.subscribe(channelName);
    userChannelRef.current = channel;

    console.log('[PusherSignaling] Subscribed to channel:', channelName);

    // ============================================================================
    // 绑定 WebRTC 信令事件
    // ============================================================================

    // 收到 Offer
    channel.bind(PUSHER_EVENTS.VIDEO_CALL_OFFER, (data: VideoCallOffer) => {
      console.log('[PusherSignaling] Received offer:', data);
      callbacksRef.current.onOffer?.(data);
    });

    // 收到 Answer
    channel.bind(PUSHER_EVENTS.VIDEO_CALL_ANSWER, (data: VideoCallAnswer) => {
      console.log('[PusherSignaling] Received answer:', data);
      callbacksRef.current.onAnswer?.(data);
    });

    // 收到拒绝
    channel.bind(PUSHER_EVENTS.VIDEO_CALL_DECLINE, (data: VideoCallDecline) => {
      console.log('[PusherSignaling] Received decline:', data);
      callbacksRef.current.onDecline?.(data);
    });

    // 收到 ICE 候选
    channel.bind(PUSHER_EVENTS.ICE_CANDIDATE, (data: ICECandidateMessage) => {
      console.log('[PusherSignaling] Received ICE candidate:', data);
      callbacksRef.current.onIceCandidate?.(data);
    });

    // 收到挂断
    channel.bind(PUSHER_EVENTS.VIDEO_CALL_HANGUP, (data: VideoCallHangup) => {
      console.log('[PusherSignaling] Received hangup:', data);
      callbacksRef.current.onHangup?.(data);
    });

    // 收到超时
    channel.bind(PUSHER_EVENTS.VIDEO_CALL_TIMEOUT, (data: VideoCallTimeout) => {
      console.log('[PusherSignaling] Received timeout:', data);
      callbacksRef.current.onTimeout?.(data);
    });

    // 连接状态
    const connectionState = pusher.connection.state;
    setIsConnected(connectionState === 'connected');

    pusher.connection.bind('connected', () => {
      console.log('[PusherSignaling] Pusher connected');
      setIsConnected(true);
    });
    
    pusher.connection.bind('disconnected', () => {
      console.log('[PusherSignaling] Pusher disconnected');
      setIsConnected(false);
    });
    
    pusher.connection.bind('error', (err: Error) => {
      console.error('[PusherSignaling] Pusher error:', err);
      setError(err);
    });

    // ============================================================================
    // 清理
    // ============================================================================

    return () => {
      console.log('[PusherSignaling] Cleaning up');
      
      if (userChannelRef.current) {
        userChannelRef.current.unbind_all();
        pusher.unsubscribe(channelName);
        userChannelRef.current = null;
      }
    };
  }, [userId]);

  // ============================================================================
  // 发送信令
  // ============================================================================

  /**
   * 发送 Offer
   */
  const sendOffer = useCallback((offer: VideoCallOffer) => {
    const pusher = pusherRef.current;
    if (!pusher) {
      console.error('[PusherSignaling] Pusher not connected');
      return;
    }

    console.log('[PusherSignaling] Sending offer to:', offer.calleeId);
    
    // 通过对方的频道发送（trigger 到 private-user-{calleeId}）
    // 注意：Pusher 客户端事件只能发送到同一频道，所以需要对方也订阅自己的频道
    // 简化方案：双方都订阅 private-user-{userId}，通过事件 payload 中的 calleeId 来区分接收方
    const channel = pusher.channel(getVideoCallChannel(offer.calleeId));
    if (channel) {
      channel.trigger(PUSHER_EVENTS.VIDEO_CALL_OFFER, offer);
    } else {
      console.warn('[PusherSignaling] Target channel not found, using current channel');
      userChannelRef.current?.trigger(PUSHER_EVENTS.VIDEO_CALL_OFFER, offer);
    }
  }, []);

  /**
   * 发送 Answer
   */
  const sendAnswer = useCallback((answer: VideoCallAnswer) => {
    const pusher = pusherRef.current;
    if (!pusher) {
      console.error('[PusherSignaling] Pusher not connected');
      return;
    }

    console.log('[PusherSignaling] Sending answer to:', answer.callerId);
    
    userChannelRef.current?.trigger(PUSHER_EVENTS.VIDEO_CALL_ANSWER, answer);
  }, []);

  /**
   * 发送拒绝
   */
  const sendDecline = useCallback((decline: VideoCallDecline) => {
    const pusher = pusherRef.current;
    if (!pusher) {
      console.error('[PusherSignaling] Pusher not connected');
      return;
    }

    console.log('[PusherSignaling] Sending decline to:', decline.callerId);
    
    userChannelRef.current?.trigger(PUSHER_EVENTS.VIDEO_CALL_DECLINE, decline);
  }, []);

  /**
   * 发送 ICE 候选
   */
  const sendIceCandidate = useCallback((message: ICECandidateMessage) => {
    const pusher = pusherRef.current;
    if (!pusher) {
      console.error('[PusherSignaling] Pusher not connected');
      return;
    }

    // 判断是发起方还是接收方
    const targetUserId = message.callerId === userId ? message.calleeId : message.callerId;
    
    console.log('[PusherSignaling] Sending ICE candidate to:', targetUserId);
    
    userChannelRef.current?.trigger(PUSHER_EVENTS.ICE_CANDIDATE, message);
  }, [userId]);

  /**
   * 发送挂断
   */
  const sendHangup = useCallback((hangup: VideoCallHangup) => {
    const pusher = pusherRef.current;
    if (!pusher) {
      console.error('[PusherSignaling] Pusher not connected');
      return;
    }

    console.log('[PusherSignaling] Sending hangup');
    
    userChannelRef.current?.trigger(PUSHER_EVENTS.VIDEO_CALL_HANGUP, hangup);
  }, []);

  /**
   * 发送超时
   */
  const sendTimeout = useCallback((timeout: VideoCallTimeout) => {
    const pusher = pusherRef.current;
    if (!pusher) {
      console.error('[PusherSignaling] Pusher not connected');
      return;
    }

    console.log('[PusherSignaling] Sending timeout');
    
    userChannelRef.current?.trigger(PUSHER_EVENTS.VIDEO_CALL_TIMEOUT, timeout);
  }, []);

  // ============================================================================
  // 返回值
  // ============================================================================

  return {
    isConnected,
    error,
    sendOffer,
    sendAnswer,
    sendDecline,
    sendIceCandidate,
    sendHangup,
    sendTimeout,
  };
}
