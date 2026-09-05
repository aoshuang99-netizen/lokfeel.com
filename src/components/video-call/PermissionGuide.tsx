/**
 * 权限引导组件
 * 首次使用时显示，引导用户授权摄像头和麦克风权限
 */

'use client';

import React, { useState, useEffect } from 'react';

/**
 * PermissionGuide 组件 Props
 */
interface PermissionGuideProps {
  open: boolean;
  onClose: () => void;
  onRequestPermission: () => void;
}

/**
 * PermissionGuide 组件
 * 引导用户授权摄像头和麦克风权限
 */
export function PermissionGuide({ open, onClose, onRequestPermission }: PermissionGuideProps) {
  const [permissionState, setPermissionState] = useState<{
    camera: PermissionState;
    microphone: PermissionState;
  }>({
    camera: 'prompt',
    microphone: 'prompt',
  });

  // ============================================================================
  // 检查权限状态
  // ============================================================================

  useEffect(() => {
    if (!open) return;

    const checkPermissions = async () => {
      try {
        const [cameraPermission, microphonePermission] = await Promise.all([
          navigator.permissions.query({ name: 'camera' as PermissionName }),
          navigator.permissions.query({ name: 'microphone' as PermissionName }),
        ]);

        setPermissionState({
          camera: cameraPermission.state,
          microphone: microphonePermission.state,
        });

        // 监听权限变化
        cameraPermission.onchange = () => {
          setPermissionState((prev) => ({ ...prev, camera: cameraPermission.state }));
        };

        microphonePermission.onchange = () => {
          setPermissionState((prev) => ({ ...prev, microphone: microphonePermission.state }));
        };
      } catch (error) {
        console.error('[PermissionGuide] Failed to check permissions:', error);
      }
    };

    checkPermissions();
  }, [open]);

  // ============================================================================
  // 请求权限
  // ============================================================================

  const handleRequestPermission = async () => {
    console.log('[PermissionGuide] Requesting permissions');
    onRequestPermission();
  };

  // ============================================================================
  // 渲染
  // ============================================================================

  if (!open) return null;

  const allGranted = permissionState.camera === 'granted' && permissionState.microphone === 'granted';
  const anyDenied = permissionState.camera === 'denied' || permissionState.microphone === 'denied';

  return (
    <div className="permission-guide fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
        {/* 标题 */}
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
          摄像头和麦克风权限
        </h2>

        {/* 说明 */}
        <p className="text-gray-600 dark:text-gray-300 mb-6">
          视频通话需要访问您的摄像头和麦克风。请点击下方按钮授权。
        </p>

        {/* 权限状态 */}
        <div className="space-y-4 mb-6">
          {/* 摄像头权限 */}
          <div className="flex items-center justify-between p-3 bg-gray-100 dark:bg-gray-700 rounded-lg">
            <div className="flex items-center gap-3">
              <svg className="w-6 h-6 text-gray-600 dark:text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <span className="text-gray-900 dark:text-white">摄像头</span>
            </div>
            <span
              className={`text-sm font-medium ${
                permissionState.camera === 'granted'
                  ? 'text-green-500'
                  : permissionState.camera === 'denied'
                  ? 'text-red-500'
                  : 'text-yellow-500'
              }`}
            >
              {permissionState.camera === 'granted'
                ? '已授权'
                : permissionState.camera === 'denied'
                ? '已拒绝'
                : '待授权'}
            </span>
          </div>

          {/* 麦克风权限 */}
          <div className="flex items-center justify-between p-3 bg-gray-100 dark:bg-gray-700 rounded-lg">
            <div className="flex items-center gap-3">
              <svg className="w-6 h-6 text-gray-600 dark:text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
              <span className="text-gray-900 dark:text-white">麦克风</span>
            </div>
            <span
              className={`text-sm font-medium ${
                permissionState.microphone === 'granted'
                  ? 'text-green-500'
                  : permissionState.microphone === 'denied'
                  ? 'text-red-500'
                  : 'text-yellow-500'
              }`}
            >
              {permissionState.microphone === 'granted'
                ? '已授权'
                : permissionState.microphone === 'denied'
                ? '已拒绝'
                : '待授权'}
            </span>
          </div>
        </div>

        {/* 按钮组 */}
        <div className="flex gap-3">
          {allGranted ? (
            // 已授权，关闭按钮
            <button
              onClick={onClose}
              className="flex-1 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors duration-200"
            >
              完成
            </button>
          ) : anyDenied ? (
            // 已拒绝，显示去设置按钮
            <>
              <button
                onClick={onClose}
                className="flex-1 py-3 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors duration-200"
              >
                关闭
              </button>
              <button
                onClick={() => {
                  // 打开浏览器设置
                  alert('请在浏览器设置中允许摄像头和麦克风权限');
                }}
                className="flex-1 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors duration-200"
              >
                去设置
              </button>
            </>
          ) : (
            // 未授权，请求权限按钮
            <>
              <button
                onClick={onClose}
                className="flex-1 py-3 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors duration-200"
              >
                取消
              </button>
              <button
                onClick={handleRequestPermission}
                className="flex-1 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors duration-200"
              >
                授权
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default PermissionGuide;
