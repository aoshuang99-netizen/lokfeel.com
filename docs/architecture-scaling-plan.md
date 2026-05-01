# LokFeel 架构合理性分析 & 百万级扩容方案

> **日期**: 2026-04-29 | **版本**: v1.0 | **作者**: Scout (AI架构审计)  
> **目标**: 分析当前架构合理性、数据交互性能瓶颈，提供从7K→1M用户的渐进式扩容路径

---

## 目录

1. [执行摘要](#1-执行摘要)
2. [当前架构全景](#2-当前架构全景)
3. [架构合理性评估](#3-架构合理性评估)
4. [数据交互性能分析](#4-数据交互性能分析)
5. [关键风险与瓶颈](#5-关键风险与瓶颈)
6. [百万级扩容方案](#6-百万级扩容方案)
7. [数据库专项扩容](#7-数据库专项扩容)
8. [实时通信专项扩容](#8-实时通信专项扩容)
9. [成本预估](#9-成本预估)
10. [实施路线图](#10-实施路线图)

---

## 1. 执行摘要

### 评分卡

| 维度 | 当前评分 | 目标评分 | 差距 |
|------|----------|----------|------|
| 架构合理性 | 6.5/10 | 9/10 | 中等 |
| 数据交互性能 | 4/10 | 9/10 | 🔴 严重 |
| 水平扩展能力 | 3/10 | 9/10 | 🔴 严重 |
| 数据库承载能力 | 3/10 | 9/10 | 🔴 严重 |
| 实时通信可靠性 | 4/10 | 9/10 | 🔴 严重 |
| 安全/限流防护 | 3/10 | 9/10 | 🔴 严重 |
| 缓存架构 | 7/10 | 9/10 | 轻微 |

### 核心结论

**当前架构可支撑 ~5,000 DAU，距百万级有 3 个数量级差距。** 主要瓶颈：

1. 🔴 **Neon 免费版 512MB** — 7K用户已达290MB，无法支撑10K+
2. 🔴 **无连接池配置** — PrismaPg 直连模式，Vercel Serverless下每请求可能建新连接
3. 🔴 **Socket.io Redis Adapter 未实现** — 无法水平扩展
4. 🔴 **Pusher 生产环境未配置** — Vercel部署下实时通信失效
5. 🔴 **无HTTP层限流** — 93个API端点完全暴露
6. 🟡 **Fail-open策略** — Redis故障时消息限流/规则引擎全部放行

---

## 2. 当前架构全景

### 2.1 技术栈

```
┌─────────────────────────────────────────────────────────────┐
│                    LokFeel Architecture                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Client (React 19 + Next.js 15 App Router)                  │
│    ├── NextAuth v5 (JWE/JWT)                                │
│    ├── Pusher Client (实时 — 生产环境未配置 ❌)               │
│    └── Socket.io Client (自部署备用)                         │
│                                                              │
│  API Layer (Vercel Serverless Edge)                          │
│    ├── 93 Route Handlers                                     │
│    ├── Middleware (仅Geo屏蔽，无Auth ❌)                      │
│    └── No Rate Limiting (❌)                                 │
│                                                              │
│  Data Layer                                                  │
│    ├── Prisma 7 + @prisma/adapter-pg                         │
│    │   └── PrismaPg (直连，无连接池参数 ❌)                   │
│    ├── Neon PostgreSQL (免费版 512MB ❌)                      │
│    └── Upstash Redis (REST API，有限流缓存 ✅)               │
│                                                              │
│  Real-time                                                   │
│    ├── Socket.io + server.ts (自部署 ✅)                     │
│    │   └── Redis Adapter: TODO/未实现 ❌                     │
│    ├── Pusher (Vercel部署方案 — 未配置 ❌)                   │
│    └── Native WebSocket (ws, 备用)                           │
│                                                              │
│  Storage                                                     │
│    ├── Redis (热数据: presence/pace/rules/typing)             │
│    ├── PostgreSQL (30天热数据)                                │
│    └── S3/Glacier (30天+冷数据 — 规划中，未实现)             │
│                                                              │
│  External Services                                           │
│    ├── Stripe (支付)                                         │
│    ├── Resend (邮件)                                        │
│    └── OpenAI (AI辅助)                                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 数据模型规模

| 分类 | 模型数 | 核心模型 |
|------|--------|----------|
| Bot System | 6 | BotProfile, BotInteractionLog, BotLearningBatch/Record, BotPreference, BotAvatar |
| Auth | 4 | User, Account, Session, VerificationToken |
| Profile | 1 | Profile (含五维偏好+相册+验证) |
| Matching | 2 | Match, MatchReaction |
| Legacy Chat | 3 | ChatRoom, ChatRoomMember, Message |
| IM Module | 8 | Conversation, ConversationParticipant, IMMessage, MessageReceipt, MessageReaction, UserPresence, ConsentRequest, ConsentGrant |
| Power Board | 2 | PowerBoardRule, AuditLog |
| Notification | 1 | Notification |
| Payment | 2 | Subscription, Payment |
| Admin | 2 | AdminLog, AnalyticsEvent |
| Sincerity | 2 | SincerityWallet, SincerityTransaction |
| Safety | 1 | UserReport |
| System | 1 | SystemConfig |
| **合计** | **35** | — |

### 2.3 API 端点分布

| 模块 | 端点数 | 关键路径 |
|------|--------|----------|
| Auth | 7 | /register (14.5KB), /login, /verify |
| Matching | 7 | /matches/inbox (10.9KB), /matches/react, /matching/enhanced |
| Chat (Legacy) | 4 | /chat/[id]/messages (16.2KB!) |
| IM Module | 8 | /im/send, /im/conversations, /im/consent |
| Bot | 4 | /bot/chat, /cron/bot-* |
| Admin | 8 | /admin/users, /admin/matches, /admin/import-users |
| Payment | 5 | /payments/checkout, /webhooks/stripe |
| Profile | 2 | /profile, /upload |
| Rules | 4 | /rules/check, /rules/[userId] |
| Sincerity | 2 | /sincerity/earn, /sincerity/wallet |
| 其他 | 10 | /health, /discover, /notifications... |
| **合计** | **93** | — |

---

## 3. 架构合理性评估

### 3.1 ✅ 合理的设计

| 设计 | 评价 |
|------|------|
| **Next.js App Router + Server Components** | 适合内容驱动页面，减少客户端JS |
| **Prisma 7 + adapter-pg** | 类型安全，减少SQL注入风险 |
| **Upstash Redis REST API** | Vercel Serverless友好，无TCP连接开销 |
| **Token Bucket限流** | 数学模型正确，渐进冷却策略合理 |
| **Power Board 4阶段评估** | 架构清晰：Pace→Media→Content→Consent |
| **3层存储策略** | Redis→PG→S3 热冷分离合理 |
| **Lazy Singleton + Proxy** | 避免Serverless冷启动重复创建连接 |
| **两套聊天系统迁移桥** | ChatRoom↔Conversation 1:1映射，渐进迁移 |

### 3.2 🟡 需要改进的设计

| 设计 | 问题 | 影响 |
|------|------|------|
| **双聊天系统共存** | ChatRoom+Message(旧) 和 Conversation+IMMessage(新) 并存，维护成本翻倍 | 任何聊天功能需同步更新两套 |
| **JSON字符串存储配置** | PowerBoardRule的paceConfig/mediaConfig等6个字段存为TEXT(JSON字符串) | 无法SQL查询/索引，Prisma需手动parse |
| **Fail-open策略** | PaceController和RuleEvaluator在Redis错误时放行 | Redis故障→无限流→滥发消息 |
| **In-memory Redis fallback** | Vercel Serverless多实例下内存不共享 | 状态不一致，限流失效 |
| **Schema中Legacy枚举** | RelationshipGoal含LONG_TERM/DATING等废弃值 | 匹配引擎需处理两种格式 |
| **BotInteractionLog无限增长** | 无TTL或分区策略 | 百万级用户→亿级日志→存储爆炸 |

### 3.3 ❌ 必须重修的设计

| 设计 | 问题 | 严重度 |
|------|------|--------|
| **PrismaPg无连接池配置** | 每次Serverless调用可能创建新TCP连接，Neon连接上限低 | 🔴 P0 |
| **DATABASE_URL直连模式** | 应使用Neon Pooler (`-pooler`后缀)减少连接数 | 🔴 P0 |
| **Socket.io Redis Adapter未实现** | 无法跨实例广播，水平扩展不可能 | 🔴 P0 |
| **Pusher生产环境空字符串** | Vercel部署下实时功能完全失效 | 🔴 P0 |
| **无HTTP层限流** | 93个API完全暴露，可被暴力请求 | 🔴 P0 |
| **middleware无Auth检查** | 仅Geo屏蔽，不验证JWT | 🟡 P1 |
| **Neon免费版512MB** | 7K用户已用290MB，10K即溢出 | 🔴 P0 |

---

## 4. 数据交互性能分析

### 4.1 数据库连接模型

```
当前 (问题):
┌────────────┐     TCP直连      ┌──────────────┐
│ Vercel     │ ──────────────→  │ Neon Direct  │
│ Serverless │   每次请求       │ (无Pooler)   │
│ (N实例)    │   可能新建连接   │ max_conns=   │
│            │                  │ ~100         │
└────────────┘                  └──────────────┘

问题: 100并发 = 100个独立TCP连接 → 连接耗尽 → 503

目标:
┌────────────┐    Pooled     ┌──────────────┐    ┌──────────────┐
│ Vercel     │ ────────────→ │ Neon Pooler  │ ──→│ Neon Compute │
│ Serverless │  复用连接     │ (PgBouncer)  │    │ (Autoscale)  │
│ (N实例)    │  max=20       │              │    │              │
└────────────┘               └──────────────┘    └──────────────┘
```

**PrismaPg 连接池参数缺失**（`db.ts`第15-18行）:

```typescript
// 当前 — 无任何连接池参数
const adapter = new PrismaPg({
  connectionString,
  schema: process.env.DATABASE_SCHEMA || "public",
});

// 应改为
const adapter = new PrismaPg({
  connectionString: connectionString.includes('-pooler') 
    ? connectionString 
    : connectionString.replace('.neon.tech', '-pooler.neon.tech'),
  schema: process.env.DATABASE_SCHEMA || "public",
  pool: {
    max: 20,              // 每个Serverless实例最多20个连接
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  },
});
```

### 4.2 索引覆盖分析

| 查询模式 | 需要的复合索引 | 当前状态 | 影响 |
|----------|---------------|----------|------|
| 用户会话列表 (按最新消息) | `(userId, lastReadSeq DESC)` | ❌ 仅有单列索引 | 全表扫描所有会话 |
| 未读消息计数 | `(userId, readAt IS NULL)` | ❌ 无 | O(N)扫描 |
| 匹配收件箱排序 | `(receiverId, status, inboxPriority DESC)` | ❌ 无复合索引 | 排序走内存 |
| 消息历史翻页 | `(conversationId, seq DESC)` | ✅ 已有 | OK |
| 在线用户查询 | `(status, lastSeenAt)` | ❌ 仅有单列 | Dashboard慢 |
| 活跃匹配查询 | `(status, matchType, createdAt DESC)` | ❌ 无复合索引 | 匹配引擎慢 |
| 分析事件聚合 | `(event, createdAt)` | ✅ 已有 | OK |
| 用户搜索/筛选 | `(gender, relationshipGoal, profileStatus, city)` | ❌ 无 | Discover慢 |

### 4.3 N+1 查询风险

| 位置 | N+1模式 | 影响 |
|------|---------|------|
| `/matches/inbox` | 逐个Match查询Profile→User→avatar | 10条匹配=30+次SQL |
| `/chat/[id]/messages` | 逐条Message查sender | 50条消息=51次SQL |
| `/discover` | 每个Profile单独查匹配分 | 全表扫描+逐条计算 |
| `/im/conversations` | 逐个会话查participant→user | 20个会话=40+次SQL |
| `/admin/users` | 逐个查Profile+Subscription | 50用户=150+次SQL |
| Presence批量查询 | `for loop`逐个查Redis | 100用户=100次Redis调用 |

### 4.4 查询延迟估算 (当前7K用户)

| API端点 | 估算延迟 | 百万级预估 | 瓶颈 |
|---------|----------|-----------|------|
| Homepage | 1.1s ✅ | 2-5s 🔴 | Server Component无缓存 |
| Login | 4.0s ⚠️ | 8-15s 🔴 | Argon2 + DB查询 |
| Matches Inbox | ~2s | 10-30s 🔴 | N+1 + 无复合索引 |
| Chat Messages | ~1.5s | 5-15s 🔴 | N+1 + 全表排序 |
| Discover | ~3s | 30s+ 🔴 | 全表扫描+逐条匹配计算 |
| IM Send | ~200ms | 2-5s 🟡 | Redis+PG双写 |
| Profile View | ~500ms | 1-3s 🟡 | 单条查询OK |

---

## 5. 关键风险与瓶颈

### 5.1 风险矩阵

| 风险 | 概率 | 影响 | 优先级 | 修复成本 |
|------|------|------|--------|----------|
| Neon 512MB溢出 | 🔴 极高 | 服务中断 | P0 | $19/月 |
| 连接池耗尽 | 🔴 高 | 503错误 | P0 | 代码修改 |
| API被暴力请求 | 🔴 高 | 服务崩溃 | P0 | Vercel配置 |
| Redis Fail-open被利用 | 🟡 中 | 消息洪泛 | P1 | 代码修改 |
| 实时通信不可用 | 🔴 高 | 聊天失效 | P0 | Pusher配置 |
| IMMessage表无限增长 | 🟡 中 | 查询超慢 | P1 | 定时清理 |
| AnalyticsEvent爆炸 | 🟡 中 | 存储溢出 | P1 | 分区/归档 |
| 两套聊天系统数据不一致 | 🟡 中 | 403/404 | P1 | 迁移方案 |

### 5.2 瓶颈链分析

```
用户请求 → Vercel Edge → API Route → Prisma → Neon Direct → 503 (连接耗尽)
                                                    ↓
                                            512MB上限 → 服务中断
                                                    
实时消息 → Socket.io → 无Redis Adapter → 仅单实例 → 无法水平扩展
                      ↓
              Pusher未配置 → Vercel部署下完全失效

暴力请求 → 93个API无限制 → DB连接耗尽 → 雪崩
```

---

## 6. 百万级扩容方案

### 6.1 扩容阶段总览

```
Phase 0: 紧急修复 (1-2天) — 修复致命缺陷，保障7K用户稳定
Phase 1: 千级优化 (1-2周) — 支撑10K-50K DAU
Phase 2: 万级扩展 (1-2月) — 支撑100K-500K DAU  
Phase 3: 百万级架构 (3-6月) — 支撑1M+ DAU
```

### 6.2 Phase 0: 紧急修复 (P0)

> **目标**: 消除当前致命缺陷，使生产环境可达基本可靠

#### P0-1: Neon 升级 + 连接池

```
操作:
1. Neon 升级到 Launch 计划 ($19/月)
   - 10GB 存储
   - Autoscaling 0.25-0.5 CU
   - Neon Pooler 可用
   
2. DATABASE_URL 切换到 Pooler
   旧: postgres://user:pass@ep-xxx.us-east-2.neon.tech/db
   新: postgres://user:pass@ep-xxx.us-east-2-pooler.neon.tech/db

3. db.ts 增加连接池参数
```

**代码修改** — `src/lib/db.ts`:

```typescript
function createPrismaClient(): PrismaClient {
  const { PrismaPg } = require("@prisma/adapter-pg");
  const rawUrl = (process.env.DATABASE_URL || "").trim();
  
  // 自动切换到 Neon Pooler
  const connectionString = rawUrl.includes('-pooler') 
    ? rawUrl 
    : rawUrl.replace('.neon.tech', '-pooler.neon.tech');

  const adapter = new PrismaPg({
    connectionString,
    schema: process.env.DATABASE_SCHEMA || "public",
    pool: {
      max: 20,                      // 每个 Serverless 实例最多 20 个连接
      idleTimeoutMillis: 30000,     // 30秒空闲回收
      connectionTimeoutMillis: 5000, // 5秒连接超时
    },
  });

  return new (PrismaClient as any)({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  }) as PrismaClient;
}
```

#### P0-2: Pusher 生产环境配置

```
操作:
1. 创建 Pusher 账号 (Sandbox免费: 100K消息/天, 100并发)
2. 获取 app_id / key / secret / cluster
3. 设置 Vercel 环境变量:
   PUSHER_APP_ID=xxx
   PUSHER_KEY=xxx  
   PUSHER_SECRET=xxx
   PUSHER_CLUSTER=us3
   NEXT_PUBLIC_PUSHER_KEY=xxx
   NEXT_PUBLIC_PUSHER_CLUSTER=us3
4. 重新部署
```

#### P0-3: HTTP 层限流

```typescript
// src/middleware.ts — 增加 API 限流
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function middleware(request: NextRequest) {
  // Geo blocking (保留)
  const country = request.headers.get('x-vercel-ip-country');
  if (country === 'CN') {
    return NextResponse.rewrite(new URL('/blocked', request.url));
  }
  
  // API Rate Limiting
  if (request.nextUrl.pathname.startsWith('/api/')) {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
    const now = Date.now();
    const entry = rateLimitMap.get(ip);
    
    if (!entry || now > entry.resetAt) {
      rateLimitMap.set(ip, { count: 1, resetAt: now + 60000 }); // 1分钟窗口
    } else if (entry.count > 60) { // 每分钟60次
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    } else {
      entry.count++;
    }
  }
  
  return NextResponse.next();
}
```

> ⚠️ 注：内存限流仅适合单实例。Phase 1 需迁移到 Upstash Redis 限流。

#### P0-4: Fail-open → Fail-closed

```typescript
// pace-controller.ts — 改为 Fail-closed
} catch (error) {
  console.error('[PaceController] Redis error, BLOCKING message (fail-closed):', error);
  return {
    allowed: false,        // 改为 false
    remaining: 0,
    hourlyCount: 0,
    dailyCount: 0,
    cooldownUntil: Date.now() + 60000, // 1分钟冷却
  };
}
```

### 6.3 Phase 1: 千级优化 (10K-50K DAU)

#### P1-1: 复合索引添加

```sql
-- 匹配收件箱查询优化
CREATE INDEX CONCURRENTLY idx_match_inbox 
ON "Match" ("receiverId", "status", "inboxPriority" DESC NULLS LAST);

-- 会话列表查询优化  
CREATE INDEX CONCURRENTLY idx_conv_user_list 
ON "ConversationParticipant" ("userId", "lastReadSeq" DESC);

-- 在线用户查询优化
CREATE INDEX CONCURRENTLY idx_presence_online 
ON "UserPresence" ("status", "lastSeenAt" DESC) 
WHERE "status" = 'ONLINE';

-- 未读通知查询优化
CREATE INDEX CONCURRENTLY idx_notification_unread 
ON "Notification" ("userId", "isRead", "createdAt" DESC) 
WHERE "isRead" = false;

-- Discover 筛选优化
CREATE INDEX CONCURRENTLY idx_profile_discover 
ON "Profile" ("gender", "relationshipGoal", "profileStatus") 
WHERE "profileStatus" = 'APPROVED';

-- 消息收据查询优化
CREATE INDEX CONCURRENTLY idx_receipt_unread 
ON "MessageReceipt" ("userId", "readAt") 
WHERE "readAt" IS NULL;
```

#### P1-2: N+1 查询消除

**核心策略**: 使用 `include` + `select` 预加载关联数据

```typescript
// 匹配收件箱 — 从N+1改为批量查询
// 旧: 逐个查 Profile → User → avatar
// 新: 一次 include 嵌套查询

const matches = await db.match.findMany({
  where: { receiverId: userId, status: 'PENDING' },
  include: {
    sender: {
      select: {
        id: true,
        name: true,
        image: true,
        isBot: true,
        profile: {
          select: {
            displayName: true,
            avatar: true,
            age: true,
            city: true,
            compatibilityScore: true,
          }
        }
      }
    }
  },
  orderBy: { inboxPriority: 'desc' },
  take: 20,
});
```

#### P1-3: Redis 限流替代内存限流

```typescript
// src/lib/rate-limit.ts
import { redis } from './im/redis';

export async function checkRateLimit(
  key: string, 
  limit: number, 
  windowMs: number
): Promise<{ allowed: boolean; remaining: number }> {
  const now = Date.now();
  const windowKey = `ratelimit:${key}:${Math.floor(now / windowMs)}`;
  
  const count = await redis.incr(windowKey);
  if (count === 1) {
    await redis.expire(windowKey, Math.ceil(windowMs / 1000));
  }
  
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
  };
}
```

#### P1-4: Presence 批量查询优化

```typescript
// 旧: for loop 逐个查
for (const userId of userIds) {
  const status = await redis.get(RedisKeys.presence(userId));
}

// 新: Pipeline 批量查
const pipeline = userIds.map(id => redis.get(RedisKeys.presence(id)));
const results = await Promise.all(pipeline);
```

#### P1-5: IMMessage 冷数据迁移 (实现 Cron Job)

```typescript
// src/app/api/cron/im-migrate-cold-storage/route.ts
export async function POST(request: Request) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  
  // 1. 找出需要归档的会话
  const staleConversations = await db.conversation.findMany({
    where: { lastMessageAt: { lt: thirtyDaysAgo } },
    take: 100,
  });
  
  // 2. 导出旧消息到 S3
  for (const conv of staleConversations) {
    const messages = await db.iMMessage.findMany({
      where: { 
        conversationId: conv.id,
        createdAt: { lt: thirtyDaysAgo },
        isDeleted: false,
      },
    });
    
    // S3 upload (需配置 S3 client)
    // await s3.putObject(...)
    
    // 3. 标记为已归档
    await db.iMMessage.updateMany({
      where: { conversationId: conv.id, createdAt: { lt: thirtyDaysAgo } },
      data: { isDeleted: true, deletedBy: 'system-archive' },
    });
  }
  
  return Response.json({ archived: staleConversations.length });
}
```

### 6.4 Phase 2: 万级扩展 (100K-500K DAU)

#### P2-1: Neon 部署架构升级

```
┌─────────────────────────────────────────────────────────┐
│              Neon Production Architecture                │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌────────────────┐    ┌──────────────────────┐         │
│  │ Neon Pooler    │    │ Neon Read Replica     │         │
│  │ (PgBouncer)    │    │ (只读副本)            │         │
│  │                │    │                      │         │
│  │ 写操作 → Primary│    │ 读操作:              │         │
│  │ max_conns=200  │    │ - 匹配列表           │         │
│  │                │    │ - 消息历史           │         │
│  └───────┬────────┘    │ - Profile查看        │         │
│          │             │ - Discover浏览       │         │
│          ▼             └──────────────────────┘         │
│  ┌────────────────┐                                      │
│  │ Neon Primary   │                                      │
│  │ (Autoscale     │                                      │
│  │  0.5-4 CU)     │                                      │
│  │                │                                      │
│  │ 10GB → 50GB   │                                      │
│  └────────────────┘                                      │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

**读写分离实现**:

```typescript
// src/lib/db.ts — 增加只读副本
function createPrismaClient(readOnly = false): PrismaClient {
  const { PrismaPg } = require("@prisma/adapter-pg");
  
  const connectionString = readOnly 
    ? (process.env.DATABASE_READ_URL || process.env.DATABASE_URL || "").trim()
    : (process.env.DATABASE_URL || "").trim();
  
  // ... pool配置同上
}

// 导出只读客户端
export const dbRead: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    return (createReadOnlyClient() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
```

**使用方式**:
```typescript
// 写操作 → db (Primary)
await db.match.create({ data: { ... } });

// 读操作 → dbRead (Replica)
const matches = await dbRead.match.findMany({ where: { ... } });
```

#### P2-2: Socket.io Redis Adapter 实现

```typescript
// src/lib/socket/index.ts — 实现Redis Adapter
async function createRedisAdapter() {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!redisUrl || !redisToken) {
    console.warn('[Socket Server] Redis not configured');
    return undefined;
  }

  try {
    const { createAdapter } = await import('@socket.io/redis-adapter');
    const { Redis: IORedis } = await import('ioredis');
    
    // Upstash Redis 用 TCP 连接 (非REST)
    // 需要配置 UPSTASH_REDIS_URL (redis:// 格式)
    const pubClient = new IORedis(process.env.UPSTASH_REDIS_URL);
    const subClient = pubClient.duplicate();
    
    console.log('[Socket Server] Redis adapter configured for horizontal scaling');
    return createAdapter(pubClient, subClient);
  } catch (error) {
    console.warn('[Socket Server] Redis adapter failed:', error);
    return undefined;
  }
}
```

> ⚠️ Upstash Redis 需开启 TCP 端口才能用于 Socket.io Adapter。REST API不兼容。

#### P2-3: 推送系统 (Pusher Pro)

| 计划 | 并发连接 | 消息/天 | 价格 |
|------|----------|---------|------|
| Sandbox | 100 | 100K | 免费 |
| Pro | 5,000 | 1M | $49/月 |
| Business | 50,000 | 10M | $299/月 |
| Enterprise | 200,000+ | 无限 | 定制 |

**50K DAU 估算**: 需 Pro 计划 ($49/月)，考虑峰值并发约5,000。

#### P2-4: 关键查询缓存策略

```typescript
// 匹配收件箱 — Redis缓存5分钟
async function getMatchInbox(userId: string) {
  const cacheKey = `cache:inbox:${userId}`;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);
  
  const matches = await dbRead.match.findMany({ ... });
  await redis.set(cacheKey, JSON.stringify(matches), { ex: 300 }); // 5min
  return matches;
}

// Profile查看 — Redis缓存10分钟
async function getProfile(userId: string) {
  const cacheKey = `cache:profile:${userId}`;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);
  
  const profile = await dbRead.profile.findUnique({ ... });
  await redis.set(cacheKey, JSON.stringify(profile), { ex: 600 }); // 10min
  return profile;
}

// Discover — Redis缓存1分钟 (高变动)
async function getDiscoverProfiles(filters: DiscoveryFilters) {
  const cacheKey = `cache:discover:${hashFilters(filters)}`;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);
  
  const profiles = await dbRead.profile.findMany({ ... });
  await redis.set(cacheKey, JSON.stringify(profiles), { ex: 60 }); // 1min
  return profiles;
}
```

#### P2-5: 数据分区策略

| 表 | 分区策略 | 实现 |
|----|----------|------|
| IMMessage | 按月分区 (createdAt) | PG LIST分区 + 30天迁移 |
| AnalyticsEvent | 按月分区 (createdAt) | PG LIST分区 + 90天归档 |
| BotInteractionLog | 按月分区 (createdAt) | PG LIST分区 + 30天归档 |
| AuditLog | 按季度分区 (createdAt) | PG RANGE分区 + 90天归档 |

**IMMessage 月分区示例**:

```sql
-- 创建分区表
CREATE TABLE "IMMessage" (
  -- 同原schema
) PARTITION BY RANGE ("createdAt");

-- 创建月分区
CREATE TABLE "IMMessage_2026_04" PARTITION OF "IMMessage"
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
  
CREATE TABLE "IMMessage_2026_05" PARTITION OF "IMMessage"
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

-- 自动创建下月分区 (Cron Job)
```

> ⚠️ Neon 目前不完全支持 PG 分区。Phase 2 末考虑迁移到 AWS RDS / Supabase Pro。

### 6.5 Phase 3: 百万级架构 (1M+ DAU)

#### P3-1: 数据库架构 — 从Neon到分布式

```
┌─────────────────────────────────────────────────────────────┐
│              1M+ User Database Architecture                  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐    │
│  │ Write Master  │   │ Read Replica │   │ Read Replica │    │
│  │ (Primary)    │   │ #1           │   │ #2           │    │
│  │              │   │              │   │              │    │
│  │ 4-8 CU       │   │ 2-4 CU       │   │ 2-4 CU       │    │
│  │ Region:      │   │ Region:      │   │ Region:      │    │
│  │ us-east-2    │   │ us-east-2    │   │ eu-west-1    │    │
│  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘    │
│         │                  │                   │             │
│         └──────────────────┼───────────────────┘             │
│                            │                                 │
│                   ┌────────▼────────┐                        │
│                   │ PgBouncer       │                        │
│                   │ (Connection     │                        │
│                   │  Pool)          │                        │
│                   │ max_conns=500   │                        │
│                   └─────────────────┘                        │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 数据分片 (Sharding) — 仅在 500K+ 时考虑               │  │
│  │                                                        │  │
│  │ Shard Key: userId (一致性哈希)                         │  │
│  │                                                        │  │
│  │ Shard 0: userId hash 0-33%  → DB Instance 0           │  │
│  │ Shard 1: userId hash 33-66% → DB Instance 1           │  │
│  │ Shard 2: userId hash 66-100% → DB Instance 2          │  │
│  │                                                        │  │
│  │ 跨分片查询:                                            │  │
│  │ - 匹配引擎: 预计算+缓存 (不在查询时计算)               │  │
│  │ - Discover: Elasticsearch 索引                         │  │
│  │ - Analytics: ClickHouse 列存                           │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### P3-2: 微服务拆分

```
当前: 单体 Next.js (所有功能一体)

目标: 微服务架构

┌──────────────────────────────────────────────┐
│  API Gateway (Kong / AWS API Gateway)         │
│  - 认证/限流/路由                             │
├──────┬──────┬──────┬──────┬────────┬─────────┤
│      │      │      │      │        │         │
│ Auth │Match │Chat  │Pay   │Profile │Analytics│
│ Svc  │ Svc  │ Svc  │ Svc  │ Svc    │ Svc     │
│      │      │      │      │        │         │
│NextJS│NextJS│Go/   │Go/   │NextJS  │ClickHouse│
│      │      │Rust  │Rust  │        │         │
│      │      │      │      │        │         │
│ PG   │ PG   │ PG   │ PG   │ PG     │ CH      │
│      │      │ Redis│      │ ES     │         │
└──────┴──────┴──────┴──────┴────────┴─────────┘
```

**Chat Service 独立**: 最先拆分，因为实时通信对延迟最敏感
- 语言: Go/Rust (WebSocket长连接友好)
- 数据库: 独立 PostgreSQL + Redis
- 部署: Kubernetes / AWS ECS

#### P3-3: 搜索引擎 (Elasticsearch)

```typescript
// Discover 从 PG 全表扫描 → ES 索引查询
// 当前: db.profile.findMany({ where: { gender, relationshipGoal, city } })
// 目标: es.search({ index: 'profiles', body: { query: { bool: { ... } } } })

// Profile 变更时同步到 ES
async function syncProfileToES(profile: Profile) {
  await es.index({
    index: 'profiles',
    id: profile.userId,
    body: {
      displayName: profile.displayName,
      age: profile.age,
      gender: profile.gender,
      city: profile.city,
      relationshipGoal: profile.relationshipGoal,
      compatibilityScore: profile.compatibilityScore,
      selectedTags: profile.selectedTags,
      // ... 可搜索字段
    }
  });
}
```

#### P3-4: 分析引擎 (ClickHouse)

```sql
-- 替代 AnalyticsEvent 的 PostgreSQL 表
CREATE TABLE analytics_events (
  event_time DateTime,
  user_id String,
  event String,
  properties String,
  session_id String,
  ip_address String
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(event_time)
ORDER BY (event, event_time, user_id)
TTL event_time + INTERVAL 90 DAY;

-- 实时聚合查询 (毫秒级)
SELECT 
  event,
  count() as cnt,
  uniq(user_id) as unique_users
FROM analytics_events
WHERE event_time >= now() - INTERVAL 1 DAY
GROUP BY event
ORDER BY cnt DESC;
```

#### P3-5: CDN & 静态优化

```
┌─────────────────────────────────────────────────────┐
│              CDN Layer                               │
├─────────────────────────────────────────────────────┤
│                                                      │
│  Vercel Edge Network (默认)                          │
│    ├── 静态资源: _next/static/* (1年缓存)           │
│    ├── 图片: _next/image/* (Vercel优化)              │
│    └── Landing: lokfeel.com (ISR 60s)               │
│                                                      │
│  Cloudflare CDN (追加)                               │
│    ├── 头像图片: CDN缓存 + WebP转换                   │
│    ├── API缓存: GET /api/profile/[userId] (5min)     │
│    └── 防DDoS: Cloudflare WAF                        │
│                                                      │
└─────────────────────────────────────────────────────┘
```

---

## 7. 数据库专项扩容

### 7.1 Neon 升级路径

| 阶段 | 计划 | 存储 | CU | 价格 | 承载 |
|------|------|------|-----|------|------|
| 当前 | Free | 0.5GB | 0.25 | $0 | ~5K用户 |
| Phase 0-1 | Launch | 10GB | 0.25-0.5 | $19/月 | ~50K用户 |
| Phase 2 | Scale | 50GB | 0.5-4 | $69/月 | ~200K用户 |
| Phase 3 | Business | 200GB+ | 4-16 | $300+/月 | ~1M用户 |

> 💡 替代方案: Supabase Pro ($25/月, 8GB, 无冷启动) 或 AWS RDS Aurora Serverless

### 7.2 连接池演进

```
Phase 0:  PrismaPg (max=20) + Neon Pooler
Phase 1:  PrismaPg (max=20) + PgBouncer (max=200)  
Phase 2:  PrismaPg (max=20) + PgBouncer (max=500) + Read Replica
Phase 3:  独立连接池 + 微服务各自管理
```

### 7.3 存储容量规划

| 用户规模 | IMMessage (30天) | Profile+User | Analytics (90天) | Bot相关 | 合计 |
|----------|------------------|-------------|------------------|---------|------|
| 7K | ~50MB | ~200MB | ~20MB | ~100MB | 370MB |
| 50K | ~2GB | ~1.5GB | ~200MB | ~500MB | 4.2GB |
| 200K | ~10GB | ~6GB | ~1GB | ~2GB | 19GB |
| 1M | ~50GB | ~30GB | ~5GB | ~10GB | 95GB |

> ⚠️ 1M用户的50GB IMMessage假设：日均100条消息/活跃用户 × 500K DAU × 2KB/条 × 30天

### 7.4 数据生命周期管理

```
┌─────────────────────────────────────────────────────┐
│              Data Lifecycle                          │
├─────────────────────────────────────────────────────┤
│                                                      │
│  实时数据 (Redis, TTL自动)                           │
│    ├── Presence: 5min                                │
│    ├── Typing: 5sec                                  │
│    ├── Pace: 24h                                     │
│    └── Rules Cache: 5min                             │
│                                                      │
│  热数据 (PostgreSQL, 30天)                           │
│    ├── IMMessage → 30天后归档到S3                    │
│    ├── MessageReceipt → 随IMMessage归档              │
│    ├── ConsentRequest → 30天后清理                   │
│    └── AnalyticsEvent → 90天后归档到ClickHouse       │
│                                                      │
│  温数据 (PostgreSQL, 长期)                           │
│    ├── User + Profile → 永久                         │
│    ├── Match + MatchReaction → 永久                  │
│    ├── Conversation → 永久                           │
│    ├── ConsentGrant → 永久 (法律要求)               │
│    └── AuditLog → 90天后归档                         │
│                                                      │
│  冷数据 (S3/Glacier)                                │
│    ├── 归档消息: S3 Standard (1-5秒检索)            │
│    ├── 分析原始数据: S3 (按需导入ClickHouse)         │
│    └── 长期归档: Glacier (1-5分钟检索)              │
│                                                      │
└─────────────────────────────────────────────────────┘
```

---

## 8. 实时通信专项扩容

### 8.1 当前问题

```
问题1: Vercel部署下 Pusher 未配置 → 实时功能失效
问题2: Socket.io Redis Adapter 未实现 → 无法水平扩展
问题3: 单WebSocket实例 → 超过1000连接即崩溃
问题4: 无心跳超时清理 → 僵尸连接累积
```

### 8.2 扩容路径

| 阶段 | 方案 | 并发连接 | 延迟 | 价格 |
|------|------|----------|------|------|
| Phase 0 | Pusher Sandbox | 100 | ~50ms | 免费 |
| Phase 1 | Pusher Pro | 5,000 | ~30ms | $49/月 |
| Phase 2 | Pusher Business | 50,000 | ~20ms | $299/月 |
| Phase 3 | 自建 WebSocket 集群 | 无限 | ~10ms | $200+/月 |

### 8.3 WebSocket 集群架构 (Phase 3)

```
┌─────────────────────────────────────────────────────┐
│              WebSocket Cluster (Phase 3)             │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ WS Node 1│  │ WS Node 2│  │ WS Node 3│  ...     │
│  │ (Go/Rust)│  │ (Go/Rust)│  │ (Go/Rust)│          │
│  │ 50K conn │  │ 50K conn │  │ 50K conn │          │
│  └─────┬────┘  └─────┬────┘  └─────┬────┘          │
│        │             │             │                  │
│        └─────────────┼─────────────┘                  │
│                      │                                │
│              ┌───────▼───────┐                        │
│              │ Redis Pub/Sub │                        │
│              │ (跨节点广播)   │                        │
│              └───────────────┘                        │
│                                                      │
│  负载均衡: Nginx / AWS ALB (Sticky Session)          │
│  服务发现: Kubernetes / Consul                        │
│  健康检查: HTTP /health + WebSocket ping             │
│                                                      │
└─────────────────────────────────────────────────────┘
```

---

## 9. 成本预估

### 9.1 分阶段月度成本

| 组件 | Phase 0-1 (10K) | Phase 2 (200K) | Phase 3 (1M) |
|------|-----------------|----------------|--------------|
| Neon PostgreSQL | $19 | $69 | $300+ |
| Upstash Redis | $0 (免费) | $10 | $50 |
| Pusher | $0 (Sandbox) | $49 | $299 |
| Vercel | $0 (Hobby) | $20 (Pro) | $150 (Team) |
| S3 存储 | ~$1 | ~$10 | ~$50 |
| Cloudflare CDN | $0 (免费) | $0 | $20 |
| 监控 (Sentry/Datadog) | $0 (免费) | $26 | $100 |
| **月度合计** | **~$20** | **~$184** | **~$969** |

### 9.2 与竞品对比

| 平台 | 月度成本 (1M用户) | 备注 |
|------|------------------|------|
| Tinder | ~$50K-100K | 大规模EKS+DynamoDB+Redis |
| Bumble | ~$40K-80K | 类似架构 |
| Hinge | ~$30K-60K | 较小规模 |
| **LokFeel (目标)** | **~$1K** | 极致成本优化 |

> 💡 我们的目标是用1%的成本支撑1%的用户量，效率持平。

---

## 10. 实施路线图

### 10.1 Phase 0: 紧急修复 (1-2天)

| # | 任务 | 优先级 | 预估时间 |
|---|------|--------|----------|
| 1 | Neon 升级 + Pooler切换 | P0 | 1h |
| 2 | db.ts 连接池参数 | P0 | 30min |
| 3 | Pusher 生产环境配置 | P0 | 2h |
| 4 | HTTP层内存限流 (middleware) | P0 | 1h |
| 5 | Fail-open → Fail-closed | P0 | 30min |
| 6 | 部署验证 | P0 | 1h |

### 10.2 Phase 1: 千级优化 (1-2周)

| # | 任务 | 优先级 | 预估时间 |
|---|------|--------|----------|
| 1 | 添加6个复合索引 | P1 | 2h |
| 2 | 消除5个N+1查询 | P1 | 1天 |
| 3 | Redis限流替代内存限流 | P1 | 4h |
| 4 | Presence批量查询优化 | P1 | 2h |
| 5 | 关键API响应缓存 | P1 | 1天 |
| 6 | IMMessage冷迁移Cron | P1 | 1天 |
| 7 | AnalyticsEvent 90天清理 | P1 | 2h |
| 8 | BotInteractionLog 30天清理 | P1 | 2h |

### 10.3 Phase 2: 万级扩展 (1-2月)

| # | 任务 | 优先级 | 预估时间 |
|---|------|--------|----------|
| 1 | Neon Read Replica + 读写分离 | P2 | 3天 |
| 2 | Socket.io Redis Adapter | P2 | 2天 |
| 3 | Pusher Pro升级 | P2 | 1天 |
| 4 | IMMessage月分区 | P2 | 3天 |
| 5 | 数据库迁移评估 (Neon→RDS/Supabase) | P2 | 1周 |
| 6 | Vercel Pro升级 + 带宽优化 | P2 | 1天 |
| 7 | Sentry错误监控接入 | P2 | 1天 |
| 8 | 压力测试 (Locust/k6) | P2 | 3天 |

### 10.4 Phase 3: 百万级架构 (3-6月)

| # | 任务 | 优先级 | 预估时间 |
|---|------|--------|----------|
| 1 | 微服务拆分 (Chat Service优先) | P3 | 1-2月 |
| 2 | Elasticsearch Profile搜索 | P3 | 2周 |
| 3 | ClickHouse分析引擎 | P3 | 2周 |
| 4 | 数据库分片 (Sharding) | P3 | 1月 |
| 5 | 自建WebSocket集群 | P3 | 1月 |
| 6 | Kubernetes部署 | P3 | 1月 |
| 7 | Cloudflare WAF + CDN | P3 | 1周 |
| 8 | 全链路可观测性 | P3 | 2周 |

### 10.5 关键里程碑

| 里程碑 | 时间 | 用户规模 | 成本/月 |
|--------|------|----------|---------|
| M0: 生产稳定 | Day 1-2 | 7K | $0 → $20 |
| M1: 千级可用 | Week 2-3 | 10K-50K | ~$20 |
| M2: 万级扩展 | Month 2-3 | 100K-200K | ~$184 |
| M3: 百万级架构就绪 | Month 6+ | 500K-1M | ~$969 |

---

## 附录A: Prisma Schema 索引审计清单

| 模型 | 当前索引 | 缺失的复合索引 | 优先级 |
|------|----------|---------------|--------|
| User | email, role, createdAt | (email, isBot) — 非Bot用户查询 | P2 |
| Profile | gender, relationshipGoal, profileStatus, compatibilityScore | (gender, relationshipGoal, profileStatus, city) — Discover | P1 |
| Match | status, matchScore, matchType, createdAt, expiresAt, senderId, receiverId, isUnread, inboxPriority | (receiverId, status, inboxPriority DESC) — 收件箱 | P0 |
| Conversation | state, lastMessageAt, userAId, userBId, controllingUserId, vaultExpiresAt | (userAId, state), (userBId, state) — 会话列表 | P1 |
| ConversationParticipant | userId, (userId, isMuted), (userId, isPinned) | (userId, conversationId, lastReadSeq) — 已读追踪 | P1 |
| IMMessage | (conversationId,seq), (conversationId,createdAt), senderId, receiverId, clientMsgId, createdAt, msgType, isDeleted | (conversationId, isDeleted, createdAt DESC) — 消息列表 | P2 |
| MessageReceipt | (userId, readAt), conversationId | (userId, readAt) WHERE readAt IS NULL — 未读计数 | P1 |
| UserPresence | status, lastSeenAt, (userId, status) | (status, lastSeenAt) WHERE status='ONLINE' — 在线列表 | P1 |
| Notification | (userId, isRead, createdAt) | ✅ 足够 | — |
| AnalyticsEvent | (userId, event, createdAt), (event, createdAt) | ✅ 足够 | — |
| AuditLog | (userId, createdAt), conversationId, action, actorId, createdAt | ✅ 足够 | — |

## 附录B: API 端点性能优化优先级

| 端点 | 当前瓶颈 | 优化方案 | 预估提升 |
|------|----------|----------|----------|
| GET /matches/inbox | N+1查询, 无复合索引 | include预加载 + 复合索引 + Redis缓存 | 10x |
| GET /chat/[id]/messages | N+1查询, 全表排序 | 批量查sender + cursor分页 | 5x |
| GET /discover | 全表扫描, 逐条计算 | ES索引 + 预计算匹配分 + 缓存 | 20x |
| POST /auth/login | Argon2慢哈希 | 降低rounds + Redis session缓存 | 2x |
| GET /im/conversations | 逐个查participant | include预加载 + 缓存 | 5x |
| GET /admin/users | N+1查询 | include预加载 + cursor分页 | 5x |

## 附录C: 数据量增长预估

| 指标 | 7K用户 | 50K用户 | 200K用户 | 1M用户 |
|------|--------|---------|----------|--------|
| User表行数 | 7K | 50K | 200K | 1M |
| Profile表行数 | 7K | 50K | 200K | 1M |
| Match表行数 | ~20K | ~150K | ~600K | ~3M |
| IMMessage (30天) | ~100K | ~750K | ~3M | ~15M |
| MessageReceipt | ~200K | ~1.5M | ~6M | ~30M |
| AnalyticsEvent (90天) | ~500K | ~3.5M | ~14M | ~70M |
| BotInteractionLog | ~50K | ~300K | ~1M | ~5M |
| **DB存储** | ~370MB | ~4.2GB | ~19GB | ~95GB |

---

> **文档状态**: v1.0 初稿完成  
> **下次更新**: Phase 0 实施完成后，更新实际基准数据  
> **负责人**: Frank Zhao + AI自动化团队
