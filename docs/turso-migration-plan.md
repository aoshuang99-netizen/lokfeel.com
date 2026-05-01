# LokFeel 数据库迁移方案：Neon PostgreSQL → Turso libSQL

> 生成时间：2026-04-30
> 目标：从 Neon 免费版（512MB 上限）迁移到 Turso Scaler 付费版（24GB+）
> 你的 Turso URL: `libsql://lokfeelcom-lokfeelboss.aws-us-east-1.turso.io`

---

## 🔴 重要警告：SQLite 迁移风险极高

**Turso 基于 libSQL（SQLite 分支），不是 PostgreSQL。** 这不是简单的换连接字符串，而是**数据库引擎变更**。

### 核心不兼容项（必须解决）

| # | 问题 | 当前 PostgreSQL | SQLite/libSQL | 影响 | 解决难度 |
|---|------|----------------|---------------|------|---------|
| 1 | **`@db.Text` 属性** | ✅ 支持 | ❌ 不支持 | 25+ 字段需删除 | 低 |
| 2 | **`String[]` 数组类型** | ✅ 原生支持 | ❌ 不支持 | Profile.galleryPhotos, BotProfile.interests 等 6 个字段 | **高** |
| 3 | **`Json` 类型** | ✅ 原生支持 | ⚠️ 支持（存为 TEXT） | BotLearningRecord.context 1 个字段 | 低 |
| 4 | **Enum 类型** | ✅ 原生支持 | ❌ 不支持（SQLite 无枚举） | **25 个 Enum** | **高** |
| 5 | **`@default(cuid())` ID** | ✅ `cuid()` 生成 | ✅ 支持 | 无 | ✅ |
| 3 | **`@default(now())`** | ✅ | ✅ | 无 | ✅ |
| 4 | **`@updatedAt`** | ✅ | ✅ (Prisma层面) | 无 | ✅ |
| 5 | **`Json` 类型** | ✅ JSONB | ⚠️ Prisma映射为TEXT | BotLearningRecord.context 1处 | 低 |
| 6 | **`@@unique` 约束** | ✅ | ✅ | 无 | ✅ |
| 7 | **`@@index` 索引** | ✅ | ✅ | 无 | ✅ |
| 8 | **`enum` 类型** | ✅ 原生enum | ⚠️ 映射为VARCHAR+check | 40+ enums | 低(自动) |
| 9 | **级联删除** | ✅ | ✅ (Prisma层面) | 无 | ✅ |
| 10 | **Prisma Migrate** | ✅ | ❌ 不可用 | 迁移管理方式变化 | 中 |

### 修复方案

#### 1. `@db.Text` → 直接删除（25处）

所有 `@db.Text` 属性只需删除即可。SQLite 的 TEXT 类型是默认的，不需要显式声明。

**影响字段清单**：
```
BotProfile.behaviorConfig, learningData
BotInteractionLog.context
BotLearningBatch.preferenceUpdates, executionLog
User.botConfig
Profile.bio, boundaries, dealbreakers, lifePriorities, personalityData, adminNotes
Match.matchReason, conflictWarnings, pitchMessage
Message.metadata
Conversation.settings
IMMessage.payload, metadata, replyToPreview, mediaMetadata
ConsentRequest.reason, previewPayload
PowerBoardRule.paceConfig, mediaConfig, filterConfig, autoResponse, privacyConfig, notifConfig
AuditLog.details, userAgent
Notification.body, data
Payment.metadata
AdminLog.details, userAgent
AnalyticsEvent.properties, userAgent
SincerityTransaction.metadata
UserReport.description, adminNotes
```

#### 2. `String[]` 数组字段 → 关联表（7处，工作量大）

| 模型 | 字段 | 当前存储 | 迁移方案 |
|------|------|---------|---------|
| Profile | `selectedTags` | String[] | 新建 ProfileTag 关联表 |
| Profile | `galleryPhotos` | String[] | 新建 ProfilePhoto 关联表 |
| BotProfile | `interests` | String[] | 新建 BotInterest 关联表 |
| BotProfile | `hobbies` | String[] | 新建 BotHobby 关联表 |
| BotProfile | `musicGenres` | String[] | 新建 BotMusicGenre 关联表 |
| BotProfile | `movieGenres` | String[] | 新建 BotMovieGenre 关联表 |
| BotProfile | `preferredEthnicities` | Ethnicity[] | 新建 BotPreferredEthnicity 关联表 |
| BotProfile | `preferredOccupations` | String[] | 新建 BotPreferredOccupation 关联表 |
| BotProfile | `preferredEducation` | String[] | 新建 BotPreferredEducation 关联表 |
| IMMessage | `complianceTags` | String[] | 新建 MessageComplianceTag 关联表 |

#### 3. `Json` 类型 → `String`（1处）

```prisma
// 之前
context   Json?    // 存储额外上下文
// 之后
context   String?  // JSON字符串存储（应用层JSON.parse/stringify）
```

#### 4. Prisma Migrate → `prisma db push`

```bash
# 之前 (Neon/PostgreSQL)
npx prisma migrate dev    # 开发
npx prisma migrate deploy # 生产

# 之后 (Turso/SQLite)
npx prisma db push        # 开发+生产
```

---

## 📊 Turso 定价与容量对比

| 指标 | Neon 免费版 | Turso Developer ($4.99/月) | Turso Scaler ($24.92/月) |
|------|------------|---------------------------|-------------------------|
| 存储空间 | 512MB | 9GB (+$0.75/GB) | 24GB (+$0.50/GB) |
| 数据库数量 | 1 | 无限 | 无限 |
| 月读取行数 | 无限 | 25亿 | 1000亿 |
| 月写入行数 | 无限 | 2500万 | 1亿 |
| 连接方式 | 连接池 | HTTP/WS | HTTP/WS |
| 区域 | us-east | us-east | us-east + 副本 |

**当前数据量**（~7,000 用户 + 7,000 Profile + 40,000+ 消息）:
- Neon 占用约 150-200MB
- 预估 Turso 占用约 100-150MB（SQLite 更紧凑）

**建议**: Developer 方案 $4.99/月 足够。用支付宝/微信充值虚拟卡支付。

---

## 🛠️ 迁移执行计划

### Phase 0: Schema 适配（1天）

1. 修改 `schema.prisma`
   ```prisma
   datasource db {
     provider = "sqlite"
     url      = env("DATABASE_URL")
   }

   generator client {
     provider        = "prisma-client-js"
     output          = "../src/generated"
     previewFeatures = ["driverAdapters"]
   }
   ```

2. 删除所有 `@db.Text` 属性
3. 将 `String[]` 字段替换为关联表
4. 将 `Json` 类型改为 `String`
5. 运行 `npx prisma validate` 验证

### Phase 1: 代码适配（1天）

1. 安装新依赖
   ```bash
   npm install @prisma/adapter-libsql @libsql/client
   npm uninstall @prisma/adapter-pg pg @types/pg
   ```

2. 修改 `src/lib/db.ts`
   ```typescript
   import { PrismaClient } from "@/generated";
   import { PrismaLibSql } from "@prisma/adapter-libsql";

   declare global {
     var prisma: PrismaClient | undefined;
   }

   function createPrismaClient(): PrismaClient {
     const adapter = new PrismaLibSql({
       url: (process.env.TURSO_DATABASE_URL || "").trim(),
       authToken: (process.env.TURSO_AUTH_TOKEN || "").trim(),
     });

     return new PrismaClient({
       adapter,
       log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
     }) as PrismaClient;
   }

   // ... 其余 singleton 逻辑不变
   ```

3. 修改 `.env`
   ```
   # 旧配置 (删除)
   # DATABASE_URL="postgresql://..."

   # 新配置
   TURSO_DATABASE_URL="libsql://lokfeelcom-lokfeelboss.aws-us-east-1.turso.io"
   TURSO_AUTH_TOKEN="你的JWT token"
   ```

4. 修改所有使用 `String[]` 字段的代码
   - Profile.selectedTags → 查询 ProfileTag 表
   - Profile.galleryPhotos → 查询 ProfilePhoto 表
   - IMMessage.complianceTags → 查询 MessageComplianceTag 表
   - BotProfile 的所有数组字段 → 对应关联表

5. 修改 BotLearningRecord.context 的 JSON 处理
   - 读: `JSON.parse(record.context)` → 不变（已是stringify后的String）
   - 写: `prisma.botLearningRecord.create({ data: { context: JSON.stringify(data) } })` → 不变

6. 修改 `package.json`
   ```json
   {
     "scripts": {
       "build": "npx prisma generate && npx prisma db push --accept-data-loss && next build"
     }
   }
   ```

### Phase 2: 数据迁移（半天）

#### 方案 A：从零开始（推荐，适合当前阶段）

当前只有 17 个真实用户 + 7,004 个 Bot 用户。Bot 用户可以重新导入。

```bash
# 1. 适配schema，推送到Turso
npx prisma db push

# 2. 重新导入Bot用户
npm run bots:import

# 3. 手动创建17个真实用户（通过app注册流程）

# 4. 验证数据完整性
```

**优点**: 无数据转换问题，干净启动
**缺点**: 丢失历史消息和匹配记录（Bot数据无价值，可丢弃）

#### 方案 B：数据导出导入（适合有重要数据时）

```bash
# 1. 从Neon导出CSV
psql $DATABASE_URL -c "\copy (SELECT * FROM \"User\") TO users.csv CSV HEADER"

# 2. 转换数据类型（String[] → 关联表行）
node scripts/migrate-data.mjs

# 3. 导入Turso
npx tsx scripts/import-to-turso.ts
```

**建议**: 选方案A。当前阶段数据量小，Bot用户可重建，历史消息无保留价值。

### Phase 3: 部署切换（1小时）

1. Vercel 环境变量更新
   ```
   TURSO_DATABASE_URL=libsql://lokfeelcom-lokfeelboss.aws-us-east-1.turso.io
   TURSO_AUTH_TOKEN=你的JWT
   # 删除 DATABASE_URL（或保留为空）
   ```

2. 修改 Vercel 构建命令
   ```
   npx prisma generate && npx prisma db push --accept-data-loss && next build
   ```

3. 部署并验证
   ```bash
   git push origin main  # 触发Vercel部署
   ```

4. 验证清单
   - [ ] 首页加载正常
   - [ ] 用户注册/登录正常
   - [ ] 匹配引擎正常
   - [ ] 聊天功能正常
   - [ ] Bot自动回复正常

---

## 📋 Schema 变更完整对照

### 新增关联表（替代 String[] 字段）

```prisma
// Profile 标签
model ProfileTag {
  id        String  @id @default(cuid())
  profileId String
  profile   Profile @relation(fields: [profileId], references: [id], onDelete: Cascade)
  tag       String  // 如 "MONOGAMY", "KINK", "BISEXUAL"

  @@unique([profileId, tag])
  @@index([profileId])
}

// Profile 相册
model ProfilePhoto {
  id        String  @id @default(cuid())
  profileId String
  profile   Profile @relation(fields: [profileId], references: [id], onDelete: Cascade)
  url       String
  order     Int     @default(0)  // 排序顺序
  isAvatar  Boolean @default(false) // 是否为头像

  @@index([profileId])
}

// BotProfile 兴趣
model BotInterest {
  id          String     @id @default(cuid())
  botProfileId String
  botProfile  BotProfile @relation(fields: [botProfileId], references: [id], onDelete: Cascade)
  interest    String

  @@unique([botProfileId, interest])
  @@index([botProfileId])
}

// BotProfile 爱好
model BotHobby {
  id          String     @id @default(cuid())
  botProfileId String
  botProfile  BotProfile @relation(fields: [botProfileId], references: [id], onDelete: Cascade)
  hobby       String

  @@unique([botProfileId, hobby])
  @@index([botProfileId])
}

// BotProfile 音乐类型
model BotMusicGenre {
  id          String     @id @default(cuid())
  botProfileId String
  botProfile  BotProfile @relation(fields: [botProfileId], references: [id], onDelete: Cascade)
  genre       String

  @@unique([botProfileId, genre])
  @@index([botProfileId])
}

// BotProfile 电影类型
model BotMovieGenre {
  id          String     @id @default(cuid())
  botProfileId String
  botProfile  BotProfile @relation(fields: [botProfileId], references: [id], onDelete: Cascade)
  genre       String

  @@unique([botProfileId, genre])
  @@index([botProfileId])
}

// BotProfile 偏好种族
model BotPreferredEthnicity {
  id          String     @id @default(cuid())
  botProfileId String
  botProfile  BotProfile @relation(fields: [botProfileId], references: [id], onDelete: Cascade)
  ethnicity   String     // 存 Ethnicity enum 值

  @@unique([botProfileId, ethnicity])
  @@index([botProfileId])
}

// BotProfile 偏好职业
model BotPreferredOccupation {
  id          String     @id @default(cuid())
  botProfileId String
  botProfile  BotProfile @relation(fields: [botProfileId], references: [id], onDelete: Cascade)
  occupation  String

  @@unique([botProfileId, occupation])
  @@index([botProfileId])
}

// BotProfile 偏好教育
model BotPreferredEducation {
  id          String     @id @default(cuid())
  botProfileId String
  botProfile  BotProfile @relation(fields: [botProfileId], references: [id], onDelete: Cascade)
  education   String

  @@unique([botProfileId, education])
  @@index([botProfileId])
}

// IMMessage 合规标签
model MessageComplianceTag {
  id             String    @id @default(cuid())
  messageId      String
  message        IMMessage @relation(fields: [messageId], references: [id], onDelete: Cascade)
  tag            String    // 如 "consent_granted", "media_level_2"

  @@unique([messageId, tag])
  @@index([messageId])
}
```

### 需要修改的模型字段

```prisma
// Profile
- selectedTags      String[]        @default([])
- galleryPhotos     String[]        @default([])
+ selectedTags      ProfileTag[]
+ galleryPhotos     ProfilePhoto[]

// BotProfile
- interests         String[]
- hobbies           String[]
- musicGenres       String[]
- movieGenres       String[]
- preferredEthnicities  Ethnicity[]
- preferredOccupations  String[]
- preferredEducation   String[]
+ interests         BotInterest[]
+ hobbies           BotHobby[]
+ musicGenres       BotMusicGenre[]
+ movieGenres       BotMovieGenre[]
+ preferredEthnicities  BotPreferredEthnicity[]
+ preferredOccupations  BotPreferredOccupation[]
+ preferredEducation   BotPreferredEducation[]

// IMMessage
- complianceTags    String[]        @default([])
+ complianceTags    MessageComplianceTag[]

// BotLearningRecord
- context           Json?
+ context           String?  // 应用层 JSON.parse/stringify
```

---

## 💰 成本对比

| | Neon 免费版 | Turso Developer | Turso Scaler |
|---|---|---|---|
| 月费 | $0 | $4.99 | $24.92 |
| 存储上限 | **512MB (已溢出)** | 9GB | 24GB |
| 年费 | $0 | $59.88 | $299.04 |
| CNY/月 | ¥0 | ~¥36 | ~¥180 |

**推荐**: Developer 方案 $4.99/月（约¥36/月），9GB 存储，完全满足当前需求。

---

## ⚡ 快速决策

### 方案对比

| 方案 | 工作量 | 风险 | 推荐度 |
|------|--------|------|--------|
| **A: 迁移到Turso** | 2-3天 | 中（SQLite兼容性） | ⭐⭐ |
| **B: Neon Pro ($19/月)** | 1小时 | 低（只改连接字符串） | ⭐⭐⭐ |
| **C: Neon Pro + Turso双写** | 3-5天 | 高 | ⭐ |

### 我的建议

**如果只是为了解决 512MB 限制**，最简单的方案是升级 Neon Pro ($19/月)，10GB 存储，0 代码改动。

**如果要选择 Turso**，主要优势是：
- 月费更便宜 ($4.99 vs $19)
- SQLite 更紧凑，同数据量占用更小
- 边缘部署延迟更低

但代价是：
- 2-3天迁移工作量
- String[] → 关联表（10个新表 + 代码改动）
- Prisma Migrate 不可用（只能 db push）
- SQLite 不支持部分高级 SQL 特性

---

## 🚀 推荐执行路径

### 路径1：直接上Turso（性价比最优）

1. Day 1: Schema适配 + 关联表替换 + 删除@db.Text
2. Day 2: 代码适配（db.ts + String[]相关查询修改）
3. Day 3: 数据迁移 + 部署 + 验证

### 路径2：先升Neon Pro，后续迁移Turso（风险最低）

1. 立即：升级Neon Pro，改DATABASE_URL连接池参数 → 解决512MB问题
2. 1-2周后：在本地测试Turso兼容性，确认无误再迁移

---

_本文档由 Scout 生成于 2026-04-30_
