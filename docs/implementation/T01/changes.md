# T01 · changes — 变更记录

> 基线 commit `3faf1e9`（T00 审计交付）。
> 任务：身份与多租户底座（`tasks/T01_IDENTITY_TENANCY.md`）。
> 用户决策（2026-10-10）：数据层走 **P2 迁 PostgreSQL**；本轮范围为 **T01 租户底座**。

---

## 1. 提交

| 项 | 值 |
|---|---|
| 本任务提交 | `__COMMIT_SHA__`（见 `git log`，含 `[skip netlify]`） |
| 分支 | `main`（**未推送**，理由见 §7） |
| 工作树 | 干净 |

---

## 2. 交付物清单

### 2.1 Schema（新增 1 文件 + 1 处关系）

| 文件 | 规模 | 说明 |
|---|---|---|
| `prisma/schema/tenancy.prisma` | 新增 · 3 model + 3 enum | `Organization` / `Membership` / `TenantAuditEvent`；`MembershipRole` / `OrganizationStatus` / `MembershipStatus` |
| `prisma/schema/core.prisma` | +3 行 | `User` 增加 `memberships Membership[] @relation("UserMemberships")` |

> **未改动任何既有模型的列语义**。新增全部为独立模型 + 一处反向关系，
> 符合 `MIGRATION_PLAN.md` §2.1「加列优先、不破坏既有」。

### 2.2 运行时（新增 5 文件）

| 文件 | 作用 | 关键约束 |
|---|---|---|
| `src/lib/tenancy/capabilities.ts` | 角色→能力矩阵（**纯逻辑，零 IO**） | 权限判定是**查表**，无 LLM 参与（主指令硬要求） |
| `src/lib/tenancy/resolve.ts` | `resolveTenant()` / `resolveTenantForUser()` / `listTenants()` / `isMemberOf()` | **绝不信任客户端 organizationId**：传入值只作选择器，授权一律回查 `memberships` |
| `src/lib/tenancy/guard.ts` | `assertCapability()` / `hasCapability()` / `withTenant()` | 路由层接入点；失败默认拒绝 + 写审计 |
| `src/lib/tenancy/audit.ts` | `writeTenantAudit()` / `listTenantAudit()` / `redactMetadata()` | 元数据递归脱敏；**写入失败不改业务结果** |
| `src/lib/tenancy/index.ts` | 统一导出 | — |

### 2.3 迁移（新增脚本 + 记录）

| 文件 | 说明 |
|---|---|
| `scripts/tenancy/migrate.mjs` | 子命令 `probe` / `plan` / `apply --batch=M0\|M1\|M2\|ALL --yes` / `verify`；**幂等**（先查 `PRAGMA table_info` 再决定是否加列） |
| `prisma/migrations/20261010150000_t01_tenancy/migration.sql` | 变更**记录**（非可执行脚本，原因见文件头注释） |
| `package.json` | 新增 `tenancy:probe` / `tenancy:plan` / `tenancy:migrate` / `tenancy:verify` / `test:tenancy` |

### 2.4 测试（新增 3 文件）

`tests/tenancy/capabilities.test.ts` · `tests/tenancy/tenant-isolation.test.ts` · `tests/tenancy/audit-redact.test.ts`

### 2.5 文档

`docs/implementation/T01/DIALECT-DIFF.md` · `docs/implementation/T01/{changes,tests,risks,rollback}.md`

---

## 3. 生产库执行记录（**已执行**）

目标：`libsql://lokfeelcom-lokfeelboss.aws-us-east-1.turso.io`（42 张表，含真实业务数据）。

| 批次 | 动作 | 结果 | 用时 |
|---|---|---|---|
| **M0** | 建 `Organization`/`Membership`/`TenantAuditEvent` + 播种默认租户 | 3 表建成（6/7/8 列），`Organization` 1 行 | ~5s |
| **M1** | 11 张业务表加**可空** `organizationId` | 11/11 成功 | 19.8s |
| **M2** | 存量行回填 `org_default` | **2,764 行** | 15.4s |
| **verify** | 18 项对账断言 | **18/18 通过** | — |

M2 回填明细：`Match` 114 · `Conversation` 109 · `IMMessage` 200 · `Subscription` 2225 · `Payment` 56 · `Notification` 60，其余 0。

> ✅ **迁移前置状态已留证**：执行前 `probe` 显示三表均不存在、11 表均无 `organizationId`。
> ✅ **生产回归**：迁移后 `/api/health` → `200 healthy`（dbLatency 1.07s），`/api/geo-check` → 200。
> 应用层未受影响 —— 既有代码不读写 `organizationId`，旧 Prisma client 用显式列名查询。

---

## 4. 验收对照（诚实标注）

| 条目 | 等级 | 本轮状态 | 说明 |
|---|---|---|---|
| **AC-02** 未授权访问（匿名 / 过期 token / 角色越权全部拒绝） | BLOCKER | ✅ **通过** | 3 类拒绝均有自动化断言：匿名→401、tokenVersion 失配→401、角色越权→403；另有 21 项角色矩阵负测 |
| **AC-01** 多租户隔离 | BLOCKER | 🟡 **部分通过** | 本轮覆盖 **成员 / 审计** 两个维度（跨租户读取负测 + 查询谓词防回归断言）；**任务 / 提案 / 分析** 维度依赖 T02/T04/T08 的实体，届时补测 |

> 按主指令「不得虚报完成状态」：**AC-01 不标 PASS**，标「部分通过（成员+审计维度）」。
> T01 的**完成定义**（代码已提交 / 迁移可回滚 / CI 可复现 / 安全测试通过 / 对应验收条目有证据）已满足；
> 但 AC-01 的全量闭环需等后续任务补齐实体后才能整体判定。

---

## 5. 过程中修掉的 2 个真实缺陷

1. **`scripts/tenancy/migrate.mjs` 自身误判**（首轮 probe 即暴露）
   `PRAGMA table_info("<不存在的表>")` 返回**空结果集**而非报错，`[]` 在 JS 中是 truthy →
   脚本把「三表不存在」误报为「已存在」。已修正为「空结果集 → null」。
   *教训：探测型脚本的「不存在」判定必须显式基于长度，不能用 truthiness。*

2. **能力矩阵声明遗漏**（由测试抓出）
   `outcome.verify` 在 `TENANT_CAPABILITIES` 中声明，却未分配给任何角色 → `OWNER` 也不具备该能力。
   已归入 `ADMIN_EXTRA`（结果核验直接影响计费归因，保守取严），并新增结构性断言
   「不存在『已定义但谁也拿不到』的能力」防复发。

另修：`prisma migrate diff --to-schema-datamodel` 在 Prisma 7 已更名为 `--to-schema`
（原文档写法会报错，已同步 `DIALECT-DIFF.md` §5）。

---

## 6. 未完成项（明确不在本轮范围）

| # | 项 | 归属 | 状态 |
|---|---|---|---|
| 1 | `provider` 切 `postgresql`（M6） | T01 后续批次 | 📄 方案就绪（`DIALECT-DIFF.md` §2/§5），**未执行** |
| 2 | RLS 策略（M5/M6） | T01 后续批次 | 📄 方案就绪（§4），**未启用**（libSQL 无 RLS） |
| 3 | 30 个 String-JSON 字段迁 `jsonb` | M6 后独立批次 | 📄 已列出（§3.2），**未触碰** |
| 4 | 加 `NOT NULL` + FK + 唯一约束（M5） | 观察期后 | ⏸ 需用户确认（`MIGRATION_PLAN.md` Q4） |
| 5 | 业务路由接入 `withTenant()` | T02 起 | ⏸ 本轮无消费方（`tenancy/` 零引用，行为不变） |
| 6 | 跨租户 Bridge（opt-in 视图） | T10 | ⏸ 未开始 |

---

## 7. 为什么本轮不推送

`nexus-app` 是**公开仓库**。本次提交包含：
- 生产库的**迁移执行记录**（回填行数、表规模）；
- `DIALECT-DIFF.md` 中的**方言差异与攻击面分析**。

是否公开披露由你决定。推送命令（含双通道代理兜底）：

```bash
bash scripts/push-main.sh
```

> 注：本次提交信息带 `[skip netlify]`，推送**不会触发构建**（省额度，且本轮无运行时行为变化）。

---

_产出：2026-10-10 · 基线 `3faf1e9`_
