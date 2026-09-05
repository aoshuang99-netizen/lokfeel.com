/**
 * WebRTC 类型定义测试
 * 验证所有 TypeScript 类型定义是否正确
 */

import {
  CallState,
  HangupReason,
  MediaDeviceType,
  CameraFacingMode,
  VideoCallOffer,
  VideoCallAnswer,
  VideoCallDecline,
  ICECandidateMessage,
  VideoCallHangup,
  VideoCallTimeout,
  LocalMediaConfig,
  VideoCallState,
  VideoCallActions,
  VideoCallStore,
  UseWebRTCResult,
  UsePusherSignalingResult,
  UseMediaDevicesResult,
  VideoCallModalProps,
  IncomingCallModalProps,
  CallControlsProps,
  VideoPlayerProps,
  CallHistory,
} from '@/types/webrtc';

// ============================================================================
// 枚举类型测试
// ============================================================================

describe('CallState 枚举', () => {
  it('应该包含所有预期的状态值', () => {
    expect(CallState.IDLE).toBe('idle');
    expect(CallState.CALLING).toBe('calling');
    expect(CallState.RINGING).toBe('ringing');
    expect(CallState.CONNECTING).toBe('connecting');
    expect(CallState.CONNECTED).toBe('connected');
    expect(CallState.ENDED).toBe('ended');
    expect(CallState.FAILED).toBe('failed');
  });

  it('应该有 7 个状态值', () => {
    const states = Object.values(CallState);
    expect(states).toHaveLength(7);
  });
});

describe('HangupReason 枚举', () => {
  it('应该包含所有预期的挂断原因', () => {
    expect(HangupReason.USER_INITIATED).toBe('user_initiated');
    expect(HangupReason.REMOTE_HANGUP).toBe('remote_hangup');
    expect(HangupReason.REJECTED).toBe('rejected');
    expect(HangupReason.TIMEOUT).toBe('timeout');
    expect(HangupReason.NETWORK_ERROR).toBe('network_error');
    expect(HangupReason.ICE_CONNECTION_FAILED).toBe('ice_failed');
  });
});

describe('MediaDeviceType 枚举', () => {
  it('应该包含所有预期的媒体设备类型', () => {
    expect(MediaDeviceType.CAMERA).toBe('camera');
    expect(MediaDeviceType.MICROPHONE).toBe('microphone');
    expect(MediaDeviceType.SPEAKER).toBe('speaker');
  });
});

describe('CameraFacingMode 枚举', () => {
  it('应该包含前置和后置摄像头', () => {
    expect(CameraFacingMode.USER).toBe('user');
    expect(CameraFacingMode.ENVIRONMENT).toBe('environment');
  });
});

// ============================================================================
// 接口类型测试
// ============================================================================

describe('VideoCallOffer 接口', () => {
  it('应该能正确创建 Offer 对象', () => {
    const offer: VideoCallOffer = {
      callId: 'call_12345',
      callerId: 'user1',
      calleeId: 'user2',
      offer: { type: 'offer', sdp: 'mock-sdp' } as RTCSessionDescriptionInit,
      timestamp: Date.now(),
    };

    expect(offer.callId).toBe('call_12345');
    expect(offer.callerId).toBe('user1');
    expect(offer.calleeId).toBe('user2');
    expect(offer.offer.type).toBe('offer');
    expect(typeof offer.timestamp).toBe('number');
  });
});

describe('VideoCallAnswer 接口', () => {
  it('应该能正确创建 Answer 对象', () => {
    const answer: VideoCallAnswer = {
      callId: 'call_12345',
      callerId: 'user1',
      calleeId: 'user2',
      answer: { type: 'answer', sdp: 'mock-sdp' } as RTCSessionDescriptionInit,
    };

    expect(answer.callId).toBe('call_12345');
    expect(answer.answer.type).toBe('answer');
  });
});

describe('VideoCallDecline 接口', () => {
  it('应该能正确创建 Decline 对象', () => {
    const decline: VideoCallDecline = {
      callId: 'call_12345',
      callerId: 'user1',
      calleeId: 'user2',
      reason: 'busy',
    };

    expect(decline.reason).toBe('busy');
  });

  it('应该支持所有拒绝原因', () => {
    const reasons: VideoCallDecline['reason'][] = ['busy', 'declined', 'no_answer'];
    
    reasons.forEach((reason) => {
      const decline: VideoCallDecline = {
        callId: 'call_12345',
        callerId: 'user1',
        calleeId: 'user2',
        reason,
      };
      expect(decline.reason).toBe(reason);
    });
  });
});

describe('ICECandidateMessage 接口', () => {
  it('应该能正确创建 ICE 候选消息', () => {
    const message: ICECandidateMessage = {
      callId: 'call_12345',
      callerId: 'user1',
      calleeId: 'user2',
      candidate: { candidate: 'mock-candidate' } as RTCIceCandidateInit,
    };

    expect(message.callId).toBe('call_12345');
    expect(message.candidate.candidate).toBe('mock-candidate');
  });
});

describe('VideoCallHangup 接口', () => {
  it('应该能正确创建挂断消息', () => {
    const hangup: VideoCallHangup = {
      callId: 'call_12345',
      callerId: 'user1',
      calleeId: 'user2',
      reason: HangupReason.USER_INITIATED,
      duration: 120,
      timestamp: Date.now(),
    };

    expect(hangup.reason).toBe(HangupReason.USER_INITIATED);
    expect(hangup.duration).toBe(120);
  });
});

describe('VideoCallTimeout 接口', () => {
  it('应该能正确创建超时消息', () => {
    const timeout: VideoCallTimeout = {
      callId: 'call_12345',
      callerId: 'user1',
      calleeId: 'user2',
    };

    expect(timeout.callId).toBe('call_12345');
  });
});

describe('LocalMediaConfig 接口', () => {
  it('应该支持布尔值和约束对象', () => {
    const config1: LocalMediaConfig = {
      video: true,
      audio: true,
    };

    const config2: LocalMediaConfig = {
      video: { width: 1280, height: 720 },
      audio: { echoCancellation: true },
    };

    expect(config1.video).toBe(true);
    expect((config2.video as MediaTrackConstraints).width).toBe(1280);
  });
});

// ============================================================================
// 组件 Props 接口测试
// ============================================================================

describe('VideoCallModalProps 接口', () => {
  it('应该能正确创建 Props 对象', () => {
    const props: VideoCallModalProps = {
      open: true,
      onClose: () => {},
    };

    expect(props.open).toBe(true);
    expect(typeof props.onClose).toBe('function');
  });
});

describe('IncomingCallModalProps 接口', () => {
  it('应该能正确创建 Props 对象', () => {
    const props: IncomingCallModalProps = {
      open: true,
      callerName: 'John Doe',
      callerAvatar: 'https://example.com/avatar.jpg',
      onAccept: () => {},
      onDecline: (reason) => {},
    };

    expect(props.callerName).toBe('John Doe');
    expect(props.callerAvatar).toBe('https://example.com/avatar.jpg');
    expect(typeof props.onAccept).toBe('function');
  });
});

describe('CallControlsProps 接口', () => {
  it('应该能正确创建 Props 对象', () => {
    const props: CallControlsProps = {
      isMicrophoneMuted: false,
      isCameraOff: false,
      isScreenSharing: false,
      onToggleMicrophone: () => {},
      onToggleCamera: () => {},
      onHangup: () => {},
      onScreenShare: () => {},
      onSwitchCamera: () => {},
    };

    expect(props.isMicrophoneMuted).toBe(false);
    expect(props.isScreenSharing).toBe(false);
  });
});

describe('VideoPlayerProps 接口', () => {
  it('应该能正确创建 Props 对象', () => {
    const mockStream = {} as MediaStream;
    const props: VideoPlayerProps = {
      stream: mockStream,
      muted: true,
      autoPlay: true,
      className: 'video-player',
    };

    expect(props.stream).toBe(mockStream);
    expect(props.muted).toBe(true);
  });

  it('应该支持可选的 stream（可以为 null）', () => {
    const props: VideoPlayerProps = {
      stream: null,
    };

    expect(props.stream).toBeNull();
  });
});

describe('CallHistory 接口', () => {
  it('应该能正确创建通话记录对象', () => {
    const history: CallHistory = {
      callId: 'call_12345',
      callerId: 'user1',
      calleeId: 'user2',
      duration: 120,
      startTime: Date.now() - 120000,
      endTime: Date.now(),
      status: 'completed',
    };

    expect(history.duration).toBe(120);
    expect(history.status).toBe('completed');
  });

  it('应该支持所有状态值', () => {
    const statuses: CallHistory['status'][] = ['completed', 'missed', 'declined'];
    
    statuses.forEach((status) => {
      const history: CallHistory = {
        callId: 'call_12345',
        callerId: 'user1',
        calleeId: 'user2',
        duration: 0,
        startTime: Date.now(),
        endTime: Date.now(),
        status,
      };
      expect(history.status).toBe(status);
    });
  });
});

// ============================================================================
// 类型兼容性测试
// ============================================================================

describe('类型兼容性', () => {
  it('VideoCallState 和 VideoCallActions 应该能组合成 VideoCallStore', () => {
    // 这个测试主要是编译时检查，确保类型可以正确组合
    const mockStore: VideoCallStore = {
      // VideoCallState
      callState: CallState.IDLE,
      callId: null,
      callerId: null,
      calleeId: null,
      localStream: null,
      remoteStream: null,
      isMicrophoneMuted: false,
      isCameraOff: false,
      cameraFacingMode: CameraFacingMode.USER,
      callDuration: 0,
      callStartTime: null,
      networkQuality: 'unknown',
      error: null,
      isScreenSharing: false,
      
      // VideoCallActions
      initiateCall: async () => {},
      acceptCall: async () => {},
      declineCall: () => {},
      hangupCall: () => {},
      toggleMicrophone: () => {},
      toggleCamera: () => {},
      switchCamera: () => {},
      startScreenShare: async () => {},
      stopScreenShare: () => {},
      resetCallState: () => {},
      _setLocalStream: () => {},
      _setRemoteStream: () => {},
      _updateCallState: () => {},
      _setError: () => {},
    };

    expect(mockStore.callState).toBe(CallState.IDLE);
    expect(typeof mockStore.initiateCall).toBe('function');
  });
});
