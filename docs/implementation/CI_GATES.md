# CI 门禁体系（AC-23）

> 状态：**已闭合**（2026-10-16）
> 相关：`FINAL_ACCEPTANCE_REPORT.md` §4.2 · `BACKLOG.md` §1
> 变更前基线：CI run `38848356361`（`4ceab89`）→ **failure**（Lint ❌ / Dependency audit ❌）

---

## 1. 为什么要有这份文档

AC-23 之前的 CI 处于一种**最坏的状态**：**部分常绿、部分恒红**。

- 常绿的部分（typecheck / jest / build / secret-scan / CodeQL）真的在保护；
- 恒红的部分（Lint / Dependency audit）**长期红着**，于是被所有人学会忽略，
  而它们本该拦住的**真回归**就淹没在存量噪音里。

恒红的门禁比没有门禁更危险 —— 它把「红」这个信号本身贬值了。
AC-23 要解决的不是「把红变绿」，而是**让红重新等于「你引入了问题」**。

---

## 2. 三道棘轮（ratchet）

三次都不是靠「降低标准」变绿的，而是靠**冻结存量 + 只拦新增**。

| 棘轮 | 脚本 | 冻结快照 | 自证 |
|---|---|---|---|
| Lint | `scripts/ci/lint-ratchet.mjs` | `lint-baseline.json` | `npm run verify:lint:ratchet` |
| 依赖审计 | `scripts/ci/dependency-ratchet.mjs` | `dependency-baseline.json` | `npm run verify:check:deps` |
| schema 漂移 | `scripts/ci/migration-drift-ratchet.mjs` | `migration-drift-baseline.json` | `npm run verify:check:migration-drift` |

### 2.1 共同语义

```
当前值 ≤ 冻结基线  →  ✅ 通过（下降记为「债务在还」）
当前值 > 冻结基线  →  🔴 判红（这才是门禁真正在拦的东西）
```

**规则强度一点没降**：基线之外的一切照旧按原 severity 报错。
降级 severity 与收敛扫描面都被否决（理由见 §2.3）。

### 2.2 为什么是「逐项」而不是「比总数」

只比总数时，「新加 3 条 `any`、顺手删掉 3 条旧的」会被判**通过**。
这是可被无意（也可被有意）绕过的**假门禁**。

三道棘轮的自证里都专门有一条测这个：

- Lint：`总数守恒（净变化 0）但发生位移：仍判红`
- 依赖：`严重度升级：判红`（high → critical 也算新增）
- 漂移：`新增漂移：判红`（按「类型 + 目标」逐条比对）

### 2.3 被否决的两条路（附实测理由）

**✗ 收敛 `npm run lint` 的扫描面**
实测全仓 1565 条债里，**1176 条（75%）就在 `src/`** —— 排除 `src/` 等于门禁失效。
真正该排除的只有构建产物（`coverage/` / `.open-next/` 合计仅 5 条），已排除。

**✗ 降级规则 severity**
那是削弱，不是收敛。改成棘轮后，**规则强度不变**，而 CI 重新可信。

---

## 3. CI job 地图（改造后）

| # | Job | 触发 | 是否阻断 | 说明 |
|---|---|---|---|---|
| 1 | Typecheck (tsc --noEmit) | push / PR | ✅ | 未改动 |
| 2 | Lint (ESLint · 棘轮) | push / PR | ✅ | 全仓产出报告 + 棘轮比对 |
| 3 | Test (Jest) | push / PR | ✅ | 未改动 |
| 4 | Build (next build) | push / PR | ✅ | **`continue-on-error` 已移除** |
| 5 | Migration（libSQL 文件库） | push / PR | ✅ | **新增**，免凭据 |
| 6 | E2E（构建产物 · 浏览器冒烟） | push / PR | ✅ | **新增** |
| 7 | Secret scan (gitleaks) | push / PR | ✅ | 未改动 |
| 8 | Dependency audit（生产可达 · 棘轮） | push / PR | ✅ | **`continue-on-error` 已移除** |
| 9 | DCO sign-off check | 仅 PR | ✅ | 未改动 |

### 3.1 `continue-on-error` 的两处移除，各有实证

- **Build**：CI run `38848356361` 中该 job 结论为 **success**，步骤级全绿 ——
  即构建在占位凭证下**本就通过**。`continue-on-error` 只是历史遗留的免责声明。
- **Dependency audit**：不是「已经绿了所以敢移除」，而是**改成棘轮后它有了真实判据**
  （新增 / 未登记 / 到期 → 判红）。详见 §5。

### 3.2 新增的 Migration job 到底在测什么

此前**从未有人验证过**：从零能不能把库建起来。

用途是 throwaway libSQL 文件库（`file:./ci-migrate.db`，provider 本就是 sqlite），
**不接触任何远程库、不需要 `TURSO_AUTH_TOKEN`**：

```
db push            → 建基线 schema（对齐项目实际做法，见 §4.1）
rollback --batch=ALL  → 卸掉批次表，回落到 T01 之前的基线
apply   --batch=ALL   → 重建 M0–M2 + C0–C9（**被测对象**）
apply   --batch=ALL   → 再跑一遍，幂等必须为空操作
verify                → 回读真实表结构的对账断言
漂移棘轮              → 已知漂移冻结，新增漂移判红
```

> **为什么必须先 rollback 再 apply**：批次 SQL 全是
> `CREATE TABLE IF NOT EXISTS`，在 `db push` 已建好的库上直接 apply 会**退化成空操作**，
> 这一环就白跑了。

### 3.3 新增的 E2E job 到底在防什么

CI 原本「构建」与「测试」是两个 job：`jest` 是**纯 Node、不起服务**；
`build` 只证明**构建期**能过。两者都绿，仍可能「部署上去起不来」——
运行期才暴露的东西（环境变量读取、instrumentation、路由装配、DB 连接方式）
没有任何一环在拦。这正是 T12 记下的「本地门禁全绿 ≠ CI 绿」。

⚠️ **没有**直接跑 `npm run test:e2e`：`playwright.config.ts` 的 `baseURL` 默认是
**生产站**，`tests/e2e/**` 还依赖真实测试账号 —— 挂到 CI 上等于每个 PR 都去打生产。
新增的是 `playwright.ci.config.ts` + `tests/e2e-ci/**`，对**本地构建产物**（`next start`）
做真实浏览器冒烟，判据全部取自**运行期事实**：

| # | 判据 | 它证明了什么 |
|---|---|---|
| ① | `GET /api/health` → 200 且 `status === 'healthy'` | 该端点内部真的执行 `db.user.count()` ⇒ **构建产物真的连上了库** |
| ② | 匿名 `GET /api/v1/{org,members}` → 401 | 鉴权守卫在构建产物里真实生效 |
| ③ | `/login` 渲染出 `#login-email` / `#login-password` | 客户端组件能水合，不是静态壳 |
| ④ | 未知路径 → 404 | 防止「任何路径都 200」把 ①③ 的断言变成永真 |
| ⑤ | `/` → 200 且返回 HTML | 根路径装配正常 |

---

## 4. 🔴 发现一：迁移目录从来不是建库路径

给 CI 加迁移环节时，先按常规写法试 `npx prisma migrate deploy`，
在一次性 libSQL 文件库上**从零建库直接失败**：

```
Error: P3018
Migration name: 20250413130000_add_product_optimization_features
Database error: near "DO": syntax error
```

根因（已核实）：

1. `prisma/migrations/20250413130000_.../migration.sql` 是 **PostgreSQL 专有 SQL**
   （`DO $$`、`CREATE TYPE ... AS ENUM`、`pg_type`、`information_schema`），
   而 `prisma.config.ts` 的 datasource provider 是 **sqlite**；
2. `prisma/migrations/initial_migration.sql` 是**空文件**；
3. 8 个迁移目录里只有最老的那一个含 PG 专有语法（其余 7 个方言无关）。

⇒ 结论：**生产库不是靠 migrations 建的**（是 `db push`），迁移目录与实际建库路径脱节。
Migration job 因此改用 `db push`，并在工作流里把这条理由写在步骤注释里。

> ⚠️ 副作用提示：`prisma db push` 会**删除** `prisma/schema` 未建模的列 ——
> 正好命中 §4.2 的 11 个 `organizationId` 列。因此 CI 中**加了安全断言**：
> 必须是 `file:` 本地库，且工作区不得存在 `.env` / `.env.local`（见 §4.3）。

---

## 4bis. 🔴 发现二：11 张核心表的 `organizationId` 未建模（已知漂移）

### 4bis.1 现象

批次 apply 之后，`prisma migrate diff` 报 **11 张核心表「被重定义」**：

```
[*] Redefined table `Block` / `ConsentGrant` / `ConsentRequest` / `Conversation` /
    `IMMessage` / `Match` / `Notification` / `Payment` / `PowerBoardRule` /
    `Subscription` / `UserReport`
```

### 4bis.2 定位过程（隔离，不是猜）

| 状态 | 漂移项 |
|---|---|
| 仅 `db push` | **0** |
| `db push` + tenancy `apply` | **11**（上面那 11 张） |
| `db push` + tenancy/connection `apply`（**不做 rollback**） | **11** |

⇒ 与 rollback 无关；**由 `tenancy migrate apply`（M1 批次）引入**。

再比对两个库里 `Block` 的真实 DDL：

```sql
-- db push 后
CREATE TABLE "Block" ( "id" TEXT NOT NULL PRIMARY KEY, "blockerId" …, "createdAt" … );

-- tenancy apply 后（多了一列）
CREATE TABLE "Block" ( "id" …, "createdAt" …,
  "organizationId" TEXT,          -- ← 这列在 prisma/schema 里不存在
  CONSTRAINT "Block_blockerId_fkey" … );
```

### 4bis.3 根因（两侧各自都符合自己的约束）

- `scripts/tenancy/migrate.mjs` 的 **M1** 对 `TENANT_SCOPED_TABLES`
  （= 上面那 11 张，`scripts/tenancy/migrate.mjs:49-61`）执行
  `ALTER TABLE "X" ADD COLUMN "organizationId" TEXT` + 建索引；
- `prisma/schema/tenancy.prisma` 文件头明确写着：
  「本文件**全部为新增模型**，不改动既有 39 个模型的任何列语义」。

⇒ 这**不是手滑**，是**有意的取舍**（纯新增、可独立回滚）。
但它的**后果此前没有被记录**：

| # | 后果 | 严重度 |
|---|---|---|
| ① | `prisma db push` 会**删掉**这 11 个 `organizationId` 列 ⇒ 租户归属数据丢失 | 🔴 高 |
| ② | Prisma Client 读不到 `organizationId` ⇒ 这 11 张表上的租户过滤只能走原生 SQL | 🟡 中 |
| ③ | 任何 schema 漂移检查都会永久非空 ⇒ 不加棘轮就没法当门禁 | 🟡 中 |

### 4bis.4 处置

**本次不修 schema**（会动到生产 DDL 与 T01 的迁移设计，超出 AC-23 半径，
且不应在发版冻结期做）。改为：

1. 用**漂移棘轮**把它冻结（`migration-drift-baseline.json`，含 `cause` 与 `reviewBy`）；
2. 后果 ① 已在 CI 中用安全断言规避（§4.3）；
3. 后果 ②③ 与「是否把 `organizationId` 补进 `core.prisma`」的决策，
   记入 `BACKLOG.md`，**复核期限 2026-12-15 到期由门禁强制复审**。

---

## 4ter. 🔴 发现三：迁移脚本会**优先读 `.env` 文件**，覆盖进程环境变量

`scripts/tenancy/migrate.mjs` 与 `scripts/connection/migrate.mjs` 的连接解析是：

```js
const url = args.url || env.DATABASE_URL || process.env.DATABASE_URL
//              ↑ 显式参数   ↑ 从 .env / .env.local 读出来的   ↑ 真实环境变量
```

⇒ `.env` 文件的优先级**高于**进程环境变量。后果是：

```bash
DATABASE_URL="file:/tmp/test.db" node scripts/connection/migrate.mjs apply --batch=ALL --yes
# ✗ 会被静默忽略 —— 实际打到 .env 里的那个库（本仓 = 生产 Turso）
```

**这是本次 CI 改造必须先处理的前置风险**（否则新增的 Migration job 变成对着生产库跑 DDL）。

处置（**不改脚本行为**，避免在发版冻结期动生产工具链）：

1. CI 的 Migration job 加**安全断言**：`DATABASE_URL` 必须是 `file:` 前缀，
   且工作区不得存在 `.env` / `.env.local` —— 任一条不满足即 `exit 1`；
2. 本地手工验证一律用**显式** `--url=file:...`（参数优先级最高）；
3. 「把优先级改成进程环境变量优先（12-factor 语义）」记入 `BACKLOG.md` 跟办。

---

## 5. 依赖审计：为什么是「棘轮 + 书面豁免」而不是「清零」

实测（2026-10-16）：

| 口径 | high | critical | moderate | low |
|---|---|---|---|---|
| 全量（含 devDependencies） | 34 | 3 | 28 | 2 |
| **生产可达**（`--omit=dev`） | **26** | **2** | 7 | 2 |

**为什么不能直接清零**：`npm audit fix --dry-run` 实测会改动 **162 个包、删除 34 个**
（含 `undici 7→8`、`deepmerge-ts 7→8` 这类**主版本跃迁**），
而且 **一条 high/critical 都没消掉** —— 可修的全部依赖 semver-major 升级。

**为什么不阻断全量**：37 条 high/critical 里有 9 条来自 `jest` / `ts-jest` /
`eslint-config-next` —— 这些**不进生产运行时**。混在一个门槛里，
真正该拦的生产漏洞会被这堆噪音淹掉。所以 dev 部分降为**非阻断报告**（仍打印、仍可见）。

**为什么 dev 依赖的处置都写得很粗**：见 `DEPENDENCY_RISK.md` —— 那是**有意**的，
每一组都注明了「为什么现在不修」以及**到期日**。

### 5.1 书面豁免的强制约束

`dependency-baseline.json` 的 `exemptions` 里，**每一条**被接受的生产高危必须有：

- `disposition`（`fix-planned` / `accept` / `mitigated` / `not-reachable`）
- `reason`（写实，不许写「暂不处理」）
- `reviewBy`（**到期由门禁判红** —— 不允许永久豁免）

缺任一项 ⇒ 门禁判红。这是防止「冻结」变成「遗忘」的机制。

---

## 6. 复跑与维护

```bash
# 三道棘轮的正常门禁
npm run lint:gate
npm run check:deps
# 漂移棘轮需要有一个已建好的库（本地用一次性文件库）
DATABASE_URL="file:/tmp/x.db" npm run check:migration-drift

# 三道自证（证明门禁真的会红，而不是永远绿）
npm run verify:lint:ratchet
npm run verify:check:deps
npm run verify:check:migration-drift

# 重写冻结快照（必须在同一提交里说明原因）
npm run lint:baseline
npm run check:deps:baseline
DATABASE_URL="file:/tmp/x.db" npm run check:migration-drift:baseline
```

---

## 7. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-10-16 | 首版。三道棘轮落地；CI 新增 Migration / E2E 两个 job；移除 `build` 与 `dependency-audit` 的 `continue-on-error`；发现并登记「迁移目录非建库路径」「11 表 `organizationId` 未建模」「迁移脚本 `.env` 覆盖环境变量」三项风险 |
