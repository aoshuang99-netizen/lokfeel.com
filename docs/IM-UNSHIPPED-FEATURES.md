# IM 侧未上线能力登记册

> 建立日期：2026-09-27 · 建立原因：P1-6 方案 A 确认（见 `CHAT-MERGE-AUDIT.md`）
> 用途：**防止阶段 5 清理时误删有价值的产品资产**

## 背景

LokFeel 的 IM 侧（`Conversation` + `IMMessage` + `lib/im/*`）实现了一套远比线上 Legacy 侧完整的聊天基础设施，但由于 UI 从未挂载（原因见审计报告 §10：`chat-container.tsx` 混用 socket.io 与 Pusher，在本项目 serverless 部署链上不可靠），**这些能力从未在生产环境运行过**。

因此它们**不是死代码，而是未启用资产**。本册逐项登记，作为阶段 5 清理的豁免清单与后续产品化路线图输入。

---

## 一、基础设施能力（已在代码中完整实现）

| # | 能力 | 代码位置 | 规范文档 | 处置建议 |
|---|---|---|---|---|
| 1 | **E2EE 端到端加密** | `IMMessage.encryptionMode` / `ephemeralPublicKey`（schema） | `docs/E2EE_SECURITY_SPEC.md` | **保留** —— open-core 叙事的核心差异点 |
| 2 | **Power Board 规则引擎** | `lib/im/services/`（`RuleEvaluator`、`ruleEvaluator`、`getUserRules`、`getDefaultRules`）；`IMMessage.boundaryVersion`/`ruleResult` | `docs/POWER_BOARD_RULE_ENGINE_SPEC.md` | **保留** —— 关系边界控制，竞品无对应能力 |
| 3 | **Pace Control 节奏控制** | `lib/im/services/`（`PaceController`、`paceController`） | `docs/ANTI_HARASSMENT_SYSTEM_SPEC.md` | **保留** —— 反骚扰，合规所需 |
| 4 | **审计日志链** | `lib/im/services/audit-logger.ts`（`AuditLogger`，hash-chained 防篡改；含 `vault_extended`/`vault_revoked` 事件） | — | **保留** —— 阶段 3 迁移 Vault 状态机时复用 |
| 5 | **序列号生成器** | `lib/im/services/`（`SeqGenerator`、`seqGenerator`） | — | **保留** —— `IMMessage.seq` 单调序号的依赖。**阶段 4 起已成为线上能力**：`/api/im/messages/*` 暴露 `seq`，前端用 `afterSeq` 做**增量轮询**（替代原每 5s 全量重拉） |
| 6 | **在线状态管理** | `lib/im/services/`（`PresenceManager`、`presenceManager`）+ `UserPresence` 表 | — | **保留** —— **阶段 4 起已接入列表**：`buildConversationList()` 批量读 `UserPresence` 富化 `isOnline`/`lastSeen`（表为空时行为与改造前等价，全部离线） |
| 7 | **存储分层（Hot/Cold）** | `lib/im/storage-strategy.ts` + `archiveMessages()` | `docs/IM_STORAGE_STRATEGY.md` | **保留** —— 自托管场景的成本控制卖点 |
| 8 | **Redis 支撑层** | `lib/im/redis/`（Upstash） | — | ⚠️ **需评估** —— 自托管时是额外依赖，必须有降级路径（见下"风险"） |

## 二、消息能力（表结构已就绪，UI 未启用）

| # | 能力 | 数据支撑 | 处置建议 |
|---|---|---|---|
| 9 | **逐人投递/已读回执** | `MessageReceipt`（`deliveredAt`/`readAt`） | 保留 —— Legacy 侧只有粗粒度 `isRead` |
| 10 | **消息反应（emoji）** | `MessageReaction` + `lib/im/queries.ts` 的 reactions 函数组 | 保留 —— 已有 `/api/im/reactions` 端点 |
| 11 | **消息编辑/撤回** | `editMessage()` / `deleteMessage()`；`IMMessage.isEdited`/`isDeleted`/`deletedBy` | 保留 —— 合规要求（撤回权） |
| 12 | **引用回复** | `IMMessage.replyToMsgId` / `replyToPreview` | 保留 |
| 13 | **会话状态机** | `Conversation.state` / `stateReason`（`ConversationState` 枚举） | 保留 —— Vault 状态机可并入此处 |
| 14 | **同意管理（Consent）** | `ConsentRequest` / `ConsentGrant` 表 + `Conversation.cachedConsentState` + `/api/im/consent` | 保留 —— **这是 open-core 的核心合规资产** |
| 15 | **媒体分级** | `IMMessage.mediaLevel`（`MediaAccessLevel`）、`mediaMetadata` | 保留 —— 与成人内容合规直接相关 |

## 三、UI 资产（已实现但未挂载）

| # | 资产 | 规模 | 处置建议 |
|---|---|---|---|
| 16 | **WebRTC 视频通话** | `components/video-call/{VideoCallModal,index}.tsx` + `hooks/useWebRTC.ts` + `usePusherSignaling.ts` | ✅ **阶段 4（2026-09-27）已接线** —— 挂载于 `page-content.tsx` 头部按钮（原为 `disabled` 占位）。受 `NEXT_PUBLIC_ENABLE_VIDEO_CALL=1` 门控，**默认关闭**（理由见审计报告 §12.4）。**启用前需验证 4 项**：Pusher 信令可达、ICE 候选协商、`getUserMedia` 权限引导、TURN 回退 |
| 17 | **IM 原生聊天 UI** | `components/chat/chat-container.tsx`（785 行）+ 6 个子组件 | **保留为增强候选** —— 待 IM 数据层稳定后单独评估；当前因实时通道混用不上线（§10） |
| 18 | **输入体验组件** | `chat-input.tsx` / `message-bubble.tsx` / `message-list.tsx` / `typing-indicator.tsx` / `reaction-picker.tsx` / `icebreaker-suggestions.tsx` / `use-message-windowing.ts` | 保留 —— 阶段 4 可选择性回移到 `page-content` |
| 19 | **Vault 计时器 UI** | `components/chat/vault-timer.tsx` | 保留 —— Legacy 侧 Vault 展示较简陋，可升级 |

---

## 风险与待办

### ⚠️ Redis 依赖（第 8 项）
`lib/im/redis/` 依赖 Upstash Redis，用于 Presence、pace control、缓存与 seq 生成。这对**自托管**（P1-1 交付物）与**多租户**（P0-2）都是额外外部依赖。

**阶段 4 使其依赖等级上升**：`seq` 与 `Presence` 从「未上线能力的内部依赖」变成**线上能力的直接依赖** —— 前者是增量轮询的游标（无 seq 则轮询必须退回全量），后者是列表在线指示器。因此 Redis 的降级路径从「自托管时才需要考虑」变成「生产也必须考虑」。

**待办**：`docs/MULTI-TENANCY-DESIGN.md` 与 `docs/SELF-HOSTING.md` 需补充降级路径（无 Redis 时 seq 退回 DB 序列、Presence 退回轮询）。已登记，**未解决**。

> 注：阶段 4 的实现已对该风险做了**防御性处理** —— `buildConversationList()` 的 Presence 富化包在 `try/catch` 中，失败仅跳过在线状态，**不影响会话列表主流程**。

### ✅ 已决策项
- **WebRTC 视频通话（第 16 项）**：✅ **已接线**（阶段 4，2026-09-27），受 `NEXT_PUBLIC_ENABLE_VIDEO_CALL=1` 门控，默认关闭。**不再阻塞阶段 4 的工作量冻结** —— 接线工作已完成，开启与否只是环境变量。

### 阶段 5 清理豁免
本册所列 20 项能力，**均不在阶段 5 的删除清单内**。阶段 5 只删除：
- Legacy `Message` / `ChatRoomMember` 表
- `api/chats/route.ts`、`api/chat/*`（阶段 4 换源后无调用者；`/api/chat` 已降级为 33 行兼容壳）
- `hooks/useSocket.ts`（socket.io 通道）
- `lib/chat-api.ts` 末尾的 Legacy 方法段
- `lib/socket/`（若无其他引用）
- `ChatRoom` 表及其 Vault 列 —— ⚠️ **前置条件**：`npm run chat:vault:verify` 必须报「剩余不一致 = 0」（见 `CHAT-MERGE-RUNBOOK.md` §9.3）

---

*本册与 `CHAT-MERGE-AUDIT.md` 配套使用。任何删除操作前请先核对本册。*
