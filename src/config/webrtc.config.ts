/**
 * WebRTC 配置文件
 * 包含 STUN/TURN 服务器配置、超时时间、事件名称等
 */

import { CameraFacingMode } from '@/types/webrtc';

// ============================================================================
// STUN/TURN 服务器配置
// ============================================================================

/**
 * 获取 ICE 服务器配置
 * 优先使用环境变量中的 TURN 服务器配置，否则使用默认值
 */
export function getIceServers(): RTCIceServer[] {
  const useTurn = process.env.NEXT_PUBLIC_USE_TURN === 'true';
  const turnUsername = process.env.NEXT_PUBLIC_TURN_USERNAME || '';
  const turnCredential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL || '';

  const iceServers: RTCIceServer[] = [
    // Google 公共 STUN 服务器
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  // 如果配置了 TURN 服务器，添加到列表
  if (useTurn && turnUsername && turnCredential) {
    iceServers.push({
      urls: [
        'turn:turn.metered.ca:80',
        'turn:turn.metered.ca:443',
        'turns:turn.metered.ca:443',
      ],
      username: turnUsername,
      credential: turnCredential,
    });
  }

  return iceServers;
}

// ============================================================================
// 超时配置
// ============================================================================

export const VIDEO_CALL_CONFIG = {
  // 邀请超时时间（毫秒）
  INVITATION_TIMEOUT: 30_000,  // 30 秒
  
  // ICE 候选收集超时（毫秒）
  ICE_GATHERING_TIMEOUT: 10_000,  // 10 秒
  
  // 通话最大时长（毫秒，0 表示无限制）
  MAX_CALL_DURATION: 0,  // 无限制（如果设置付费墙，可改为 5 * 60 * 1000 = 5 分钟）
  
  // 网络质量检测间隔（毫秒）
  NETWORK_QUALITY_INTERVAL: 5_000,  // 每 5 秒检测一次
  
  // TURN 服务器配额警告阈值（字节）
  TURN_QUOTA_WARNING: 900 * 1024 * 1024,  // 900MB（接近 1GB 免费额度时警告）
  
  // 重新连接尝试次数
  MAX_RECONNECT_ATTEMPTS: 3,
  
  // 重新连接延迟（毫秒）
  RECONNECT_DELAY: 2_000,
} as const;

// ============================================================================
// Pusher 事件名称
// ============================================================================

export const PUSHER_EVENTS = {
  VIDEO_CALL_OFFER: 'client-video-call-offer',
  VIDEO_CALL_ANSWER: 'client-video-call-answer',
  VIDEO_CALL_DECLINE: 'client-video-call-decline',
  ICE_CANDIDATE: 'client-ice-candidate',
  VIDEO_CALL_HANGUP: 'client-video-call-hangup',
  VIDEO_CALL_TIMEOUT: 'client-video-call-timeout',
} as const;

// ============================================================================
// 频道命名
// ============================================================================

export const CHANNEL_PREFIX = 'private-user';

export function getUserChannel(userId: string): string {
  return `${CHANNEL_PREFIX}-${userId}`;
}

// ============================================================================
// 媒体约束配置
// ============================================================================

export const DEFAULT_MEDIA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 },
  },
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
};

export const CAMERA_CONSTRAINTS: Record<CameraFacingMode, MediaTrackConstraints> = {
  [CameraFacingMode.USER]: { facingMode: 'user' },
  [CameraFacingMode.ENVIRONMENT]: { facingMode: 'environment' },
};

// ============================================================================
// 网络质量阈值
// ============================================================================

export const NETWORK_QUALITY_THRESHOLDS = {
  GOOD: {
    packetLoss: 0.01,      // 1% 丢包率
    rtt: 100,               // 100ms RTT
  },
  MEDIUM: {
    packetLoss: 0.05,      // 5% 丢包率
    rtt: 300,               // 300ms RTT
  },
} as const;
