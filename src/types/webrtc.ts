/**
 * WebRTC 视频通话类型定义
 * 集中管理所有 TypeScript 类型，便于跨文件复用和维护
 */

// ============================
// 枚举类型
// ============================

/** 通话状态枚举 */
export enum CallState {
  IDLE = 'idle',                 // 空闲（无通话）
  CALLING = 'calling',           // 发起通话中（等待对方接听）
  RINGING = 'ringing',           // 收到来电（响铃中）
  CONNECTING = 'connecting',     // 连接中（交换 ICE 候选）
  CONNECTED = 'connected',       // 已连接（通话中）
  ENDED = 'ended',               // 通话已结束
  FAILED = 'failed',             // 通话失败（错误）
}

/** 挂断原因枚举 */
export enum HangupReason {
  USER_INITIATED = 'user_initiated',   // 用户主动挂断
  REMOTE_HANGUP = 'remote_hangup',    // 对方挂断
  REJECTED = 'rejected',              // 对方拒绝
  TIMEOUT = 'timeout',                // 超时未接听
  NETWORK_ERROR = 'network_error',     // 网络错误
  ICE_CONNECTION_FAILED = 'ice_failed', // ICE 连接失败
}

/** 媒体设备类型 */
export enum MediaDeviceType {
  CAMERA = 'camera',
  MICROPHONE = 'microphone',
  SPEAKER = 'speaker',
}

/** 摄像头位置（移动端） */
export enum CameraFacingMode {
  USER = 'user',         // 前置摄像头
  ENVIRONMENT = 'environment',  // 后置摄像头
}

// ============================
// Pusher 信令事件 Payload
// ============================

/** 视频通话 Offer（发起方 → 接收方） */
export interface VideoCallOffer {
  callId: string;           // 唯一通话 ID（UUID v4）
  callerId: string;          // 发起方用户 ID
  calleeId: string;          // 接收方用户 ID
  offer: RTCSessionDescriptionInit;  // SDP Offer
  timestamp: number;         // 发起时间戳（用于超时判断）
}

/** 视频通话 Answer（接收方 → 发起方） */
export interface VideoCallAnswer {
  callId: string;
  callerId: string;
  calleeId: string;
  answer: RTCSessionDescriptionInit;  // SDP Answer
}

/** 视频通话拒绝（接收方 → 发起方） */
export interface VideoCallDecline {
  callId: string;
  callerId: string;
  calleeId: string;
  reason: 'busy' | 'declined' | 'no_answer';  // 拒绝原因
  message?: string;          // 可选拒绝消息（如「没空」）
}

/** ICE 候选（双方交换） */
export interface ICECandidateMessage {
  callId: string;
  callerId: string;
  calleeId: string;
  candidate: RTCIceCandidateInit;  // ICE 候选
}

/** 挂断事件（双方均可触发） */
export interface VideoCallHangup {
  callId: string;
  callerId: string;
  calleeId: string;
  reason: HangupReason;
  duration: number;          // 通话时长（秒）
  timestamp: number;         // 挂断时间戳
}

/** 邀请超时（发起方触发） */
export interface VideoCallTimeout {
  callId: string;
  callerId: string;
  calleeId: string;
}

// ============================
// 媒体流相关类型
// ============================

/** 本地媒体流配置 */
export interface LocalMediaConfig {
  video: boolean | MediaTrackConstraints;  // 视频约束
  audio: boolean | MediaTrackConstraints;   // 音频约束
}

/** 屏幕共享配置（P1） */
export interface ScreenShareConfig {
  enabled: boolean;
  displayMediaOptions?: MediaStreamConstraints;
}

// ============================
// Zustand Store 类型
// ============================

/** VideoCall Store 状态 */
export interface VideoCallState {
  // 通话状态
  callState: CallState;
  callId: string | null;
  callerId: string | null;
  calleeId: string | null;
  
  // 媒体流
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  
  // 设备状态
  isMicrophoneMuted: boolean;
  isCameraOff: boolean;
  cameraFacingMode: CameraFacingMode;
  
  // 通话信息
  callDuration: number;       // 通话时长（秒）
  callStartTime: number | null;
  networkQuality: 'good' | 'medium' | 'poor' | 'unknown';
  
  // 错误信息
  error: string | null;
  
  // 屏幕共享（P1）
  isScreenSharing: boolean;
}

/** VideoCall Store Actions（方法） */
export interface VideoCallActions {
  // 通话控制
  initiateCall: (calleeId: string) => void;
  acceptCall: () => void;
  declineCall: (reason: VideoCallDecline['reason']) => void;
  hangupCall: (reason?: HangupReason) => void;
  
  // 状态设置（新增 - 供 Hook 使用）
  setCallId: (callId: string | null) => void;
  setCallerId: (callerId: string | null) => void;
  setCalleeId: (calleeId: string | null) => void;
  
  // 媒体控制
  toggleMicrophone: () => void;
  toggleCamera: () => void;
  switchCamera: () => void;
  startScreenShare: () => Promise<void>;  // P1
  stopScreenShare: () => void;           // P1
  
  // 状态重置
  resetCallState: () => void;
  
  // 内部方法（仅供 Hook 使用）
  _setLocalStream: (stream: MediaStream | null) => void;
  _setRemoteStream: (stream: MediaStream | null) => void;
  _updateCallState: (state: CallState) => void;
  _setError: (error: string | null) => void;
}

/** VideoCall Store 完整类型 */
export type VideoCallStore = VideoCallState & VideoCallActions;

// ============================
// Hook 返回值类型
// ============================

/** useWebRTC Hook 返回值 */
export interface UseWebRTCResult {
  // 状态
  callState: CallState;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isMicrophoneMuted: boolean;
  isCameraOff: boolean;
  callDuration: number;
  networkQuality: VideoCallState['networkQuality'];
  error: string | null;
  isSignalingConnected: boolean;
  
  // 方法
  initiateCall: (calleeId: string) => void;
  acceptCall: () => void;
  declineCall: (reason: VideoCallDecline['reason']) => void;
  hangupCall: () => void;
  toggleMicrophone: () => void;
  toggleCamera: () => void;
  switchCamera: () => void;
}

/** usePusherSignaling Hook 返回值 */
export interface UsePusherSignalingResult {
  // 方法
  sendOffer: (offer: VideoCallOffer) => void;
  sendAnswer: (answer: VideoCallAnswer) => void;
  sendDecline: (decline: VideoCallDecline) => void;
  sendIceCandidate: (message: ICECandidateMessage) => void;
  sendHangup: (hangup: VideoCallHangup) => void;
  sendTimeout: (timeout: VideoCallTimeout) => void;
}

/** useMediaDevices Hook 返回值 */
export interface UseMediaDevicesResult {
  localStream: MediaStream | null;
  isMicrophoneMuted: boolean;
  isCameraOff: boolean;
  cameraFacingMode: CameraFacingMode;
  
  getLocalStream: (config?: LocalMediaConfig) => Promise<MediaStream>;
  stopLocalStream: () => void;
  toggleMicrophone: () => void;
  toggleCamera: () => void;
  switchCamera: () => Promise<void>;
}

// ============================
// 组件 Props 类型
// ============================

/** VideoCallModal 组件 Props */
export interface VideoCallModalProps {
  open: boolean;
  onClose: () => void;
}

/** IncomingCallModal 组件 Props */
export interface IncomingCallModalProps {
  open: boolean;
  callerName: string;
  callerAvatar: string;
  onAccept: () => void;
  onDecline: (reason: VideoCallDecline['reason']) => void;
}

/** CallControls 组件 Props */
export interface CallControlsProps {
  isMicrophoneMuted: boolean;
  isCameraOff: boolean;
  isScreenSharing: boolean;
  onToggleMicrophone: () => void;
  onToggleCamera: () => void;
  onHangup: () => void;
  onScreenShare: () => void;  // P1
  onSwitchCamera: () => void;
}

/** VideoPlayer 组件 Props */
export interface VideoPlayerProps {
  stream: MediaStream | null;
  muted?: boolean;
  autoPlay?: boolean;
  className?: string;
}

/** CallHistory 类型定义 */
export interface CallHistory {
  callId: string;
  callerId: string;
  calleeId: string;
  duration: number;         // 通话时长（秒）
  startTime: number;         // 开始时间戳
  endTime: number;           // 结束时间戳
  status: 'completed' | 'missed' | 'declined';
}
