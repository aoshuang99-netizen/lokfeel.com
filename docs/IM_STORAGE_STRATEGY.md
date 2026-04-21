# IM Storage Strategy — LokFeel IM Module

## 📋 概述

本文档定义了 LokFeel IM 模块的冷热分层存储策略，确保在保证用户体验的同时优化成本。

## 🏗️ 三层存储架构

```
┌──────────────────────────────────────────────────────────────────┐
│                        STORAGE ARCHITECTURE                       │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐     ┌─────────────────┐                    │
│  │   Redis Cache   │     │  PostgreSQL     │                    │
│  │   (TTL: 5min)   │     │  (Hot: 30 days) │                    │
│  │                 │     │                 │                    │
│  │  • Rules cache  │     │  • Conversations│                    │
│  │  • Presence     │     │  • IMMessages   │                    │
│  │  • Pace state   │     │  • Receipts     │                    │
│  │  • Typing       │     │  • Consent      │                    │
│  │  • Seq counters │     │  • AuditLog     │                    │
│  └─────────────────┘     └────────┬────────┘                    │
│                                   │                              │
│                                   │ Migration Job                │
│                                   │ (30+ day old messages)       │
│                                   ▼                              │
│                          ┌─────────────────┐                    │
│                          │  S3 / Glacier   │                    │
│                          │  (Cold Storage) │                    │
│                          │                 │                    │
│                          │  • Archived msgs│                    │
│                          │  • Exports      │                    │
│                          │  • Audit backup │                    │
│                          └─────────────────┘                    │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## 🟥 Layer 1: Redis (毫秒级访问)

**用途**: 实时状态、临时数据、限流

### 缓存键模式

| 键模式 | TTL | 用途 |
|--------|-----|------|
| `im:presence:{userId}` | 5min | 在线状态 + 心跳 |
| `im:pace:{sender}:{recv}` | 24h | 令牌桶限流 |
| `im:typing:{conv}:{user}` | 5sec | 打字指示器（自动过期） |
| `im:rules:{userId}` | 5min | Power Board 规则缓存 |
| `im:seq:{convId}` | 30d | 序列号计数器 |
| `im:conn:{connId}` | 2h | WebSocket 连接映射 |
| `im:delivery:{userId}` | 1h | 待投递消息队列 |
| `im:consent:{g}:{g}:{t}` | 10min | Consent 授权缓存 |

### 成本估算
- **Upstash Redis**: ~$0.50/月（免费套餐覆盖 10K 命令）

---

## 🟨 Layer 2: PostgreSQL (热数据 - 30天内)

**用途**: 活跃会话数据、可查询消息

### 表结构与保留策略

| 表名 | 保留期 | 说明 |
|------|--------|------|
| `Conversation` | 永久 | 仅活跃会话 |
| `ConversationParticipant` | 永久 | 用户会话状态 |
| `IMMessage` | 30天 | 最近消息（热数据） |
| `MessageReceipt` | 30天 | 投递和已读回执 |
| `ConsentRequest` | 30天 | 待处理/过期请求 |
| `ConsentGrant` | 永久 | 活跃授权 |
| `PowerBoardRule` | 永久 | 用户规则 |
| `AuditLog` | 90天 | 合规审计轨迹 |
| `UserPresence` | 永久 | 最后已知状态 |

### 查询优化索引

```sql
-- IMMessage: 会话内序列号范围扫描
CREATE INDEX idx_immessage_conv_seq ON "IMMessage"(conversationId, seq);

-- MessageReceipt: 用户未读查询
CREATE INDEX idx_receipt_user_read ON "MessageReceipt"(userId, readAt);

-- Conversation: 活跃会话列表
CREATE INDEX idx_conv_state ON "Conversation"(state) WHERE state = 'ACTIVE';

-- AuditLog: 用户历史查询
CREATE INDEX idx_audit_user_time ON "AuditLog"(userId, createdAt);
```

---

## 🟦 Layer 3: S3 / Glacier (冷数据 - 30天+)

**用途**: 长期归档、合规、数据导出

### 迁移作业（每日执行）

```sql
-- 1. 查找30天前的消息
SELECT * FROM "IMMessage"
WHERE createdAt < NOW() - INTERVAL '30 days';

-- 2. 导出到 S3 JSON.gz
-- 3. 标记已归档消息 isArchived = true
-- 4. 7天缓冲期后从 PostgreSQL 硬删除
```

### 冷存储结构

```
s3://lokfeel-im-archive/
└── {convId}/
    ├── 2026-03.json.gz     # 2026年3月消息
    ├── 2026-04.json.gz     # 2026年4月消息
    └── metadata.json       # 会话元数据
```

### 按需检索
- 用户请求旧消息 → API 从 S3 加载 → 返回客户端
- 预期延迟：S3 Standard 1-5秒
- Glacier 检索：1-5分钟

---

## ⏰ 迁移 Cron Job

**调度**: 每天 3:00 AM UTC
**端点**: `POST /api/cron/im-migrate-cold-storage`

### 执行步骤

1. 查找30天前的消息
2. 批量导出到 S3（每次最多100个会话）
3. 在 DB 中标记已导出消息
4. 7天缓冲期后从 PostgreSQL 硬删除
5. 上报统计到监控

```typescript
// 伪代码示例
async function migrateColdStorage() {
  const conversations = await findOldConversations();
  
  for (const conv of conversations.slice(0, 100)) {
    const messages = await getMessagesOlderThan(conv.id, 30);
    await exportToS3(conv.id, messages);
    await markAsArchived(messages);
  }
  
  // 7天后硬删除
  await hardDeleteArchived({ olderThan: 7 });
}
```

---

## ✅ 合规与数据保留

| 法规 | 要求 | 实现 |
|------|------|------|
| **CCPA** | 用户可导出所有数据 | `/api/im/export` 接口 |
| **Crypto-Shred** | 账户删除永久销毁密钥 | 删除时清除加密密钥 |
| **Audit Log** | 90天保留 | 之后归档到 Glacier |
| **Consent Records** | 永久保留 | 法律要求 |
| **Messages** | 热30天 + 冷无限期 | 分层存储 |

---

## 💰 成本估算（3500用户，约100日活）

| 组件 | 月估算 |
|------|--------|
| Upstash Redis | ~$0.50（免费套餐覆盖） |
| Neon PostgreSQL | ~$0.00（免费套餐：0.5GB） |
| S3 Storage | ~$0.10（估算1GB冷数据） |
| S3 Requests | ~$0.01 |
| **总计** | **~$0.61/月** |

---

## 🔧 实现清单

- [x] Prisma Schema 定义（已包含 IM 相关表）
- [x] 存储策略配置 (`lib/im/storage-strategy.ts`)
- [x] 数据库查询函数 (`lib/im/queries.ts`)
- [ ] Cron Job API (`/api/cron/im-migrate-cold-storage`)
- [ ] S3 导出服务
- [ ] 按需检索 API (`/api/im/messages/[id]/restore`)
- [ ] CCPA 数据导出 API (`/api/im/export`)

---

## 📚 相关文档

- [IM Protocol v2](./IM_PROTOCOL_V2.md)
- [Power Board Rule Engine](./RULE_ENGINE_SPEC.md)
- [数据库 Schema](../prisma/schema.prisma)
