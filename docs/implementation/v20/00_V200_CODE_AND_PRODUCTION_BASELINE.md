# V20.0 · 00 — 代码事实源与生产基线（Batch 0 · 只读审计）

> 本文件是 V20.0 的**事实锚点**。所有结论均来自本次会话真实读取的源码、配置与 `git` / 线上事实，未臆造。
> 凡无法从现有代码确认的项，一律标 `UNKNOWN` 或 `BLOCKED`，不编造。
> 复检命令均可在本地重跑；线上事实以 `GET /api/health` 与 `git ls-remote` 为准。

---

## 1. 范围与目的

V20.0 的终极交付是「设计 ↔ 代码 ↔ API 状态 ↔ 测试截图 ↔ Git Commit ↔ 部署 SHA」六层一一对应。
本文件（B0）只回答第一层：**现在的代码与世界长什么样**。它不改造任何东西。

---

## 2. 代码事实源（git / 生产）

| 项 | 值 | 取证方式 |
| --- | --- | --- |
| 仓库本地路径 | `/Users/frankzhao/WorkBuddy/20260402202519/nexus-app` | — |
| 当前 `HEAD` | `d4ad0d4`（分支 `t4/v199-visual` = `origin/main` = `main`） | `git log --oneline -1` |
| 远端 `main` | `d4ad0d4`（与本地一致，领先/落后 = 0/0） | `git rev-list --left-right --count origin/main...HEAD` |
| 生产部署代码 SHA | `79459d6` | `GET /api/health → commit` 线上回读 |
| 工作树状态 | 仅 `docs/implementation/v20/` 未跟踪（本批新增），其余干净 | `git status --short` |
| 框架 | Next 16.4.2（Turbopack）、React 19.3、Prisma 7.x、NextAuth v5 beta | `package.json` / 已知 |
| 数据库 | libSQL / Turso（provider=sqlite，方言无关写法） | `prisma/schema/*` |
| 部署目标 | Netlify `lokfeel`（= `app.lokfeel.com`），Next.js 官方插件 | `netlify.toml` |
| 线上健康 | `healthy`；db 252ms；Upstash Redis up；botModule on | `GET /api/health` |

> ⚠️ 诚实保留项：WorkBuddy 自报的 `prod-smoke 15/15`、`public-origin 13/13`、`payment-off 18/18` 三组为脚本自报，**本次 B0 未重跑**；Netlify build API 无令牌未直查。线上 `commit=79459d6` 已与部署 ID 一致，部署事实成立。

---

## 3. 生产部署拓扑（Netlify）

来源：`netlify.toml`（真实读取）。

- **构建**：`command = "npm run build"`，`publish = ".next"`。
- **Node**：`NODE_VERSION = "22"`（与 `.nvmrc` 一致；openai@7 要求 node≥22）。
- **插件**：`@netlify/plugin-nextjs`（`latest` 在构建期解析）。
- **定时任务**：`[functions.cron-runner]` `schedule = "23 * * * *"`，用 `CRON_SECRET` 打内部 cron 端点（替代 Vercel Cron）。
- **Geo/安全**：`src/config/region-policy.ts` + 根 `proxy.ts` 中间件，先读 `x-vercel-ip-country` 再回退 `cf-ipcountry`（Cloudflare 橙云已带该头）。验证：`npm run verify:geo`。
- **Bot 模块**：默认关闭（`BOT_ENGINE_ENABLED` 未设 = off）；本生产部署显式 `=true`（Netlify 站点 env，contexts: production/branch-deploy/deploy-preview）。
- **必要的环境变量**（Netlify 后台设置，非仓库）：`DATABASE_URL`、`AUTH_SECRET`、`GOOGLE_CLIENT_ID/SECRET`、`NEXT_PUBLIC_PUSHER_*`、`PUSHER_*`、`CREEM_API_KEY/Webhook`、`STRIPE_SECRET_KEY`、`NEXT_PUBLIC_SITE_URL=https://app.lokfeel.com`、`DEBUG_SECRET` 等。

> ⚠️ 关键纪律（来自 `netlify.toml` 注释与历史教训）：`[skip netlify]` 提交只绕过 Netlify 钩子，**不**触发新构建；推送过的提交**禁止 `--amend`**；发布结论**只认 `git ls-remote`**，脚本退出码不算（沙箱拒 keychain 会 exit≠0 但推送成功）。

---

## 4. 路由清单（Next App Router · 真实）

### 4.1 Workspace —— **单路由 + 内部视图切换**（用户 V20 要求先核验的机制）

- 入口：`src/app/workspace/page.tsx` → `src/app/workspace/living-workspace.tsx`（客户端组件）。
- **不是六个独立 URL**，是一个 `LivingShell` + `NAV` 数组按 `activeKey` 切换。
- `NAV` 定义（真实，来自 `living-workspace.tsx:115-123`）：

| key | 标签 | ready | 说明 |
| --- | --- | --- | --- |
| `now` | Now | ✅ | 今日工作台（通知/未读/待你介绍） |
| `studio` | Studio | ✅ | 目标编译器（本地 `compileWorkspaceSpec` + `POST /api/v1/missions`） |
| `field` | Field | ✅ | 连接场 2.5D 关系网络 |
| `consent` | Consent | ✅ | 同意与逐字段披露（含跨社群子面板） |
| `outcomes` | Outcomes | ✅ | 成果时间轴与指标 |
| `agents` | Agents | ✅ | Agent 运行与审批（`agent.run` 能力开启时） |
| `missions` | Missions | ❌ | **`ready:false`**，未接线（创建已在 Studio，刻意不重复入口） |

> ⚠️ **与用户「Workspace 六屏」枚举的差异（需决策，标 `UNKNOWN`）**：
> 用户列出的六屏是 Now / Intent·Studio / Missions / Agents / Consent / Outcomes（其中「Intent/Studio」合一）。
> 现有实现是 **7 个内部视图**（多了 `field`），且 `missions` 是 `ready:false`。
> 同时 `consent` 区含一个名为「跨社群（Bridge）」的**子面板**（不是第八屏，见文件头 §T10）。
> → V20 需明确：是否保留 `field` 作为六屏之一？是否把 `missions` 从 `ready:false` 升为可用？这是**产品决策**，B0 不擅自改。

### 4.2 Console —— **7 个真实路由**（与用户枚举一致）

| 路由 | 文件 | 真实数据源（已核验） |
| --- | --- | --- |
| `/console` Overview | `src/app/console/page.tsx` | `GET /api/v1/workflow/overview`、`GET /api/v1/missions?page=1&pageSize=1` |
| `/console/agents` | `src/app/console/agents/page.tsx` | `GET /api/v1/agents/runs?limit=50`、`GET /api/v1/agents/usage`；动作 `…/approve` `…/reject` `…/execute` |
| `/console/connections` | `src/app/console/connections/page.tsx` | `GET /api/v1/connections/pipeline`；动作 `POST /api/v1/connections/{id}/introduce` |
| `/console/members` | `src/app/console/members/page.tsx` | `GET /api/v1/members`（`member.read`=OPERATOR+） |
| `/console/missions` | `src/app/console/missions/page.tsx` | `GET /api/v1/missions`；详情 `GET /api/v1/missions/{id}`，动作 `POST …/{id}/pause` |
| `/console/outcomes` | `src/app/console/outcomes/page.tsx` | `GET /api/v1/outcomes`、`GET /api/v1/connections/proposals?states=MUTUALLY_ACCEPTED`；动作 `POST /api/v1/outcomes/{id}/confirm`、`/verify` |
| `/console/settings` | `src/app/console/settings/page.tsx` | `GET /api/v1/org`、`PATCH /api/v1/org`（OWNER） |

### 4.3 跨页面关键旅程（不因「13 核心屏」而遗漏）

- Landing：`src/app/(public)/page.tsx`（含 `/pricing`、`/refunds` 等 20+ 公开页）。
- 认证：`src/app/(auth)/login`、`register`、`forgot-password`、`reset-password`、`verify-request`、`auto-login`、`admin-login`。
- 聊天：`src/app/(dashboard)/dashboard/chats`、`chats/[roomId]`（B2C 遗留线，非主线）。
- ReportModal：举报弹窗（依赖真实会话夹具，CI 中由 `seed-chat-fixture` 提供）。
- 中间页：`/m/[token]/*`（分享深链：intent / proposals / matches / page）。

---

## 5. 设计系统基础（真实）

- Token 命名空间：`--lf-*`（颜色 `lf-text` / `lf-surface` / `lf-line` / `lf-signal` / `lf-danger` / `lf-text-muted/faint`；半径 `rounded-lf`；间距/动效 `var(--lf-dur-fast)` 等）。
- 双主题：**Deep Field**（高专注协作）与 **Paper**（阅读/分析/运营），**共享同一套信息结构与组件**，不允许两套实现（用户 V20 原则）。
- 焦点环：`lf-focus-ring` 工具类（键盘可达性）。
- 现状：`globals.css` 已落地双主题变量骨架；组件已大量使用 `--lf-*`。**这是 V20 设计系统的代码事实源**，也是 Figma 缺位时的权威替代（见 B1）。

---

## 6. Agent Runtime（真实 · 诚实纪律是本项目红线）

核心目录边界（来自 `agent.prisma` 文件头与 `provider.ts` 注释）：
- `src/lib/agent/`（**单数**）= 无 IO 纯内核，单测不需要网络/凭据。
- `src/lib/agents/`（**复数**）= 允许碰 DB 的服务层（`runs.ts` `transitionRun`、`executor.ts`）。

### 6.1 Provider（只认凭据，绝不假成功）
来源：`src/lib/agent/provider.ts`。
- `resolveProviderConfig(env)`：**只认 `OPENAI_API_KEY`**；缺失 → `{ok:false, reason}`（**不可用，不是用假模型顶上**）。
- `resolveWorkBuddyConfig(env)`：认 `WORKBUDDY_LLM_ENDPOINT` + `WORKBUDDY_LLM_KEY` 两个变量，任一缺失 → `ok:false`。
- `createStubProvider(responder)`：**测试专用确定性假模型，必须由调用方显式注入；绝不进生产路径**（由 `check-agent-invariants` 的 A5 守着「本文件不含任何网络调用」）。
- `AgentProviderKind` 枚举含 `OPENAI / WORKBUDDY / STUB / RULES`（`RULES`=根本没调模型，规则式兜底，记进账本使降级率可复算）。

### 6.2 状态机与执行
- `AgentRunStatus`：`PROPOSED → AWAITING_APPROVAL → APPROVED → REJECTED → EXECUTED`，外加 `DEGRADED / BLOCKED_QUOTA / FAILED`。
- **`AWAITING_APPROVAL` 只经「真实模型成功 + 技能 `requiresApproval`」产出**（`runtime.ts:runSkill`）。本地无凭据 → 永远到不了待批态 → 这就是 **A-03b `BLOCKED_ENV`** 的根因。
- **`EXECUTED` 唯一写入点是 `src/lib/agents/executor.ts`**（静态断言守着：服务层+路由层源码里 `EXECUTED` 字面量只允许出现在 `executor.ts`）。
- 审批与执行分离：`AgentApprovalDecision` 只有 `APPROVED/REJECTED`，**没有** `EXECUTED`（裁决≠执行）。
- 一致性：C6/C7 迁移断言 + `tests/agents/*`：`status='EXECUTED'` ⇔ 恰有一条 `AgentExecution`；`APPROVED/REJECTED` 的运行必须有一条 `AgentApproval`。

---

## 7. Consent 状态机（真实）

- 同意是**逐字段披露**（`discloseSubject()` 投影后才进 prompt，AC-03）。
- 跨社群（Bridge）是**独立信任域的授权层**（两个群主各管一个租户），不是同租户多一个受众档位。
- 端点：`GET /api/v1/intents`、`GET /api/v1/intents/{id}/disclosure`、`GET /api/v1/connections/proposals`、`GET /api/v1/bridges`(+`/{id}`、`/{id}/discovery`)。
- 撤销即刻生效（T05）：执行时回读当时生效的披露表。

---

## 8. Action Executor（真实）

- `AgentExecution`：唯一写入点 `executor.ts`；经 T06 统一投递出口产生副作用并留痕；与 `AgentRun.status='EXECUTED'` 同事务写入。
- `AgentDeliveryTarget`：**创建时**固定送达目标（防止「批准 A、发给 B」的橡皮图章），执行时不补。
- 幂等：库级 `@@unique([runId])` 保证「一次运行最多一次执行 / 一个送达目标」。
- 成本归因：`AgentCall` 逐次调用入账（含失败），`costMicroCents` 整数微分，避免浮点累加误差。

---

## 9. Outcome / Evidence Schema（真实 · 验证级别是派生值）

来源：`prisma/schema/outcome.prisma`。
- `Outcome.verificationLevel`：`SELF_REPORTED / COUNTERPARTY_CONFIRMED / EXTERNALLY_VERIFIED`。
- 🔴 **派生自 `OutcomeVerification` 记录集，不接受客户端入参**（防止 AC-15 越权把自报计为已验证）。默认 `SELF_REPORTED` 即「下限：上报即得，但不是验证成功」。
- `OutcomeVerification`：每次确认/核验一条**不可变记录**；撤销=再记一条反向语义记录，不改写历史。
- 端点：`GET /api/v1/outcomes`、`/outcomes/metrics`；动作 `POST /api/v1/outcomes`（自报）、`/{id}/confirm`（对手方确认）、`/{id}/verify`（运营 `outcome.verify`，仅 ADMIN+）。
- **诚实红线（用户 V20 反复强调）**：界面上「已验证」必须有服务端 `OutcomeVerification` 记录映射；`providerKind=stub` 的产物**不能**产生真实模型验证状态。

---

## 10. 数据库模型（Prisma · 9 文件）

`prisma/schema/`：`core` / `tenancy` / `connection` / `agent` / `outcome` / `billing` / `bridge` / `bot` / 汇总 `src/generated/schema.prisma`。
- 迁移机制：**手写 `.mjs` 批次脚本**（`scripts/tenancy/migrate.mjs`、`scripts/connection/migrate.mjs`），只支持 `CREATE TABLE/INDEX IF NOT EXISTS`（**无 ALTER TABLE**）→ 新模型必须「纯新增、可独立上线、零停机」。
- 租户铁律：每个多租户查询首要条件都是 `organizationId`；软引用（无 FK）用于审计可追溯（用户注销后仍可查「谁批准过什么」）。
- 方言无关：不含 `@db.*`，同一份定义可同时生成 libSQL 与 PostgreSQL。

---

## 11. CI / Netlify 配置（真实 · 门禁极其严格）

来源：`.github/workflows/ci.yml`（仅在 push `main` / PR `main` 触发）。
Jobs（节选，全部为**确定性或带自证**）：typecheck → lint（**棘轮**，只拦新增债）→ test（Jest + 多个变异自证 + 退款链路 e2e + 证据透镜）→ build（`next build`，无 `continue-on-error`）→ migration（libSQL 文件库全批次 + 幂等复跑 + 漂移棘轮）→ e2e（构建产物真启动 + payment-off 契约 + 双组织隔离取证 + Mission/Workspace 闭环探针 + axe 四视口棘轮 + Playwright）→ secret-scan（gitleaks）→ dependency-audit（生产可达·棘轮）→ dco → slo-check → tenancy-scoping-gate → cron-method-gate → 手动 perf-baseline。

> ⚠️ 含义：V20.0 任何改动都会触发这套门禁；**本地实测门禁为准**，`t4/*` 分支无远端 CI。远程必需检查全绿是 B6 发布硬门槛。

---

## 12. 已知事实摘要（13 屏现状）

| 区域 | 屏 | 现状 |
| --- | --- | --- |
| Workspace | Now / Studio / Consent / Outcomes / Agents | ✅ `ready:true`，已接真实端点 |
| Workspace | Field | ✅ 渲染，但**不在用户六屏枚举内**（决策项） |
| Workspace | Missions | ❌ `ready:false`（未接线） |
| Console | Overview / Agents / Connections / Members / Missions / Outcomes / Settings | ✅ 7 屏全部真实路由 + 真实端点 |
| 跨页面 | Landing / Login / Register / Chats / ReportModal | ✅ 存在（Chats/ReportModal 属 B2C 遗留线，非主线） |

**下一步**：本基线确认后进入 B1（设计）与 B2（实现）。但 B1 的「Figma 可编辑节点」受环境限制（见 `01`/`02` 与任务 #21），需用户决策。
