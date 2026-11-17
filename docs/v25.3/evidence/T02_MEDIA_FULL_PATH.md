# V25.3 · T02（V25-09/10）媒体隐私全路径闭环 — 证据与边界

**状态：CODE_COMPLETE → LOCAL_TESTED（未独立复核、未 Preview、未生产）。** 本文件不声称 PRODUCTION_VERIFIED。

## 0. 基线

- BASE_SHA（本轮起点）：`9f4bf4757a9a0b4f543f5292fbe4031d20234aa5`（分支 `v25.2/consent-closure`）
- 远端 GitHub main：`cad717e92542395e4346e49d388f09be78ec1557`（本轮不推送）
- V25.2 已闭合：发送侧 `/api/im/send`、读取侧 `/api/im/messages/[id]`、`lib/im/list.ts` 会话预览（保留，不重写）。

## 1. 审计发现的**剩余**披露面（本轮新增闭合）

| # | 披露路径 | 风险 | V25.2 覆盖? | 本轮处置 |
|---|---------|------|------------|---------|
| D1 | `/api/im/send` 的 Pusher `im:message` 广播（`private-im-conv-*` + `private-im-user-*`）直接带 `message.payload` 原文 | H | 否 | 广播前用统一判决 `view(action)` 重算，原文被遮盖时置 `mediaRedacted=true` |
| D2 | `handleBotReply(..., content)` 把原文喂进 Bot 分类 / `BotInteractionLog` | H | 否 | 以 `process_ai(action)` 判决后的内容代入；媒体恒为占位符，零 base64 进 Bot/日志 |
| D3 | `sniffContentMediaLevel` 只认 `data:image/`/`audio/` 前缀，MIME 伪装可绕过 | H | 部分 | 增加 base64 魔数（JPEG/PNG/GIF/WEBP/MP3/OGG/WAV/WEBM）+ 普通 URL 扩展名嗅探 |
| D4 | `getConversationsByUserId` 会话预览回显 lastMessage.payload 原文 | M | 否（ dormant 导出 API） | 按当前 grant 复核，撤销后占位符 |
| D5 | `exportAccountData` / `/api/im/reactions` / `/api/im/read` / `/api/im/conversations/[id]` | L | 已核 | 审计确认不回显媒体原文（导出不含 IM 消息；reactions/read/conv-detail 不写 payload），不改 |

**诚实边界：**
- 已送达并留在接收设备本地的副本（含 Pusher 已 emit 的历史帧、本地缓存）**无法远程收回**。本轮只保证「未来任何**经服务端受控**的新披露」遵循撤销后策略。
- `process_ai` 对媒体一律拒绝，是因为当前 schema 没有独立的 `process_ai` 授权类型。这是一条保守的临时契约，不是产品终态；要放行需 Owner 定义新授权类型并单独判决。

## 2. 统一判决 API

新增 `src/lib/im/media-disclosure.ts`：

- `authorizeMediaAction(action, subject, client?)`：覆盖 `view | send | forward | export | process_ai` 五动作；
  - 每次都重新查 `ConsentGrant`（方向 receiver=granter / sender=grantee、会话绑定、档位取最高、时间/撤销）；
  - `process_ai`：媒体恒拒绝（`DENY_BY_ACTION`），连 grant 都不查，零外发；
  - `forward`：目标会话必须显式给出且不同于来源，不跨会话复用授权；
  - 作者自看：`OWN_CONTENT` 放行；DB 异常 fail closed；
  - 拒绝时 `safePayload` 恒为不含 `data:`/base64 的占位符。
- `safePayloadForDisclosure(...)`：只取安全载荷的封装，供各披露路径直接外发。

## 3. 改动文件与 SHA256

| 文件 | SHA256 |
|------|--------|
| src/lib/im/media-disclosure.ts | `a494d834c5b64795e2ad50d8fff19d13c42c8d95b42ac22ca7ac0974e630cf24` |
| src/lib/im/consent-guard.ts | `da5b4bc5d78a4765e59c864e13913ff9f3a2fac87811137fb292421990626d04` |
| src/app/api/im/send/route.ts | `d603b637b9e27365b8770f394ffe4ae85e841455c65b3ae391bf414983270cbc` |
| src/lib/im/queries.ts | `4bd7622451781e645f08adfa5879953e1e1edecf99f19277d00b80d8e599f2a9` |
| tests/im/media-disclosure.test.ts | `0981b95e4995864ca79170501d20a6648925a0891881ca9aaede9de015d7b2c3` |
| tests/im/send-media-consent.test.ts | `32061644bd2dc6b039570c231a7800344137267c191fe19722ef1a1a8fc2d3eb` |

## 4. 验证结果

- 媒体定向 Jest：`3 suites / 49 tests PASS`（media-disclosure + send-media-consent + media-consent-guard）
- 全量 Jest：`165 suites / 2975 tests PASS`（较 V25.2 基线 164/2951 增 1 suite / 24 tests）
- `tsc --noEmit`：EXIT 0
- 定向 eslint：0 error；`queries.ts` 2 条 warning 为存量（未用 interface，非本轮引入）
- 负向测试覆盖：无授权/撤销、档位不足、多 grant 取高、跨会话、forward 缺目标、OWN_CONTENT、process_ai 恒拒、DB 异常 fail-closed、MIME 伪装（JPEG/PNG/MP3 base64 魔数）、普通 URL 媒体引用、Pusher 载荷零原文、Bot 上下文零 base64

## 5. 剩余失败项 / 未闭合（如实）

- **未独立复核**：本轮代码由实施者自测，无独立 Reviewer ⇒ 不能标 `INDEPENDENT_VERIFIED`。
- **未真实 HTTP 重跑 V25-09/10**：本轮以 Jest 集成层钉住行为；V25.2 的真实 HTTP 11/11 + 4/4 仍是上一轮证据，未在新代码树上重跑（需启动隔离服务）。
- **Socket.IO 遗留路径（D6，仅自托管）**：`src/lib/socket/delivery.ts` 的 `saveMessage`/`queueForOfflineDelivery` 仍写原文到 DB/Redis，`handlers.ts:260` 的 `queueMessage` 未做媒体门禁。经确认：Socket.IO 网关仅由自定义 `server.ts` 的 `initializeSocketServer` 初始化，`package.json` 只有 `dev:socket`/`dev:all` 走 `tsx server.ts`，生产 `start=next start`（Netlify/Vercel 用 Pusher）⇒ **当前生产不经过此路径**。但 T06 Community Edition 自托管会用 `server.ts`，该路径会活过来 ⇒ 列为 T06 发布前的必须闭合项，本轮未改（避免误伤 dev 链路）。
- **Pusher 真实 emit 未验**：沙箱无 Pusher 凭据，仅断言 `trigger` 调用参数安全，未接真实 Pusher 观察帧。
