/**
 * 媒体流工具函数
 * 封装 getUserMedia、getDisplayMedia 相关操作
 */

import { LocalMediaConfig, CameraFacingMode } from '@/types/webrtc';
import { DEFAULT_MEDIA_CONSTRAINTS, CAMERA_CONSTRAINTS } from '@/config/webrtc.config';

// ============================================================================
// 获取媒体流
// ============================================================================

/**
 * 获取本地媒体流（摄像头 + 麦克风）
 * @param config - 媒体约束配置
 * @returns 媒体流
 */
export async function getLocalStream(
  config?: Partial<LocalMediaConfig>
): Promise<MediaStream> {
  try {
    const constraints: MediaStreamConstraints = {
      video: config?.video ?? DEFAULT_MEDIA_CONSTRAINTS.video,
      audio: config?.audio ?? DEFAULT_MEDIA_CONSTRAINTS.audio,
    };

    console.log('[MediaStream] Requesting local stream with constraints:', constraints);
    
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    console.log('[MediaStream] Local stream obtained:', stream.id);
    
    return stream;
  } catch (error) {
    console.error('[MediaStream] Failed to get local stream:', error);
    throw error;
  }
}

/**
 * 获取屏幕共享流
 * @param options - 屏幕共享配置
 * @returns 屏幕共享流
 */
export async function getScreenShareStream(
  options?: MediaStreamConstraints
): Promise<MediaStream> {
  try {
    const constraints: MediaStreamConstraints = {
      video: options?.video 
        ? (typeof options.video === 'object' 
            ? { 
                cursor: 'always',
                ...options.video,
              } as MediaTrackConstraints
            : true)
        : { cursor: 'always' } as any,
      audio: options?.audio ?? false,
    };

    console.log('[MediaStream] Requesting screen share');
    
    // 使用 any 类型绕过 TypeScript 检查，因为 getDisplayMedia 在一些配置中可能需要特殊处理
    const stream = await (navigator.mediaDevices as any).getDisplayMedia(constraints);
    console.log('[MediaStream] Screen share stream obtained:', stream.id);
    
    return stream;
  } catch (error) {
    console.error('[MediaStream] Failed to get screen share:', error);
    throw error;
  }
}

/**
 * 切换摄像头
 * @param currentStream - 当前媒体流
 * @param targetFacingMode - 目标摄像头方向
 * @returns 新的媒体流
 */
export async function switchCamera(
  currentStream: MediaStream | null,
  targetFacingMode: CameraFacingMode
): Promise<MediaStream> {
  try {
    // 停止当前流
    if (currentStream) {
      stopMediaStream(currentStream);
    }

    // 获取新流
    const constraints: MediaStreamConstraints = {
      video: CAMERA_CONSTRAINTS[targetFacingMode],
      audio: DEFAULT_MEDIA_CONSTRAINTS.audio,
    };

    console.log('[MediaStream] Switching camera to:', targetFacingMode);
    
    const newStream = await navigator.mediaDevices.getUserMedia(constraints);
    console.log('[MediaStream] Camera switched successfully');
    
    return newStream;
  } catch (error) {
    console.error('[MediaStream] Failed to switch camera:', error);
    throw error;
  }
}

// ============================================================================
// 媒体流控制
// ============================================================================

/**
 * 停止媒体流（停止所有轨道）
 * @param stream - 要停止的媒体流
 */
export function stopMediaStream(stream: MediaStream | null): void {
  if (!stream) return;

  stream.getTracks().forEach((track) => {
    track.stop();
    console.log(`[MediaStream] Stopped ${track.kind} track`);
  });
}

/**
 * 切换麦克风状态
 * @param stream - 媒体流
 * @returns 切换后的状态（true = 静音）
 */
export function toggleMicrophone(stream: MediaStream | null): boolean {
  if (!stream) return false;

  const audioTrack = stream.getAudioTracks()[0];
  if (!audioTrack) {
    console.warn('[MediaStream] No audio track found');
    return false;
  }

  audioTrack.enabled = !audioTrack.enabled;
  console.log('[MediaStream] Microphone', audioTrack.enabled ? 'enabled' : 'muted');
  
  return !audioTrack.enabled;
}

/**
 * 切换摄像头状态
 * @param stream - 媒体流
 * @returns 切换后的状态（true = 关闭）
 */
export function toggleCamera(stream: MediaStream | null): boolean {
  if (!stream) return false;

  const videoTrack = stream.getVideoTracks()[0];
  if (!videoTrack) {
    console.warn('[MediaStream] No video track found');
    return false;
  }

  videoTrack.enabled = !videoTrack.enabled;
  console.log('[MediaStream] Camera', videoTrack.enabled ? 'enabled' : 'disabled');
  
  return !videoTrack.enabled;
}

/**
 * 检查麦克风状态
 * @param stream - 媒体流
 * @returns 是否静音
 */
export function isMicrophoneMuted(stream: MediaStream | null): boolean {
  if (!stream) return false;

  const audioTrack = stream.getAudioTracks()[0];
  if (!audioTrack) return false;

  return !audioTrack.enabled;
}

/**
 * 检查摄像头状态
 * @param stream - 媒体流
 * @returns 是否关闭
 */
export function isCameraOff(stream: MediaStream | null): boolean {
  if (!stream) return false;

  const videoTrack = stream.getVideoTracks()[0];
  if (!videoTrack) return false;

  return !videoTrack.enabled;
}

// ============================================================================
// 设备枚举
// ============================================================================

/**
 * 获取可用的媒体设备列表
 * @returns 设备列表
 */
export async function getMediaDevices(): Promise<MediaDeviceInfo[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices;
  } catch (error) {
    console.error('[MediaStream] Failed to enumerate devices:', error);
    return [];
  }
}

/**
 * 获取可用的摄像头列表
 * @returns 摄像头列表
 */
export async function getCameras(): Promise<MediaDeviceInfo[]> {
  const devices = await getMediaDevices();
  return devices.filter((device) => device.kind === 'videoinput');
}

/**
 * 获取可用的麦克风列表
 * @returns 麦克风列表
 */
export async function getMicrophones(): Promise<MediaDeviceInfo[]> {
  const devices = await getMediaDevices();
  return devices.filter((device) => device.kind === 'audioinput');
}

// ============================================================================
// 权限检查
// ============================================================================

/**
 * 检查媒体设备权限
 * @returns 权限状态
 */
export async function checkMediaPermissions(): Promise<{
  camera: PermissionState;
  microphone: PermissionState;
}> {
  try {
    const [cameraPermission, microphonePermission] = await Promise.all([
      navigator.permissions.query({ name: 'camera' as PermissionName }),
      navigator.permissions.query({ name: 'microphone' as PermissionName }),
    ]);

    return {
      camera: cameraPermission.state,
      microphone: microphonePermission.state,
    };
  } catch (error) {
    console.error('[MediaStream] Failed to check permissions:', error);
    return {
      camera: 'prompt',
      microphone: 'prompt',
    };
  }
}

// ============================================================================
// 截图功能
// ============================================================================

/**
 * 从视频流截图
 * @param videoElement - 视频元素
 * @param format - 图片格式
 * @returns 截图数据 URL
 */
export function captureScreenshot(
  videoElement: HTMLVideoElement,
  format: 'image/png' | 'image/jpeg' = 'image/png'
): string {
  const canvas = document.createElement('canvas');
  canvas.width = videoElement.videoWidth;
  canvas.height = videoElement.videoHeight;
  
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }
  
  ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
  
  return canvas.toDataURL(format);
}
