/**
 * 通话计时 Hook
 * 管理通话时长计时器
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

// ============================================================================
// Hook 返回值类型
// ============================================================================

export interface UseCallTimerReturn {
  callDuration: number;           // 通话时长（秒）
  formattedDuration: string;      // 格式化的时长（MM:SS）
  isRunning: boolean;             // 计时器是否运行中
  startTimer: () => void;         // 开始计时
  pauseTimer: () => void;         // 暂停计时
  resetTimer: () => void;         // 重置计时
}

// ============================================================================
// useCallTimer Hook
// ============================================================================

/**
 * useCallTimer Hook
 * @param autoStart - 是否自动开始计时
 * @param onTick - 每秒回调
 */
export function useCallTimer(
  autoStart: boolean = false,
  onTick?: (duration: number) => void
): UseCallTimerReturn {
  const [callDuration, setCallDuration] = useState<number>(0);
  const [isRunning, setIsRunning] = useState<boolean>(autoStart);
  
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);

  // ============================================================================
  // 格式化时长（MM:SS）
  // ============================================================================

  const formatDuration = useCallback((seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);  // 使用 Math.floor 确保整数
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, []);

  // ============================================================================
  // 开始计时
  // ============================================================================

  const startTimer = useCallback(() => {
    if (isRunning) {
      console.warn('[useCallTimer] Timer already running');
      return;
    }

    console.log('[useCallTimer] Starting timer');
    startTimeRef.current = Date.now();
    setIsRunning(true);
  }, [isRunning]);

  // ============================================================================
  // 暂停计时
  // ============================================================================

  const pauseTimer = useCallback(() => {
    if (!isRunning) {
      console.warn('[useCallTimer] Timer not running');
      return;
    }

    console.log('[useCallTimer] Pausing timer');
    setIsRunning(false);
    
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, [isRunning]);

  // ============================================================================
  // 重置计时
  // ============================================================================

  const resetTimer = useCallback(() => {
    console.log('[useCallTimer] Resetting timer');
    
    setIsRunning(false);
    setCallDuration(0);
    startTimeRef.current = 0;
    
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // ============================================================================
  // 计时器逻辑
  // ============================================================================

  useEffect(() => {
    if (isRunning) {
      console.log('[useCallTimer] Timer started');
      
      timerRef.current = setInterval(() => {
        setCallDuration((prev) => {
          const newDuration = prev + 1;
          onTick?.(newDuration);
          return newDuration;
        });
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isRunning, onTick]);

  // ============================================================================
  // 返回值
  // ============================================================================

  return {
    callDuration,
    formattedDuration: formatDuration(callDuration),
    isRunning,
    startTimer,
    pauseTimer,
    resetTimer,
  };
}

// ============================================================================
// 导出辅助函数
// ============================================================================

/**
 * 格式化秒数为 MM:SS 格式
 * @param seconds - 秒数
 * @returns 格式化的字符串
 */
export function formatCallDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);  // 使用 Math.floor 确保整数
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * 格式化秒数为 HH:MM:SS 格式
 * @param seconds - 秒数
 * @returns 格式化的字符串
 */
export function formatCallDurationLong(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
