/**
 * 视频通话主界面模态框
 * 包含本地/远程视频、控制栏、通话时长
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { VideoCallModalProps, CallState } from '@/types/webrtc';
import { useVideoCallStore } from '@/store/videoCallStore';
import { useWebRTC } from '@/hooks/useWebRTC';
import { usePusherSignaling } from '@/hooks/usePusherSignaling';
import { useCallTimer } from '@/hooks/useCallTimer';
import { VideoPlayer } from './VideoPlayer';
import { CallControls } from './CallControls';
import { CallTimer } from './CallTimer';
import IncomingCallModal from './IncomingCallModal';

/**
 * VideoCallModal 组件
 * 视频通话主界面
 */
export function VideoCallModal({ open, onClose }: VideoCallModalProps) {
  const [showIncomingCall, setShowIncomingCall] = useState(false);
  const [callerInfo, setCallerInfo] = useState({ name: '', avatar: '' });

  // Store
  const {
    callState,
    callId,
    callerId,
    calleeId,
    isMicrophoneMuted,
    isCameraOff,
    _setLocalStream,
    _setRemoteStream,
    _updateCallState,
  } = useVideoCallStore();

  // WebRTC Hook
  const {
    callState: webrtcCallState,
    localStream,
    remoteStream,
    initiateCall,
    acceptCall,
    declineCall,
    hangupCall,
    toggleMicrophone,
    toggleCamera,
    switchCamera,
    error,
  } = useWebRTC();

  // Pusher 信令 Hook
  const {
    isConnected,
    sendOffer,
    sendAnswer,
    sendDecline,
    sendIceCandidate,
    sendHangup,
  } = usePusherSignaling(
    undefined, // userId - 应该从 auth store 获取
    // onOffer
    (offer) => {
      console.log('[VideoCallModal] Received offer:', offer);
      setShowIncomingCall(true);
      // TODO: 设置 callerInfo
    },
    // onAnswer
    (answer) => {
      console.log('[VideoCallModal] Received answer:', answer);
    },
    // onDecline
    (decline) => {
      console.log('[VideoCallModal] Received decline:', decline);
    },
    // onIceCandidate
    (message) => {
      console.log('[VideoCallModal] Received ICE candidate:', message);
    },
    // onHangup
    (hangup) => {
      console.log('[VideoCallModal] Received hangup:', hangup);
    }
  );

  // 计时器 Hook
  const { startTimer, pauseTimer, resetTimer } = useCallTimer(
    false,
    (duration) => {
      // 每秒更新通话时长
      console.log('[VideoCallModal] Call duration:', duration);
    }
  );

  // ============================================================================
  // 监听通话状态变化
  // ============================================================================

  useEffect(() => {
    if (callState === CallState.CONNECTED) {
      startTimer();
    } else if (callState === CallState.ENDED || callState === CallState.FAILED) {
      pauseTimer();
    }
  }, [callState, startTimer, pauseTimer]);

  // ============================================================================
  // 处理接听
  // ============================================================================

  const handleAccept = useCallback(async () => {
    console.log('[VideoCallModal] Accepting call');
    setShowIncomingCall(false);
    await acceptCall();
  }, [acceptCall]);

  // ============================================================================
  // 处理拒绝
  // ============================================================================

  const handleDecline = useCallback(
    (reason: 'busy' | 'declined' | 'no_answer') => {
      console.log('[VideoCallModal] Declining call:', reason);
      setShowIncomingCall(false);
      declineCall(reason);
    },
    [declineCall]
  );

  // ============================================================================
  // 处理挂断
  // ============================================================================

  const handleHangup = useCallback(() => {
    console.log('[VideoCallModal] Hanging up');
    hangupCall();
    resetTimer();
    if (onClose) onClose();
  }, [hangupCall, resetTimer, onClose]);

  // ============================================================================
  // 渲染
  // ============================================================================

  if (!open) return null;

  return (
    <div className="video-call-modal fixed inset-0 z-50 bg-gray-900">
      {/* 远程视频（大窗，居中） */}
      <div className="remote-video absolute inset-0 flex items-center justify-center">
        {remoteStream ? (
          <VideoPlayer
            stream={remoteStream}
            muted={false}
            autoPlay={true}
            className="max-w-full max-h-full"
          />
        ) : (
          <div className="flex items-center justify-center w-full h-full bg-gray-800">
            <div className="text-center text-white">
              {callState === CallState.CALLING && (
                <>
                  <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-white mx-auto mb-4" />
                  <p className="text-xl">正在呼叫...</p>
                </>
              )}
              {callState === CallState.CONNECTING && (
                <>
                  <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-white mx-auto mb-4" />
                  <p className="text-xl">正在连接...</p>
                </>
              )}
              {callState === CallState.RINGING && (
                <>
                  <div className="animate-pulse rounded-full h-16 w-16 bg-blue-500 mx-auto mb-4" />
                  <p className="text-xl">对方正在响铃...</p>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 本地视频（小窗，右上角） */}
      <div className="local-video absolute top-4 right-4 w-48 h-64 rounded-lg overflow-hidden shadow-lg z-10 border-2 border-gray-700">
        {localStream ? (
          <div style={{ transform: 'scaleX(-1)' }}>
            <VideoPlayer
              stream={localStream}
              muted={true}
              autoPlay={true}
              className="w-full h-full"
            />
          </div>
        ) : (
          <div className="w-full h-full bg-gray-700 flex items-center justify-center">
            <p className="text-white text-sm">本地视频</p>
          </div>
        )}
      </div>

      {/* 通话时长（左上角） */}
      <div className="absolute top-4 left-4 z-10">
        <CallTimer duration={0} isVisible={callState === CallState.CONNECTED} />
      </div>

      {/* 错误信息 */}
      {error && (
        <div className="absolute top-20 left-4 right-4 z-10">
          <div className="bg-red-500 text-white px-4 py-2 rounded-lg text-center">
            {error}
          </div>
        </div>
      )}

      {/* 控制栏（底部居中） */}
      <div className="absolute bottom-8 left-0 right-0 z-10">
        <div className="flex justify-center">
          <CallControls
            isMicrophoneMuted={isMicrophoneMuted}
            isCameraOff={isCameraOff}
            isScreenSharing={false}
            onToggleMicrophone={toggleMicrophone}
            onToggleCamera={toggleCamera}
            onHangup={handleHangup}
            onScreenShare={() => {}}
            onSwitchCamera={switchCamera}
          />
        </div>
      </div>

      {/* 来电弹窗 */}
      <IncomingCallModal
        open={showIncomingCall}
        callerName={callerInfo.name}
        callerAvatar={callerInfo.avatar}
        onAccept={handleAccept}
        onDecline={handleDecline}
      />
    </div>
  );
}

export default VideoCallModal;
