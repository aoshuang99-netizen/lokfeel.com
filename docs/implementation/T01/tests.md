# T01 · tests — 测试证据

> 所有命令均可复现。数据库相关的两步（本地演练 / 生产对账）分别标注了目标库。

---

## 1. 运行命令与结果

| # | 命令 | 目标 | 结果 |
|---|---|---|---|
| 1 | `npx jest tests/tenancy --silent` | 单元/集成 | ✅ **49 passed / 49**（3 suites） |
| 2 | `npm run check:script-decls` | 脚本静态检查 | ✅ 39 脚本 / 0 未声明引用 |
| 3 | `npx tsc --noEmit` | 全量类型 | ✅ **0 error**（exit 0） |
| 4 | `npx jest --silent`（全量） | 回归 | 见 §5 |
| 5 | `npm run tenancy:verify` | **生产库**对账 | ✅ **18/18 通过** |
| 6 | `npm run tenancy:verify -- --url=file:/tmp/t01-test.db` | **本地演练库**对账 | ✅ 18/18 通过（迁移前为 ❌，见 §4） |

---

## 2. 用例清单（49 条）

### 2.1 `tests/tenancy/capabilities.test.ts`（21 条）

| 分组 | 覆盖点 |
|---|---|
| 角色集合 | 与 `contracts/schema.sql:12` 的 CHECK 取值逐字一致；每角色均有能力定义 |
| 单调性 | `MEMBER ⊆ OPERATOR ⊆ ADMIN ⊆ OWNER` 逐项验证；`OWNER` 覆盖全部 21 项能力 |
| **结构性守卫** | **「不存在已定义但谁也拿不到的能力」** ← 曾抓出 `outcome.verify` 遗漏缺陷 |
| 越权拒绝 | MEMBER 不能管人/建 Mission/读审计；OPERATOR 不能管人/核验；ADMIN 不能处置租户；OWNER 独占 `org.*` |
| 默认拒绝 | `null` / `undefined` / 未知字符串（含大小写变体）一律无权限 |
| `parseTenantRole` | 接受 4 个契约值；拒绝 `'owner'`（小写）、`''`、数字、对象 |
| `capabilitiesOf` | 与 `can()` 判定一致；MEMBER 能力数 < OWNER |

### 2.2 `tests/tenancy/tenant-isolation.test.ts`（22 条）

| 分组 | 覆盖点 |
|---|---|
| **AC-01** 身份 | 匿名 → 401 且**不触达租户查询**；tokenVersion 失配 → 401；游客会话 → 401 |
| **AC-02** 跨租户 | 指定他人租户 → 403 + 写 `tenant.access_denied` 审计 |
| 🔒 **防回归锁** | **查询必须同时以 `userId` 与 `organizationId` 为谓词**，且 `status='ACTIVE'`、`organization.status='ACTIVE'` —— 若有人删掉 `userId` 谓词，此断言立刻失败 |
| 租户边界 | 不属于任何租户 → 403；租户停用 → 403；成员停用 → 403；脏角色 `SUPERADMIN` → 403（fail-closed） |
| 审计噪音 | 「无租户」的正常 403 **不写**审计；「指定他人租户」的越权**写**审计 |
| 成功路径 | 合法成员返回完整 `TenantContext`；`resolveTenantForUser` 不经过会话校验（供脚本用） |
| 越权能力 | MEMBER→`member.invite` 403；OPERATOR→`org.delete` 403；OPERATOR→`outcome.verify` 403；ADMIN→`org.transfer` 403；OWNER→`org.delete` 放行 |
| 列表 | `listTenants` 过滤未知角色；`isMemberOf` 命中/未命中 |

### 2.3 `tests/tenancy/audit-redact.test.ts`（15 条）

| 分组 | 覆盖点 |
|---|---|
| `redactMetadata` | 敏感键整值替换（password/token/email/authorization/apiKey…）；大小写与 `-`/`_` 变体均命中；非敏感字段保留；数组逐项脱敏且上限 50；深度上限 4 层；原始值原样返回 |
| `writeTenantAudit` | 入库前已脱敏；无 metadata 时存 `null`；缺 `organizationId` 直接跳过 |
| 🔒 **容错** | **审计写入失败必须被吞掉**（`resolves.toBeUndefined()`）—— 否则审计库故障会升级为全站故障 |
| `listTenantAudit` | 查询带 `organizationId` 谓词（租户隔离）；`limit` 钳制在 1..500 |

---

## 3. 生产库对账（`npm run tenancy:verify`）

```
✅ 表 Organization 存在          ✅ 表 Membership 存在        ✅ 表 TenantAuditEvent 存在
✅ Organization 行数 ≥ 1 — 1     ✅ 默认租户(slug=default) 恰 1 条
✅ M1 列已就位 — 全部就位
✅ Match/Conversation/IMMessage/ConsentRequest/ConsentGrant/PowerBoardRule/
   Subscription/Payment/Notification/UserReport/Block 各表 organizationId 无空值（NULL=0）
✅ Membership 无孤儿行 — 0
━━ 结果：✅ 全部通过（18/18）
```

---

## 4. 负向验证（证明测试与校验器**并非空转**）

| # | 手段 | 预期 | 实测 |
|---|---|---|---|
| 1 | 在**本地库**上「迁移前」跑 `verify` | 应失败 | ✅ 6 项 ❌（三表不存在、缺列 11 张），exit 1 |
| 2 | 迁移后重跑 `apply --batch=ALL` | 应全部跳过 | ✅ 11 张表全 `⏭ 已有 organizationId，跳过（幂等）`，回填 0 行 |
| 3 | 测试自身抓缺陷 | 应能抓出 | ✅ `capabilities.test.ts` 首轮真实抓出 `outcome.verify` 未分配 |
| 4 | `check-script-decls` | 覆盖新脚本 | ✅ 39 个脚本（含 `scripts/tenancy/migrate.mjs`）/ 0 未声明 |

### 本地演练的完整链路（可复现）

```bash
# 1) 从基线 schema 生成 DDL（临时移开 tenancy.prisma 与其反向关系）
#    → /tmp/t01-base.sql（1216 行，不含 organizationId / Organization，已验证）
sqlite3 /tmp/t01-test.db < /tmp/t01-base.sql          # 39 张表
# 2) 造存量数据：Conversation ×2、Block ×1、PowerBoardRule ×1
node scripts/tenancy/migrate.mjs verify --url=file:/tmp/t01-test.db    # ❌ 预期失败
node scripts/tenancy/migrate.mjs apply --batch=ALL --yes --url=file:/tmp/t01-test.db
node scripts/tenancy/migrate.mjs verify --url=file:/tmp/t01-test.db    # ✅ 18/18
# 3) M2 回填行数与造数精确吻合：Conversation 2、PowerBoardRule 1、Block 1
```

---

## 5. 全量回归

`npx jest --silent` 结果见 `changes.md` 提交时记录。

**已知的既有失败（与本任务无关，T00 已用 worktree 对照证明）**：
`plans-consistency`、`webrtc/components`。判定标准：本任务**未新增失败**。

---

## 6. 明确未覆盖（诚实标注）

| 项 | 原因 |
|---|---|
| HTTP 层端到端负测（真实请求打 `/api/*` 看 401/403） | 本轮 `tenancy/` **无任何路由消费方**，无可打的目标。T02 接入首个租户作用域接口时补 E2E |
| DB 级 RLS 负测 | libSQL 无 RLS，需 M6 上 PostgreSQL 后才能测 |
| 多租户真实并发的隔离压测 | 需 T02 起有真实实体与流量 |
| 浏览器 E2E | 同上（本任务无 UI 变更） |

---

_产出：2026-10-10_
