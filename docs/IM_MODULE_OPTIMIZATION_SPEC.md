# 美国女性私密社交 App · IM 模块专项优化方案

> **定位**：女性主导、隐私优先、同意驱动的即时通讯系统  
> **对标**：Feeld（传统双向IM） → **本方案**（边界前置+ consent-gated+ 隐私内建）  
> **适用范围**：1v1私聊 / 小群组 / 媒体交互 / 规则同步 / 合规审计  
> **文档版本**：v1.0  
> **最后更新**：2026-04-19

---

## 一、IM 模块设计哲学（IM 升维逻辑）

| Feeld 传统 IM 痛点 | 本方案 IM 优化策略 | 产品价值 |
|-------------------|-------------------|---------|
| 事后举报为主，女性处于被动防御 | 👑 **边界前置**：聊天前即加载女性 Power Board 规则，消息发送前自动校验 | 从"事后补救"到"事前预防" |
| 媒体/隐私泄露风险高 | 🛡️ **渐进披露+加密控制**：媒体分级解锁、阅后即焚、防截屏水印、客户端加密上传 | 降低数字痕迹泄露风险 |
| 消息节奏不可控，易被轰炸 | ⏱️ **动态节律控制**：女性可设回复期望/频率上限，客户端自动冷却+UI提示 | 减少情绪劳动与骚扰焦虑 |
| 合规与审计缺失 | 📜 **同意留痕+CCPA就绪**：所有边界变更、亲密请求、媒体授权生成不可篡改审计日志 | 满足美国州法合规与证据留存 |

---

## 二、通信协议与架构优化（IM 专属）

### 2.1 消息协议扩展（Protobuf v2）

```protobuf
syntax = "proto3";
package lokfeel.im;

// === 枚举定义 ===
enum ConsentState {
  CONSENT_NONE = 0;
  CONSENT_PENDING = 1;
  CONSENT_GRANTED = 2;
  CONSENT_DENIED = 3;
  CONSENT_EXPIRED = 4;
}

enum MediaAccessLevel {
  MEDIA_L0_TEXT = 0;      // 纯文本
  MEDIA_L1_IMAGE = 1;     // 静态图片
  MEDIA_L2_VOICE = 2;     // 语音消息
  MEDIA_L3_VIDEO = 3;     // 视频/实时通话
  MEDIA_L4_LOCATION = 4;  // 位置信息
  MEDIA_L5_CONTACT = 5;   // 联系方式
}

enum RuleEngineResult {
  RULE_PASS = 0;
  RULE_SOFT_BLOCK = 1;    // 建议调整，可覆盖
  RULE_HARD_BLOCK = 2;    // 强制拦截
  RULE_PACE_LIMIT = 3;    // 频率限制
}

enum MessageType {
  MSG_TEXT = 0;
  MSG_IMAGE = 1;
  MSG_VOICE = 2;
  MSG_FILE = 3;
  MSG_SYSTEM = 4;
  MSG_CONSENT_REQUEST = 5;
  MSG_CONSENT_RESPONSE = 6;
  MSG_RULE_UPDATE = 7;
  MSG_TYPING = 8;
  MSG_READ_RECEIPT = 9;
}

// === 核心消息结构 ===
message IMMessage {
  // 基础字段
  string msg_id = 1;
  string sender_id = 2;
  string receiver_id = 3;
  string conv_id = 4;
  int64 seq = 5;
  MessageType msg_type = 6;
  bytes payload = 7;              // E2EE密文或明文
  int64 timestamp = 8;
  
  // === 边界与合规元数据（明文，供规则引擎使用）===
  string boundary_version = 9;           // 当前生效的 Power Board 版本号
  repeated string compliance_tags = 10;  // ["consent_granted", "media_level_2", "pace_ok"]
  ConsentState consent_state = 11;       // 同意状态
  MediaAccessLevel media_level = 12;     // 媒体访问级别
  RuleEngineResult rule_result = 13;     // 规则引擎判定结果
  
  // === 安全与追踪 ===
  string client_msg_id = 14;             // 客户端生成的消息ID（用于去重）
  string reply_to_msg_id = 15;           // 回复消息ID
  bool is_edited = 16;
  int64 edited_at = 17;
  bool is_deleted = 18;
  int64 deleted_at = 19;
  
  // === 扩展字段（未来兼容）===
  map<string, string> metadata = 100;
}

// === 同意请求消息 ===
message ConsentRequest {
  string request_id = 1;
  string requester_id = 2;
  string target_id = 3;
  MediaAccessLevel requested_level = 4;
  string context_msg_id = 5;             // 触发同意请求的消息ID
  string reason = 6;                     // 请求原因（用户可见）
  int64 expires_at = 7;                  // 过期时间戳
  
  enum ConsentType {
    CONSENT_MEDIA = 0;
    CONSENT_LOCATION = 1;
    CONSENT_CONTACT = 2;
    CONSENT_INTIMATE = 3;                // 亲密内容
  }
  ConsentType consent_type = 8;
}

// === 同意响应消息 ===
message ConsentResponse {
  string request_id = 1;
  string responder_id = 2;
  ConsentState decision = 3;
  int64 responded_at = 4;
  string note = 5;                       // 可选备注
  int64 valid_until = 6;                 // 授权有效期（0=永久）
}

// === 规则集定义 ===
message PowerBoardRules {
  string user_id = 1;
  string version = 2;                    // 规则版本号（用于增量同步）
  int64 updated_at = 3;
  
  // 消息频率控制
  message PaceControl {
    int32 max_messages_per_hour = 1;
    int32 max_messages_per_day = 2;
    int32 response_window_hours = 3;     // 期望回复时间窗口
    bool enforce_cooldown = 4;           // 是否强制执行冷却
  }
  PaceControl pace = 4;
  
  // 媒体访问控制
  message MediaPolicy {
    MediaAccessLevel default_level = 1;
    map<string, MediaAccessLevel> per_user_override = 2;  // 对特定用户的覆盖
    bool require_consent_for_upgrade = 3;                 // 升级媒体级别是否需要同意
  }
  MediaPolicy media = 5;
  
  // 内容拦截规则
  message ContentFilter {
    repeated string blocked_keywords = 1;
    bool block_explicit_images = 2;
    bool auto_flag_profanity = 3;
  }
  ContentFilter filter = 6;
  
  // 自动回复设置
  message AutoResponse {
    bool enabled = 1;
    string message_template = 2;
    int32 trigger_after_hours = 3;
  }
  AutoResponse auto_response = 7;
}

// === 会话元数据 ===
message Conversation {
  string conv_id = 1;
  string user_a_id = 2;
  string user_b_id = 3;
  string initiator_id = 4;
  int64 created_at = 5;
  
  // 会话状态
  enum ConvState {
    CONV_ACTIVE = 0;
    CONV_PAUSED = 1;           // 一方暂停
    CONV_BLOCKED = 2;
    CONV_EXPIRED = 3;          // 自动过期（如 Vault 到期）
  }
  ConvState state = 6;
  
  // 女性控制点
  string controlling_user_id = 7;  // 谁拥有此会话的控制权（通常是女性）
  string active_boundary_version = 8;  // 当前生效的规则版本
  
  // 统计
  int64 last_message_at = 9;
  int32 message_count = 10;
  int32 unread_count = 11;
}

// === 审计日志条目 ===
message AuditLogEntry {
  string log_id = 1;
  string user_id = 2;
  string conv_id = 3;
  string action = 4;              // "boundary_changed", "consent_granted", "message_blocked"
  string details = 5;             // JSON 详情
  int64 timestamp = 6;
  string hash_chain = 7;          // 前一个条目的哈希（防篡改）
}
```

### 2.2 IM 架构分层调整

```
┌─────────────────────────────────────────────────┐
│ 客户端 SDK (iOS/Android/Web)                    │
│ • 本地规则校验器 (WASM/原生)                    │
│ • E2EE 密钥管理 (Signal Protocol 变体)          │
│ • 防截屏/水印渲染 + 本地加密存储 (SQLCipher)    │
└───────────────┬─────────────────────────────────┘
                │ TLS 1.3 + WebSocket/QUIC
┌───────────────▼─────────────────────────────────┐
│ 接入网关 (Access Gateway)                       │
│ • 轻量内容过滤 (俚语/显式词库)                  │
│ • 消息频控 (Token Bucket)                       │
│ • 路由转发 + ACK 调度                           │
└───────────────┬─────────────────────────────────┘
                │ gRPC / Kafka
┌───────────────▼─────────────────────────────────┐
│ 规则与同意服务 (Rule & Consent Service)         │
│ • 加载女性 Power Board 版本                     │
│ • 执行合规元数据校验                            │
│ • 生成审计日志 (不可篡改哈希链)                 │
└───────────────┬─────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────┐
│ 消息引擎 & 存储 (Message Engine)                │
│ • 投递队列 (在线直推 / 离线队列)                │
│ • 媒体代理 (预签名上传 + 客户端加密)            │
│ • 冷热分层 (热: Redis / 温: Scylla / 冷: S3)   │
└─────────────────────────────────────────────────┘
```

> 🔑 **架构核心决策**：采用 **混合信任模型（Hybrid Trust）**  
> - 消息正文端到端加密（保护隐私）  
> - 边界元数据、合规标签、同意状态明文可见（支持规则引擎与审计）  
> - 女性可选择"安全模式"（服务器可读，用于高风险场景或法律取证）

---

## 三、Power Board 规则引擎深度集成（IM 核心）

### 3.1 规则注入与同步机制

| 场景 | 触发条件 | 同步方式 | 延迟要求 |
|------|---------|---------|---------|
| 聊天初始化 | 匹配成功/进入会话 | 服务端推送完整 RuleSet JSON | < 200ms |
| 规则动态调整 | 女性修改边界设置 | WebSocket `rule_update` 事件 | < 100ms |
| 断线重连 | 客户端网络恢复 | 携带 `last_boundary_version` 拉取增量 | < 300ms |

### 3.2 消息拦截状态机（客户端+服务端协同）

```
[发送方输入] → 本地规则预检 → 
  ├─ 通过 → 附加合规元数据 → 加密 → 发送
  ├─ 软拦截 (SOFT_BLOCK) → 弹出"调整建议" → 用户修改后重试
  └─ 硬拦截 (HARD_BLOCK) → 阻断发送 + 记录行为分

[接收方网关] → 元数据校验 → 
  ├─ 版本匹配 + 标签合规 → 投递客户端
  ├─ 越权媒体/超频 → 降级显示/延迟投递
  └─ 违规标签 → 拦截 + 触发"尊重指数"扣分

[客户端渲染] → 检查 ConsentState → 
  ├─ GRANTED → 正常展示
  ├─ PENDING → 显示"等待确认"占位符
  └─ DENIED → 替换为"对方未授权此内容"
```

### 3.3 同意门控交互流（Consent Gate）

```
男性发送包含亲密/位置/联系方式的内容 → 
  客户端检测触发词/媒体类型 → 
    弹出 ConsentModal: "对方要求确认后再发送此内容" → 
      点击确认 → 生成 consent_request (msg_type=6) → 发送至服务端 → 
        服务端记录审计日志 → 推送至女性客户端 → 
          女性点击"允许/拒绝" → 更新 consent_state → 
            男性收到状态 → 允许则解密原消息投递 / 拒绝则销毁
```

---

## 四、隐私与安全增强（美国合规+E2EE）

### 4.1 端到端加密适配策略

| 组件 | 实现方案 | 女性控制点 |
|------|---------|-----------|
| 密钥交换 | X3DH + PreKey Bundle（女性主设备为信任根） | 可撤销设备访问权 |
| 群聊加密 | Sender Key 协议 + 管理员密钥分发 | 仅女性能添加成员/修改群规则 |
| 历史同步 | 仅传输加密密文，新设备需主设备授权解密 | 防止"偷偷登录"查看历史 |
| 媒体加密 | 客户端本地 AES-GCM 加密后上传，密钥不落地 | 女性可随时"撤回并销毁"云端副本 |

### 4.2 防截屏与数字水印（iOS/Android 现实适配）

- **iOS 限制**：系统级禁止截屏不可行
- **替代方案**：
  1. 动态不可见水印（用户ID+时间戳哈希，泄露后可溯源）
  2. 截屏/录屏触发系统通知（`UIApplicationUserDidTakeScreenshotNotification`）
  3. 聊天界面叠加半透明"禁止传播"提示层
  4. 法律威慑：用户协议明确授权违约追责（符合加州《反复仇色情法》）

### 4.3 数据生命周期与 CCPA 合规

| 阶段 | 策略 | 合规映射 |
|------|------|---------|
| 生成 | 本地加密存储 + 服务端仅存元数据 | Data Minimization |
| 存储 | 热数据 30天 → 冷数据 180天 → 自动销毁 | Retention Policy |
| 导出 | 一键生成机器可读 JSON（含消息/同意记录/审计日志） | Right to Access |
| 删除 | 用户触发 → 72h 内执行密码学擦除（Crypto-Shred） | Right to Delete |
| 审计 | 所有边界变更/同意/举报上链存证（可选锚定） | Evidence Trail |

---

## 五、反骚扰与动态风控体系（IM 内置）

### 5.1 行为级节律控制

```
女性设置: max_messages_per_hour = 5, response_window = 4h
系统执行:
  • 男性发送第6条 → 客户端置灰输入框 + 显示冷却倒计时
  • 超窗未回复 → 自动标记"低响应"，女性可见提示
  • 连续触发3次 → 触发"尊重指数"降权 + 限制每日 Like 数
```

### 5.2 内容审核三层联动

| 层级 | 执行位置 | 技术 | 延迟 |
|------|---------|------|------|
| L1 实时拦截 | 客户端 SDK | 本地词库 + 规则引擎 | < 10ms |
| L2 网关过滤 | 接入层 | Perspective API + 轻量CNN | < 50ms |
| L3 异步复审 | 审核服务 | 多模态大模型 + 人工队列 | < 15min |

### 5.3 举报与快速响应

- 聊天内长按消息 → `Report` → 预设类别：`骚扰 / 越界 / 虚假 / 违法`
- 自动携带上下文：规则版本、同意状态、男性尊重指数、近10条消息哈希
- 女性专属通道：高优审核队列，15分钟内反馈初步处理结果
- 恶意举报反制：女性滥用举报 → 信任分下降 → 限制规则引擎高级功能

---

## 六、关键技术指标与容量规划

| 指标 | 目标值 | 监控方式 |
|------|--------|---------|
| 消息端到端延迟 P95 | ≤ 300ms（在线） / ≤ 2s（离线唤醒） | OpenTelemetry Trace |
| 规则引擎评估耗时 | ≤ 20ms/条 | Server-side Histogram |
| 投递成功率 | ≥ 99.9% | ACK 对账看板 |
| 拦截准确率 | ≥ 96% | 人工抽检集 + 混淆矩阵 |
| E2EE 会话建立 | ≤ 500ms | Client-side Timing |
| 单集群并发 CCU | 100,000 | 网关连接数 + Redis 状态 |
| 峰值吞吐 | 15,000 msg/s | Kafka Lag + 消费组监控 |

**容量参考（10万活跃用户）**：
- 网关：8 节点 × 4C8G（Go + epoll）
- 规则服务：4 节点 × 2C4G（无状态，水平扩展）
- 消息存储：ScyllaDB 6节点 × 16C64G（月增量 ~2TB）
- 媒体存储：S3 + CloudFront（自动压缩 + Exif 剥离）

---

## 七、研发交付清单（IM 专项）

| 交付物 | 格式 | 负责人 | 验收标准 |
|--------|------|--------|---------|
| `IM_Protocol_v2.proto` | Protobuf 3 | 架构师 | 字段完整，向后兼容，含合规元数据 |
| `Rule_Engine_API.yaml` | OpenAPI 3.0 | 后端 | 支持规则下发/版本控制/审计查询 |
| `IM_Interaction_Flow.fig` | Figma | UX | 含 ConsentGate/冷却态/拦截提示/断网恢复 |
| `E2EE_Security_Spec.md` | Markdown | 安全 | 密钥生命周期、设备授权、密码学擦除流程 |
| `CCPA_Compliance_Checklist.xlsx` | Excel | 法务/产品 | 数据映射、导出/删除接口、审计日志留存策略 |
| `Load_Test_Script.jmx` | JMeter/Gatling | 测试 | 模拟 5万 CCU + 1万 msg/s 压力场景 |

---

## 八、IM 模块迭代路线（3阶段）

| 阶段 | 周期 | 核心交付 | 验收指标 |
|------|------|---------|---------|
| **Phase 1: 基础 IM + 边界控制** | 6周 | 1v1文本/离线/Push + Power Board Lite + 本地规则预检 | 延迟<500ms，规则拦截生效，0数据泄露 |
| **Phase 2: 同意门控 + 媒体安全** | 8周 | Consent Gate / 媒体分级 / 防截屏水印 / E2EE 1v1 | 同意流程完成率>85%，媒体加密上传成功率>99% |
| **Phase 3: 动态风控 + 合规审计** | 6周 | 节律控制 / 尊重指数联动 / CCPA导出删除 / 审核队列 | 骚扰投诉下降40%，合规审计100%覆盖，NPS≥50 |

---

## 九、与现有 LokFeel 架构的集成点

### 9.1 数据模型扩展

```prisma
// 扩展现有 Schema
model Conversation {
  id              String   @id @default(uuid())
  userAId         String
  userBId         String
  initiatorId     String
  
  // IM 模块新增字段
  controllingUserId    String           // 控制权归属（女性）
  activeBoundaryVersion String?         // 当前生效规则版本
  consentState         ConsentState     @default(NONE)
  paceControlEnabled   Boolean          @default(false)
  
  // 统计
  messageCount    Int      @default(0)
  lastMessageAt   DateTime?
  
  messages        Message[]
  auditLogs       AuditLog[]
  
  @@index([userAId, lastMessageAt])
  @@index([userBId, lastMessageAt])
}

model Message {
  id              String   @id @default(uuid())
  conversationId  String
  senderId        String
  
  // IM 模块新增字段
  msgType         MessageType      @default(TEXT)
  mediaLevel      MediaAccessLevel @default(L0_TEXT)
  consentState    ConsentState     @default(NONE)
  ruleResult      RuleResult       @default(PASS)
  boundaryVersion String?
  complianceTags  String[]         // PostgreSQL array
  
  // 内容（加密存储）
  encryptedPayload Bytes?
  
  // 元数据
  clientMsgId     String?
  replyToMsgId    String?
  isEdited        Boolean  @default(false)
  isDeleted       Boolean  @default(false)
  
  createdAt       DateTime @default(now())
  
  conversation    Conversation @relation(fields: [conversationId], references: [id])
  
  @@index([conversationId, createdAt])
  @@index([senderId, createdAt])
}

model PowerBoardRules {
  id          String   @id @default(uuid())
  userId      String   @unique
  version     String   // 语义化版本
  
  // 频率控制
  maxMessagesPerHour   Int      @default(10)
  maxMessagesPerDay    Int      @default(50)
  responseWindowHours  Int      @default(24)
  enforceCooldown      Boolean  @default(false)
  
  // 媒体策略
  defaultMediaLevel    MediaAccessLevel @default(L0_TEXT)
  requireConsentUpgrade Boolean @default(true)
  
  // 内容过滤
  blockedKeywords      String[]
  blockExplicitImages  Boolean  @default(false)
  
  // 自动回复
  autoResponseEnabled  Boolean  @default(false)
  autoResponseTemplate String?
  
  updatedAt   DateTime @updatedAt
  
  @@index([userId])
}

model AuditLog {
  id          String   @id @default(uuid())
  userId      String
  conversationId String?
  action      String   // boundary_changed, consent_granted, message_blocked
  details     Json
  hashChain   String   // 前一个条目的哈希
  createdAt   DateTime @default(now())
  
  conversation Conversation? @relation(fields: [conversationId], references: [id])
  
  @@index([userId, createdAt])
  @@index([action, createdAt])
}

// 枚举定义
enum ConsentState {
  NONE
  PENDING
  GRANTED
  DENIED
  EXPIRED
}

enum MediaAccessLevel {
  L0_TEXT
  L1_IMAGE
  L2_VOICE
  L3_VIDEO
  L4_LOCATION
  L5_CONTACT
}

enum RuleResult {
  PASS
  SOFT_BLOCK
  HARD_BLOCK
  PACE_LIMIT
}

enum MessageType {
  TEXT
  IMAGE
  VOICE
  FILE
  SYSTEM
  CONSENT_REQUEST
  CONSENT_RESPONSE
  RULE_UPDATE
  TYPING
  READ_RECEIPT
}
```

### 9.2 API 路由规划

```
/api/im/
  ├── /conversations          # 会话管理
  │   ├── GET    /           # 列表（含未读数）
  │   ├── POST   /           # 创建会话
  │   ├── GET    /:id        # 会话详情
  │   └── PATCH  /:id/rules  # 更新规则（女性专属）
  │
  ├── /messages               # 消息操作
  │   ├── GET    /:convId    # 历史消息
  │   ├── POST   /           # 发送消息
  │   ├── PATCH  /:id        # 编辑消息
  │   └── DELETE /:id        # 撤回消息
  │
  ├── /consent                # 同意管理
  │   ├── POST   /request    # 发起同意请求
  │   ├── POST   /respond    # 响应同意请求
  │   └── GET    /status     # 查询同意状态
  │
  ├── /rules                  # 规则引擎
  │   ├── GET    /           # 获取当前规则
  │   ├── PUT    /           # 更新规则（女性）
  │   └── POST   /validate   # 预检消息
  │
  └── /audit                  # 审计日志
      ├── GET    /export     # 导出数据（CCPA）
      └── DELETE /account    # 删除账户（Crypto-Shred）
```

### 9.3 WebSocket 事件设计

```typescript
// 服务端 → 客户端 事件
interface ServerEvents {
  'im:message': (msg: IMMessage) => void;
  'im:message:status': (data: { msgId: string; status: 'delivered' | 'read' }) => void;
  'im:rule:update': (rules: PowerBoardRules) => void;
  'im:consent:request': (req: ConsentRequest) => void;
  'im:consent:response': (res: ConsentResponse) => void;
  'im:pace:limit': (data: { cooldownUntil: number; reason: string }) => void;
  'im:typing': (data: { userId: string; convId: string }) => void;
}

// 客户端 → 服务端 事件
interface ClientEvents {
  'im:subscribe': (convId: string) => void;
  'im:unsubscribe': (convId: string) => void;
  'im:send': (msg: Partial<IMMessage>) => void;
  'im:ack': (msgId: string) => void;
  'im:typing': (convId: string) => void;
  'im:read': (convId: string, upToMsgId: string) => void;
}
```

---

## 十、UI/UX 设计规范

### 10.1 设计原则

基于 Impeccable 设计系统，IM 模块遵循以下原则：

1. **女性优先**：所有控制点默认由女性掌握
2. **渐进披露**：复杂功能按需展示，不增加认知负荷
3. **即时反馈**：规则拦截、同意状态变化实时可见
4. **安全可见**：隐私保护状态清晰传达，建立信任

### 10.2 关键交互组件

#### Consent Gate 弹窗

```tsx
// 核心交互组件
interface ConsentGateProps {
  type: 'media' | 'location' | 'contact' | 'intimate';
  onConfirm: () => void;
  onCancel: () => void;
  recipientName: string;
}

// 视觉设计
// - 半透明遮罩（backdrop-blur）
// - 女性头像 + 盾牌图标
// - 明确的"请求同意"文案
// - 二次确认按钮（防误触）
```

#### 冷却状态提示

```tsx
interface PaceLimitIndicatorProps {
  cooldownUntil: Date;
  messagesRemaining: number;
  maxMessages: number;
}

// 视觉设计
// - 渐变进度条显示剩余额度
// - 倒计时动画（沙漏/水滴效果）
// - 温和但明确的文案提示
```

#### 规则同步状态

```tsx
interface RuleSyncStatusProps {
  version: string;
  lastSynced: Date;
  isOnline: boolean;
}

// 视觉设计
// - 微型的盾牌/锁图标
// - 悬停显示详细规则摘要
// - 离线时显示缓存规则状态
```

### 10.3 色彩与主题

```css
/* IM 模块专用色彩变量 */
:root {
  /* 同意状态 */
  --consent-pending: #F59E0B;    /* 琥珀 */
  --consent-granted: #10B981;    /* 翠绿 */
  --consent-denied: #EF4444;     /* 红 */
  
  /* 安全/隐私 */
  --privacy-shield: #6366F1;     /* 靛蓝 */
  --privacy-secure: #06B6D4;     /* 青 */
  --privacy-warning: #F97316;    /* 橙 */
  
  /* 边界控制 */
  --boundary-soft: #FCD34D;      /* 柔黄 */
  --boundary-hard: #DC2626;      /* 深红 */
  --boundary-cool: #93C5FD;      /* 浅蓝 */
}
```

---

## 附录

### A. 术语表

| 术语 | 定义 |
|------|------|
| Power Board | 女性用户的边界控制面板，定义消息频率、媒体访问等规则 |
| Consent Gate | 同意门控，敏感内容发送前需获得对方明确授权 |
| Respect Score | 尊重指数，基于用户行为计算的信任分数 |
| Crypto-Shred | 密码学擦除，通过删除密钥使加密数据永久不可读 |
| Hybrid Trust | 混合信任模型，E2EE 与服务器可读模式的动态切换 |

### B. 合规检查清单

- [ ] CCPA 数据导出接口实现
- [ ] CCPA 数据删除（Crypto-Shred）实现
- [ ] 审计日志不可篡改验证
- [ ] 端到端加密密钥管理审计
- [ ] 第三方内容审核 API 合规评估
- [ ] 用户协议隐私条款更新
- [ ] 数据留存策略自动化执行

### C. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| E2EE 密钥丢失 | 高 | 多设备备份 + 恢复码机制 |
| 规则引擎误判 | 中 | 软拦截 + 人工申诉通道 |
| 性能瓶颈 | 中 | 边缘缓存 + 异步处理 |
| 合规诉讼 | 高 | 完整审计日志 + 法务预审 |

---

> 📌 **IM 模块成功关键**：
> 1. **不把 IM 当通道，当边界执行器**：规则引擎必须深度耦合消息流，而非事后插件
> 2. **隐私与安全不可妥协**：采用混合信任模型，在 E2EE 与合规审计间取得工程平衡
> 3. **女性体验优先设计**：所有拦截、冷却、同意流程必须降低女性认知负荷，而非增加操作步骤
> 4. **美国合规内建**：从协议字段到存储策略，默认满足 CCPA/州法要求，避免后期重构
