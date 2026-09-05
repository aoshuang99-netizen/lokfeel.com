/**
 * VideoCall Store 测试
 * 测试 Zustand store 的状态管理和 actions
 * 
 * 注意：这个测试直接测试 Zustand store，不模拟 zustand 本身
 */

import { useVideoCallStore } from '@/store/videoCallStore';
import {
  CallState,
  HangupReason,
  CameraFacingMode,
} from '@/types/webrtc';

// ============================================================================
// 初始状态测试
// ============================================================================

describe('VideoCall Store - 初始状态', () => {
  beforeEach(() => {
    // 重置 store 到初始状态
    useVideoCallStore.getState().resetCallState();
  });

  it('callState 应该是 IDLE', () => {
    const state = useVideoCallStore.getState();
    expect(state.callState).toBe(CallState.IDLE);
  });

  it('callId 应该是 null', () => {
    const state = useVideoCallStore.getState();
    expect(state.callId).toBeNull();
  });

  it('localStream 应该是 null', () => {
    const state = useVideoCallStore.getState();
    expect(state.localStream).toBeNull();
  });

  it('remoteStream 应该是 null', () => {
    const state = useVideoCallStore.getState();
    expect(state.remoteStream).toBeNull();
  });

  it('isMicrophoneMuted 应该是 false', () => {
    const state = useVideoCallStore.getState();
    expect(state.isMicrophoneMuted).toBe(false);
  });

  it('isCameraOff 应该是 false', () => {
    const state = useVideoCallStore.getState();
    expect(state.isCameraOff).toBe(false);
  });

  it('cameraFacingMode 应该是 USER', () => {
    const state = useVideoCallStore.getState();
    expect(state.cameraFacingMode).toBe(CameraFacingMode.USER);
  });

  it('callDuration 应该是 0', () => {
    const state = useVideoCallStore.getState();
    expect(state.callDuration).toBe(0);
  });

  it('error 应该是 null', () => {
    const state = useVideoCallStore.getState();
    expect(state.error).toBeNull();
  });

  it('isScreenSharing 应该是 false', () => {
    const state = useVideoCallStore.getState();
    expect(state.isScreenSharing).toBe(false);
  });
});

// ============================================================================
// initiateCall Action 测试
// ============================================================================

describe('VideoCall Store - initiateCall', () => {
  beforeEach(() => {
    useVideoCallStore.getState().resetCallState();
  });

  it('应该更新 callState 为 CALLING', () => {
    const store = useVideoCallStore.getState();
    store.initiateCall('user2');

    const newState = useVideoCallStore.getState();
    expect(newState.callState).toBe(CallState.CALLING);
  });

  it('应该设置 calleeId', () => {
    const store = useVideoCallStore.getState();
    store.initiateCall('user2');

    const newState = useVideoCallStore.getState();
    expect(newState.calleeId).toBe('user2');
  });

  it('应该生成 callId', () => {
    const store = useVideoCallStore.getState();
    store.initiateCall('user2');

    const newState = useVideoCallStore.getState();
    expect(newState.callId).toBeDefined();
    expect(newState.callId).toMatch(/^call_/);
  });

  it('应该清除之前的错误', () => {
    // 先设置一个错误
    useVideoCallStore.setState({ error: 'Previous error' });

    const store = useVideoCallStore.getState();
    store.initiateCall('user2');

    const newState = useVideoCallStore.getState();
    expect(newState.error).toBeNull();
  });
});

// ============================================================================
// acceptCall Action 测试
// ============================================================================

describe('VideoCall Store - acceptCall', () => {
  beforeEach(() => {
    useVideoCallStore.getState().resetCallState();
  });

  it('应该更新 callState 为 CONNECTING', () => {
    const store = useVideoCallStore.getState();
    store.acceptCall();

    const newState = useVideoCallStore.getState();
    expect(newState.callState).toBe(CallState.CONNECTING);
  });

  it('应该清除错误', () => {
    useVideoCallStore.setState({ error: 'Previous error' });

    const store = useVideoCallStore.getState();
    store.acceptCall();

    const newState = useVideoCallStore.getState();
    expect(newState.error).toBeNull();
  });
});

// ============================================================================
// declineCall Action 测试
// ============================================================================

describe('VideoCall Store - declineCall', () => {
  beforeEach(() => {
    useVideoCallStore.getState().resetCallState();
  });

  it('应该更新 callState 为 ENDED', (done) => {
    // 先设置一个状态
    useVideoCallStore.setState({
      callState: CallState.RINGING,
    });

    const store = useVideoCallStore.getState();
    store.declineCall('busy');

    // declineCall 会设置 callState 为 ENDED
    const newState = useVideoCallStore.getState();
    expect(newState.callState).toBe(CallState.ENDED);
    
    done();
  });

  it('应该在 1 秒后重置状态', (done) => {
    useVideoCallStore.setState({
      callState: CallState.RINGING,
    });

    const store = useVideoCallStore.getState();
    store.declineCall('declined');

    // 等待 1.1 秒
    setTimeout(() => {
      const newState = useVideoCallStore.getState();
      expect(newState.callState).toBe(CallState.IDLE);
      done();
    }, 1100);
  }, 2000);
});

// ============================================================================
// hangupCall Action 测试
// ============================================================================

describe('VideoCall Store - hangupCall', () => {
  beforeEach(() => {
    useVideoCallStore.getState().resetCallState();
  });

  it('应该更新 callState 为 ENDED', () => {
    const store = useVideoCallStore.getState();
    store.hangupCall();

    const newState = useVideoCallStore.getState();
    expect(newState.callState).toBe(CallState.ENDED);
  });

  it('应该使用默认的挂断原因 USER_INITIATED', () => {
    // 这个测试主要是确保不会抛出错误
    const store = useVideoCallStore.getState();
    
    expect(() => {
      store.hangupCall();
    }).not.toThrow();
  });

  it('应该接受自定义的挂断原因', () => {
    const store = useVideoCallStore.getState();
    
    expect(() => {
      store.hangupCall(HangupReason.TIMEOUT);
    }).not.toThrow();
  });

  it('应该在 1 秒后重置状态', (done) => {
    const store = useVideoCallStore.getState();
    store.hangupCall();

    setTimeout(() => {
      const newState = useVideoCallStore.getState();
      expect(newState.callState).toBe(CallState.IDLE);
      done();
    }, 1100);
  }, 2000);
});

// ============================================================================
// toggleMicrophone Action 测试
// ============================================================================

describe('VideoCall Store - toggleMicrophone', () => {
  beforeEach(() => {
    useVideoCallStore.getState().resetCallState();
  });

  it('应该在有本地流时切换状态', () => {
    // 模拟本地流
    const mockStream = {
      getAudioTracks: () => [{ enabled: true }],
    } as MediaStream;

    useVideoCallStore.setState({ localStream: mockStream });

    const store = useVideoCallStore.getState();
    store.toggleMicrophone();

    const newState = useVideoCallStore.getState();
    expect(newState.isMicrophoneMuted).toBe(true);
  });

  it('应该在没有本地流时不执行操作', () => {
    const store = useVideoCallStore.getState();
    store.toggleMicrophone();

    const newState = useVideoCallStore.getState();
    expect(newState.isMicrophoneMuted).toBe(false);
  });
});

// ============================================================================
// toggleCamera Action 测试
// ============================================================================

describe('VideoCall Store - toggleCamera', () => {
  beforeEach(() => {
    useVideoCallStore.getState().resetCallState();
  });

  it('应该在有本地流时切换状态', () => {
    const mockStream = {
      getVideoTracks: () => [{ enabled: true }],
    } as MediaStream;

    useVideoCallStore.setState({ localStream: mockStream });

    const store = useVideoCallStore.getState();
    store.toggleCamera();

    const newState = useVideoCallStore.getState();
    expect(newState.isCameraOff).toBe(true);
  });
});

// ============================================================================
// switchCamera Action 测试
// ============================================================================

describe('VideoCall Store - switchCamera', () => {
  beforeEach(() => {
    useVideoCallStore.getState().resetCallState();
  });

  it('应该从 USER 切换到 ENVIRONMENT', () => {
    const store = useVideoCallStore.getState();
    store.switchCamera();

    const newState = useVideoCallStore.getState();
    expect(newState.cameraFacingMode).toBe(CameraFacingMode.ENVIRONMENT);
  });

  it('应该从 ENVIRONMENT 切换回 USER', () => {
    useVideoCallStore.setState({
      cameraFacingMode: CameraFacingMode.ENVIRONMENT,
    });

    const store = useVideoCallStore.getState();
    store.switchCamera();

    const newState = useVideoCallStore.getState();
    expect(newState.cameraFacingMode).toBe(CameraFacingMode.USER);
  });
});

// ============================================================================
// resetCallState Action 测试
// ============================================================================

describe('VideoCall Store - resetCallState', () => {
  it('应该重置所有状态到初始值', () => {
    // 先修改所有状态
    useVideoCallStore.setState({
      callState: CallState.CONNECTED,
      callId: 'call_123',
      callerId: 'user1',
      calleeId: 'user2',
      isMicrophoneMuted: true,
      isCameraOff: true,
      cameraFacingMode: CameraFacingMode.ENVIRONMENT,
      callDuration: 120,
      error: 'Some error',
      isScreenSharing: true,
    });

    // 重置
    const store = useVideoCallStore.getState();
    store.resetCallState();

    // 验证所有状态都恢复了
    const newState = useVideoCallStore.getState();
    expect(newState.callState).toBe(CallState.IDLE);
    expect(newState.callId).toBeNull();
    expect(newState.callerId).toBeNull();
    expect(newState.calleeId).toBeNull();
    expect(newState.isMicrophoneMuted).toBe(false);
    expect(newState.isCameraOff).toBe(false);
    expect(newState.cameraFacingMode).toBe(CameraFacingMode.USER);
    expect(newState.callDuration).toBe(0);
    expect(newState.error).toBeNull();
    expect(newState.isScreenSharing).toBe(false);
  });
});

// ============================================================================
// 内部方法测试
// ============================================================================

describe('VideoCall Store - 内部方法', () => {
  beforeEach(() => {
    useVideoCallStore.getState().resetCallState();
  });

  it('_setLocalStream 应该更新本地流', () => {
    const mockStream = {} as MediaStream;
    
    const store = useVideoCallStore.getState();
    store._setLocalStream(mockStream);

    const newState = useVideoCallStore.getState();
    expect(newState.localStream).toBe(mockStream);
  });

  it('_setRemoteStream 应该更新远程流', () => {
    const mockStream = {} as MediaStream;
    
    const store = useVideoCallStore.getState();
    store._setRemoteStream(mockStream);

    const newState = useVideoCallStore.getState();
    expect(newState.remoteStream).toBe(mockStream);
  });

  it('_updateCallState 应该更新通话状态', () => {
    const store = useVideoCallStore.getState();
    store._updateCallState(CallState.CONNECTED);

    const newState = useVideoCallStore.getState();
    expect(newState.callState).toBe(CallState.CONNECTED);
  });

  it('_setError 应该更新错误信息', () => {
    const store = useVideoCallStore.getState();
    store._setError('Test error');

    const newState = useVideoCallStore.getState();
    expect(newState.error).toBe('Test error');
  });

  it('_setError 应该能清除错误（设为 null）', () => {
    useVideoCallStore.setState({ error: 'Previous error' });

    const store = useVideoCallStore.getState();
    store._setError(null);

    const newState = useVideoCallStore.getState();
    expect(newState.error).toBeNull();
  });
});

// ============================================================================
// 状态订阅测试
// ============================================================================

describe('VideoCall Store - 状态订阅', () => {
  beforeEach(() => {
    useVideoCallStore.getState().resetCallState();
  });

  it('应该能订阅状态变化', () => {
    const mockCallback = jest.fn();

    // 订阅状态变化
    const unsubscribe = useVideoCallStore.subscribe(
      (state) => state.callState,
      mockCallback
    );

    // 验证 unsubscribe 是一个函数
    expect(typeof unsubscribe).toBe('function');

    // 取消订阅
    unsubscribe();
  });
});
