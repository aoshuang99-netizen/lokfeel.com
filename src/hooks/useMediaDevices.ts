/**
 * 媒体设备 Hook
 * 获取/切换摄像头、麦克风
 */

'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  CameraFacingMode,
  LocalMediaConfig,
  UseMediaDevicesResult,
} from '@/types/webrtc';
import {
  getLocalStream,
  switchCamera as switchCameraUtil,
  stopMediaStream,
  toggleMicrophone as toggleMicUtil,
  toggleCamera as toggleCamUtil,
  isMicrophoneMuted as checkIsMicMuted,
  isCameraOff as checkIsCamOff,
  getCameras,
  getMicrophones,
  checkMediaPermissions,
} from '@/utils/mediaStream';
import { DEFAULT_MEDIA_CONSTRAINTS } from '@/config/webrtc.config';

// ============================================================================
// useMediaDevices Hook
// ============================================================================

/**
 * useMediaDevices Hook
 * 管理本地媒体设备的获取和控制
 */
export function useMediaDevices(): UseMediaDevicesResult {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isMicrophoneMuted, setIsMicrophoneMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [cameraFacingMode, setCameraFacingMode] = useState<CameraFacingMode>(
    CameraFacingMode.USER
  );

  // ============================================================================
  // 获取本地媒体流
  // ============================================================================

  const getLocalStreamAsync = useCallback(
    async (config?: Partial<LocalMediaConfig>): Promise<MediaStream> => {
      try {
        console.log('[useMediaDevices] Getting local stream');
        
        const constraints: MediaStreamConstraints = {
          video: config?.video ?? DEFAULT_MEDIA_CONSTRAINTS.video,
          audio: config?.audio ?? DEFAULT_MEDIA_CONSTRAINTS.audio,
        };
        
        const stream = await getLocalStream(constraints);
        
        setLocalStream(stream);
        setIsMicrophoneMuted(checkIsMicMuted(stream));
        setIsCameraOff(checkIsCamOff(stream));
        
        console.log('[useMediaDevices] Local stream obtained');
        return stream;
      } catch (error) {
        console.error('[useMediaDevices] Failed to get local stream:', error);
        throw error;
      }
    },
    []
  );

  // ============================================================================
  // 停止本地媒体流
  // ============================================================================

  const stopLocalStream = useCallback(() => {
    if (localStream) {
      console.log('[useMediaDevices] Stopping local stream');
      stopMediaStream(localStream);
      setLocalStream(null);
      setIsMicrophoneMuted(false);
      setIsCameraOff(false);
    }
  }, [localStream]);

  // ============================================================================
  // 切换麦克风
  // ============================================================================

  const toggleMicrophone = useCallback(() => {
    if (!localStream) {
      console.warn('[useMediaDevices] No local stream to toggle microphone');
      return;
    }

    const muted = toggleMicUtil(localStream);
    setIsMicrophoneMuted(muted);
    
    console.log('[useMediaDevices] Microphone', muted ? 'muted' : 'enabled');
  }, [localStream]);

  // ============================================================================
  // 切换摄像头
  // ============================================================================

  const toggleCamera = useCallback(() => {
    if (!localStream) {
      console.warn('[useMediaDevices] No local stream to toggle camera');
      return;
    }

    const off = toggleCamUtil(localStream);
    setIsCameraOff(off);
    
    console.log('[useMediaDevices] Camera', off ? 'disabled' : 'enabled');
  }, [localStream]);

  // ============================================================================
  // 切换摄像头方向（前置/后置）
  // ============================================================================

  const switchCameraAsync = useCallback(async () => {
    try {
      console.log('[useMediaDevices] Switching camera');
      
      const newMode = cameraFacingMode === CameraFacingMode.USER
        ? CameraFacingMode.ENVIRONMENT
        : CameraFacingMode.USER;
      
      const newStream = await switchCameraUtil(localStream, newMode);
      
      setLocalStream(newStream);
      setCameraFacingMode(newMode);
      setIsCameraOff(false);
      
      console.log('[useMediaDevices] Camera switched to:', newMode);
    } catch (error) {
      console.error('[useMediaDevices] Failed to switch camera:', error);
    }
  }, [localStream, cameraFacingMode]);

  // ============================================================================
  // 清理
  // ============================================================================

  useEffect(() => {
    return () => {
      console.log('[useMediaDevices] Cleaning up');
      stopLocalStream();
    };
  }, [stopLocalStream]);

  // ============================================================================
  // 返回值
  // ============================================================================

  return {
    localStream,
    isMicrophoneMuted,
    isCameraOff,
    cameraFacingMode,
    getLocalStream: getLocalStreamAsync,
    stopLocalStream,
    toggleMicrophone,
    toggleCamera,
    switchCamera: switchCameraAsync,
  };
}

// ============================================================================
// 导出辅助 Hook：检查权限
// ============================================================================

/**
 * useMediaPermissions Hook
 * 检查和管理媒体设备权限
 */
export function useMediaPermissions() {
  const [cameraPermission, setCameraPermission] = useState<PermissionState>('prompt');
  const [microphonePermission, setMicrophonePermission] = useState<PermissionState>('prompt');

  const checkPermissions = useCallback(async () => {
    try {
      const permissions = await checkMediaPermissions();
      setCameraPermission(permissions.camera);
      setMicrophonePermission(permissions.microphone);
    } catch (error) {
      console.error('[useMediaPermissions] Failed to check permissions:', error);
    }
  }, []);

  useEffect(() => {
    checkPermissions();
  }, [checkPermissions]);

  return {
    cameraPermission,
    microphonePermission,
    checkPermissions,
  };
}

// ============================================================================
// 导出辅助 Hook：枚举设备
// ============================================================================

/**
 * useMediaDeviceEnumeration Hook
 * 枚举可用的媒体设备
 */
export function useMediaDeviceEnumeration() {
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);

  const enumerateDevices = useCallback(async () => {
    try {
      const [cameraList, microphoneList] = await Promise.all([
        getCameras(),
        getMicrophones(),
      ]);
      
      setCameras(cameraList);
      setMicrophones(microphoneList);
    } catch (error) {
      console.error('[useMediaDeviceEnumeration] Failed to enumerate devices:', error);
    }
  }, []);

  useEffect(() => {
    enumerateDevices();
  }, [enumerateDevices]);

  return {
    cameras,
    microphones,
    enumerateDevices,
  };
}
