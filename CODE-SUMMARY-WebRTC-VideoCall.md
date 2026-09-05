# WebRTC 视频通话功能 - 代码摘要

> **功能**: LokFeel WebRTC 视频通话  
> **实现日期**: 2025-04-02  
> **工程师**: 寇豆码（Kou）  
> **对应架构设计**: `ARCHITECTURE-WebRTC-VideoCall.md`

---

## 📦 交付物清单

### T01: 基础设施 + 类型定义 + 配置文件

| 文件路径 | 描述 | 状态 |
|---------|------|------|
| `src/types/webrtc.ts` | WebRTC 相关 TypeScript 类型定义（枚举、接口、Props） | ✅ 已完成 |
| `src/config/webrtc.config.ts` | WebRTC 配置文件（STUN/TURN 服务器、超时配置、事件名称） | ✅ 已完成 |
| `src/utils/webrtc.ts` | WebRTC 工具函数（RTCPeerConnection 创建、SDP 处理、ICE 候选管理） | ✅ 已完成 |
| `src/utils/mediaStream.ts` | 媒体流工具函数（获取/停止流、切换设备、权限检查、截图） | ✅ 已完成 |
| `package.json` | 添加依赖：zustand ^4.5.0, webrtc-adapter ^8.2.3, @types/webrtc ^0.0.33 | ✅ 已完成 |

### T02: Zustand Store + 核心 Hooks

| 文件路径 | 描述 | 状态 |
|---------|------|------|
| `src/store/videoCallStore.ts` | Zustand store（管理通话状态、媒体流、设备状态、错误信息） | ✅ 已完成 |
| `src/hooks/useWebRTC.ts` | 核心 WebRTC Hook（封装 RTCPeerConnection 生命周期、信令交互） | ✅ 已完成 |
| `src/hooks/usePusherSignaling.ts` | Pusher 信令 Hook（监听/触发 Pusher 事件，复用现有 Pusher 连接） | ✅ 已完成 |
| `src/hooks/useMediaDevices.ts` | 媒体设备 Hook（获取/切换摄像头、麦克风，权限检查，设备枚举） | ✅ 已完成 |
| `src/hooks/useCallTimer.ts` | 计时 Hook（开始、暂停、重置计时器，格式化时长 MM:SS） | ✅ 已完成 |

### T03: 视频通话 UI 组件

| 文件路径 | 描述 | 状态 |
|---------|------|------|
| `src/components/video-call/VideoPlayer.tsx` | 视频播放器组件（封装 `<video>` 标签，自动播放，支持镜像） | ✅ 已完成 |
| `src/components/video-call/CallTimer.tsx` | 通话时长显示组件（格式 MM:SS，带通话指示器动画） | ✅ 已完成 |
| `src/components/video-call/CallControls.tsx` | 控制栏组件（静音、摄像头、挂断、切换摄像头、屏幕共享按钮） | ✅ 已完成 |
| `src/components/video-call/IncomingCallModal.tsx` | 来电弹窗组件（显示来电者信息、接听/拒绝按钮、播放铃声） | ✅ 已完成 |
| `src/components/video-call/VideoCallModal.tsx` | 主界面模态框（本地/远程视频、控制栏、时长显示、状态处理） | ✅ 已完成 |
| `src/components/chat/VideoCallButton.tsx` | 聊天界面按钮组件（视频通话入口，支持禁用状态） | ✅ 已完成 |
| `src/components/video-call/index.ts` | 导出文件（统一导出所有 video-call 组件） | ✅ 已完成 |

### T04: 集成到聊天界面 + 权限引导

| 文件路径 | 描述 | 状态 |
|---------|------|------|
| `src/components/chat/chat-container.tsx` | 修改：添加 VideoCallModal，连接视频按钮到模态框 | ✅ 已完成 |
| `src/components/video-call/PermissionGuide.tsx` | 权限引导组件（首次使用时引导授权摄像头/麦克风） | ✅ 已完成 |
| `src/hooks/usePermissionGuide.ts` | 权限引导 Hook（检测权限状态、请求权限、localStorage 记忆） | ✅ 已完成 |

---

## 🔑 关键实现细节

### 1. WebRTC 连接流程

**发起方 (Caller)**:
1. 点击视频按钮 → `setShowVideoCallModal(true)`
2. `useWebRTC.initiateCall(calleeId)` → 获取本地媒体流 → 创建 Offer
3. 通过 Pusher 发送 Offer（`client-video-call-offer`）
4. 接收 Answer → 设置远程描述 → ICE 候选交换 → 建立 P2P 连接

**接收方 (Callee)**:
1. 收到 Offer → 显示 `IncomingCallModal`
2. 用户点击接听 → `useWebRTC.acceptCall()` → 获取本地媒体流
3. 创建 Answer → 通过 Pusher 发送 Answer
4. 接收 ICE 候选 → 添加 ICE 候选 → 建立 P2P 连接

### 2. Pusher 信令集成

- **复用现有 Pusher 连接**：`usePusherSignaling` 调用 `getIMPusherClient()` 获取已有连接
- **频道命名**：复用 `private-user-{userId}` 频道（与 IM 聊天相同）
- **事件命名**：`client-video-call-offer`, `client-video-call-answer`, `client-ice-candidate`, `client-video-call-hangup`, `client-video-call-decline`, `client-video-call-timeout`

### 3. 状态管理

- **Zustand Store**: `useVideoCallStore` 管理全局通话状态
- **选择器优化**: 提供细粒度选择器（`useCallState`, `useLocalStream`, `useRemoteStream` 等）
- **状态持久化**: 通话结束后延迟 1 秒重置状态（让 UI 有机会显示结束状态）

### 4. 错误处理

- WebRTC 连接失败：显示 toast 通知，允许重试
- 权限被拒绝：显示 `PermissionGuide` 组件引导用户授权
- 网络断开：显示断线提示，允许重新连接
- ICE 连接失败：自动重启 ICE（`peerConnection.restartIce()`）

---

## 📝 已知问题或待优化点

### P0 (必须修复)
- [ ] **userId 获取**: `usePusherSignaling` 中的 `userId` 应该从 auth store 获取，当前是 `undefined`
- [ ] **Offer/Answer 发送逻辑**: `useWebRTC` 中创建 Offer/Answer 后，需要通过 `usePusherSignaling` 发送，当前只是 console.log
- [ ] **ICE 候选发送**: `createPeerConnection` 的 `onIceCandidate` 回调中需要调用 `sendIceCandidate`

### P1 (建议优化)
- [ ] **屏幕共享功能**: `useScreenShare` Hook 和 `ScreenShareButton` 组件未完成
- [ ] **网络质量检测**: `useNetworkQuality` Hook 未完成
- [ ] **通话记录**: `CallHistory` 组件和 API 未完成
- [ ] **来电铃声**: `/sounds/ringtone.mp3` 文件需要实现或提供默认铃声

### P2 (可选优化)
- [ ] **UI 美化**: 当前使用基础 Tailwind CSS，可以优化动画和过渡效果
- [ ] **移动端适配**: 摄像头切换按钮在桌面端也显示，可以仅在小屏显示
- [ ] **全屏模式**: 控制栏的全屏按钮未实现
- [ ] **二维码分享**: 可以通过二维码分享通话链接（类似 Zoom）

---

## 🧪 测试建议

### 单元测试
```bash
# 测试 Zustand store
npm test -- src/store/videoCallStore.ts

# 测试 Hooks
npm test -- src/hooks/useWebRTC.ts
npm test -- src/hooks/usePusherSignaling.ts
```

### 集成测试
- 使用 Mock Pusher 测试完整的 Offer/Answer 流程
- 测试权限拒绝后的引导流程

### E2E 测试
- 使用 Playwright 测试真实视频通话流程（需要两台机器或模拟摄像头）

---

## 📚 后续步骤

1. **安装依赖**:
   ```bash
   cd /Users/frankzhao/WorkBuddy/20260402202519/nexus-app
   npm install
   ```

2. **修复 P0 问题**:
   - 获取当前用户 ID（从 auth store 或 session）
   - 完善 Offer/Answer/ICE 候选的发送逻辑
   - 测试 Pusher 信令流程

3. **测试功能**:
   - 在浏览器中测试视频通话流程
   - 检查控制台错误
   - 验证权限请求流程

4. **部署到 staging**:
   - 配置 TURN 服务器（Metered.ca）
   - 设置环境变量（`NEXT_PUBLIC_USE_TURN`, `NEXT_PUBLIC_TURN_USERNAME`, `NEXT_PUBLIC_TURN_CREDENTIAL`）

---

## 🌐 环境变量配置

在 `.env.local` 中添加：

```bash
# WebRTC TURN Server (Metered.ca)
NEXT_PUBLIC_USE_TURN=false
NEXT_PUBLIC_TURN_USERNAME=your_turn_username
NEXT_PUBLIC_TURN_CREDENTIAL=your_turn_credential

# 注意：MVP 阶段可以先不配置 TURN，使用 STUN 服务器即可
# 如果 NAT 穿透失败，视频通话可能无法建立连接
```

---

**文档结束**

> 下一步：修复 P0 问题，测试完整流程，然后部署到 staging 环境。
