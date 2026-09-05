/**
 * 通话控制栏组件
 * 包含：挂断、静音、切换摄像头、屏幕共享等按钮
 */

'use client';

import React from 'react';
import { CallControlsProps } from '@/types/webrtc';

/**
 * CallControls 组件
 * 视频通话控制栏
 */
export function CallControls({
  isMicrophoneMuted,
  isCameraOff,
  isScreenSharing,
  onToggleMicrophone,
  onToggleCamera,
  onHangup,
  onScreenShare,
  onSwitchCamera,
}: CallControlsProps) {
  return (
    <div className="call-controls flex items-center justify-center gap-4 p-4 bg-gray-900/90 rounded-full">
      {/* 静音按钮 */}
      <button
        onClick={onToggleMicrophone}
        className={`
          w-12 h-12 rounded-full flex items-center justify-center
          transition-colors duration-200
          ${isMicrophoneMuted ? 'bg-red-500 hover:bg-red-600' : 'bg-gray-700 hover:bg-gray-600'}
        `}
        title={isMicrophoneMuted ? '取消静音' : '静音'}
      >
        {isMicrophoneMuted ? (
          // 麦克风关闭图标
          <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1m5.586 4H10a1 1 0 01-1-1V9a1 1 0 011-1h1m4 6h2a1 1 0 001-1V9a1 1 0 00-1-1h-2m-4 0V5a1 1 0 011-1h2a1 1 0 011 1v8m-6 0a1 1 0 001 1h2a1 1 0 001-1m0 0V5a1 1 0 011-1h2a1 1 0 011 1v8" />
          </svg>
        ) : (
          // 麦克风开启图标
          <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        )}
      </button>

      {/* 摄像头按钮 */}
      <button
        onClick={onToggleCamera}
        className={`
          w-12 h-12 rounded-full flex items-center justify-center
          transition-colors duration-200
          ${isCameraOff ? 'bg-red-500 hover:bg-red-600' : 'bg-gray-700 hover:bg-gray-600'}
        `}
        title={isCameraOff ? '开启摄像头' : '关闭摄像头'}
      >
        {isCameraOff ? (
          // 摄像头关闭图标
          <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        ) : (
          // 摄像头开启图标
          <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        )}
      </button>

      {/* 挂断按钮（红色） */}
      <button
        onClick={onHangup}
        className="w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-colors duration-200"
        title="挂断"
      >
        {/* 挂断图标 */}
        <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
        </svg>
      </button>

      {/* 切换摄像头按钮（移动端） */}
      <button
        onClick={onSwitchCamera}
        className="w-12 h-12 rounded-full bg-gray-700 hover:bg-gray-600 flex items-center justify-center transition-colors duration-200"
        title="切换摄像头"
      >
        {/* 切换摄像头图标 */}
        <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
        </svg>
      </button>

      {/* 屏幕共享按钮（P1 功能） */}
      {onScreenShare && (
        <button
          onClick={onScreenShare}
          className={`
            w-12 h-12 rounded-full flex items-center justify-center
            transition-colors duration-200
            ${isScreenSharing ? 'bg-blue-500 hover:bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'}
          `}
          title={isScreenSharing ? '停止共享' : '共享屏幕'}
        >
          {/* 屏幕共享图标 */}
          <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </button>
      )}
    </div>
  );
}

export default CallControls;
