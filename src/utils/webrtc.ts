/**
 * WebRTC 工具函数
 * 封装 RTCPeerConnection 相关操作
 */

import { getIceServers } from '@/config/webrtc.config';
import { VideoCallOffer, VideoCallAnswer, ICECandidateMessage } from '@/types/webrtc';

// ============================================================================
// RTCPeerConnection 工厂函数
// ============================================================================

/**
 * 创建 RTCPeerConnection 实例
 * @param onIceCandidate - ICE 候选回调
 * @param onTrack - 远程轨道回调
 * @param onConnectionStateChange - 连接状态变化回调
 * @returns RTCPeerConnection 实例
 */
export function createPeerConnection(
  onIceCandidate: (candidate: RTCIceCandidate) => void,
  onTrack: (event: RTCTrackEvent) => void,
  onConnectionStateChange: (state: RTCPeerConnectionState) => void
): RTCPeerConnection {
  const peerConnection = new RTCPeerConnection({
    iceServers: getIceServers(),
  });

  // 处理 ICE 候选
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      console.log('[WebRTC] ICE candidate generated:', event.candidate);
      onIceCandidate(event.candidate);
    } else {
      console.log('[WebRTC] ICE candidate gathering complete');
    }
  };

  // 处理远程轨道
  peerConnection.ontrack = (event) => {
    console.log('[WebRTC] Remote track received:', event.track.kind);
    onTrack(event);
  };

  // 监听连接状态变化
  peerConnection.onconnectionstatechange = () => {
    const state = peerConnection.connectionState;
    console.log('[WebRTC] Connection state changed:', state);
    onConnectionStateChange(state);
  };

  // 监听 ICE 连接状态变化
  peerConnection.oniceconnectionstatechange = () => {
    const state = peerConnection.iceConnectionState;
    console.log('[WebRTC] ICE connection state changed:', state);
    
    if (state === 'failed') {
      console.error('[WebRTC] ICE connection failed');
      // 尝试重新连接
      peerConnection.restartIce();
    }
  };

  // 监听信令状态变化
  peerConnection.onsignalingstatechange = () => {
    console.log('[WebRTC] Signaling state changed:', peerConnection.signalingState);
  };

  return peerConnection;
}

// ============================================================================
// SDP Offer/Answer 处理
// ============================================================================

/**
 * 创建 Offer
 * @param peerConnection - RTCPeerConnection 实例
 * @returns SDP Offer
 */
export async function createOffer(
  peerConnection: RTCPeerConnection
): Promise<RTCSessionDescriptionInit> {
  try {
    const offer = await peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    
    await peerConnection.setLocalDescription(offer);
    console.log('[WebRTC] Offer created and set as local description');
    
    return offer;
  } catch (error) {
    console.error('[WebRTC] Failed to create offer:', error);
    throw error;
  }
}

/**
 * 创建 Answer
 * @param peerConnection - RTCPeerConnection 实例
 * @param offer - 远程 Offer
 * @returns SDP Answer
 */
export async function createAnswer(
  peerConnection: RTCPeerConnection,
  offer: RTCSessionDescriptionInit
): Promise<RTCSessionDescriptionInit> {
  try {
    // 设置远程描述（Offer）
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    console.log('[WebRTC] Remote offer set as description');
    
    // 创建 Answer
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    console.log('[WebRTC] Answer created and set as local description');
    
    return answer;
  } catch (error) {
    console.error('[WebRTC] Failed to create answer:', error);
    throw error;
  }
}

/**
 * 设置远程描述（Answer）
 * @param peerConnection - RTCPeerConnection 实例
 * @param answer - 远程 Answer
 */
export async function setRemoteDescription(
  peerConnection: RTCPeerConnection,
  answer: RTCSessionDescriptionInit
): Promise<void> {
  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    console.log('[WebRTC] Remote answer set as description');
  } catch (error) {
    console.error('[WebRTC] Failed to set remote description:', error);
    throw error;
  }
}

// ============================================================================
// ICE 候选处理
// ============================================================================

/**
 * 添加 ICE 候选
 * @param peerConnection - RTCPeerConnection 实例
 * @param candidate - ICE 候选
 */
export async function addIceCandidate(
  peerConnection: RTCPeerConnection,
  candidate: RTCIceCandidateInit
): Promise<void> {
  try {
    if (peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      console.log('[WebRTC] ICE candidate added');
    } else {
      console.warn('[WebRTC] Skipped adding ICE candidate (remote description not set)');
    }
  } catch (error) {
    console.error('[WebRTC] Failed to add ICE candidate:', error);
    throw error;
  }
}

// ============================================================================
// 媒体流处理
// ============================================================================

/**
 * 添加本地流到连接
 * @param peerConnection - RTCPeerConnection 实例
 * @param stream - 本地媒体流
 */
export function addLocalStream(
  peerConnection: RTCPeerConnection,
  stream: MediaStream
): void {
  stream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, stream);
    console.log(`[WebRTC] Added ${track.kind} track to peer connection`);
  });
}

/**
 * 移除本地流
 * @param peerConnection - RTCPeerConnection 实例
 * @param stream - 本地媒体流
 */
export function removeLocalStream(
  peerConnection: RTCPeerConnection,
  stream: MediaStream
): void {
  const senders = peerConnection.getSenders();
  
  stream.getTracks().forEach((track) => {
    const sender = senders.find((s) => s.track === track);
    if (sender) {
      peerConnection.removeTrack(sender);
      console.log(`[WebRTC] Removed ${track.kind} track from peer connection`);
    }
  });
}

// ============================================================================
// 连接管理
// ============================================================================

/**
 * 关闭连接
 * @param peerConnection - RTCPeerConnection 实例
 */
export function closeConnection(peerConnection: RTCPeerConnection | null): void {
  if (!peerConnection) return;
  
  try {
    // 停止所有发送者
    peerConnection.getSenders().forEach((sender) => {
      if (sender.track) {
        sender.track.stop();
      }
    });
    
    // 关闭连接
    peerConnection.close();
    console.log('[WebRTC] Connection closed');
  } catch (error) {
    console.error('[WebRTC] Error closing connection:', error);
  }
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 生成唯一的通话 ID
 * @returns UUID v4 格式的字符串
 */
export function generateCallId(): string {
  return `call_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * 检查 WebRTC 支持
 * @returns 是否支持 WebRTC
 */
export function isWebRTCSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'RTCPeerConnection' in window &&
    'mediaDevices' in navigator &&
    'getUserMedia' in navigator.mediaDevices
  );
}

/**
 * 检查屏幕共享支持
 * @returns 是否支持屏幕共享
 */
export function isScreenShareSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'getDisplayMedia' in navigator.mediaDevices
  );
}

/**
 * 获取网络质量
 * @param peerConnection - RTCPeerConnection 实例
 * @returns 网络质量评级
 */
export async function getNetworkQuality(
  peerConnection: RTCPeerConnection
): Promise<'good' | 'medium' | 'poor' | 'unknown'> {
  try {
    const stats = await peerConnection.getStats();
    let packetLoss = 0;
    let rtt = 0;
    
    stats.forEach((report) => {
      if (report.type === 'inbound-rtp' && report.kind === 'video') {
        const packetsLost = report.packetsLost || 0;
        const packetsReceived = report.packetsReceived || 1;
        packetLoss = packetsLost / (packetsLost + packetsReceived);
      }
      
      if (report.type === 'candidate-pair' && report.selected) {
        rtt = report.currentRoundTripTime || 0;
      }
    });
    
    // 根据阈值判断质量
    if (packetLoss < 0.01 && rtt < 0.1) return 'good';
    if (packetLoss < 0.05 && rtt < 0.3) return 'medium';
    return 'poor';
  } catch (error) {
    console.error('[WebRTC] Failed to get network stats:', error);
    return 'unknown';
  }
}
