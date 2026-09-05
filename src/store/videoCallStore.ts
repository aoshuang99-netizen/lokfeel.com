/**
 * WebRTC 视频通话 Zustand Store
 * 管理通话状态、媒体流、设备状态
 */

import { create } from 'zustand';
import {
  CallState,
  HangupReason,
  CameraFacingMode,
  VideoCallState,
  VideoCallActions,
  VideoCallStore,
} from '@/types/webrtc';

// ============================================================================
// 初始状态
// ============================================================================

const initialState: VideoCallState = {
  // 通话状态
  callState: CallState.IDLE,
  callId: null,
  callerId: null,
  calleeId: null,
  
  // 媒体流
  localStream: null,
  remoteStream: null,
  
  // 设备状态
  isMicrophoneMuted: false,
  isCameraOff: false,
  cameraFacingMode: CameraFacingMode.USER,
  
  // 通话信息
  callDuration: 0,
  callStartTime: null,
  networkQuality: 'unknown',
  
  // 错误信息
  error: null,
  
  // 屏幕共享（P1）
  isScreenSharing: false,
};

// ============================================================================
// Store 创建
// ============================================================================

export const useVideoCallStore = create<VideoCallStore>((set, get) => ({
  ...initialState,

  // ============================================================================
  // 通话控制
  // ============================================================================

  /**
   * 发起视频通话
   * @param calleeId - 接收方用户 ID
   */
  initiateCall: async (calleeId: string) => {
    try {
      const callId = `call_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
      
      console.log('[VideoCallStore] Initiating call to:', calleeId, 'callId:', callId);
      
      set({
        callState: CallState.CALLING,
        callId,
        callerId: '', // 将在 Hook 中设置
        calleeId,
        error: null,
      });
    } catch (error) {
      console.error('[VideoCallStore] Failed to initiate call:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to initiate call',
        callState: CallState.FAILED,
      });
    }
  },

  /**
   * 接受视频通话
   */
  acceptCall: async () => {
    try {
      console.log('[VideoCallStore] Accepting call');
      
      set({
        callState: CallState.CONNECTING,
        error: null,
      });
    } catch (error) {
      console.error('[VideoCallStore] Failed to accept call:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to accept call',
        callState: CallState.FAILED,
      });
    }
  },

  /**
   * 拒绝视频通话
   * @param reason - 拒绝原因
   */
  declineCall: (reason: 'busy' | 'declined' | 'no_answer') => {
    try {
      console.log('[VideoCallStore] Declining call, reason:', reason);
      
      const state = get();
      set({
        callState: CallState.ENDED,
        error: null,
      });
      
      // 停止本地流
      if (state.localStream) {
        state.localStream.getTracks().forEach((track) => track.stop());
      }
      
      // 延迟重置状态（让 UI 有机会显示结束状态）
      setTimeout(() => {
        get().resetCallState();
      }, 1000);
    } catch (error) {
      console.error('[VideoCallStore] Failed to decline call:', error);
    }
  },

  /**
   * 挂断视频通话
   * @param reason - 挂断原因
   */
  hangupCall: (reason: HangupReason = HangupReason.USER_INITIATED) => {
    try {
      console.log('[VideoCallStore] Hanging up call, reason:', reason);
      
      const state = get();
      
      // 停止本地流
      if (state.localStream) {
        state.localStream.getTracks().forEach((track) => track.stop());
        set({ localStream: null });
      }
      
      // 清除远程流
      if (state.remoteStream) {
        set({ remoteStream: null });
      }
      
      set({
        callState: CallState.ENDED,
        callDuration: 0,
        callStartTime: null,
        error: null,
      });
      
      // 延迟重置状态
      setTimeout(() => {
        get().resetCallState();
      }, 1000);
    } catch (error) {
      console.error('[VideoCallStore] Failed to hangup call:', error);
    }
  },

  // ============================================================================
  // 媒体控制
  // ============================================================================

  /**
   * 切换麦克风
   */
  toggleMicrophone: () => {
    const state = get();
    if (!state.localStream) return;

    const audioTrack = state.localStream.getAudioTracks()[0];
    if (!audioTrack) return;

    audioTrack.enabled = !audioTrack.enabled;
    set({ isMicrophoneMuted: !audioTrack.enabled });
    
    console.log('[VideoCallStore] Microphone', audioTrack.enabled ? 'enabled' : 'muted');
  },

  /**
   * 切换摄像头
   */
  toggleCamera: () => {
    const state = get();
    if (!state.localStream) return;

    const videoTrack = state.localStream.getVideoTracks()[0];
    if (!videoTrack) return;

    videoTrack.enabled = !videoTrack.enabled;
    set({ isCameraOff: !videoTrack.enabled });
    
    console.log('[VideoCallStore] Camera', videoTrack.enabled ? 'enabled' : 'disabled');
  },

  /**
   * 切换摄像头方向（前置/后置）
   */
  switchCamera: () => {
    const state = get();
    const newMode = state.cameraFacingMode === CameraFacingMode.USER
      ? CameraFacingMode.ENVIRONMENT
      : CameraFacingMode.USER;
    
    console.log('[VideoCallStore] Switching camera to:', newMode);
    set({ cameraFacingMode: newMode });
  },

  /**
   * 开始屏幕共享
   */
  startScreenShare: async () => {
    try {
      console.log('[VideoCallStore] Starting screen share');
      // P1 功能，将在 useScreenShare Hook 中实现
      set({ isScreenSharing: true });
    } catch (error) {
      console.error('[VideoCallStore] Failed to start screen share:', error);
      set({ error: 'Failed to start screen share' });
    }
  },

  /**
   * 停止屏幕共享
   */
  stopScreenShare: () => {
    console.log('[VideoCallStore] Stopping screen share');
    set({ isScreenSharing: false });
  },

  // ============================================================================
  // 状态重置
  // ============================================================================

  /**
   * 重置通话状态
   */
  resetCallState: () => {
    console.log('[VideoCallStore] Resetting call state');
    set(initialState);
  },

  // ============================================================================
  // 内部方法（仅供 Hook 使用）
  // ============================================================================

  _setLocalStream: (stream: MediaStream | null) => {
    set({ localStream: stream });
  },

  _setRemoteStream: (stream: MediaStream | null) => {
    set({ remoteStream: stream });
  },

  _updateCallState: (state: CallState) => {
    set({ callState: state });
  },

  _setError: (error: string | null) => {
    set({ error });
  },

  // ============================================================================
  // 状态设置（新增 - 供 Hook 使用）
  // ============================================================================

  /**
   * 设置通话 ID
   */
  setCallId: (callId: string | null) => {
    set({ callId });
  },

  /**
   * 设置发起方 ID
   */
  setCallerId: (callerId: string | null) => {
    set({ callerId });
  },

  /**
   * 设置接收方 ID
   */
  setCalleeId: (calleeId: string | null) => {
    set({ calleeId });
  },
}));

// ============================================================================
// 选择器（用于性能优化）
// ============================================================================

export const useCallState = () => useVideoCallStore((state) => state.callState);
export const useLocalStream = () => useVideoCallStore((state) => state.localStream);
export const useRemoteStream = () => useVideoCallStore((state) => state.remoteStream);
export const useCallDuration = () => useVideoCallStore((state) => state.callDuration);
export const useIsMicrophoneMuted = () => useVideoCallStore((state) => state.isMicrophoneMuted);
export const useIsCameraOff = () => useVideoCallStore((state) => state.isCameraOff);
export const useCallError = () => useVideoCallStore((state) => state.error);
