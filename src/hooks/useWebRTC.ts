/**
 * 核心 WebRTC Hook
 * 封装 RTCPeerConnection 生命周期、信令交互
 * 直接集成 Pusher 信令发送/接收
 */

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Pusher from 'pusher-js';
import {
  CallState,
  HangupReason,
  UseWebRTCResult,
  VideoCallOffer,
  VideoCallAnswer,
  VideoCallDecline,
  ICECandidateMessage,
  VideoCallHangup,
} from '@/types/webrtc';
import { useVideoCallStore } from '@/store/videoCallStore';
import {
  createPeerConnection,
  createOffer,
  createAnswer,
  setRemoteDescription,
  addIceCandidate,
  addLocalStream,
  closeConnection,
  generateCallId,
} from '@/utils/webrtc';
import { getLocalStream, stopMediaStream } from '@/utils/mediaStream';
import { PUSHER_EVENTS, getUserChannel } from '@/config/webrtc.config';
import { getIMPusherClient } from './use-im-pusher';
import { useCurrentUser } from '@/hooks/use-auth';

// ============================================================================
// Hook 返回值类型（已在 types/webrtc.ts 中定义）
// ============================================================================

/**
 * useWebRTC Hook
 * 管理 WebRTC 连接的生命周期
 * 集成 Pusher 信令发送/接收
 */
export function useWebRTC(): UseWebRTCResult {
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSignalingConnected, setIsSignalingConnected] = useState(false);

  // 获取当前用户 ID
  const currentUser = useCurrentUser();
  const userId = currentUser?.id;

  // Pusher 客户端引用
  const pusherRef = useRef<Pusher | null>(null);
  const channelRef = useRef<any>(null);

  // Zustand Store
  const {
    callState,
    callId,
    callerId,
    calleeId,
    isMicrophoneMuted,
    isCameraOff,
    callDuration,
    networkQuality,
    setCallId,
    setCallerId,
    setCalleeId,
    initiateCall: storeInitiateCall,
    acceptCall: storeAcceptCall,
    declineCall: storeDeclineCall,
    hangupCall: storeHangupCall,
    toggleMicrophone: storeToggleMicrophone,
    toggleCamera: storeToggleCamera,
    switchCamera: storeSwitchCamera,
    _setLocalStream,
    _setRemoteStream,
    _updateCallState,
    _setError,
  } = useVideoCallStore();

  // ============================================================================
  // 初始化 Pusher 信令
  // ============================================================================

  const initPusherSignaling = useCallback(
    (currentUserId: string) => {
      if (!currentUserId) {
        console.error('[useWebRTC] No userId provided for Pusher signaling');
        return;
      }

      console.log('[useWebRTC] Initializing Pusher signaling for user:', currentUserId);

      // 复用现有的 Pusher 客户端
      const pusher = getIMPusherClient();
      if (!pusher) {
        console.error('[useWebRTC] Pusher not available');
        return;
      }

      pusherRef.current = pusher;

      // 订阅用户频道（复用现有的 private-user-{userId}）
      const channelName = getUserChannel(currentUserId);
      const channel = pusher.subscribe(channelName);
      channelRef.current = channel;

      console.log('[useWebRTC] Subscribed to Pusher channel:', channelName);

      // 绑定 WebRTC 信令事件
      channel.bind(PUSHER_EVENTS.VIDEO_CALL_OFFER, (data: VideoCallOffer) => {
        console.log('[useWebRTC] Received offer via Pusher:', data);
        handleReceivedOffer(data);
      });

      channel.bind(PUSHER_EVENTS.VIDEO_CALL_ANSWER, (data: VideoCallAnswer) => {
        console.log('[useWebRTC] Received answer via Pusher:', data);
        handleReceivedAnswer(data);
      });

      channel.bind(PUSHER_EVENTS.VIDEO_CALL_DECLINE, (data: VideoCallDecline) => {
        console.log('[useWebRTC] Received decline via Pusher:', data);
        handleReceivedDecline(data);
      });

      channel.bind(PUSHER_EVENTS.ICE_CANDIDATE, (data: ICECandidateMessage) => {
        console.log('[useWebRTC] Received ICE candidate via Pusher:', data);
        handleReceivedIceCandidate(data);
      });

      channel.bind(PUSHER_EVENTS.VIDEO_CALL_HANGUP, (data: VideoCallHangup) => {
        console.log('[useWebRTC] Received hangup via Pusher:', data);
        handleReceivedHangup(data);
      });

      // 连接状态
      setIsSignalingConnected(pusher.connection.state === 'connected');

      pusher.connection.bind('connected', () => {
        setIsSignalingConnected(true);
      });

      pusher.connection.bind('disconnected', () => {
        setIsSignalingConnected(false);
      });
    },
    []
  );

  // ============================================================================
  // 发送 Pusher 信令
  // ============================================================================

  /**
   * 发送 Offer
   */
  const sendOfferViaPusher = useCallback(
    (offer: VideoCallOffer) => {
      const channel = channelRef.current;
      if (!channel) {
        console.error('[useWebRTC] Pusher channel not available');
        return;
      }

      console.log('[useWebRTC] Sending offer to:', offer.calleeId);
      channel.trigger(PUSHER_EVENTS.VIDEO_CALL_OFFER, offer);
    },
    []
  );

  /**
   * 发送 Answer
   */
  const sendAnswerViaPusher = useCallback(
    (answer: VideoCallAnswer) => {
      const channel = channelRef.current;
      if (!channel) {
        console.error('[useWebRTC] Pusher channel not available');
        return;
      }

      console.log('[useWebRTC] Sending answer to:', answer.callerId);
      channel.trigger(PUSHER_EVENTS.VIDEO_CALL_ANSWER, answer);
    },
    []
  );

  /**
   * 发送 ICE 候选
   */
  const sendIceCandidateViaPusher = useCallback(
    (message: ICECandidateMessage) => {
      const channel = channelRef.current;
      if (!channel) {
        console.error('[useWebRTC] Pusher channel not available');
        return;
      }

      console.log('[useWebRTC] Sending ICE candidate');
      channel.trigger(PUSHER_EVENTS.ICE_CANDIDATE, message);
    },
    []
  );

  /**
   * 发送拒绝
   */
  const sendDeclineViaPusher = useCallback(
    (decline: VideoCallDecline) => {
      const channel = channelRef.current;
      if (!channel) {
        console.error('[useWebRTC] Pusher channel not available');
        return;
      }

      console.log('[useWebRTC] Sending decline to:', decline.callerId);
      channel.trigger(PUSHER_EVENTS.VIDEO_CALL_DECLINE, decline);
    },
    []
  );

  /**
   * 发送挂断
   */
  const sendHangupViaPusher = useCallback(
    (hangup: VideoCallHangup) => {
      const channel = channelRef.current;
      if (!channel) {
        console.error('[useWebRTC] Pusher channel not available');
        return;
      }

      console.log('[useWebRTC] Sending hangup');
      channel.trigger(PUSHER_EVENTS.VIDEO_CALL_HANGUP, hangup);
    },
    []
  );

  // ============================================================================
  // 处理接收到的信令
  // ============================================================================

  const handleReceivedOffer = useCallback(
    async (offer: VideoCallOffer) => {
      try {
        console.log('[useWebRTC] Handling received offer');

        // 更新 Store 状态
        setCallId(offer.callId);
        setCallerId(offer.callerId);
        setCalleeId(offer.calleeId);
        _updateCallState(CallState.RINGING);

        // 保存 Offer 到 sessionStorage（等待用户接听）
        sessionStorage.setItem('pendingVideoCallOffer', JSON.stringify(offer));
      } catch (error) {
        console.error('[useWebRTC] Failed to handle received offer:', error);
        setError(error instanceof Error ? error.message : 'Failed to handle offer');
      }
    },
    [setCallId, setCallerId, setCalleeId, _updateCallState, _setError]
  );

  const handleReceivedAnswer = useCallback(
    async (answer: VideoCallAnswer) => {
      try {
        console.log('[useWebRTC] Handling received answer');

        const pc = peerConnectionRef.current;
        if (!pc) {
          console.error('[useWebRTC] PeerConnection not initialized');
          return;
        }

        // 设置远程描述
        await setRemoteDescription(pc, answer.answer);

        console.log('[useWebRTC] Answer set successfully');
      } catch (error) {
        console.error('[useWebRTC] Failed to handle received answer:', error);
        setError(error instanceof Error ? error.message : 'Failed to handle answer');
      }
    },
    []
  );

  const handleReceivedDecline = useCallback(
    (decline: VideoCallDecline) => {
      console.log('[useWebRTC] Handling received decline:', decline.reason);

      // 更新 Store 状态
      _updateCallState(CallState.ENDED);

      // 显示错误
      const errorMsg = decline.reason === 'busy' ? 'User is busy' : 'Call was declined';
      setError(errorMsg);

      // 延迟重置状态
      setTimeout(() => {
        _updateCallState(CallState.IDLE);
        setError(null);
      }, 2000);
    },
    [_updateCallState, _setError]
  );

  const handleReceivedIceCandidate = useCallback(
    async (message: ICECandidateMessage) => {
      try {
        console.log('[useWebRTC] Handling received ICE candidate');

        const pc = peerConnectionRef.current;
        if (!pc) {
          console.error('[useWebRTC] PeerConnection not initialized');
          return;
        }

        // 添加 ICE 候选
        await addIceCandidate(pc, message.candidate);

        console.log('[useWebRTC] ICE candidate added successfully');
      } catch (error) {
        console.error('[useWebRTC] Failed to handle received ICE candidate:', error);
      }
    },
    []
  );

  const handleReceivedHangup = useCallback(
    (hangup: VideoCallHangup) => {
      console.log('[useWebRTC] Handling received hangup:', hangup.reason);

      // 挂断通话
      hangupCall();
    },
    []
  );

  // ============================================================================
  // 初始化 RTCPeerConnection
  // ============================================================================

  const initPeerConnection = useCallback(() => {
    if (peerConnectionRef.current) {
      console.warn('[useWebRTC] PeerConnection already initialized');
      return peerConnectionRef.current;
    }

    const pc = createPeerConnection(
      // onIceCandidate
      (candidate: RTCIceCandidate) => {
        console.log('[useWebRTC] ICE candidate generated:', candidate);

        // 发送 ICE 候选（P0 Issue #3 修复）
        if (callId && userId) {
          const message: ICECandidateMessage = {
            callId,
            callerId: callerId || userId,
            calleeId: calleeId || '',
            candidate: candidate.toJSON(),
          };
          sendIceCandidateViaPusher(message);
        }
      },

      // onTrack
      (event: RTCTrackEvent) => {
        console.log('[useWebRTC] Remote track received');
        if (event.streams && event.streams[0]) {
          setRemoteStream(event.streams[0]);
          _setRemoteStream(event.streams[0]);
        }
      },

      // onConnectionStateChange
      (state: string) => {
        console.log('[useWebRTC] Connection state:', state);
        switch (state) {
          case 'connected':
            _updateCallState(CallState.CONNECTED);
            break;
          case 'disconnected':
          case 'failed':
            _updateCallState(CallState.FAILED);
            setError('Connection failed');
            break;
          case 'closed':
            _updateCallState(CallState.ENDED);
            break;
        }
      }
    );

    peerConnectionRef.current = pc;
    console.log('[useWebRTC] PeerConnection initialized');

    return pc;
  }, [callId, userId, callerId, calleeId, sendIceCandidateViaPusher, _setRemoteStream, _updateCallState, _setError]);

  // ============================================================================
  // 初始化 Pusher（当 userId 可用时）
  // ============================================================================

  useEffect(() => {
    if (userId) {
      initPusherSignaling(userId);
    }

    return () => {
      // 清理 Pusher 订阅
      if (channelRef.current) {
        channelRef.current.unbind_all();
        pusherRef.current?.unsubscribe(getUserChannel(userId!));
        channelRef.current = null;
      }
    };
  }, [userId, initPusherSignaling]);

  // ============================================================================
  // 发起通话
  // ============================================================================

  const initiateCall = useCallback(
    async (calleeId: string) => {
      try {
        console.log('[useWebRTC] Initiating call to:', calleeId);

        if (!userId) {
          throw new Error('User not authenticated');
        }

        // 1. 生成通话 ID
        const newCallId = generateCallId();

        // 2. 获取本地媒体流
        const stream = await getLocalStream();
        setLocalStream(stream);
        _setLocalStream(stream);

        // 3. 初始化 PeerConnection
        const pc = initPeerConnection();

        // 4. 添加本地流
        addLocalStream(pc, stream);

        // 5. 创建 Offer
        const offer = await createOffer(pc);

        // 6. 更新 Store 状态
        setCallId(newCallId);
        setCallerId(userId);
        setCalleeId(calleeId);
        _updateCallState(CallState.CALLING);

        // 7. 通过 Pusher 发送 Offer（P0 Issue #2 修复）
        const videoCallOffer: VideoCallOffer = {
          callId: newCallId,
          callerId: userId,
          calleeId,
          offer,
          timestamp: Date.now(),
        };
        sendOfferViaPusher(videoCallOffer);

        console.log('[useWebRTC] Call initiated successfully');
      } catch (error) {
        console.error('[useWebRTC] Failed to initiate call:', error);
        setError(error instanceof Error ? error.message : 'Failed to initiate call');
        _setError(error instanceof Error ? error.message : 'Failed to initiate call');
      }
    },
    [userId, initPeerConnection, setCallId, setCallerId, setCalleeId, _updateCallState, _setLocalStream, _setError, sendOfferViaPusher]
  );

  // ============================================================================
  // 接受通话
  // ============================================================================

  const acceptCall = useCallback(
    async () => {
      try {
        console.log('[useWebRTC] Accepting call');

        if (!userId) {
          throw new Error('User not authenticated');
        }

        // 1. 从 sessionStorage 获取 pending Offer
        const pendingOfferStr = sessionStorage.getItem('pendingVideoCallOffer');
        if (!pendingOfferStr) {
          throw new Error('No pending offer found');
        }

        const pendingOffer: VideoCallOffer = JSON.parse(pendingOfferStr);

        // 2. 获取本地媒体流
        const stream = await getLocalStream();
        setLocalStream(stream);
        _setLocalStream(stream);

        // 3. 初始化 PeerConnection
        const pc = initPeerConnection();

        // 4. 添加本地流
        addLocalStream(pc, stream);

        // 5. 设置远程描述（Offer）
        await setRemoteDescription(pc, pendingOffer.offer);

        // 6. 创建 Answer
        const answer = await createAnswer(pc, pendingOffer.offer);

        // 7. 更新 Store 状态
        _updateCallState(CallState.CONNECTING);

        // 8. 通过 Pusher 发送 Answer（P0 Issue #2 修复）
        const videoCallAnswer: VideoCallAnswer = {
          callId: pendingOffer.callId,
          callerId: pendingOffer.callerId,
          calleeId: userId,
          answer,
        };
        sendAnswerViaPusher(videoCallAnswer);

        // 9. 清除 pending Offer
        sessionStorage.removeItem('pendingVideoCallOffer');

        console.log('[useWebRTC] Call accepted successfully');
      } catch (error) {
        console.error('[useWebRTC] Failed to accept call:', error);
        setError(error instanceof Error ? error.message : 'Failed to accept call');
        _setError(error instanceof Error ? error.message : 'Failed to accept call');
      }
    },
    [userId, initPeerConnection, _updateCallState, _setLocalStream, _setError, sendAnswerViaPusher]
  );

  // ============================================================================
  // 拒绝通话
  // ============================================================================

  const declineCall = useCallback(
    (reason: 'busy' | 'declined' | 'no_answer') => {
      console.log('[useWebRTC] Declining call, reason:', reason);

      // 1. 更新 Store 状态
      storeDeclineCall(reason);

      // 2. 通过 Pusher 发送拒绝
      const state = useVideoCallStore.getState();
      if (state.callId && state.callerId) {
        const decline: VideoCallDecline = {
          callId: state.callId,
          callerId: state.callerId,
          calleeId: userId!,
          reason,
        };
        sendDeclineViaPusher(decline);
      }

      // 3. 清除 pending Offer
      sessionStorage.removeItem('pendingVideoCallOffer');

      // 4. 延迟重置状态
      setTimeout(() => {
        _updateCallState(CallState.IDLE);
      }, 1000);
    },
    [storeDeclineCall, userId, sendDeclineViaPusher, _updateCallState]
  );

  // ============================================================================
  // 挂断通话
  // ============================================================================

  const hangupCall = useCallback(() => {
    console.log('[useWebRTC] Hanging up call');

    // 1. 关闭 PeerConnection
    closeConnection(peerConnectionRef.current);
    peerConnectionRef.current = null;

    // 2. 停止本地流
    if (localStream) {
      stopMediaStream(localStream);
      setLocalStream(null);
      _setLocalStream(null);
    }

    // 3. 清除远程流
    setRemoteStream(null);
    _setRemoteStream(null);

    // 4. 通过 Pusher 发送挂断（P0 Issue #2 修复）
    const state = useVideoCallStore.getState();
    if (state.callId) {
      const hangup: VideoCallHangup = {
        callId: state.callId,
        callerId: state.callerId || userId!,
        calleeId: state.calleeId || '',
        reason: HangupReason.USER_INITIATED,
        duration: state.callDuration,
        timestamp: Date.now(),
      };
      sendHangupViaPusher(hangup);
    }

    // 5. 更新 Store
    storeHangupCall();

    // 6. 清除 pending Offer
    sessionStorage.removeItem('pendingVideoCallOffer');
  }, [localStream, userId, storeHangupCall, _setLocalStream, _setRemoteStream, sendHangupViaPusher]);

  // ============================================================================
  // 媒体控制
  // ============================================================================

  const toggleMicrophone = useCallback(() => {
    storeToggleMicrophone();
  }, [storeToggleMicrophone]);

  const toggleCamera = useCallback(() => {
    storeToggleCamera();
  }, [storeToggleCamera]);

  const switchCamera = useCallback(() => {
    storeSwitchCamera();
  }, [storeSwitchCamera]);

  // ============================================================================
  // 清理
  // ============================================================================

  useEffect(() => {
    return () => {
      console.log('[useWebRTC] Cleaning up');
      closeConnection(peerConnectionRef.current);
      if (localStream) {
        stopMediaStream(localStream);
      }
    };
  }, [localStream]);

  // ============================================================================
  // 返回值
  // ============================================================================

  return {
    callState,
    localStream,
    remoteStream,
    isMicrophoneMuted,
    isCameraOff,
    callDuration,
    networkQuality,
    error,
    isSignalingConnected,
    initiateCall,
    acceptCall,
    declineCall,
    hangupCall,
    toggleMicrophone,
    toggleCamera,
    switchCamera,
  };
}

export default useWebRTC;
