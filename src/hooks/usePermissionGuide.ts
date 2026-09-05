/**
 * 权限引导 Hook
 * 检测权限状态并触发引导
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { checkMediaPermissions } from '@/utils/mediaStream';

/**
 * usePermissionGuide Hook 返回值
 */
export interface UsePermissionGuideReturn {
  showGuide: boolean;
  permissionChecked: boolean;
  cameraPermission: PermissionState;
  microphonePermission: PermissionState;
  checkPermissions: () => Promise<void>;
  requestPermissions: () => Promise<void>;
  closeGuide: () => void;
}

/**
 * usePermissionGuide Hook
 * 管理权限引导的显示
 */
export function usePermissionGuide(): UsePermissionGuideReturn {
  const [showGuide, setShowGuide] = useState(false);
  const [permissionChecked, setPermissionChecked] = useState(false);
  const [cameraPermission, setCameraPermission] = useState<PermissionState>('prompt');
  const [microphonePermission, setMicrophonePermission] = useState<PermissionState>('prompt');

  // ============================================================================
  // 检查权限
  // ============================================================================

  const checkPermissions = useCallback(async () => {
    try {
      console.log('[usePermissionGuide] Checking permissions');
      
      const permissions = await checkMediaPermissions();
      
      setCameraPermission(permissions.camera);
      setMicrophonePermission(permissions.microphone);
      setPermissionChecked(true);
      
      // 如果未授权，显示引导
      if (permissions.camera !== 'granted' || permissions.microphone !== 'granted') {
        // 检查是否首次使用（通过 localStorage）
        const hasSeenGuide = localStorage.getItem('video-call-permission-guide-seen');
        if (!hasSeenGuide) {
          setShowGuide(true);
        }
      }
    } catch (error) {
      console.error('[usePermissionGuide] Failed to check permissions:', error);
    }
  }, []);

  // ============================================================================
  // 请求权限
  // ============================================================================

  const requestPermissions = useCallback(async () => {
    try {
      console.log('[usePermissionGuide] Requesting permissions');
      
      // 通过 getUserMedia 触发权限请求
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      
      // 停止流（只是用来触发权限请求）
      stream.getTracks().forEach((track) => track.stop());
      
      // 重新检查权限
      await checkPermissions();
    } catch (error) {
      console.error('[usePermissionGuide] Failed to request permissions:', error);
    }
  }, [checkPermissions]);

  // ============================================================================
  // 关闭引导
  // ============================================================================

  const closeGuide = useCallback(() => {
    console.log('[usePermissionGuide] Closing guide');
    setShowGuide(false);
    localStorage.setItem('video-call-permission-guide-seen', 'true');
  }, []);

  // ============================================================================
  // 初始化检查
  // ============================================================================

  useEffect(() => {
    checkPermissions();
  }, [checkPermissions]);

  // ============================================================================
  // 返回值
  // ============================================================================

  return {
    showGuide,
    permissionChecked,
    cameraPermission,
    microphonePermission,
    checkPermissions,
    requestPermissions,
    closeGuide,
  };
}
