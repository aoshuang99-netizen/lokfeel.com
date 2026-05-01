# Turso 数据库迁移指南

## 架构变更

| 组件 | 旧方案 (Neon) | 新方案 (Turso) |
|------|--------------|----------------|
| 数据库 | Neon PostgreSQL | Turso libSQL (SQLite) |
| 驱动 | `pg` + `@prisma/adapter-pg` | `@libsql/client` + `@prisma/adapter-libsql` |
| 连接 | WebSocket/HTTP | HTTP (边缘优化) |
| 免费额度 | 512MB | 9GB 存储 + 1B 行读 |
| 区域 | 1个 | 多区域复制 |
| Schema | String[], @db.Text | String (JSON序列化) |

## 迁移步骤

### Step 1: 创建 Turso 数据库

```bash
# 安装 Turso CLI
curl -sSfL https://get.tur.so/install.sh | bash

# 登录
turso auth login

# 创建数据库
turso db create lokfeel-prod --group default

# 获取连接URL
turso db show lokfeel-prod --url

# 创建 Auth Token
turso db tokens create lokfeel-prod
```

### Step 2: 更新环境变量

在 Vercel 项目设置中更新以下环境变量：

```
# 旧变量 (删除)
DATABASE_URL=postgresql://...neon.tech/...

# 新变量
DATABASE_URL=libsql://lokfeel-prod-[your-org].turso.io?authToken=[your-token]
TURSO_AUTH_TOKEN=[your-token]
```

⚠️ **重要**：DATABASE_URL 格式必须是 `libsql://` 开头

### Step 3: 导出 Neon 数据

```bash
# 确保 .env 中有 Neon 的 DATABASE_URL
cd nexus-app
npx tsx scripts/migrate-neon-to-turso.ts
```

这会生成 `migration-data.json`

### Step 4: 推送 Schema 到 Turso

```bash
# 切换 .env 到 Turso DATABASE_URL
npx prisma db push
```

### Step 5: 导入数据到 Turso

```bash
npx tsx scripts/migrate-neon-to-turso.ts --import
```

### Step 6: 验证

```bash
# 检查表结构
curl https://app.lokfeel.com/api/db-check

# 测试登录
curl -X POST https://app.lokfeel.com/api/auth/callback/credentials
```

## 代码变更清单

| 文件 | 变更 |
|------|------|
| `prisma/schema.prisma` | provider=sqlite, String[]→String, 删除@db.Text |
| `src/lib/db.ts` | adapter-pg → adapter-libsql |
| `src/lib/json-helpers.ts` | 新增：jsonArr/toJson/pushJson 辅助函数 |
| `package.json` | pg → @libsql/client + @prisma/adapter-libsql |
| `src/app/api/db-check/route.ts` | information_schema → PRAGMA table_info |
| `src/app/api/settings/route.ts` | selectedTags读写jsonArr/toJson |
| `src/app/api/square/route.ts` | selectedTags/interests读jsonArr |
| `src/app/api/upload/route.ts` | galleryPhotos写pushJson |
| `src/app/api/profile/route.ts` | JSON数组字段自动序列化 |
| `src/app/api/profile/[userId]/route.ts` | interests读jsonArr |
| `src/app/api/admin/import-users/route.ts` | interests/hobbies写toJson |
| `src/app/api/admin/generate-test-users/route.ts` | selectedTags写toJson |
| `src/app/api/im/send/route.ts` | complianceTags写toJson |
| `src/app/api/matches/[id]/pitch/generate/route.ts` | interests读jsonArr |
| `src/lib/im/queries.ts` | complianceTags读写jsonArr/toJson |
| `src/lib/im/bot-reply.ts` | complianceTags写toJson |
| `src/lib/socket/delivery.ts` | complianceTags写toJson/读jsonArr |
| `src/lib/bot-automation.ts` | interests读jsonArr |
| `src/lib/matching/scoring.ts` | interests/defbreakers读jsonArr |
| `scripts/migrate-neon-to-turso.ts` | 新增：数据迁移脚本 |

## Turso 免费计划对比

| 指标 | Neon Free | Turso Free (Starter) |
|------|-----------|---------------------|
| 存储 | 512MB | 9GB |
| 行读 | 无限 | 1B/月 |
| 行写 | 无限 | 25M/月 |
| 数据库 | 1 | 3 |
| 复制 | 无 | 3区域 |
| 连接 | 限制 | 无限HTTP |

## 回滚方案

如果迁移后出问题：
1. 在 Vercel 恢复旧的 `DATABASE_URL` (Neon)
2. 恢复 `git checkout HEAD~1 -- src/lib/db.ts package.json prisma/schema.prisma`
3. `npm install`
4. `npx prisma generate`
5. 重新部署
