/**
 * 来电弹窗组件
 * 接收方看到的通话邀请
 */

'use client';

import React, { useEffect, useRef } from 'react';
import { IncomingCallModalProps } from '@/types/webrtc';

/**
 * IncomingCallModal 组件
 * 显示来电通知，包含接听/拒绝按钮
 */
export function IncomingCallModal({
  open,
  callerName,
  callerAvatar,
  onAccept,
  onDecline,
}: IncomingCallModalProps) {
  const audioRef = useRef<HTMLAudioElement>(null);

  // ============================================================================
  // 播放来电铃声
  // ============================================================================

  useEffect(() => {
    if (open) {
      // 播放来电铃声
      if (audioRef.current) {
        audioRef.current.play().catch((error) => {
          console.warn('[IncomingCallModal] Failed to play ringtone:', error);
        });
      }
    } else {
      // 停止铃声
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
    }

    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
    };
  }, [open]);

  // ============================================================================
  // 处理接听
  // ============================================================================

  const handleAccept = () => {
    console.log('[IncomingCallModal] Call accepted');
    if (audioRef.current) {
      audioRef.current.pause();
    }
    onAccept();
  };

  // ============================================================================
  // 处理拒绝
  // ============================================================================

  const handleDecline = (reason: 'busy' | 'declined' | 'no_answer') => {
    console.log('[IncomingCallModal] Call declined:', reason);
    if (audioRef.current) {
      audioRef.current.pause();
    }
    onDecline(reason);
  };

  // ============================================================================
  // 渲染
  // ============================================================================

  if (!open) return null;

  return (
    <div className="incoming-call-modal fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      {/* 来电铃声（隐藏） */}
      <audio ref={audioRef} loop>
        <source src="/sounds/ringtone.mp3" type="audio/mpeg" />
      </audio>

      {/* 弹窗内容 */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 max-w-sm w-full mx-4 shadow-2xl animate-slide-up">
        {/* 来电者头像 */}
        <div className="flex flex-col items-center mb-6">
          <div className="w-24 h-24 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700 mb-4">
            {callerAvatar ? (
              <img
                src={callerAvatar}
                alt={callerName}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-4xl text-gray-400">
                👤
              </div>
            )}
          </div>

          {/* 来电者名字 */}
          <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
            {callerName}
          </h3>

          {/* 来电提示 */}
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            邀请您进行视频通话...
          </p>
        </div>

        {/* 按钮组 */}
        <div className="flex items-center justify-center gap-6">
          {/* 拒绝按钮（红色） */}
          <button
            onClick={() => handleDecline('declined')}
            className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-colors duration-200 shadow-lg"
            title="拒绝"
          >
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* 接听按钮（绿色） */}
          <button
            onClick={handleAccept}
            className="w-16 h-16 rounded-full bg-green-500 hover:bg-green-600 flex items-center justify-center transition-colors duration-200 shadow-lg"
            title="接听"
          >
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export default IncomingCallModal;
