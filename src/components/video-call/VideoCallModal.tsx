/**
 * 视频通话主界面模态框
 * 包含本地/远程视频、控制栏、通话时长
 */

'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { VideoCallModalProps, CallState } from '@/types/webrtc';
import { useVideoCallStore } from '@/store/videoCallStore';
import { useWebRTC } from '@/hooks/useWebRTC';
import { useCallTimer } from '@/hooks/useCallTimer';
import { VideoPlayer } from './VideoPlayer';
import { CallControls } from './CallControls';
import { CallTimer } from './CallTimer';
import IncomingCallModal from './IncomingCallModal';

/**
 * VideoCallModal 组件
 * 视频通话主界面
 */
export function VideoCallModal({ open, onClose, initialCalleeId }: VideoCallModalProps) {
  // 来电者资料（offer 载荷里只有 callerId，需要另取）
  const [callerInfo, setCallerInfo] = useState({ name: 'User', avatar: '' });

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

  // ⚠️ 这里曾有一处 `usePusherSignaling(undefined, ...)`：把 userId 传成了 undefined，
  //    而 usePusherSignaling 第一行就是 `if (!userId) return;` → **永不订阅**，
  //    于是它唯一的副作用 `setShowIncomingCall(true)` 永远不会触发。
  //    而 `useWebRTC()` 内部已经用真实 userId 订阅了同一个个人频道并绑定全部信令
  //    （offer/answer/decline/ICE/hangup），此处属于重复且失效的第二份订阅，已删除。
  //    来电 UI 改由 store 的 callState === RINGING 驱动（见 handleReceivedOffer）。

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
  // 来电时拉取来电者资料
  // ============================================================================
  // offer 载荷只有 callerId，没有名字/头像，需按 id 现取（接口为鉴权后可见）。
  // 失败时保留兜底文案，不阻断来电 UI。
  useEffect(() => {
    if (callState !== CallState.RINGING || !callerId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/users/${callerId}`, { credentials: 'same-origin' });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const u = data?.user ?? {};
        setCallerInfo({
          name: u?.profile?.displayName || u?.name || 'User',
          avatar: u?.image || u?.profile?.avatar || '',
        });
      } catch {
        // 保持兜底
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [callState, callerId]);

  // ============================================================================
  // 发起呼叫（用户点了聊天页的「视频通话」按钮）
  // ============================================================================
  // ⚠️ 必须由本组件调用 `useWebRTC.initiateCall`：getUserMedia / createOffer /
  //    发信令（经 /api/im/call/signal 中继）都在它里面。
  //    store 的同名方法只把 callState 置为 CALLING，**不发信令** —— 早期接线误用了
  //    store 版本，导致点按钮后对方永远收不到呼叫（已修）。
  //    用 ref 记住已发起的目标，避免 React StrictMode 双调用 effect 时重复发起。
  const initiatedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !initialCalleeId) {
      initiatedForRef.current = null;
      return;
    }
    if (callState !== CallState.IDLE) return;
    if (initiatedForRef.current === initialCalleeId) return;
    initiatedForRef.current = initialCalleeId;
    void initiateCall(initialCalleeId);
  }, [open, initialCalleeId, callState, initiateCall]);

  // ============================================================================
  // 处理接听
  // ============================================================================

  const handleAccept = useCallback(async () => {
    console.log('[VideoCallModal] Accepting call');
    await acceptCall();
  }, [acceptCall]);

  // ============================================================================
  // 处理拒绝
  // ============================================================================

  const handleDecline = useCallback(
    (reason: 'busy' | 'declined' | 'no_answer') => {
      console.log('[VideoCallModal] Declining call:', reason);
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

  // 来电弹窗由 store 状态驱动（useWebRTC.handleReceivedOffer → CallState.RINGING）。
  // ⚠️ 必须在 `open` 判定**之前**渲染：被叫方收到 offer 时通话主界面是关闭的，
  //    若把来电 UI 放在提前 return 之后，被叫方将永远看不到来电（历史缺陷）。
  const incomingCallModal = (
    <IncomingCallModal
      open={callState === CallState.RINGING}
      callerName={callerInfo.name}
      callerAvatar={callerInfo.avatar}
      onAccept={handleAccept}
      onDecline={handleDecline}
    />
  );

  // 通话主界面：用户主动打开，或已进入连接/通话阶段（被叫方接听后）才铺满屏幕。
  // RINGING 阶段只显示来电弹窗。
  const showCallUI =
    open || callState === CallState.CONNECTING || callState === CallState.CONNECTED;

  if (!showCallUI) return incomingCallModal;

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

      {/* 来电弹窗（与「未打开」分支共用同一元素） */}
      {incomingCallModal}
    </div>
  );
}

export default VideoCallModal;
