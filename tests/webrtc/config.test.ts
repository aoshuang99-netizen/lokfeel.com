/**
 * WebRTC 配置文件测试
 * 验证 STUN/TURN 服务器配置、超时配置、事件名称等
 */

import {
  getIceServers,
  VIDEO_CALL_CONFIG,
  PUSHER_EVENTS,
  CHANNEL_PREFIX,
  getUserChannel,
  DEFAULT_MEDIA_CONSTRAINTS,
  CAMERA_CONSTRAINTS,
  NETWORK_QUALITY_THRESHOLDS,
} from '@/config/webrtc.config';
import { CameraFacingMode } from '@/types/webrtc';

// ============================================================================
// getIceServers 函数测试
// ============================================================================

describe('getIceServers', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // 清除环境变量
    process.env = { ...originalEnv };
    delete process.env.NEXT_PUBLIC_USE_TURN;
    delete process.env.NEXT_PUBLIC_TURN_USERNAME;
    delete process.env.NEXT_PUBLIC_TURN_CREDENTIAL;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('应该返回默认的 STUN 服务器配置', () => {
    const iceServers = getIceServers();

    expect(iceServers).toBeInstanceOf(Array);
    expect(iceServers.length).toBeGreaterThanOrEqual(2);
    
    // 检查是否包含 Google 公共 STUN 服务器
    const hasStun1 = iceServers.some(
      (server) => server.urls === 'stun:stun.l.google.com:19302'
    );
    const hasStun2 = iceServers.some(
      (server) => server.urls === 'stun:stun1.l.google.com:19302'
    );

    expect(hasStun1 || hasStun2).toBe(true);
  });

  it('应该在启用 TURN 时添加 TURN 服务器', () => {
    process.env.NEXT_PUBLIC_USE_TURN = 'true';
    process.env.NEXT_PUBLIC_TURN_USERNAME = 'test-user';
    process.env.NEXT_PUBLIC_TURN_CREDENTIAL = 'test-credential';

    const iceServers = getIceServers();

    // 检查是否包含 TURN 服务器
    const hasTurn = iceServers.some((server) => {
      if (Array.isArray(server.urls)) {
        return server.urls.some((url) => url.includes('turn.metered.ca'));
      }
      return false;
    });

    expect(hasTurn).toBe(true);
  });

  it('应该在未配置 TURN 凭据时不添加 TURN 服务器', () => {
    process.env.NEXT_PUBLIC_USE_TURN = 'true';
    // 不设置用户名和密码

    const iceServers = getIceServers();

    // 应该只有 STUN 服务器
    const hasTurn = iceServers.some((server) => {
      if (Array.isArray(server.urls)) {
        return server.urls.some((url) => url.includes('turn'));
      }
      return typeof server.urls === 'string' && server.urls.includes('turn');
    });

    expect(hasTurn).toBe(false);
  });

  it('应该为每个 TURN URL 创建配置对象', () => {
    process.env.NEXT_PUBLIC_USE_TURN = 'true';
    process.env.NEXT_PUBLIC_TURN_USERNAME = 'test-user';
    process.env.NEXT_PUBLIC_TURN_CREDENTIAL = 'test-credential';

    const iceServers = getIceServers();

    // 查找 TURN 配置
    const turnConfig = iceServers.find((server) => {
      return server.urls && server.username && server.credential;
    });

    expect(turnConfig).toBeDefined();
    expect(turnConfig?.username).toBe('test-user');
    expect(turnConfig?.credential).toBe('test-credential');
  });
});

// ============================================================================
// VIDEO_CALL_CONFIG 常量测试
// ============================================================================

describe('VIDEO_CALL_CONFIG', () => {
  it('应该包含邀请超时配置（30 秒）', () => {
    expect(VIDEO_CALL_CONFIG.INVITATION_TIMEOUT).toBe(30000);
  });

  it('应该包含 ICE 候选收集超时配置（10 秒）', () => {
    expect(VIDEO_CALL_CONFIG.ICE_GATHERING_TIMEOUT).toBe(10000);
  });

  it('应该包含最大通话时长配置（0 表示无限制）', () => {
    expect(VIDEO_CALL_CONFIG.MAX_CALL_DURATION).toBe(0);
  });

  it('应该包含网络质量检测间隔配置（5 秒）', () => {
    expect(VIDEO_CALL_CONFIG.NETWORK_QUALITY_INTERVAL).toBe(5000);
  });

  it('应该包含 TURN 服务器配额警告阈值（900MB）', () => {
    expect(VIDEO_CALL_CONFIG.TURN_QUOTA_WARNING).toBe(900 * 1024 * 1024);
  });

  it('应该包含最大重连尝试次数', () => {
    expect(VIDEO_CALL_CONFIG.MAX_RECONNECT_ATTEMPTS).toBe(3);
  });

  it('应该包含重连延迟配置', () => {
    expect(VIDEO_CALL_CONFIG.RECONNECT_DELAY).toBe(2000);
  });

  it('应该是只读的（as const）', () => {
    // 由于使用了 as const，所有属性都应该是只读的
    // TypeScript 编译时会检查，这里主要确保配置存在
    expect(VIDEO_CALL_CONFIG).toBeDefined();
  });
});

// ============================================================================
// PUSHER_EVENTS 常量测试
// ============================================================================

describe('PUSHER_EVENTS', () => {
  it('应该包含所有必需的事件名称', () => {
    expect(PUSHER_EVENTS.VIDEO_CALL_OFFER).toBeDefined();
    expect(PUSHER_EVENTS.VIDEO_CALL_ANSWER).toBeDefined();
    expect(PUSHER_EVENTS.VIDEO_CALL_DECLINE).toBeDefined();
    expect(PUSHER_EVENTS.ICE_CANDIDATE).toBeDefined();
    expect(PUSHER_EVENTS.VIDEO_CALL_HANGUP).toBeDefined();
    expect(PUSHER_EVENTS.VIDEO_CALL_TIMEOUT).toBeDefined();
  });

  it('所有事件名称应该以 client- 开头', () => {
    Object.values(PUSHER_EVENTS).forEach((eventName) => {
      expect(eventName).toMatch(/^client-/);
    });
  });

  it('应该有以下具体的事件名称', () => {
    expect(PUSHER_EVENTS.VIDEO_CALL_OFFER).toBe('client-video-call-offer');
    expect(PUSHER_EVENTS.VIDEO_CALL_ANSWER).toBe('client-video-call-answer');
    expect(PUSHER_EVENTS.VIDEO_CALL_DECLINE).toBe('client-video-call-decline');
    expect(PUSHER_EVENTS.ICE_CANDIDATE).toBe('client-ice-candidate');
    expect(PUSHER_EVENTS.VIDEO_CALL_HANGUP).toBe('client-video-call-hangup');
    expect(PUSHER_EVENTS.VIDEO_CALL_TIMEOUT).toBe('client-video-call-timeout');
  });
});

// ============================================================================
// CHANNEL_PREFIX 和 getUserChannel 测试
// ============================================================================

describe('getUserChannel', () => {
  it('应该为给定的用户 ID 返回正确的频道名称', () => {
    const userId = 'user123';
    const channelName = getUserChannel(userId);

    expect(channelName).toBe('private-user-user123');
  });

  it('应该正确处理空字符串', () => {
    const channelName = getUserChannel('');

    expect(channelName).toBe('private-user-');
  });

  it('应该正确处理包含特殊字符的用户 ID', () => {
    const userId = 'user-123@example.com';
    const channelName = getUserChannel(userId);

    expect(channelName).toBe(`private-user-${userId}`);
  });
});

describe('CHANNEL_PREFIX', () => {
  it('应该是 private-user', () => {
    expect(CHANNEL_PREFIX).toBe('private-user');
  });
});

// ============================================================================
// DEFAULT_MEDIA_CONSTRAINTS 测试
// ============================================================================

describe('DEFAULT_MEDIA_CONSTRAINTS', () => {
  it('应该包含视频约束', () => {
    expect(DEFAULT_MEDIA_CONSTRAINTS.video).toBeDefined();
    
    const videoConstraints = DEFAULT_MEDIA_CONSTRAINTS.video as MediaTrackConstraints;
    expect(videoConstraints.width).toBeDefined();
    expect(videoConstraints.height).toBeDefined();
    expect(videoConstraints.frameRate).toBeDefined();
  });

  it('应该包含音频约束', () => {
    expect(DEFAULT_MEDIA_CONSTRAINTS.audio).toBeDefined();
    
    const audioConstraints = DEFAULT_MEDIA_CONSTRAINTS.audio as MediaTrackConstraints;
    expect(audioConstraints.echoCancellation).toBe(true);
    expect(audioConstraints.noiseSuppression).toBe(true);
    expect(audioConstraints.autoGainControl).toBe(true);
  });

  it('视频约束应该有理想的分辨率和帧率', () => {
    const videoConstraints = DEFAULT_MEDIA_CONSTRAINTS.video as MediaTrackConstraints;
    
    expect((videoConstraints.width as ConstrainULongRange).ideal).toBe(1280);
    expect((videoConstraints.height as ConstrainULongRange).ideal).toBe(720);
    expect((videoConstraints.frameRate as ConstrainDoubleRange).ideal).toBe(30);
  });
});

// ============================================================================
// CAMERA_CONSTRAINTS 测试
// ============================================================================

describe('CAMERA_CONSTRAINTS', () => {
  it('应该包含前置摄像头配置', () => {
    const userConfig = CAMERA_CONSTRAINTS[CameraFacingMode.USER];
    
    expect(userConfig.facingMode).toBe('user');
  });

  it('应该包含后置摄像头配置', () => {
    const environmentConfig = CAMERA_CONSTRAINTS[CameraFacingMode.ENVIRONMENT];
    
    expect(environmentConfig.facingMode).toBe('environment');
  });

  it('应该为所有 CameraFacingMode 提供配置', () => {
    const modes = Object.values(CameraFacingMode);
    
    modes.forEach((mode) => {
      expect(CAMERA_CONSTRAINTS[mode]).toBeDefined();
      expect(CAMERA_CONSTRAINTS[mode].facingMode).toBeDefined();
    });
  });
});

// ============================================================================
// NETWORK_QUALITY_THRESHOLDS 测试
// ============================================================================

describe('NETWORK_QUALITY_THRESHOLDS', () => {
  it('应该包含 GOOD 阈值', () => {
    expect(NETWORK_QUALITY_THRESHOLDS.GOOD).toBeDefined();
    expect(NETWORK_QUALITY_THRESHOLDS.GOOD.packetLoss).toBe(0.01);
    expect(NETWORK_QUALITY_THRESHOLDS.GOOD.rtt).toBe(100);
  });

  it('应该包含 MEDIUM 阈值', () => {
    expect(NETWORK_QUALITY_THRESHOLDS.MEDIUM).toBeDefined();
    expect(NETWORK_QUALITY_THRESHOLDS.MEDIUM.packetLoss).toBe(0.05);
    expect(NETWORK_QUALITY_THRESHOLDS.MEDIUM.rtt).toBe(300);
  });

  it('MEDIUM 阈值应该比 GOOD 更宽松', () => {
    expect(NETWORK_QUALITY_THRESHOLDS.MEDIUM.packetLoss).toBeGreaterThan(
      NETWORK_QUALITY_THRESHOLDS.GOOD.packetLoss
    );
    expect(NETWORK_QUALITY_THRESHOLDS.MEDIUM.rtt).toBeGreaterThan(
      NETWORK_QUALITY_THRESHOLDS.GOOD.rtt
    );
  });
});
