/**
 * 视频播放器组件
 * 封装 <video> 标签，处理播放逻辑
 */

'use client';

import React, { useRef, useEffect, useCallback } from 'react';
import { VideoPlayerProps } from '@/types/webrtc';

/**
 * VideoPlayer 组件
 * 显示本地或远程视频流
 */
export function VideoPlayer({
  stream,
  muted = false,
  autoPlay = true,
  className = '',
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // ============================================================================
  // 设置视频流
  // ============================================================================

  useEffect(() => {
    const videoElement = videoRef.current;
    
    if (!videoElement) return;
    
    if (stream) {
      console.log('[VideoPlayer] Setting video stream:', stream.id);
      videoElement.srcObject = stream;
      
      // 确保视频播放
      if (autoPlay) {
        videoElement.play().catch((error) => {
          console.error('[VideoPlayer] Failed to play video:', error);
        });
      }
    } else {
      console.log('[VideoPlayer] Clearing video stream');
      videoElement.srcObject = null;
    }
  }, [stream, autoPlay]);

  // ============================================================================
  // 处理视频播放事件
  // ============================================================================

  const handleCanPlay = useCallback(() => {
    console.log('[VideoPlayer] Video can play');
  }, []);

  const handlePlaying = useCallback(() => {
    console.log('[VideoPlayer] Video is playing');
  }, []);

  const handleError = useCallback((event: React.SyntheticEvent<HTMLVideoElement, Event>) => {
    console.error('[VideoPlayer] Video error:', event);
  }, []);

  // ============================================================================
  // 渲染
  // ============================================================================

  return (
    <video
      ref={videoRef}
      muted={muted}
      autoPlay={autoPlay}
      playsInline
      onCanPlay={handleCanPlay}
      onPlaying={handlePlaying}
      onError={handleError}
      className={`video-player ${className}`}
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        borderRadius: '8px',
      }}
    />
  );
}

/**
 * 带镜像效果的 VideoPlayer（用于本地视频）
 */
export function MirroredVideoPlayer(props: VideoPlayerProps) {
  return (
    <div className="mirrored-video-container" style={{ transform: 'scaleX(-1)' }}>
      <VideoPlayer {...props} />
    </div>
  );
}

export default VideoPlayer;
