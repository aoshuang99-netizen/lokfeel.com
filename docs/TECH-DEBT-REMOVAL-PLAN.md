# 技术债清除计划（P0-3 依赖解耦 + P1-6 双聊天系统合并）

> 状态：**P1-6 方案 A 已确认 · P0-3 方案待评审** · 2026-09-27
> 这两项的共同点：不解决则开源后**维护成本翻倍**，但都不阻塞首次发布 —— 因此排在 P0 之后、P1 之中。
>
> 📎 **P1-6 详细审计（含引用矩阵、五个缺陷、迁移映射、四阶段计划）：见 `docs/CHAT-MERGE-AUDIT.md`**
> 📎 **清理豁免清单（19 项未上线能力，勿误删）：见 `docs/IM-UNSHIPPED-FEATURES.md`**

---

# 第一部分：私有 SaaS 依赖解耦（P0-3）

## 1. 问题

当前代码深度绑定一批**商业托管服务**。开源后，任何人想自托管都必须先注册这些服务，这在开源场景下是致命的采用门槛。

| 依赖 | 用途 | 自托管替代方案 |
|---|---|---|
| **Neon**（PostgreSQL 512MB 免费版） | 主数据库 | 自建 PostgreSQL 16 |
| **Turso / libSQL** | 备用数据库（`docs/turso-migration-plan.md`）| 二选一，建议统一到 PostgreSQL |
| **Vercel** | 部署平台 | Docker（见 `Dockerfile`）|
| **Cloudflare Workers** | 备用部署目标（`wrangler.jsonc`、`open-next.config.ts`）| Docker |
| **Pusher** | 实时消息推送 | 自建 Socket.io（**需先完成 Redis Adapter**）|
| **Upstash Redis** | 限流、缓存 | 自建 Redis 7 |
| **Firebase / firebase-admin** | 认证辅助、推送 | NextAuth + 自建 SMTP + Web Push |
| **Sentry** | 错误监控 | 可选（默认关闭，接入自建 GlitchTip 亦可）|
| **Resend** | 事务邮件 | 自建 SMTP（已在 Compose 中接入）|
| **DiceBear** | 默认头像生成 | 本地生成或静态资源 |
| **Creem / Stripe** | 支付 | 见 `docs/PAYMENT-COMPLIANCE.md`（BYO Gateway）|

## 2. 改造原则

> **服务商不是要删掉，而是要不被硬绑定。**

保留"使用托管服务"的能力（对云托管版有价值），但必须让"自托管"成为**默认可用路径**。

### 2.1 Provider 模式

对每一类外部依赖，定义一个接口 + 至少两个实现（托管版 / 自托管版）：

```ts
// 示例：实时消息传输
export interface RealtimeTransport {
  readonly id: string;
  publish(channel: string, event: string, payload: unknown): Promise<void>;
  authorizeChannel(userId: string, channel: string): Promise<AuthToken>;
}

// 实现
// · PusherTransport      —— 托管（当前生产使用）
// · SocketIoTransport    —— 自托管（需先补 Redis Adapter）
// · InMemoryTransport    —— 单实例开发/小型部署
```

**选择方式**：环境变量，而非代码分支。

```bash
REALTIME_TRANSPORT=socketio   # socketio | pusher | memory
MAIL_TRANSPORT=smtp           # smtp | resend | console
STORAGE_DRIVER=minio          # minio | s3 | local
```

## 3. 分模块改造清单

| # | 模块 | 现状证据 | 改造动作 | 工作量 |
|---|---|---|---|---|
| 1 | 数据库 | `@prisma/adapter-pg` + `@prisma/adapter-libsql` 并存 | 统一为 PostgreSQL 单一 adapter；libSQL 作为可选驱动 | 1–2 周 |
| 2 | 实时层 | `pusher` / `pusher-js` 与 `socket.io` 并存；Socket.io Redis Adapter **未实现** | 先补 Redis Adapter（否则无法水平扩展），再抽象为 `RealtimeTransport` | 3–4 周 |
| 3 | 缓存/限流 | `@upstash/redis`（REST 协议） | 改为标准 Redis 客户端 + 接口抽象；**顺手修复架构文档记录的 fail-open 问题** | 1–2 周 |
| 4 | 认证 | `next-auth` + `firebase` / `firebase-admin` | 明确 NextAuth 为主；Firebase 仅保留推送，降为可选 | 2–3 周 |
| 5 | 邮件 | `nodemailer` 直接调用 | 抽为 `MailTransport`（smtp / resend / console）| 1 周 |
| 6 | 对象存储 | 上传直连（`api/upload`）| 抽为存储驱动（minio / s3 / local）| 1–2 周 |
| 7 | 监控 | Sentry 硬绑定 | 抽为可选上报，默认关闭；支持自建兼容端点 | 3–5 天 |
| 8 | 头像 | DiceBear 远程 API | 提供本地默认头像生成，远程服务降为可选 | 2–3 天 |
| 9 | 构建目标 | `@opennextjs/cloudflare` + `wrangler` 参与主构建 | 隔离到独立的 `cf:*` 脚本，不进入默认构建路径 | 2–3 天 |

**小计：约 8–10 周**

## 4. 验收标准

- [ ] 在**没有任何第三方账号**的前提下，`docker compose up -d` 能跑起完整功能（除支付与邮件外）
- [ ] 每个外部依赖都有"自托管实现"与"托管实现"两条路径
- [ ] 切换实现只改环境变量，不改代码
- [ ] `.env.example` 中不预设任何商业服务为默认
- [ ] 架构文档中记录的 5 个红色风险项（限流缺失、连接池缺失、Redis Adapter 未实现、Pusher 生产未配置、fail-open 策略）全部关闭

---

# 第二部分：双聊天系统合并（P1-6）

## 1. 问题

代码库中**并存两套完整的消息系统**：

| 栈 | 表 | 路由 | 特征 |
|---|---|---|---|
| **旧栈（ChatRoom）** | `ChatRoom`、`ChatRoomMember`、`Message` | `api/chat/[id]/messages`、`api/chats` | 偏"群聊/房间"模型 |
| **新栈（IM）** | `Conversation`、`ConversationParticipant`、`IMMessage`、`MessageReceipt`、`MessageReaction`、`UserPresence` | `api/im/send`、`api/im/conversations`、`api/im/presence` | 完整 IM：已读回执、在线状态、输入中、表情回应 |

**共 9 张消息相关表、2 套前端组件（`components/chat/*` 与 IM 组件）。**

### 代价

| 代价 | 说明 |
|---|---|
| 维护成本翻倍 | 每个消息相关改动要做两遍；Bug 要修两处 |
| 数据割裂 | 用户在旧栈的聊天记录不会出现在新栈 |
| 开源后更痛 | 外部贡献者无法判断该改哪一套 → 贡献意愿下降 |
| 多租户改造量翻倍 | 9 张表都要加 `tenantId` |

**结论**：合并应尽量**提前**到多租户改造之前做 —— 合并后再做多租户，工作量直接减半。

### 1.1 实测补充（2026-09-27 阶段 1 盘点）

阶段 1 的静态引用分析得出四条**修正性结论**，已并入 `CHAT-MERGE-AUDIT.md`：

| # | 实测发现 | 对本计划的影响 |
|---|---|---|
| 1 | 线上**只跑旧栈**（`page-content.tsx` → `/api/chat/[id]/messages` 的 ChatRoom 分支）；新栈**无任何页面挂载** | 合并不是"二选一"，而是"把已验证的 UI 外壳换到新数据源" |
| 2 | `IMMessage` 中**几乎只有开场系统消息**，真实用户对话全在 `Message` 表 | 迁移数据面小，**工期从 6–8 周降至 3.5–5 周** |
| 3 | **WebRTC 视频通话从未接线**（唯一引用方是未挂载的 `chat-container.tsx`） | 阶段 4 需额外做「功能补全」而非仅数据切换（D5） |
| 4 | `chat-container.tsx` 混用 socket.io 与 Pusher 两套实时通道，serverless 下不可靠 | **阶段 4 不切换到该 UI**，保留 `page-content` 外壳；socket.io 列入待删 |

**合并方向修正为「方案 A」**：IM 为终局模型，`Message` 存量**反向迁入** `IMMessage`，删除 `Message` / `ChatRoomMember`（42 表 → 39 表）。多租户届时只需给 **5 张**表加 `tenantId`（而非 9 张）。

---

## 2. 合并方案

### 2.1 目标模型：以 IM 为主，ChatRoom 降为"群聊会话"

理由：

- IM 栈**功能更完整**（已读/在线/输入中/回应）—— 竞争分析中也把这一点列为相对 FetLife / Feeld / Recon 的领先项
- `Conversation` + `ConversationParticipant` 的模型天然支持 1:1 与多人，比 `ChatRoom` 更通用
- 旧栈的"房间"语义可以用 `Conversation.type = GROUP` 表达

### 2.2 目标结构

```
Conversation
  ├─ id, tenantId, type (DIRECT | GROUP), title?, createdAt
  ├─ participants: ConversationParticipant[]
  └─ messages:     IMMessage[]
                      ├─ MessageReceipt
                      ├─ MessageReaction
                      └─ attachments
UserPresence  ← 租户内
```

**迁移映射**：

| 旧 | 新 |
|---|---|
| `ChatRoom` | `Conversation`（`type = GROUP`，`title` 取自原房间名）|
| `ChatRoomMember` | `ConversationParticipant` |
| `Message` | `IMMessage`（保留原 `createdAt` 以维持顺序）|

### 2.3 迁移步骤

| 阶段 | 内容 | 工期 | 可回滚 |
|---|---|---|---|
| 1 | 盘点实际用量：统计两套栈各自的活跃会话/消息量 | 2–3 天 | — |
| 2 | 写数据迁移脚本（`ChatRoom*` → `Conversation*`），在副本库上演练 | 1 周 | ✅ |
| 3 | 双写期：新消息同时写入两套栈，验证一致性 | 1 周 | ✅ |
| 4 | 前端统一为 IM 组件，旧组件标记废弃 | 1 周 | ✅ |
| 5 | 停写旧栈、切换读取到新栈、观察 | 3–5 天 | ✅ |
| 6 | 删除旧栈代码与表（保留一个版本周期后再删表）| 3–5 天 | ⚠️ 删表后不可逆 |

**小计：约 3–5 周**

### 2.4 关键风险

| 风险 | 缓解 |
|---|---|
| 迁移丢失消息顺序/附件 | 迁移脚本保留原始 `createdAt` 与附件引用；迁移后做条数与抽样内容比对 |
| 旧栈有 IM 未覆盖的功能 | 阶段 1 的盘点必须先完成，确认无遗漏（例如房间权限、房间级设置）|
| 前端改动引入回归 | 阶段 4 前后都要跑端到端测试 |
| 历史数据量大的迁移窗口 | 分批迁移 + 双写期覆盖，避免长时间停机 |

---

# 优先级建议（重要）

这两部分存在**顺序依赖**，建议这样排：

```
[先] P1-6 双聊天系统合并（3–5 周）
        ↓  消息表从 9 张降到 6 张，多租户改造量减半
[后] P0-2 多租户改造（10–14 周，改造量已缩减）
        ↓
[并行] P0-3 依赖解耦（8–10 周，可与多租户并行）
```

**调整理由**：把聊天系统合并提前到多租户之前，可以让 3 张表免于加 `tenantId`，并且避免"改完多租户又要合并聊天"的二次返工。这是一个**纯收益的排序优化**。

---

*最后更新：2026-09-27*
