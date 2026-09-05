/**
 * 通话时长显示组件
 * 格式：MM:SS（例如 02:35）
 */

'use client';

import React from 'react';
import { useCallTimer, formatCallDuration } from '@/hooks/useCallTimer';

/**
 * CallTimer 组件 Props
 */
interface CallTimerProps {
  duration: number;  // 通话时长（秒）
  isVisible?: boolean;
}

/**
 * CallTimer 组件
 * 显示通话时长
 */
export function CallTimer({ duration, isVisible = true }: CallTimerProps) {
  if (!isVisible) return null;

  const formattedTime = formatCallDuration(duration);

  return (
    <div className="call-timer flex items-center gap-2 px-3 py-1 bg-black/50 rounded-full text-white text-sm">
      {/* 通话指示器 */}
      <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
      
      {/* 时长 */}
      <span className="font-mono tabular-nums">{formattedTime}</span>
    </div>
  );
}

/**
 * CallTimerWithHook 组件
 * 自带计时器逻辑的版本
 */
export function CallTimerWithHook({ isRunning = false }: { isRunning?: boolean }) {
  const { formattedDuration } = useCallTimer(isRunning);

  return (
    <div className="call-timer-with-hook flex items-center gap-2 px-3 py-1 bg-black/50 rounded-full text-white text-sm">
      <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
      <span className="font-mono tabular-nums">{formattedDuration}</span>
    </div>
  );
}

export default CallTimer;
