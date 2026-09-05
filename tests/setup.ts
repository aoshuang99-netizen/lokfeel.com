import dotenv from 'dotenv';

// 加载环境变量
dotenv.config({ path: '.env.test' });

// 全局测试配置
global.console = {
  ...console,
  // 在测试中静音某些日志
  log: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// 测试超时设置
jest.setTimeout(30000);

// 模拟外部API - 简化版本
jest.mock('openai', () => {
  return {
    OpenAI: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: '这是一个测试生成的pitch消息。'
                }
              }
            ]
          })
        }
      }
    }))
  };
});

// 模拟pusher
jest.mock('pusher', () => {
  const mockPusher = {
    trigger: jest.fn().mockResolvedValue({}),
    authenticate: jest.fn().mockReturnValue({})
  };
  return {
    default: jest.fn().mockReturnValue(mockPusher)
  };
});

// 模拟 WebRTC API（全局模拟）
class MockRTCPeerConnection {
  onicecandidate: ((event: any) => void) | null = null;
  ontrack: ((event: any) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  onsignalingstatechange: (() => void) | null = null;

  connectionState: string = 'new';
  iceConnectionState: string = 'new';
  signalingState: string = 'stable';

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: 'mock-sdp' };
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'answer', sdp: 'mock-sdp' };
  }

  async setLocalDescription(_desc: RTCSessionDescriptionInit): Promise<void> {}
  async setRemoteDescription(_desc: RTCSessionDescriptionInit): Promise<void> {}

  addTrack(_track: MediaStreamTrack, _stream: MediaStream): RTCRtpSender {
    return {} as RTCRtpSender;
  }

  getSenders(): RTCRtpSender[] {
    return [];
  }

  removeTrack(_sender: RTCRtpSender): void {}

  close(): void {
    this.connectionState = 'closed';
  }

  restartIce(): void {}

  async getStats(): Promise<RTCStatsReport> {
    return new Map() as unknown as RTCStatsReport;
  }

  addIceCandidate(_candidate: RTCIceCandidateInit): Promise<void> {
    return Promise.resolve();
  }
}

(global as any).RTCPeerConnection = MockRTCPeerConnection;
(global as any).RTCSessionDescription = class {
  constructor(public init: RTCSessionDescriptionInit) {}
};
(global as any).RTCIceCandidate = class {
  constructor(public init: RTCIceCandidateInit) {}
};

// 模拟 navigator.mediaDevices
Object.defineProperty(global, 'navigator', {
  value: {
    mediaDevices: {
      getUserMedia: jest.fn().mockResolvedValue({
        getTracks: () => [{ kind: 'video', stop: jest.fn() }, { kind: 'audio', stop: jest.fn() }],
        getVideoTracks: () => [{ enabled: true }],
        getAudioTracks: () => [{ enabled: true }],
      }),
      getDisplayMedia: jest.fn().mockResolvedValue({}),
      enumerateDevices: jest.fn().mockResolvedValue([]),
      permissions: {
        query: jest.fn().mockResolvedValue({ state: 'granted' }),
      },
    },
  },
  writable: true,
});