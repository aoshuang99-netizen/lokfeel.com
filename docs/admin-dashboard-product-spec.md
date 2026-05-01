# LokFeel 管理后台系统 — 产品规划与系统设计 v1.0

> **文档版本**: v1.0 | **日期**: 2026-04-28 | **作者**: Scout  
> **状态**: Draft — 待评审  
> **目标**: 建立精细化管理后台，覆盖 LokFeel 全部 30+ 数据模型、93 个 API 端点、18 个用户端页面

---

## 一、执行摘要

### 1.1 背景与动机

LokFeel 当前管理后台 (`/admin`) 仅包含 **7 个基础页面**（概览/用户/用户详情/匹配/内容/分析/设置），且功能停留在只读查看和数据导入阶段。随着系统已部署 **30+ Prisma 数据模型**（含 Bot 系统、IM v2、Consent 管理、Power Board 规则引擎、诚意值系统等），需要一个全面的管理后台来支撑精细化运营。

### 1.2 核心目标

| 优先级 | 目标 | 衡量指标 |
|--------|------|----------|
| P0 | 全局监控仪表盘 | 实时数据 <5s 延迟，覆盖 8 大核心指标 |
| P0 | 用户全生命周期管理 | 从注册→Onboarding→活跃→流失，全链路可干预 |
| P0 | 安全与内容审核 | 举报处理 <2h SLA，Bot 异常行为实时告警 |
| P1 | 匹配引擎监控 | 匹配成功率、冲突预警、算法参数可调 |
| P1 | 支付与订阅管理 | 收入追踪、退款处理、套餐配置 |
| P2 | Bot 数字用户管理 | Bot 生命周期、学习效果、行为模拟调控 |
| P2 | 系统配置与权限 | 多管理员、RBAC、操作审计 |

### 1.3 现有系统资产盘点

#### 数据模型 (30+)

| 模块 | 模型 | 数据量级 |
|------|------|----------|
| **认证** | User, Account, Session, VerificationToken | ~3500+ |
| **用户画像** | Profile, BotProfile, BotAvatar | ~3500+ |
| **匹配引擎** | Match, MatchReaction | 增长中 |
| **聊天 (Legacy)** | ChatRoom, ChatRoomMember, Message | — |
| **IM v2** | Conversation, ConversationParticipant, IMMessage, MessageReceipt, MessageReaction, UserPresence | — |
| **同意管理** | ConsentRequest, ConsentGrant | — |
| **规则引擎** | PowerBoardRule, AuditLog | — |
| **支付** | Subscription, Payment | 早期 |
| **诚意值** | SincerityWallet, SincerityTransaction | — |
| **安全** | UserReport, AdminLog, AnalyticsEvent | — |
| **Bot 学习** | BotInteractionLog, BotLearningBatch, BotLearningRecord, BotPreference | — |
| **系统** | SystemConfig | — |

#### API 端点 (93+)

| 模块 | 路由数 | 关键端点 |
|------|--------|----------|
| Admin | 13 | analytics, users, matches, settings, import-users, generate-test-users, cleanup-avatars, fix-bot-users, assign-lady-free |
| Auth | 9 | register (send-code/verify-and-create), login, logout, session |
| User/Profile | 5 | profile CRUD, avatar upload |
| Matching | 6 | matches, discover, auto-match |
| Chat (Legacy) | 4 | chat rooms, messages |
| IM v2 | 9 | conversations, messages, presence, typing, reactions |
| Bot | 6 | bot config, automation, learning |
| Payments | 4 | stripe checkout, webhook, subscription |
| 其他 | 37+ | notifications, reports, sincerity, upload, geo, health, cron, webhooks |

#### 用户端页面 (18)

Dashboard / Onboarding / Matches / Matches[detail] / Discover / Inbox / Chat[roomId] / Profile / Profile[id] / Settings / Subscription / Square / Activity / Notifications / Subscription(cancel/success) / Blocked

---

## 二、系统架构设计

### 2.1 技术栈选型

```
┌─────────────────────────────────────────────────┐
│                 Admin Dashboard                 │
│  Next.js 15 App Router + TypeScript + Tailwind   │
│  shadcn/ui + Recharts (可视化) + Tremor (表格)   │
└─────────────────┬───────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────┐
│              API Layer (BFF)                     │
│  Next.js API Routes + NextAuth v5 (ADMIN role)  │
│  Rate Limiting + Audit Logging (每操作必记录)     │
└─────────────────┬───────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────┐
│              Data Layer                          │
│  Prisma 7 ORM → Neon PostgreSQL                  │
│  Redis (缓存/Session) — 未来                     │
└─────────────────────────────────────────────────┘
```

**设计原则**:
- **Admin API 与 User API 同仓库** — 通过 NextAuth `role: ADMIN/SUPER_ADMIN` 中间件隔离
- **Server Component 优先** — 大部分管理页面为纯 Server Component，减少客户端 JS
- **流式数据** — 仪表盘指标使用 Server-Sent Events (SSE) 或轮询，避免 WebSocket 复杂度
- **操作审计** — 所有写操作必须写入 `AdminLog`，不可绕过

### 2.2 路由规划

```
/admin                          → 仪表盘 (Dashboard)
/admin/users                    → 用户管理 (列表)
/admin/users/[id]               → 用户详情
/admin/users/bots               → Bot 数字用户管理
/admin/users/bots/[id]          → Bot 详情与调控
/admin/users/reports            → 举报管理
/admin/matches                  → 匹配管理
/admin/matches/[id]             → 匹配详情
/admin/matches/engine           → 匹配引擎监控
/admin/chats                    → 聊天监控 (IM v2)
/admin/chats/[conversationId]   → 会话详情
/admin/payments                 → 支付与订阅
/admin/payments/subscriptions   → 订阅管理
/admin/payments/transactions    → 交易记录
/admin/content                  → 内容审核
/admin/content/consent          → 同意请求管理
/admin/content/rules            → 规则引擎监控
/admin/bot-system               → Bot 系统总控
/admin/bot-system/learning      → 学习效果分析
/admin/bot-system/behavior      → 行为模拟配置
/admin/analytics                → 数据分析
/admin/analytics/funnel         → 转化漏斗
/admin/analytics/retention      → 留存分析
/admin/analytics/revenue        → 收入分析
/admin/settings                 → 系统设置
/admin/settings/roles           → 权限管理
/admin/settings/config          → 系统配置
/admin/settings/audit           → 审计日志
/admin/health                   → 系统健康
```

### 2.3 权限模型 (RBAC)

```typescript
// 新增 ADMIN 角色 (扩展现有 UserRole)
enum AdminRole {
  SUPER_ADMIN    // 超管：全部权限 + 角色管理
  ADMIN          // 管理员：用户/匹配/内容/支付
  MODERATOR      // 审核员：举报/内容审核/用户封禁
  ANALYST        // 分析师：只读数据分析
  SUPPORT        // 客服：用户查看 + 基础操作
}

// 权限矩阵
//                  SUPER  ADMIN  MODERATOR  ANALYST  SUPPORT
// 仪表盘            ✓      ✓       ✓          ✓        ✓
// 用户管理(写)       ✓      ✓       ✗          ✗        ✗
// 用户查看(读)       ✓      ✓       ✓          ✓        ✓
// 用户封禁           ✓      ✓       ✓          ✗        ✗
// Bot 管理(写)       ✓      ✓       ✗          ✗        ✗
// 匹配管理(写)       ✓      ✓       ✗          ✗        ✗
// 匹配引擎配置       ✓      ✓       ✗          ✗        ✗
// 聊天监控(读)       ✓      ✓       ✓          ✗        ✓
// 支付/退款          ✓      ✓       ✗          ✗        ✗
// 举报处理           ✓      ✓       ✓          ✗        ✓
// 内容审核           ✓      ✓       ✓          ✗        ✗
// 系统配置           ✓      ✓       ✗          ✗        ✗
// 审计日志           ✓      ✓       ✗          ✓        ✗
// 数据分析           ✓      ✓       ✗          ✓        ✓
// 系统健康           ✓      ✓       ✗          ✓        ✗
```

---

## 三、模块详细设计

### 3.1 P0 — 全局监控仪表盘 `/admin`

**目标**: 一屏掌控全局，数据延迟 <5s

#### 3.1.1 核心指标卡片 (KPI Cards)

| 卡片 | 指标 | 数据源 | 刷新频率 |
|------|------|--------|----------|
| 👥 总用户 | 真实用户 / Bot用户 / 本日新增 | User.isBot + createdAt | 60s |
| 💳 付费用户 | Premium活跃 / Lady Free / 总MRR | Subscription + Payment | 5min |
| 💬 活跃会话 | 进行中Conversation / 今日消息数 | Conversation.state + IMMessage | 60s |
| ❤️ 匹配效果 | 本周匹配数 / 接受率 / 平均分 | Match.status + matchScore | 5min |
| 🚨 待处理 | 未读举报 / 异常Bot / 付款失败 | UserReport + BotInteractionLog + Payment | 30s |
| 📈 增长漏斗 | 注册→Onboarding→Profile→首匹配 | AnalyticsEvent funnel | 5min |

#### 3.1.2 实时趋势图

- **用户注册趋势**: 7/30/90天折线图 (真实 vs Bot 分开)
- **匹配成功率趋势**: 按天展示 accept/(accept+reject+pass+expired)
- **消息活跃度**: 日消息量柱状图 (按小时分布 heatmap)
- **收入趋势**: MRR / 日收入 / 累计收入

#### 3.1.3 告警面板

```
🔴 CRITICAL  — 需立即处理
  - Bot异常行为(3h内匹配拒绝率>80%)
  - 支付失败(连续3次)
  - 数据库连接异常

🟡 WARNING   — 需关注
  - 举报积压(>10条未处理)
  - Bot响应延迟(>60min)
  - 匹配成功率连续3天下降

🟢 INFO      — 信息通知
  - 新版本部署成功
  - 数据备份完成
```

#### 3.1.4 最近活动流 (Activity Feed)

```
[14:32] 用户 alice@email.com 完成Onboarding
[14:28] Bot_B00169 与真实用户建立会话
[14:15] 举报 #rep_42 已处理 — 用户被警告
[13:50] 新匹配: User_A ↔ User_B (score: 87)
[13:30] 支付 $19.99 — User_C 升级 Premium
```

---

### 3.2 P0 — 用户管理 `/admin/users`

#### 3.2.1 用户列表页

**筛选器**:
- 关键词搜索 (邮箱/昵称/ID)
- 角色: 真实用户 / Bot用户
- 性别: Male / Female / Non-binary
- 状态: DRAFT / PENDING_REVIEW / APPROVED / REJECTED / DEACTIVATED / BANNED
- 订阅: Free / Lady Free / Premium
- 注册时间范围
- 是否有举报
- Bot 类型: SEED / SIMULATION / TRAINING / ACTIVE
- Bot 活跃度: GHOST / LOW / MEDIUM / HIGH / FULL

**列表字段**:

| 列 | 说明 | 可排序 |
|----|------|--------|
| 头像 | 40px 缩略图 | — |
| 昵称 | displayName | ✓ |
| 邮箱 | email (脱敏显示) | ✓ |
| 性别 | gender icon | ✓ |
| 年龄 | age | ✓ |
| 状态 | profileStatus badge | ✓ |
| 订阅 | SubscriptionPlan badge | ✓ |
| Bot? | isBot tag | ✓ |
| 匹配数 | sentMatches + receivedMatches count | ✓ |
| 注册时间 | createdAt | ✓ |
| 最后活跃 | lastActivity (从 Presence 推断) | ✓ |
| 操作 | 查看/编辑/封禁/删除 | — |

**批量操作**: 导出 CSV / 批量修改状态 / 批量分配 Lady Free / 批量禁用 Bot

#### 3.2.2 用户详情页 `/admin/users/[id]`

**Tab 1: 基础信息**
```
┌──────────────────────────────────────────┐
│  [头像大图]  昵称: Alice                 │
│              Email: alice@example.com    │
│              ID: user_xxxxx              │
│              Role: USER | ADMIN           │
│              Gender: FEMALE | Age: 28    │
│              Created: 2026-04-20         │
│              Last Active: 2h ago         │
│              Card Verified: ✓            │
│                                          │
│  [编辑] [重置密码] [切换角色] [删除]       │
└──────────────────────────────────────────┘
```

**Tab 2: 关系蓝图 (Profile)**
- 关系目标 (RelationshipGoal)
- 依恋风格 (AttachmentStyle)
- 沟通风格 (CommunicationStyle)
- 冲突解决方式 (ConflictResolution)
- 爱的语言 (LoveLanguage)
- 情绪可用性 (EmotionalAvailability)
- 生命优先级 (LifePriorities — JSON 展示)
- Dealbreakers
- 偏好标签 (selectedTags)
- 匹配偏好 (年龄/性别/距离/地点)
- 职业信息 (occupation/company/industry)
- 地理位置信息

**Tab 3: 订阅与支付**
- 当前套餐 + 状态 + 到期时间
- 支付历史 (Payment 表)
- 诚意值余额 + 等级 + 交易明细 (SincerityWallet + SincerityTransaction)
- 手动调整: 分配/取消 Lady Free、调整诚意值

**Tab 4: 匹配记录**
- 发出/收到的匹配列表 (Match 表)
- 匹配分数分布图
- 反馈汇总 (accept/pass/maybe/block 比例)
- 匹配解释 (matchReason)

**Tab 5: 聊天记录**
- 会话列表 (Conversation 表)
- 消息详情 (IMMessage + Message)
- 在线状态历史 (UserPresence)
- Vault 状态 (vaultStatus/vaultExpiry)

**Tab 6: 安全与举报**
- 发出的举报 (reportsMade)
- 收到的举报 (reportsReceived) — 含详情和处理状态
- AuditLog 中的相关记录
- 设备/IP 信息

**Tab 7: Admin 备注**
- adminNotes (已有字段)
- 内部标签 (需新增字段 `adminTags String[]`)
- 操作历史时间线

#### 3.2.3 Bot 用户管理 `/admin/users/bots`

**独立管理页面**，因为 Bot 用户有大量专属配置:

**列表额外字段**:
- BotType: SEED/SIMULATION/TRAINING/ACTIVE
- ActivityLevel: GHOST/LOW/MEDIUM/HIGH/FULL
- OnlinePattern: MORNING/AFTERNOON/EVENING/NIGHT/...
- 总交互数 / 成功匹配数 / 参与度评分
- isActive 状态 / sleepUntil

**Bot 详情页 `/admin/users/bots/[id]`**:
- 基础信息 (继承用户详情)
- BotProfile 配置: ethnicity/occupation/interests/hobbies/musicGenres/movieGenres
- 行为模拟: onlinePattern/avgResponseTime/maxDailyMatches
- 行为概率 (behaviorConfig JSON)
- 匹配偏好: preferredEthnicities/preferredOccupations/preferredEducation
- 头像管理 (BotAvatar): originalUrl/processedUrl/style/status/useCount
- 学习数据 (BotPreference): 五维偏好向量 + 置信度 + 样本数
- 交互日志 (BotInteractionLog): 按类型/时间筛选
- 学习记录 (BotLearningRecord): 交互类型/结果/上下文
- 学习批次 (BotLearningBatch): 批次号/状态/统计数据

**Bot 批量操作**:
- 批量调整 ActivityLevel
- 批量 sleep/wake
- 批量更新行为配置
- 批量导入新 Bot
- 批量清理不活跃 Bot

---

### 3.3 P0 — 安全与内容审核 `/admin/users/reports`

#### 3.3.1 举报管理

**列表视图**:
- 举报ID / 举报人 / 被举报人 / 原因 / 状态 / 创建时间 / 处理人
- 按状态筛选: PENDING / UNDER_REVIEW / RESOLVED_* / DISMISSED
- 按原因筛选: INAPPROPRIATE_CONTENT / HARASSMENT / FAKE_PROFILE / SPAM / ...

**处理工作流**:
```
PENDING → UNDER_REVIEW → RESOLVED_NO_ACTION
                       → RESOLVED_WARNING (发送警告通知)
                       → RESOLVED_BANNED (封禁用户)
                       → DISMISSED (误报)
```

**处理面板**:
- 查看举报详情 + 关联聊天记录截图
- 查看举报人和被举报人的历史
- 采取行动: 警告 / 临时封禁 / 永久封禁 / 忽略
- 添加 adminNotes
- 自动写入 AdminLog + AuditLog

**SLA 追踪**:
- 举报平均处理时间
- 逾期未处理数量
- 按原因分类的举报趋势

---

### 3.4 P1 — 匹配引擎监控 `/admin/matches/engine`

#### 3.4.1 引擎健康指标

| 指标 | 说明 | 告警阈值 |
|------|------|----------|
| 日匹配量 | 每日生成的匹配总数 | <50 (Day30+) |
| 接受率 | accept / (accept + reject + pass + expired) | <30% 连续3天 |
| 平均匹配分 | matchScore 均值 | <50 |
| 冲突预警率 | 有 conflictWarnings 的匹配占比 | >20% |
| 过期率 | expired / total | >40% |
| Pitch 使用率 | 有 pitchMessage 的匹配占比 | — |

#### 3.4.2 五维兼容性分布

- Attachment Compatibility 直方图
- Communication Compatibility 直方图
- Conflict Resolution Compatibility 直方图
- Values Compatibility 直方图
- Lifestyle Compatibility 直方图
- 总分分布图

#### 3.4.3 匹配质量分析

- **高分手对**: score > 80 但被 reject 的案例 → 算法问题排查
- **低分通过**: score < 40 但被 accept → 隐藏信号发现
- **Bot-User 交互质量**: Bot 与真实用户匹配的接受率对比

#### 3.4.4 匹配漏斗

```
总用户池 → 符合偏好筛选 → 评分排序 → 推荐展示 → 查看详情 → 发起匹配 → 接受匹配 → 开始聊天
```

#### 3.4.5 引擎参数配置 (需 SUPER_ADMIN)

```json
{
  "matchingEngine": {
    "weeklyMatchLimit": { "FREE": 3, "LADY_FREE": 5, "PREMIUM": 10 },
    "matchExpiryDays": 7,
    "minMatchScore": 30,
    "boostScoreThreshold": 70,
    "conflictWarningThreshold": 60,
    "botMatchRatio": 0.7,
    "sameGenderMatching": false,
    "ageRangeFlexibility": 5
  }
}
```

---

### 3.5 P1 — 聊天监控 `/admin/chats`

#### 3.5.1 会话列表

- 会话ID / 参与者A / 参与者B / 状态 / 消息数 / 最后消息时间 / Vault 状态
- 筛选: 状态(ACTIVE/PAUSED/BLOCKED/EXPIRED)、含 Bot、有举报、Vault 活跃中

#### 3.5.2 会话详情 `/admin/chats/[conversationId]`

- 参与者信息摘要
- 完整消息时间线 (含已删除消息的标记)
- 媒体文件列表 (IMAGE 类型消息)
- Consent 状态流 (ConsentRequest + ConsentGrant 时间线)
- Vault 状态与时间线 (vaultStatus 变更记录)
- Power Board Rule 配置查看 (双方)
- Rate Limiting 状态 (是否触发 PACE_LIMIT)
- AuditLog 中的相关条目

#### 3.5.3 敏感词监控

- 基于 PowerBoardRule.filterConfig 的关键词匹配
- 实时检测违规消息 (标记 ruleResult = HARD_BLOCK)
- 按严重程度排序的违规消息列表

---

### 3.6 P1 — 支付与订阅管理 `/admin/payments`

#### 3.6.1 收入仪表盘

| 指标 | 说明 |
|------|------|
| MRR | 月经常性收入 |
| ARR | 年化收入 |
| 日/周/月收入 | 趋势图 |
| 付费转化率 | Premium / 总活跃用户 |
| ARPU | 每用户平均收入 |
| Churn Rate | 月退订率 |
| LTV | 用户生命周期价值 |

#### 3.6.2 订阅管理

- 订阅列表: 用户/套餐/状态/开始时间/到期时间/Stripe ID
- 手动操作: 升级/降级/取消/延长/退款
- Lady Free 批量分配: 按条件筛选 → 一键分配
- Stripe 同步状态检查

#### 3.6.3 交易记录

- 全部 Payment 记录: ID/用户/金额/货币/状态/Stripe PI/时间
- 退款处理: 发起退款 + 记录原因
- 失败交易重试

---

### 3.7 P2 — Bot 系统总控 `/admin/bot-system`

#### 3.7.1 Bot 集群概览

| 维度 | 指标 |
|------|------|
| 总量 | 按 BotType 分布 (SEED/SIMULATION/TRAINING/ACTIVE) |
| 活跃度 | 按 ActivityLevel 分布 |
| 在线模式 | 按 OnlinePattern 分布 |
| 种族分布 | 按 Ethnicity 分布 |
| 性别比例 | Bot 男/女/非二元 |
| 头像覆盖率 | 有 processedUrl 的比例 |

#### 3.7.2 学习效果分析

- **BotPreference 分布**: 五维偏好向量的均值/标准差/分布图
- **学习置信度**: 按 sampleSize 分段的 confidence 分布
- **学习批次历史**: BotLearningBatch 列表 + 执行结果
- **A/B 效果**: 接受率对比 (学习前 vs 学习后)
- **群体智慧**: 成功模式识别 (哪些偏好组合接受率最高)

#### 3.7.3 行为模拟配置

**全局配置** (通过 SystemConfig):
```json
{
  "botSystem": {
    "globalResponseDelay": { "min": 15, "max": 120 },
    "dailyMatchLimit": 5,
    "pitchGenerationEnabled": true,
    "autoReplyEnabled": true,
    "learningEnabled": true,
    "learningBatchInterval": "24h",
    "sleepSchedule": { "start": "01:00", "end": "06:00" }
  }
}
```

**行为概率模板**:
```json
{
  "matchAcceptProbability": 0.6,
  "messageInitiateProbability": 0.8,
  "responseProbability": 0.9,
  "conversationContinueProbability": 0.7,
  "profileViewProbability": 0.5
}
```

---

### 3.8 P2 — 同意管理与规则引擎 `/admin/content/consent` & `/admin/content/rules`

#### 3.8.1 同意请求监控

- 待处理 ConsentRequest 列表
- 同意率统计 (GRANTED / DENIED / EXPIRED)
- 按 ConsentRequestType 分布 (MEDIA/LOCATION/CONTACT/INTIMATE)
- 按 MediaAccessLevel 升级请求分布

#### 3.8.2 规则引擎监控

- PowerBoardRule 覆盖率 (有多少用户配置了)
- 规则触发统计: PASS / SOFT_BLOCK / HARD_BLOCK / PACE_LIMIT 分布
- 高频 BLOCK 用户 (被 BLOCK 次数最多的用户)
- Pace Control 生效统计

---

### 3.9 P2 — 数据分析 `/admin/analytics`

#### 3.9.1 转化漏斗 `/admin/analytics/funnel`

```
访问 Landing → 注册账号 → 邮箱验证 → 开始 Onboarding → 完成 Onboarding
→ 首次匹配 → 首次消息 → 首次匹配接受 → 付费转化
```

- 每步转化率 + 总体转化率
- 按时间段对比
- 按来源渠道拆分 (UTM 参数)

#### 3.9.2 留存分析 `/admin/analytics/retention`

- D1/D7/D30 留存率
- 留存曲线 (Cohort 热力图)
- 按用户特征拆分 (性别/订阅/年龄)
- Bot vs 真实用户对比

#### 3.9.3 收入分析 `/admin/analytics/revenue`

- MRR/ARR 趋势
- 收入来源拆分: Premium Monthly / Premium Yearly
- LTV by Cohort
- Churn 分析: 退订原因分布
- 诚意值经济系统: 总发放量 / 总消费量 / 流通速度

---

### 3.10 P2 — 系统设置 `/admin/settings`

#### 3.10.1 角色管理 `/admin/settings/roles`

- 管理员列表 + 角色分配
- 新增/移除管理员
- 角色权限矩阵配置

#### 3.10.2 系统配置 `/admin/settings/config`

基于 `SystemConfig` 表的 Key-Value 管理:

| Key | 说明 | 类型 |
|-----|------|------|
| `matching.weekly_limit_free` | 免费用户每周匹配数 | int |
| `matching.weekly_limit_lady_free` | Lady Free 每周匹配数 | int |
| `matching.weekly_limit_premium` | Premium 每周匹配数 | int |
| `matching.min_score` | 最低匹配分数 | int |
| `matching.bot_ratio` | Bot 匹配比例 | float |
| `bot.global_response_delay` | Bot 全局响应延迟范围 | json |
| `bot.learning_enabled` | 是否启用学习 | boolean |
| `bot.auto_reply_enabled` | 是否启用自动回复 | boolean |
| `subscription.lady_free_auto_assign` | Lady Free 自动分配条件 | json |
| `sincerity.earning_rates` | 诚意值赚取倍率 | json |
| `sincerity.tier_thresholds` | 等级门槛 | json |
| `content.max_report_stale_hours` | 举报处理 SLA | int |
| `notification.weekly_digest_enabled` | 周报推送开关 | boolean |
| `system.maintenance_mode` | 维护模式 | boolean |

#### 3.10.3 审计日志 `/admin/settings/audit`

- AdminLog 全量查询
- 按 admin / action / targetType / 时间范围筛选
- 操作详情展开 (details JSON)
- IP + UserAgent 信息
- 导出功能

---

### 3.11 系统健康 `/admin/health`

| 检查项 | 指标 | 告警 |
|--------|------|------|
| 数据库 | 连接延迟 / 查询时间 P95 / 空间使用 | >500ms / >5s / >80% |
| API | 错误率 / 响应时间 P95 / QPS | >1% / >2s / — |
| Vercel | Deploy 状态 / Edge Function 延迟 | Failed / >500ms |
| Neon | 存储使用 / Connection Pool | >80% / >80% |
| Pusher | 连接数 / 消息吞吐 | — / — |
| Stripe | Webhook 投递成功率 | <99% |
| Resend | 邮件发送成功率 / 延迟 | <95% / >5s |
| Cron | 定时任务执行状态 | Failed |

---

## 四、API 设计规范

### 4.1 Admin API 路由前缀

所有管理后台 API 统一前缀: `/api/admin/*`

### 4.2 认证与鉴权中间件

```typescript
// middleware.ts
export async function isAdmin(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return false;
  
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { role: true }
  });
  
  return user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
}

// 权限检查
export function hasPermission(role: AdminRole, permission: string): boolean {
  return PERMISSION_MATRIX[role]?.includes(permission) ?? false;
}
```

### 4.3 Admin API 端点规划

#### 用户管理
```
GET    /api/admin/users              → 列表 (分页+筛选)
GET    /api/admin/users/[id]         → 详情
PATCH  /api/admin/users/[id]         → 更新
DELETE /api/admin/users/[id]         → 删除
POST   /api/admin/users/[id]/ban     → 封禁
POST   /api/admin/users/[id]/unban   → 解封
PATCH  /api/admin/users/[id]/role    → 修改角色
POST   /api/admin/users/[id]/reset-password → 重置密码
POST   /api/admin/users/[id]/assign-lady-free → 分配 Lady Free

GET    /api/admin/users/bots         → Bot 列表
GET    /api/admin/users/bots/[id]    → Bot 详情
PATCH  /api/admin/users/bots/[id]    → 更新 Bot 配置
POST   /api/admin/users/bots/batch   → 批量操作
POST   /api/admin/users/bots/import  → 导入新 Bot
```

#### 匹配管理
```
GET    /api/admin/matches            → 列表
GET    /api/admin/matches/[id]       → 详情
PATCH  /api/admin/matches/[id]       → 更新 (审核/取消)
DELETE /api/admin/matches/[id]       → 删除
GET    /api/admin/matches/engine/stats → 引擎统计
GET    /api/admin/matches/engine/config → 引擎配置
PUT    /api/admin/matches/engine/config → 更新引擎配置
```

#### 聊天监控
```
GET    /api/admin/chats              → 会话列表
GET    /api/admin/chats/[id]         → 会话详情 + 消息
DELETE /api/admin/chats/[id]/messages/[msgId] → 删除消息
GET    /api/admin/chats/sensitive    → 敏感词命中列表
```

#### 举报管理
```
GET    /api/admin/reports            → 列表
GET    /api/admin/reports/[id]       → 详情
PATCH  /api/admin/reports/[id]       → 处理 (更新状态+行动)
POST   /api/admin/reports/batch      → 批量处理
```

#### 支付管理
```
GET    /api/admin/payments/subscriptions → 订阅列表
PATCH  /api/admin/payments/subscriptions/[id] → 更新订阅
POST   /api/admin/payments/subscriptions/[id]/cancel → 取消
POST   /api/admin/payments/subscriptions/[id]/refund → 退款
GET    /api/admin/payments/transactions → 交易列表
GET    /api/admin/payments/revenue      → 收入统计
```

#### 分析
```
GET    /api/admin/analytics/overview    → 全局概览数据
GET    /api/admin/analytics/funnel      → 转化漏斗
GET    /api/admin/analytics/retention   → 留存数据
GET    /api/admin/analytics/revenue     → 收入分析
GET    /api/admin/analytics/matching    → 匹配分析
GET    /api/admin/analytics/bot         → Bot 分析
```

#### 系统管理
```
GET    /api/admin/settings/config       → 配置列表
PUT    /api/admin/settings/config/[key] → 更新配置
GET    /api/admin/settings/audit        → 审计日志
GET    /api/admin/settings/roles        → 角色列表
POST   /api/admin/settings/roles        → 新增管理员
DELETE /api/admin/settings/roles/[id]   → 移除管理员
GET    /api/admin/health                → 健康检查
```

---

## 五、数据库变更

### 5.1 需要新增的表/字段

```prisma
// 1. AdminProfile — 管理员扩展信息
model AdminProfile {
  id          String   @id @default(cuid())
  userId      String   @unique
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  adminRole   AdminRole @default(ADMIN)
  permissions String[]  @default([])  // 精细权限列表
  department  String?  // "operations", "safety", "growth"
  
  lastLoginAt DateTime?
  loginCount  Int      @default(0)
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

// 2. 扩展 User 表
// 新增字段:
adminTags    String[]  @default([])  // 内部标签
loginHistory String?   @db.Text      // JSON: [{ip, device, time}]

// 3. 扩展 UserReport 表
priority     Int       @default(0)   // 优先级 (0=普通, 1=紧急, 2=紧急)
assignedTo   String?                 // 分配给的管理员

// 4. AlertRule — 告警规则配置
model AlertRule {
  id          String   @id @default(cuid())
  name        String
  description String?
  
  // 触发条件
  metric      String   // "bot_reject_rate", "payment_failure", etc.
  operator    String   // "gt", "lt", "eq", "gte", "lte"
  threshold   Float
  window      String   // "1h", "3h", "24h", "7d"
  
  // 通知
  severity    String   @default("WARNING")  // CRITICAL, WARNING, INFO
  enabled     Boolean  @default(true)
  channels    String[] @default(["admin_dashboard"])  // admin_dashboard, email, webhook
  
  // 状态
  lastTriggeredAt DateTime?
  triggerCount    Int  @default(0)
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

// 5. Alert — 告警记录
model Alert {
  id          String   @id @default(cuid())
  ruleId      String?
  rule        AlertRule? @relation(fields: [ruleId], references: [id])
  
  severity    String
  title       String
  description String   @db.Text
  metric      String
  value       Float
  threshold   Float
  
  status      String   @default("ACTIVE")  // ACTIVE, ACKNOWLEDGED, RESOLVED
  acknowledgedBy String?
  acknowledgedAt DateTime?
  resolvedAt     DateTime?
  resolution     String? @db.Text
  
  createdAt DateTime @default(now())
}

// 6. 新增 Enum
enum AdminRole {
  SUPER_ADMIN
  ADMIN
  MODERATOR
  ANALYST
  SUPPORT
}
```

---

## 六、UI/UX 设计规范

### 6.1 布局结构

```
┌──────────────────────────────────────────────────────────┐
│  [Logo] LokFeel Admin        [搜索]  [通知🔔]  [Admin▾]  │
├────────┬─────────────────────────────────────────────────┤
│        │                                                 │
│  📊    │   Page Header (面包屑 + 标题 + 操作按钮)         │
│  仪表盘 │   ─────────────────────────────────────────────  │
│        │                                                 │
│  👥    │   Filter Bar (筛选器 + 搜索)                     │
│  用户   │   ─────────────────────────────────────────────  │
│   ├ Bot │                                                 │
│   └ 举报 │   Main Content Area                            │
│        │   (表格 / 图表 / 详情面板)                       │
│  ❤️    │                                                 │
│  匹配   │                                                 │
│   └ 引擎 │                                                 │
│        │                                                 │
│  💬    │                                                 │
│  聊天   │                                                 │
│        │                                                 │
│  💳    │                                                 │
│  支付   │                                                 │
│        │                                                 │
│  📋    │                                                 │
│  内容   │                                                 │
│   ├ 同意 │                                                 │
│   └ 规则 │                                                 │
│        │                                                 │
│  🤖    │                                                 │
│  Bot系统│                                                 │
│   ├ 学习 │                                                 │
│   └ 行为 │                                                 │
│        │                                                 │
│  📈    │                                                 │
│  分析   │                                                 │
│        │                                                 │
│  ⚙️    │                                                 │
│  设置   │                                                 │
│        │                                                 │
└────────┴─────────────────────────────────────────────────┘
```

### 6.2 设计系统

- **组件库**: shadcn/ui (与现有 admin 页面一致)
- **图表库**: Recharts (折线/柱状) + Tremor (KPI 卡片/表格)
- **主题**: 复用 Warm Sand v4 设计系统 (OKLCH 色彩)
- **响应式**: 桌面优先 (管理后台不需要移动端)
- **深色模式**: 支持 (可选)
- **表格**: Tremor Table — 排序/筛选/分页/虚拟滚动
- **图表**: 交互式 tooltip + 时间范围选择器 + 数据导出

### 6.3 交互规范

- **删除操作**: 二次确认弹窗 + 输入目标名称确认
- **批量操作**: 勾选 → 操作栏浮现 → 确认 → 执行 + 进度提示
- **筛选器**: URL 参数同步 (可分享链接)
- **导出**: CSV/JSON 格式 + 日期范围
- **实时数据**: 仪表盘指标 60s 自动刷新，可手动暂停

---

## 七、实施路线图

### Phase 1: 基础框架 + P0 模块 (Week 1-2)

```
Sprint 1.1 (3天):
  [x] Admin 路由骨架 + 布局组件 + 认证中间件
  [x] 用户列表页 (筛选/排序/分页)
  [x] 用户详情页 (基础信息 + Profile + 订阅)
  
Sprint 1.2 (3天):
  [x] 全局仪表盘 (KPI 卡片 + 趋势图 + 活动流)
  [x] 举报管理列表 + 处理工作流
  
Sprint 1.3 (4天):
  [x] Admin API 层 (用户/举报/仪表盘数据)
  [x] Prisma migration (AdminProfile/AdminRole/AdminLog增强)
  [x] 操作审计集成 (所有写操作写入 AdminLog)
```

### Phase 2: P1 模块 (Week 3-4)

```
Sprint 2.1 (3天):
  [x] 匹配管理列表 + 详情 + 引擎监控面板
  [x] 匹配质量分析 (高分手对/低分通过)
  
Sprint 2.2 (3天):
  [x] 聊天监控列表 + 会话详情
  [x] 敏感词监控面板
  
Sprint 2.3 (4天):
  [x] 支付管理 (收入仪表盘 + 订阅管理 + 交易记录)
  [x] 退款处理流程
```

### Phase 3: P2 模块 (Week 5-6)

```
Sprint 3.1 (3天):
  [x] Bot 系统总控面板 + Bot 详情页
  [x] Bot 批量操作 (导入/调整/清理)
  
Sprint 3.2 (3天):
  [x] Bot 学习效果分析面板
  [x] 同意管理 + 规则引擎监控
  
Sprint 3.3 (4天):
  [x] 数据分析 (漏斗/留存/收入)
  [x] 系统设置 (配置/角色/审计)
  [x] 系统健康检查面板
```

### Phase 4: 优化与安全 (Week 7-8)

```
Sprint 4.1:
  [ ] 告警系统 (AlertRule + Alert + 通知)
  [ ] 性能优化 (虚拟滚动/缓存/懒加载)
  [ ] E2E 测试 (Playwright 管理后台测试套件)
  
Sprint 4.2:
  [ ] 安全审计 (XSS/CSRF/SQL注入检查)
  [ ] 日志增强 (结构化日志 + 搜索)
  [ ] 文档完善 (Admin 使用手册)
```

---

## 八、非功能需求

### 8.1 性能

| 场景 | 目标 |
|------|------|
| 仪表盘首屏加载 | <2s (Server Component) |
| 用户列表 (1000条) | <1s |
| 搜索响应 | <500ms |
| 批量操作 (100条) | <10s |
| 图表渲染 | <500ms |

### 8.2 安全

- 所有 Admin API 强制 NextAuth `ADMIN/SUPER_ADMIN` 角色校验
- 操作审计不可删除，仅可追加
- 敏感操作（删除/封禁/退款）需二次确认
- Rate Limiting: 100 req/min per admin
- CSRF 保护: NextAuth 内置
- 数据导出: 脱敏 (邮箱/手机号部分隐藏)

### 8.3 可用性

- 页面级错误边界 (Error Boundary)
- API 失败自动重试 (1次) + 友好错误提示
- 空状态引导 (No Data Placeholder)
- 骨架屏加载 (已有 Skeleton 基础设施)
- 键盘快捷键 (Cmd+K 全局搜索)

---

## 九、风险与依赖

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Neon 512MB 限制 | 管理后台查询可能超时 | 增加 readonly replica / 优化查询 |
| 现有 Admin API 不完整 | 需要大量新 API | 分阶段开发，复用已有端点 |
| Bot 数据量大 (3500+) | 列表查询慢 | 分页 + 索引优化 + 游标分页 |
| 单人开发 | 交付周期长 | P0 优先，P2 可延后 |
| 管理后台无移动端需求 | — | 桌面优先，省去响应式成本 |

---

## 附录 A: 现有 Admin 页面审计

| 页面 | 路径 | 文件大小 | 当前功能 | 需增强 |
|------|------|----------|----------|--------|
| 概览 | `/admin` | 7.59KB | 基础统计 | ✅ 全面重做 |
| 用户列表 | `/admin/users` | 8.76KB | 列表+搜索 | ✅ 筛选/排序/分页 |
| 用户详情 | `/admin/users/[id]` | 8.66KB | 基本信息 | ✅ Tab化/全维度 |
| 匹配 | `/admin/matches` | 7.61KB | 列表 | ✅ 详情/引擎监控 |
| 内容 | `/admin/content` | 6.91KB | 基础 | ✅ 同意/规则 |
| 分析 | `/admin/analytics` | 7.20KB | 基础图表 | ✅ 漏斗/留存 |
| 设置 | `/admin/settings` | 8.91KB | 配置 | ✅ 角色/审计 |

## 附录 B: 数据模型关系图 (简化)

```
User ──────────────────────────────────────────────────
  ├── Profile (1:1)
  │     ├── BotProfile (1:1, optional)
  │     ├── BotAvatar (1:1, optional)
  │     ├── SincerityWallet (1:1, optional)
  │     └── SincerityTransaction[] (1:N)
  ├── Subscription[] (1:N)
  ├── Payment[] (1:N)
  ├── Match[] (sent + received, 1:N)
  ├── Conversation[] (userA + userB, 1:N)
  ├── IMMessage[] (1:N)
  ├── UserPresence (1:1)
  ├── PowerBoardRule (1:1)
  ├── ConsentRequest[] (requester + target, 1:N)
  ├── ConsentGrant[] (granter + grantee, 1:N)
  ├── UserReport[] (reportsMade + reportsReceived, 1:N)
  ├── Notification[] (1:N)
  ├── AnalyticsEvent[] (1:N)
  └── AuditLog[] (1:N)

Match ────────────────────────────────────────────────
  ├── MatchReaction[] (1:N)
  ├── ChatRoom (1:1, optional)
  └── BotInteractionLog[] (1:N, via matchId)

Conversation ──────────────────────────────────────────
  ├── ConversationParticipant[] (1:N)
  ├── IMMessage[] (1:N)
  ├── MessageReceipt[] (1:N, via IMMessage)
  ├── MessageReaction[] (1:N, via IMMessage)
  ├── ConsentRequest[] (1:N)
  ├── ConsentGrant[] (1:N)
  └── ChatRoom (1:1, optional, migration)

BotLearningBatch ──────────────────────────────────────
  └── (independent, linked via BotInteractionLog data)

BotPreference ─────────────────────────────────────────
  └── (per-bot, 1:1)

SystemConfig ──────────────────────────────────────────
  └── (global KV store)
```

---

> **下一步**: 评审本文档 → 确认优先级 → 开始 Phase 1 开发
