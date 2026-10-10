# T02 · changes — 变更记录

> 基线 commit `7988de4`（T02–T12 任务总盘）。
> 任务：创建免安装 Mission Link 与任务管理（`tasks/T02_MISSION_LINK.md`）。
> 验收：可真实创建分享并加入任务；无候选时不伪造；**AC-11**。

---

## 1. 提交

| 项 | 值 |
|---|---|
| 代码提交 | `49ee97d` — `feat(t02): Mission Link —— 免安装分享页、加入动作与幂等`（含 `[skip netlify]`） |
| 本文档回填 | 紧随其后的文档提交（`git log -1 --format=%h`） |
| 分支 | `main`（**未推送**，理由见 §7） |
| 工作树 | 干净 |

---

## 2. 交付物清单

### 2.1 Schema（新增 1 文件 + 3 处关系）

| 文件 | 规模 | 说明 |
|---|---|---|
| `prisma/schema/connection.prisma` | 新增 · 3 model + 2 enum | `Mission` / `MissionParticipation` / `IdempotencyRecord`；`MissionStatus` / `MissionParticipationStatus` |
| `prisma/schema/tenancy.prisma` | +5 行 | `Organization` 增加 `missions` / `missionParticipations` / `idempotencyRecords` 反向关系 |
| `prisma/schema/core.prisma` | +4 行 | `User` 增加 `missions @relation("UserMissions")` / `missionParticipations @relation("UserMissionParticipations")` |
| `src/generated/**` | 7 文件再生 | Prisma client 随 schema 再生（本仓生成物入库） |

**关键设计**：`organizationId` **必填**（T01 起新表第一天就带上，不走加列批次）；全文件**无 `@db.*` 原生类型**，同一份定义可同时为 libSQL 与 PostgreSQL 生成。

### 2.2 服务层（新增 7 文件 · 1,424 行）

| 文件 | 行 | 作用 | 关键约束 |
|---|---|---|---|
| `src/lib/connection/json-codec.ts` | 106 | JSON 文本编解码 | **脏数据永不抛异常**；`{` 开头按对象返回 `[]`（不误判为单元素数组） |
| `src/lib/connection/share-token.ts` | 43 | 令牌生成/形状预检 | 24B CSPRNG base64url；形状预检 22–128 字符 |
| `src/lib/connection/idempotency.ts` | 165 | `requireIdempotencyKey` / `withIdempotency` | 同键同体→回放、同键异体→409、**并发先回收孤儿再判定胜者** |
| `src/lib/connection/mission-input.ts` | 241 | 入参解析 + 白名单动作 | 动作白名单（无「其他」分支）；`LIMITS` 单点定义 |
| `src/lib/connection/public-view.ts` | 145 | 公开投影 + 可加入性判定 | **白名单投影**；`candidates: never[]`、`candidatesAvailable: false`；每个拒绝都有原因 |
| `src/lib/connection/missions.ts` | 617 | 服务层（CRUD/状态机/加入/撤销/分享数据） | 状态机查表 `TRANSITIONS`；所有查询带 `organizationId` 谓词；名额竞态补偿 |
| `src/lib/connection/index.ts` | 107 | 统一导出 | — |

### 2.3 API（新增 5 路由 · 320 行）

| 路由 | 行 | 能力/鉴权 | 说明 |
|---|---|---|---|
| `src/app/api/v1/missions/route.ts` | 89 | `mission.create` / `mission.read` | POST 强制 `Idempotency-Key`；GET 分页 |
| `src/app/api/v1/missions/[missionId]/route.ts` | 45 | 同上 | GET / PATCH（PATCH 走白名单字段） |
| `src/app/api/v1/missions/[missionId]/pause/route.ts` | 43 | `mission.update` | 动作白名单：publish / pause / resume / close |
| `src/app/api/v1/public/missions/[token]/route.ts` | 63 | **匿名可达** | 限流 120/5min → 形状预检 → 白名单投影 → `no-store` |
| `src/app/api/v1/public/missions/[token]/join/route.ts` | 80 | **需登录** | 匿名 401；限流按用户维度 |

### 2.4 前端（新增 2 文件 · 340 行）

| 文件 | 行 | 说明 |
|---|---|---|
| `src/app/m/[token]/page.tsx` | 234 | RSC 分享页，移动优先；未登录**可预览**；不可加入时显示确定原因；已加入显示状态 |
| `src/app/m/[token]/join-button.tsx` | 106 | 客户端按钮，`idle → submitting → joined / error`，401 跳登录并带 `callbackUrl` |

### 2.5 迁移（新增脚本 + 记录）

| 文件 | 说明 |
|---|---|
| `scripts/connection/migrate.mjs` | 458 行；子命令 `probe` / `plan` / `apply --batch=C0 --yes` / `rollback --batch=C0 --yes` / `verify`；**纯新增 + IF NOT EXISTS 幂等**；回滚遇有数据先备份 JSON |
| `prisma/migrations/20261010190000_t02_connection_mission/migration.sql` | 90 行；变更**记录**（DDL 由 `prisma migrate diff` 原样抄录） |
| `package.json` | 新增 `connection:{probe,plan,migrate,rollback,verify}`、`test:connection` |

### 2.6 配置改动（4 文件）

| 文件 | 改动 |
|---|---|
| `proxy.ts` | matcher 增加 `/m/:path*` |
| `src/config/region-policy.ts` | `getCacheControl` 对 `/m`、`/m/` 返回 `private, no-store` |
| `scripts/verify-region-policy.ts` | 新增分享页 no-store 断言（门禁 67 → **69** 项） |
| `src/lib/errors.ts` / `src/lib/api-response.ts` | 新增 `ValidationError`(400) / `ConflictError`(409) / `RateLimitError`(429) 与 `errorResponse` / `withErrorEnvelope` |

### 2.7 测试（新增 6 单测 + 1 E2E + 1 夹具）

| 文件 | 行 | 覆盖 |
|---|---|---|
| `tests/connection/json-codec.test.ts` | 123 | 编解码边界 / 脏数据容错 |
| `tests/connection/public-view.test.ts` | 138 | 白名单投影 / 不泄露内部字段 / 拒绝原因 |
| `tests/connection/mission-input.test.ts` | 184 | 入参校验 / 动作白名单 / 越界 |
| `tests/connection/idempotency.test.ts` | 224 | 回放 / 409 / 并发孤儿回收 |
| `tests/connection/missions.test.ts` | 507 | 状态机 / 跨租户 / 名额竞态 / 审计 |
| `tests/connection/mission-api.test.ts` | 493 | HTTP 层 401/403/404/409/400 信封 |
| `scripts/qa/seed-t02-e2e.mjs` | 204 | 隔离夹具库（`file:/tmp/t02-e2e.db`，45 表 + owner/member + ACTIVE/PAUSED） |
| `tests/e2e/mission-link.spec.ts` | 218 | **AC-11** 移动端 8 用例 |
| `playwright.t02.config.ts` | 57 | 真实 Chrome（channel）+ Pixel 5 视口 |

---

## 3. 生产库执行记录（**已执行**）

目标：`libsql://lokfeelcom-lokfeelboss.aws-us-east-1.turso.io`。

| 批次 | 动作 | 结果 |
|---|---|---|
| **C0** | 建 `Mission` / `MissionParticipation` / `IdempotencyRecord` + 9 个索引 + 6 个外键 | 三表建成（**17 / 8 / 8 列**） |
| `verify` | 25 项对账断言 | **25/25 通过**（本次复核复现） |
| `apply` 重跑 | 幂等性 | 全部 `IF NOT EXISTS` 空操作，行数不变 |
| 应用回归 | `/api/health` | 200 healthy |

**零停机、零回归**：C0 只 `CREATE TABLE/INDEX IF NOT EXISTS`，**不改动既有 48 张表的任何列**。

```
── C0 目标表状态 ──
  ✅ Mission                已存在 (列 17, 行 0)
  ✅ MissionParticipation   已存在 (列 8, 行 0)
  ✅ IdempotencyRecord      已存在 (列 8, 行 0)
```

---

## 4. 验收对照（诚实标注）

| 条目 | 等级 | 本轮状态 | 证据 |
|---|---|---|---|
| **AC-11** Mission Link：移动端可访问 / 未注册预览 / 敏感动作需身份验证 | P0 | ✅ **通过** | 移动端 E2E（真实 Chrome + Pixel 5）**8/8** 全绿：①匿名预览最小披露可见且**无**加入按钮 ②源码级不泄露内部标识 ③无候选渲染显式空态 ④无横向滚动 + 按钮拇指可达 ⑤不存在令牌→404 ⑥暂停任务给确定原因 ⑦未登录点击→跳登录带 `callbackUrl` ⑧**真实登录 → 真实加入 → 刷新仍已加入（幂等）→ 名额真实 1/5** |
| **AC-07** 幂等（本任务的最小落点） | P0 | 🟡 **部分通过** | `Idempotency-Key` 强制 + `(organizationId, scope, key)` 唯一约束 + 同键异体 409 + 并发孤儿回收，单测 224 行覆盖；**AC-07 的全量闭环（重试/接管）归 T06/T12** |

> **不虚报**：本任务的任务卡只写「验收 = AC-11」，已达成；
> AC-07 是本任务顺带建立的机制，但矩阵条目不因局部实现而标 PASS。

---

## 5. 过程中修掉的真实缺陷（3 个产品/工具缺陷 + 2 个测试缺陷）

1. **幂等并发漏回收孤儿**（由单测抓出）
   原判定 `winner && winner.requestHash === hash` 才回滚已写入的资源 →
   并发胜者若 `requestHash` 不同，**孤儿资源永久残留**。
   已改为 **总是先 `compensate` 再判定胜者**：命中且同体 → 回放；异体或资源失 → 409；否则抛原错。

2. **`json-codec` 把对象 JSON 当成单元素数组**
   契约字段声明为「字符串数组」，但对 `{"a":1}`（旧版本写入的脏数据 / 手工写入）会解析成
   `[' {"a":1} ']` 式的假元素。已修正：**`{` 开头直接返回 `[]`**，脏数据永不抛异常。

3. 🔴 **`verify` 的孤儿断言形同虚设**（本任务最值得记的一处）
   `countRows(client, table)` **只有两个形参**，而调用方传了第三个 `where` 子句 →
   参数被静默丢弃 → 实际执行 `SELECT COUNT(*) FROM "表"`，
   把**全表行数**当成「孤儿数」上报：
   - 空库 → 恒为 0 → **假绿**（生产库当时正好 0 行，所以首轮 25/25 看不出来）；
   - 非空库 → 稳定误报（本地夹具库报「孤儿 2 / 孤儿 1」，正是总行数 2 / 1）→ **假红**；
   - 且**引用完整性从未被真正校验**。
   已补上形参并加注释说明为何不可删。**负向自证**见 `tests.md` §4。

4. **E2E：dev 冷编译撞上客户端超时**（测试侧修复）
   Turbopack dev 下路由首次访问现场编译：`POST /api/auth/login` application-code **7.4s**
   （登录页自带 10s 客户端超时 → 服务端 200 但客户端已 abort）；
   `POST .../join` 整请求 **14.1s**（`next.js: 13.8s` / `application-code: 209ms`）。
   已在 `beforeAll` 预热两条写路由（登录用错误密码、加入用无会话请求 → 均**不产生副作用**）。

5. **E2E：hydration 延迟导致点击静默无效**
   RSC 页面在 `domcontentloaded` 时 DOM 可断言但 `onClick` 尚未挂载 → 点击无反应。
   已改为 `networkidle` + 容错重试块（成功后按钮被替换，故重试内只在按钮仍存在时才点击）。
   另：`public-view` 的 `candidates: never[]` 类型设计让页面只能渲染空态分支（编译期即保证铁律）。

---

## 6. 未完成项（明确不在本轮范围）

| # | 项 | 归属 | 状态 |
|---|---|---|---|
| 1 | `SocialIntent`（need/offer/逐字段披露/有效期） | T03 | ⏸ 未开始（`MissionParticipation` 已留稳定父锚点） |
| 2 | 候选检索与可解释排序（本轮 `candidates` 恒为空） | T04 | ⏸ 未开始 |
| 3 | 分享页图片/OG 卡片等富预览 | T07 | ⏸ 未开始 |
| 4 | 加入通知、加入者列表导出 | T07/T08 | ⏸ 未开始 |
| 5 | 分布式限流（现为 Redis 不可用时的进程内退化） | T12 / 运维 | ⏸ 见 `risks.md` R2 |
| 6 | 数据库级隔离（RLS） | M6（PG） | ⏸ 见 `risks.md` R3 |

---

## 7. 为什么本轮不推送

`nexus-app` 是**公开仓库**。本次提交包含：

- 分享令牌的**生成与校验策略**、限流的**具体阈值**、匿名可达面的**防护清单**；
- 生产库迁移与对账的**执行记录**。

是否公开披露由你决定。推送命令（含双通道代理兜底）：

```bash
bash scripts/push-main.sh
```

> 注：本次提交信息带 `[skip netlify]`，推送**不会触发构建**（省额度）。
> 原因不是"没风险"，而是**本任务尚未接生产入口**：分享页需真实数据才能演示，
> 待 T03 接通真实创建流程后再一次性发版。

---

_产出：2026-10-10 · 基线 `7988de4` · 代码提交 `49ee97d`_
