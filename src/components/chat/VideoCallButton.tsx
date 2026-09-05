/**
 * 聊天界面的「视频通话」按钮
 * 集成入口
 */

'use client';

import React, { useState, useCallback } from 'react';

/**
 * VideoCallButton 组件 Props
 */
interface VideoCallButtonProps {
  targetUserId: string;        // 对方用户 ID
  isOnline?: boolean;          // 对方是否在线
  isDisabled?: boolean;        // 是否禁用（自己忙线中）
  onStartCall: (userId: string) => void;  // 开始通话回调
}

/**
 * VideoCallButton 组件
 * 聊天界面中的视频通话按钮
 */
export function VideoCallButton({
  targetUserId,
  isOnline = true,
  isDisabled = false,
  onStartCall,
}: VideoCallButtonProps) {
  const [isLoading, setIsLoading] = useState(false);

  // ============================================================================
  // 处理点击
  // ============================================================================

  const handleClick = useCallback(async () => {
    if (!isOnline || isDisabled || isLoading) return;

    console.log('[VideoCallButton] Starting video call to:', targetUserId);
    setIsLoading(true);

    try {
      await onStartCall(targetUserId);
    } catch (error) {
      console.error('[VideoCallButton] Failed to start call:', error);
    } finally {
      setIsLoading(false);
    }
  }, [targetUserId, isOnline, isDisabled, isLoading, onStartCall]);

  // ============================================================================
  // 渲染
  // ============================================================================

  const isButtonDisabled = !isOnline || isDisabled || isLoading;

  return (
    <button
      onClick={handleClick}
      disabled={isButtonDisabled}
      className={`
        p-2 rounded-full transition-all duration-200
        ${isButtonDisabled
          ? 'bg-gray-300 dark:bg-gray-600 cursor-not-allowed opacity-50'
          : 'bg-green-500 hover:bg-green-600 text-white shadow-lg hover:shadow-xl'
        }
      `}
      title={
        !isOnline
          ? '对方离线'
          : isDisabled
          ? '正在通话中'
          : '发起视频通话'
      }
    >
      {isLoading ? (
        // 加载中图标
        <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : (
        // 视频通话图标
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      )}
    </button>
  );
}

export default VideoCallButton;
