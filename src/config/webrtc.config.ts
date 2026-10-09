/**
 * WebRTC 配置文件
 * 包含 STUN/TURN 服务器配置、超时时间、事件名称等
 */

import { CameraFacingMode } from '@/types/webrtc';
import { userChannel } from '@/lib/im/channels';
import { CALL_SIGNAL_EVENTS } from '@/lib/im/call-signal';

// ============================================================================
// STUN/TURN 服务器配置
// ============================================================================

/**
 * 默认 STUN（Google 公共）。可用 `NEXT_PUBLIC_STUN_URLS`（逗号分隔）覆盖。
 *
 * ⚠️ 该函数是**同步静态兜底**。真正下发的 ICE 配置走 `GET /api/rtc/ice-servers`
 *    （服务端签发，含 TURN 短时凭据）；见 `src/lib/rtc/ice-servers-client.ts`。
 */
export function getStunUrls(): string[] {
  const override = process.env.NEXT_PUBLIC_STUN_URLS;
  if (override) {
    const list = override
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length > 0) return list;
  }
  return ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'];
}

/**
 * 默认 TURN 端点。可用 `NEXT_PUBLIC_TURN_URLS`（逗号分隔）覆盖，
 * 便于在不改代码的前提下换用自建 TURN。
 */
function getTurnUrls(): string[] {
  const override = process.env.NEXT_PUBLIC_TURN_URLS;
  if (override) {
    const list = override
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length > 0) return list;
  }
  return [
    'turn:turn.metered.ca:80',
    'turn:turn.metered.ca:443',
    'turns:turn.metered.ca:443',
  ];
}

/**
 * 获取 ICE 服务器配置（**静态兜底**，仅 STUN + 可选的 NEXT_PUBLIC_TURN_*）。
 *
 * ## 2026-10-09 起的实际链路
 *
 * 生产不再依赖这个同步函数拿 TURN：
 *   · 优先 `GET /api/rtc/ice-servers`（服务端签发，TURN 凭据不进前端 bundle）
 *   · 该端点不可达/未登录时，才退回本函数（STUN-only，保证不失败）
 *
 * `NEXT_PUBLIC_TURN_*` 三个变量保留仅为兼容自建 TURN 的临时开关；**不建议**在生产使用
 * ——`NEXT_PUBLIC_*` 会被内联进 bundle，长期凭据等于公开。
 */
export function getIceServers(): RTCIceServer[] {
  const useTurn = process.env.NEXT_PUBLIC_USE_TURN === 'true';
  const turnUsername = process.env.NEXT_PUBLIC_TURN_USERNAME || '';
  const turnCredential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL || '';

  const iceServers: RTCIceServer[] = getStunUrls().map((urls) => ({ urls }));

  // 只有三项都齐备时才追加 TURN —— 缺凭据的 TURN 条目会让 ICE 收集白等一轮。
  if (useTurn && turnUsername && turnCredential) {
    iceServers.push({
      urls: getTurnUrls(),
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
  VIDEO_CALL_OFFER: CALL_SIGNAL_EVENTS.OFFER,
  VIDEO_CALL_ANSWER: CALL_SIGNAL_EVENTS.ANSWER,
  VIDEO_CALL_DECLINE: CALL_SIGNAL_EVENTS.DECLINE,
  ICE_CANDIDATE: CALL_SIGNAL_EVENTS.ICE_CANDIDATE,
  VIDEO_CALL_HANGUP: CALL_SIGNAL_EVENTS.HANGUP,
  VIDEO_CALL_TIMEOUT: CALL_SIGNAL_EVENTS.TIMEOUT,
} as const;

// ============================================================================
// 频道命名
// ============================================================================

/**
 * ⚠️ 必须与 Pusher **鉴权白名单**一致，否则订阅会拿到 403。
 *
 * 历史缺陷：这里曾是 `'private-user'`，而鉴权端点只放行
 * `private-im-` 前缀 —— 只差 3 个字符，静态审查极难发现，
 * 线上表现为视频通话信令频道订阅被拒、通话完全不可用。
 *
 * 现在统一从 `lib/im/channels.ts` 取名；该常量保留仅为兼容既有引用，
 * 取的是完整频道名前缀（含 `-user` 段）。
 */
export const CHANNEL_PREFIX = 'private-im-user';

/** 用户个人频道，与 IM 侧 `lib/im/channels.ts` 的 `userChannel` 同源。 */
export function getUserChannel(userId: string): string {
  return userChannel(userId);
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
