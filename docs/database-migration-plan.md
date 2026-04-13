# LokFeel 数据库迁移方案

> **迁移目标**: 支持产品优化新功能 (诚意值系统、限时聊天、匹配申请信)  
> **迁移策略**: 零停机在线迁移 (Zero-Downtime Migration)  
> **风险评估**: 低风险 (仅新增表和字段，无数据删除)  
> **预计耗时**: 15-30分钟 (含备份、验证、回滚准备)

---

## 一、迁移策略选择

### 1.1 策略对比

| 策略 | 适用场景 | 停机时间 | 复杂度 | 本次选择 |
|------|----------|----------|--------|----------|
| **在线迁移** | 新增表/字段 | 0 | 低 | ✅ **采用** |
| 蓝绿部署 | 大规模重构 | 0 | 高 | - |
| 滚动迁移 | 分片数据库 | 分钟级 | 中 | - |
| 停机迁移 | 紧急修复 | 小时级 | 低 | - |

### 1.2 为什么选择在线迁移

1. **变更性质**: 仅新增表和可选字段，无破坏性变更
2. **Prisma支持**: `prisma migrate dev` 支持原子性DDL
3. **Neon PostgreSQL**: 支持在线DDL，不锁表
4. **业务连续性**: Phase 3增长期，不能停机

---

## 二、迁移前准备

### 2.1 数据备份

```bash
# 1. 创建完整备份 (Neon控制台或pg_dump)
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql

# 2. 验证备份完整性
pg_restore --list backup_*.sql | head -20
```

### 2.2 环境检查清单

- [ ] 生产数据库连接正常
- [ ] 备份已完成且可恢复
- [ ] 迁移脚本已测试通过 (staging环境)
- [ ] 回滚脚本已准备
- [ ] 监控告警已开启
- [ ] 团队通知已发送

### 2.3 回滚方案

```sql
-- 紧急回滚脚本 (如需回滚到迁移前状态)
-- 注意：仅删除新增表，保留已有数据

DROP TABLE IF EXISTS "SincerityTransaction" CASCADE;
DROP TABLE IF EXISTS "SincerityWallet" CASCADE;

-- 移除Match表新增字段 (可选，保留更安全)
-- ALTER TABLE "Match" DROP COLUMN IF EXISTS "pitchMessage";
-- ALTER TABLE "Match" DROP COLUMN IF EXISTS "giftAmount";
-- ALTER TABLE "Match" DROP COLUMN IF EXISTS "isUnread";
-- ALTER TABLE "Match" DROP COLUMN IF EXISTS "expiresAt";

-- 移除ChatRoom表新增字段
-- ALTER TABLE "ChatRoom" DROP COLUMN IF EXISTS "vaultExpiry";
-- ALTER TABLE "ChatRoom" DROP COLUMN IF EXISTS "status";
-- ALTER TABLE "ChatRoom" DROP COLUMN IF EXISTS "revokedAt";
-- ALTER TABLE "ChatRoom" DROP COLUMN IF EXISTS "revokedBy";
```

---

## 三、迁移执行步骤

### Step 1: 预迁移检查 (2分钟)

```bash
# 检查数据库连接
cd /Users/frankzhao/WorkBuddy/20260402202519/nexus-app
npx prisma db pull --print

# 检查当前迁移状态
npx prisma migrate status
```

### Step 2: 生成迁移文件 (3分钟)

```bash
# 生成迁移 (不立即执行)
npx prisma migrate dev --create-only --name add_sincerity_system_and_vault

# 生成的迁移文件位于: prisma/migrations/YYYYMMDD_HHMMSS_add_sincerity_system_and_vault/
```

### Step 3: 审核迁移SQL (5分钟)

迁移文件应包含以下内容：

```sql
-- 1. 创建SincerityWallet表
CREATE TABLE "SincerityWallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "totalEarned" INTEGER NOT NULL DEFAULT 0,
    "totalSpent" INTEGER NOT NULL DEFAULT 0,
    "tier" TEXT NOT NULL DEFAULT 'bronze',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SincerityWallet_pkey" PRIMARY KEY ("id")
);

-- 2. 创建SincerityTransaction表
CREATE TABLE "SincerityTransaction" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "matchId" TEXT,
    "fromUserId" TEXT,
    "toUserId" TEXT,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SincerityTransaction_pkey" PRIMARY KEY ("id")
);

-- 3. 添加唯一约束和索引
CREATE UNIQUE INDEX "SincerityWallet_userId_key" ON "SincerityWallet"("userId");
CREATE INDEX "SincerityTransaction_walletId_idx" ON "SincerityTransaction"("walletId");
CREATE INDEX "SincerityTransaction_createdAt_idx" ON "SincerityTransaction"("createdAt");

-- 4. 添加外键约束
ALTER TABLE "SincerityWallet" ADD CONSTRAINT "SincerityWallet_userId_fkey" 
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SincerityTransaction" ADD CONSTRAINT "SincerityTransaction_walletId_fkey" 
    FOREIGN KEY ("walletId") REFERENCES "SincerityWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. 扩展Match表
ALTER TABLE "Match" ADD COLUMN "pitchMessage" TEXT;
ALTER TABLE "Match" ADD COLUMN "giftAmount" INTEGER DEFAULT 0;
ALTER TABLE "Match" ADD COLUMN "isUnread" BOOLEAN DEFAULT true;
ALTER TABLE "Match" ADD COLUMN "expiresAt" TIMESTAMP(3);

-- 6. 扩展ChatRoom表
ALTER TABLE "ChatRoom" ADD COLUMN "vaultExpiry" TIMESTAMP(3);
ALTER TABLE "ChatRoom" ADD COLUMN "status" TEXT DEFAULT 'ACTIVE';
ALTER TABLE "ChatRoom" ADD COLUMN "revokedAt" TIMESTAMP(3);
ALTER TABLE "ChatRoom" ADD COLUMN "revokedBy" TEXT;

-- 7. 扩展Profile表
ALTER TABLE "Profile" ADD COLUMN "occupation" TEXT;
ALTER TABLE "Profile" ADD COLUMN "company" TEXT;
ALTER TABLE "Profile" ADD COLUMN "industry" TEXT;
ALTER TABLE "Profile" ADD COLUMN "linkedInVerified" BOOLEAN DEFAULT false;
ALTER TABLE "Profile" ADD COLUMN "verificationBadge" TEXT;
```

### Step 4: 执行迁移 (5分钟)

```bash
# 执行迁移
npx prisma migrate deploy

# 验证迁移成功
npx prisma migrate status
```

### Step 5: 生成Prisma Client (2分钟)

```bash
# 重新生成客户端
npx prisma generate

# 验证类型定义
npx tsc --noEmit --skipLibCheck
```

### Step 6: 数据初始化 (3分钟)

```bash
# 为现有用户创建SincerityWallet (余额为0)
# 此脚本将在部署后执行
node scripts/init-sincerity-wallets.js
```

---

## 四、迁移后验证

### 4.1 数据库验证

```sql
-- 验证表创建
SELECT tablename FROM pg_tables WHERE schemaname='public' 
AND tablename IN ('SincerityWallet', 'SincerityTransaction');

-- 验证字段添加
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'Match' AND column_name IN ('pitchMessage', 'giftAmount', 'isUnread', 'expiresAt');

-- 验证外键约束
SELECT tc.constraint_name, tc.table_name, kcu.column_name 
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY' 
AND tc.table_name IN ('SincerityWallet', 'SincerityTransaction');
```

### 4.2 应用验证

- [ ] API健康检查通过
- [ ] 用户注册流程正常
- [ ] 匹配流程正常
- [ ] 聊天功能正常
- [ ] 无新增错误日志

---

## 五、风险缓解

### 5.1 风险矩阵

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| 迁移失败 | 低 | 高 | 完整备份 + 回滚脚本 |
| 性能下降 | 低 | 中 | 索引优化 + 监控 |
| 数据不一致 | 极低 | 高 | 事务性DDL + 验证 |
| 应用兼容性问题 | 中 | 中 | 代码先行兼容 + 灰度发布 |

### 5.2 监控指标

```typescript
// 迁移后监控 (24小时内)
interface MigrationMetrics {
  // 数据库
  dbConnectionErrors: number;      // 应 = 0
  queryLatencyP95: number;         // 应 < 200ms
  
  // 应用
  apiErrorRate: number;            // 应 < 0.1%
  matchCreationSuccess: number;    // 应 > 99%
  chatMessageDelivery: number;     // 应 > 99%
  
  // 业务
  newUserRegistrations: number;    // 与基线对比
  matchAcceptanceRate: number;     // 与基线对比
}
```

---

## 六、执行命令汇总

```bash
# 1. 进入项目目录
cd /Users/frankzhao/WorkBuddy/20260402202519/nexus-app

# 2. 备份数据库 (Neon控制台执行或使用pg_dump)

# 3. 生成迁移
npx prisma migrate dev --create-only --name add_sincerity_system_and_vault

# 4. 审核迁移SQL文件
# 文件位置: prisma/migrations/YYYYMMDD_HHMMSS_add_sincerity_system_and_vault/migration.sql

# 5. 执行迁移
npx prisma migrate deploy

# 6. 生成Prisma Client
npx prisma generate

# 7. 初始化数据
node scripts/init-sincerity-wallets.js

# 8. 部署应用
vercel --prod

# 9. 验证
# - 访问 https://app.lokfeel.com
# - 检查健康检查端点
# - 验证核心功能
```

---

## 七、紧急联系

| 角色 | 联系人 | 职责 |
|------|--------|------|
| 技术负责人 | Frank | 迁移决策、回滚授权 |
| 数据库管理员 | Neon Support | 数据库紧急修复 |
| 运维 | Vercel Support | 部署问题 |

---

*迁移方案版本: v1.0*  
*创建时间: 2026-04-13*  
*最后更新: 2026-04-13*
