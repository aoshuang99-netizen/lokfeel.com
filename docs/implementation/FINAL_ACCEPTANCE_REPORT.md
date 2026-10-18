# LokFeel Connection OS — 最终验收报告（T12 Release E2E）

> **报告口径**：`docs/ACCEPTANCE_MATRIX.md` 的 AC-01 ~ AC-25 逐条判定 `PASS` / `FAIL` / `BLOCKED`。
> **铁律**：**所有 BLOCKER 必须 PASS 才建议上线**；缺真实凭据的流程只能 `MOCKED` / `BLOCKED`，**不得以 mock 冒充生产验收**。
> **本报告不虚报任何未实测指标** —— 凡未执行、未接通者，一律如实标注。

- **生成时间**：2026-10-15（CST）｜**最近更新**：2026-10-16（发版复验）
- **HEAD（代码基线）**：`2d5385d`（发版提交；含 T09+T10+T11+T12 / AC-10/23/24 共 34 个提交）
- **生产部署版本**：`2d5385d`（2026-10-16 发布；上一版 `f6630ea6b` @ 2026-10-13）
- **发版状态**：✅ **已发版并复验生效** —— `verify:released:surface` **6/6 达期望 + 2/2 正向对照**；
  `verify-public-origin` **13/0**；`db-snapshot diff` 证明对既有数据**零影响**。详见 `RELEASE_T09-T12.md`
- **迁移状态**：✅ **C0–C9 已全部应用到生产 Turso** —— `connection:migrate verify` **255/255**
  （C9 `CommunityBridge` / `BridgeMemberOptIn` 已就位，本次发版**无需再 apply**）
- **A1（生产侧出口连通性）**：✅ **已实跑闭合**（`verify:agent:connectivity:server` **22/0**）——
  匿名层 401 ✅ · **网络层 PASS**（285ms 到达外部端点）· 身份层 INFO · 凭据层 FAIL（端点回 **400**）。
  生产的 `OPENAI_BASE_URL` 指向 **Netlify AI Gateway**（`/.netlify/ai`），探针只打不计费的 `/models` ⇒
  **400 是端点对「请求」的答复，不是对「凭据」的答复**。**"能否成功出稿"本轮未验**（需计费调用）。
  详见 `RELEASE_T09-T12.md` §4

---

## 1. 结论摘要（先看这里）

| 维度 | 结果 |
|---|---|
| **BLOCKER（10 条）** | ✅ **10 PASS / 0 FAIL** —— AC-10 已于 2026-10-16 闭合 |
| **P0（11 条）** | 10 PASS / 0 FAIL / 1 BLOCKED —— ✅ **工程项已清空**；仅余 **AC-25**（外部依赖） |
| **P1（3 条）** | 3 PASS（AC-21 为沙箱口径，真实扣款 BLOCKED） |
| **P2（1 条）** | 1 PASS |
| **合计（25 条）** | **24 PASS / 0 FAIL / 1 BLOCKED** |

### ✅ 上线判定：**BLOCKER 已清空 · P0 工程项已清空 —— 唯一剩余项 AC-25 属外部依赖，非工程问题**

### 🚀 发版落实（2026-10-16 17:10 · 提交 `2d5385d`）

**已发版，且发版后有实证**（不是"推上去了"，是"生效了"）：

| 复验项 | 命令 | 结果 |
|---|---|---|
| 生效断言 | `npm run verify:released:surface` | ✅ **6/6 达期望**（bridges/agents.runs/me.export/me.erasure → 401；`/api/mcp` → 405；agent-card → 200）+ **2/2 正向对照** |
| 对外跳转域名 | `verify-public-origin.mjs` | ✅ **13/0**（含 Google `redirect_uri` 落在公开域名；泄漏扫描 **0 处**） |
| 数据零影响 | `db-snapshot diff before after` | ✅ 65→65 表 · 无增删 · 既有表行数**全部未变** |
| 发版前 schema | `connection:migrate verify` | ✅ **255/255**（C0–C9 全部就位 ⇒ 本次无需 apply） |
| **A1 生产出口连通性** | `verify:agent:connectivity:server` | ✅ **22/0** —— 真实登录 200 + 会话 · 诊断端点 200 · **网络层 PASS**（285ms 到达外部端点） |

> ✅ **A1 已闭合**（分层读数）：匿名层 401 ✅ · **网络层 PASS** ✅ · 身份层 INFO · 凭据层 FAIL（端点回 **400**）。
> 生产的 `OPENAI_BASE_URL` 指向 **Netlify AI Gateway**（`/.netlify/ai`），探针只打不计费的 `/models` ⇒
> **400 是端点对"请求"的答复，不是对"凭据"的答复**（凭据被拒会回 401）。
> **"Agent 在生产能否成功出稿"本轮未验**（需一次计费调用）。详见 `RELEASE_T09-T12.md` §4。

按 `ACCEPTANCE_MATRIX.md` 的上线判定"**所有 BLOCKER 必须 PASS**"：
- **AC-10（BLOCKER）已转 PASS**（2026-10-16）—— 「导出」「删除请求」「缓存清理」三支全部落地并端到端取证：
  `npm run verify:ac10:lifecycle` → **68 PASS / 0 FAIL**（真 dev server + 真隔离库 + 真会话 + **逐表库状态断言**）；
  单测 `tests/lifecycle` 由 **13 例扩到 31 例**（新增账号政策 + 缓存键单一来源）。
  ⇒ **硬阻断已解除**，且**未走例外审批**。详见 §4.1。
- **AC-23（CI 门禁可信化）已转 PASS**（2026-10-16）—— CI 从「部分恒红」改为**三道棘轮**：
  lint / 依赖审计 / schema 漂移**只拦新增**；新增 Migration 与 E2E 两个 job；
  `build` 与 `dependency-audit` 的 `continue-on-error` 均移除。
  ⇒ **CI 的红重新等于「你引入了问题」**，且**未走例外审批**。详见 §4.2。
- **AC-24（性能基线）已转 PASS**（2026-10-16）—— SLO 已定义（两档 × 三层共 9 条规则）· 本地构建产物
  三档并发实测留档（每档 10s × 3 次取中位数，**保留每次原始值**）· `check:slo` **48/48 通过** ·
  校验器自证 **6/6**（含「判红有牙齿」与「非恒红」两个方向）· T11 交接的「MCP/A2A 无速率限制」
  **带阳性对照证实**。⇒ **工程项清空**，且**未走例外审批**。详见 §4.3。

**剩余阻断（非工程问题）**：
1. **AC-25 付费价值**：无真实试点客户，**不可 MOCK 代替**（外部依赖，见 §4.4）。
2. **支付凭据**：生产未配 4 个支付变量。**工程侧已收口** —— 「未接入」是受测状态（503 + 稳定码 + 健康检查自报缺口），
   接入是纯配置动作，无迁移、无代码改动。见 `LAUNCH_READINESS.md`。

> **核心业务闭环（AC-01 ~ AC-22）实现与取证质量高**：22 条 AC 均以**真实 HTTP / 真实浏览器 / 真实隔离库**取证，
> 且多数带**变异自证**（证明断言有牙齿）。AC-10 是本轮从"无人认领"追到闭合的一条 BLOCKER。

---

## 2. 环境与基线

| 项 | 值 |
|---|---|
| 仓库 | `github.com/aoshuang99-netizen/lokfeel.com`（`main`） |
| 技术栈 | Next.js 16.3.6（App Router + Turbopack）· React 19.3 · Prisma 7.10（libSQL/Turso）· NextAuth v5 |
| 数据库 | Turso（libSQL）；隔离库用于 E2E（`file:/tmp/*.db`） |
| 宿主 | Netlify 免费计划（`lokfeel`，site_id `c46478e9-…`）+ Cloudflare DNS |
| 全量单测 | **98 套 / 2030 例通过**（`npx jest`，2026-10-16 复跑） |
| 类型检查 | **`npx tsc --noEmit` exit 0** |
| CI | `.github/workflows/ci.yml`（GitHub Actions）—— **11 个 job**；三道棘轮见 `CI_GATES.md`，性能 SLO 见 `PERFORMANCE_BASELINE.md` |
| 最新 CI run（改造前） | `38848356361`（commit `4ceab89`）→ **failure**（Lint ❌ / Dependency audit ❌；其余 5 项 success） |
| 最新 CI run（改造后） | ✅ **`38863968546`（commit `8016bb4`）→ success** —— 当时 9 个 job 全绿（整轮 2m49s），含**新增**的 Migration（67s）与 E2E（164s），`Build` 在移除 `continue-on-error` 后仍 success |
| 最新 CI run（AC-24 后） | ✅ **`38868575737`（commit `7e76bc3`）→ success** —— **11 个 job 全绿**（整轮 **151s**）；新增的 **`Perf SLO 对账` 8s 通过**、**`Perf 基线实跑` 在 push 上 skipped**（仅 `workflow_dispatch`）—— 与「压测是取证不是门禁」的设计**逐条吻合** |
| 最新 CI run（依赖升级后） | ✅ **`39021438953`（commit `5fc3bf6`）→ success** —— **11 job：9 success + 2 skipped / 0 失败**；Build 2m22s · Jest 1m20s · Typecheck 1m33s · E2E 2m27s · Migration 1m07s · Dependency audit 1m05s · Lint 棘轮 1m19s |
| 依赖升级后的发版 | Netlify deploy `6ad3405dbb509383d7f55ecf` ← `5fc3bf6`，`state=ready`；生产 `/api/health` **200 ×2**（`redis.backend=upstash`、`degraded:false`） |
| 发版后生产复验 | `verify:released:surface` **6/6 + 对照 2/2** · `verify-public-origin` **13 通过 / 0 失败**（0 处部署域名泄漏）· 限流并发探针：MCP `200×120 + 429×10`、A2A `401×120 + 429×10`，`RateLimit-Backend: upstash` |
| 最新 CI run（并入 Dependabot #27 后） | ✅ **`39025021586`（commit `7d42f25`）→ success** —— 11 job：9 success + 2 skipped / 0 失败（`@sentry/nextjs` 11.7 / `@swc/core` 1.16.18 / `playwright` 1.64 全部通过 Build · Jest · E2E） |
| 最新 CI run（并入 Dependabot #24 · Stripe 23 后） | 第一轮 `39039731608`（`05c345d`）→ **3 红**：`Typecheck` / `Build` / `E2E`，同一根因（`apiVersion` 只接受最新版本字面量 `2026-09-30.endive`）。修好后 `39040981328`（`2e2f131`）→ ✅ **11 job：9 success + 2 skipped / 0 失败**；发版 `6ad38653be0d` ready。详见 `BACKLOG.md` §7octies |
| 并入 #27 后的发版与复验 | Netlify deploy `6ad34dc8b568` ← `7d42f25`，`state=ready`；`/api/health` **200 ×2** · 发版面 **6/6 + 2/2** · `verify-public-origin` **13/0** · 限流 MCP/A2A 各 `429×10` |
| 全仓 lint 债 | **1542 problems** / 1019 文件（改造前 1565；净 −23，且已冻结为棘轮基线） |
| 生产可达依赖高危 | **high 0 / critical 0**（2026-10-17 升级批次前为 high 26 / critical 2）—— 见 `DEPENDENCY_RISK.md` §7 |
| 性能基线 | 本地构建产物三档并发（1/10/50）· 每档 10s × 3 次取中位数 · **48/48 SLO 断言通过** · 错误率 **0.00%**；宿主 `Intel Core m3-7Y32 @ 1.10GHz`（4 核 / 8GB）—— 见 `PERFORMANCE_BASELINE.md` |

---

## 3. AC 逐条判定

> **证据列**均为**可复跑命令**或**仓库内文档**。临时日志（本轮）位于 `/tmp/t11-*.log`；长期证据以仓库文档为准。

### 3.1 BLOCKER（10 条）—— 必须全部 PASS

| ID | 场景 | 判定 | 证据 | 备注 |
|---|---|---|---|---|
| **AC-01** | 多租户隔离 | ✅ **PASS** | `tests/tenancy` **120 例**；`verify:ac19:bridge` **越权六条**（非当事组织读协议 404）；`verify:ac22:open-sdk` **跨租户 403**；`withTenant(capability)` 能力守卫 | 隔离为**应用级**（libSQL 无 RLS）；DB 级 RLS 待 M6 迁 PG |
| **AC-02** | 未授权访问 | ✅ **PASS** | 匿名 **401**（`verify:ac22` 无会话 401 + `-32001`）；角色越权 **403**（AC-19/22 多处）；`verify-t07-prod` 7 个 API 匿名 **401+JSON** | ⚠️ **生产取证盲区**：`verify-login-realpath` 12 项因生产库**无 qa 账号**失败（既有盲区，非功能缺陷） |
| **AC-03** | 逐字段披露 | ✅ **PASS** | API 响应：T03 白名单投影（未授权字段**键不存在**）；候选通道：T04 `discloseSubject(...,'CANDIDATE')` **唯一出口**；Agent 上下文：T09 **哨兵串**断言「模型真正收到的请求」 | 「向量索引」这条下游：T04 用结构化过滤、**无 embedding 索引** ⇒ M6 前 **N/A** |
| **AC-04** | 双方同意 | ✅ **PASS** | T05：`CONSENT_PENDING` 跨第一次 accept；仅 `MUTUALLY_ACCEPTED` 可介绍；移动端 E2E **7/7** | 状态机为**纯函数内核**，任何调用方绕不过 |
| **AC-05** | 拒绝与撤销 | ✅ **PASS** | T05：REJECT/REVOKE 立即终态 + `closedAt`；终态后任何表态 **409**；T10：撤销后投影 **0**、`BRIDGE_REVOKED` 精确拒绝码 | opt-out 方向**不受**协议状态限制（否则界面留"消不掉的已加入"） |
| **AC-06** | 执行时校验 | ✅ **PASS** | T05：介绍是**唯一执行点**，执行那刻重查提案/意图；用 `updateMany({introducedAt:null, status:'MUTUALLY_ACCEPTED'})` 做 **CAS** | "先查再写"并发下会双写 ⇒ 条件更新 |
| **AC-07** | 幂等 | ✅ **PASS** | T02（加入幂等名额 1/5）；T06（outbox 重试无重复）；T10（**修掉** `POST /api/v1/bridges` 幂等重放不可达缺陷）；T11（A2A **无状态 task.id 每次不同**） | 幂等记录与主体**同批清理**（T09 教训） |
| **AC-08** | Agent 安全 | ✅ **PASS** | T09 对抗夹具 **26 例**：闭合标签逃逸 **6 种写法**（含零宽）+ 注入语料 8 条 + 权限/披露/审批三组"**行为不变**"，**每条配负向对照** | 注入只**告警**、**不作放行判据**；审批绕过是**结构性**的（`AWAITING_APPROVAL → EXECUTED` 边不存在） |
| **AC-09** | 消息合规 | ✅ **PASS** | T06 统一投递出口（站内信 + 邮件沙箱）；`tests/workflow` **169 例** + 故障注入 E2E；禁静默冒充真人 | 🔴 **真实邮件外发 `BLOCKED`**（无 `RESEND_API_KEY`，用户明确排除）—— AC-09 口径为"仅官方授权渠道"，渠道机制已 PASS |
| **AC-10** | 数据生命周期 | ✅ **PASS** | `verify:ac10:lifecycle` **68/0**（真 dev server + 真隔离库 + 真会话）：导出（凭据剔除 + 未覆盖声明）· 删除计划（**跑完库零改动**）· 执行删除（**逐表库状态**）· **缓存失效回执** · 对照账号零波及 · 原邮箱不可再登录；`tests/lifecycle` **31 例**；`docs/implementation/LIFECYCLE.md` §4.5 | 索引一支记 **N/A**（本仓无独立搜索/向量索引，**已核实**）⇒ M6 迁 PG+pgvector 后重评。`ProposalDecision` 追加式改造**不属本 AC 判据**，仍开放 |

### 3.2 P0（11 条）—— 未通过须记录例外审批及明确影响

| ID | 场景 | 判定 | 证据 | 备注 |
|---|---|---|---|---|
| **AC-11** | Mission Link 移动端 | ✅ **PASS** | T02 移动端 E2E（真实 Chrome + Pixel 5）**8/8**：真实登录 → 真实加入 → 刷新幂等 | 分享页匿名可达 + 限流 + 最小披露 |
| **AC-12** | 意图提交 | ✅ **PASS** | T03 移动端 E2E：登录 → 加入 → 提交 → 预览 → 编辑 → 撤销（"刷新后输入框仍是改后正文"证真实落库） | — |
| **AC-13** | 双向匹配 | ✅ **PASS** | T04 移动端 **3/3**；`field-catalog.test.ts` 次序不变量 + `candidates.test.ts` **变异自证**；无候选**不伪造** | 🟡 pgvector 不可用（libSQL）⇒ 一期结构化召回，语义召回待 M6 |
| **AC-14** | 介绍工作流 | ✅ **PASS** | T05 移动端 **7/7**（单方同意仍待决 → 双方同意 → 运营介绍 200 / 重复 409）+ T06 `tests/e2e/workflow-execution.spec.ts` **8/8** | 证据形态为 **API/浏览器 E2E**；**未采集视频录像**（诚实标注） |
| **AC-15** | Outcome 真实性 | ✅ **PASS** | T08 Slice 1：三级验证**级别是派生值不是入参**；`isVerified('SELF_REPORTED')===false`；**自我确认 → 400** | — |
| **AC-16** | 商业指标 | ✅ **PASS** | T08 Slice 2：`outcome-reconcile.mjs` 原始表 SQL 独立复算 **14/0**（全租户 + 任务内）；**变异自证 4 处** + 2 条负向 `exit 1` | 口径：无时间窗口 / 快照式漏斗 / 假设随响应下发 |
| **AC-17** | 工作流恢复 | ✅ **PASS** | T06 故障注入 E2E **8/8**：崩溃/超时/网络失败后**无重复动作**且**可接管** | — |
| **AC-18** | SaaS UI | ✅ **PASS** | `verify:ac18:console`（真实 Chrome + 隔离库）**84/0**（七屏）；无空按钮**动态负测**（逐个真点） | 第 7 屏 Agents 由 T09 Slice 5 接线；`check:ui-invariants` 扫描面含 `src/app/console` |
| **AC-23** | CI | ✅ **PASS** | **CI run `38863968546`（`8016bb4`）→ success**：9 个 job 全绿（整轮 **2m49s**），四个关键 job 逐步 `success` —— Lint 棘轮 99s · Dependency 棘轮 70s · **Migration 67s（新增）** · **E2E 164s（新增）**；`Build` 移除 `continue-on-error` 后仍 success。改造前对照 `38848356361`（`4ceab89`）→ failure（Lint ❌ / Dependency audit ❌）。本地另证：三份自证 8+6+5 全绿、`verify` **255/255** | 见 §4.2 与 `CI_GATES.md`。**残留**：生产可达高危 28 条为「已登记 + 棘轮」，**未做批量升级**（`npm audit fix` 实测动 162 包且一条不消）⇒ 升级批次列为后续 P0 |
| **AC-24** | 性能 | ✅ **PASS** | 本地构建产物三档并发（1/10/50）实测，每档 **10s × 3 次取中位数**（原始值保留）：`npm run check:slo` → **48/48 断言通过**（8 个端点 · 错误率三档全 **0.00%**）· `npm run verify:check:slo` → **6/6 自证** · 限流取证 **阳性对照恰好 10 次 429**（印证 `max=120`），**MCP/A2A 各 200 次零 429 ⇒ 缺口证实** · **CI run `38868575737`（`7e76bc3`）→ success**（11 job 全绿 · 151s），新增 `Perf SLO 对账` **8s 通过**、`Perf 基线实跑` push 上 **skipped** | 见 §4.3 与 `PERFORMANCE_BASELINE.md`。**未测项已如实列出**（生产端到端 RTT / 写路径 / 长连接 / 多租户数据量 / 饱和归因）；本基线**仅可用于同法前后对比**，**不可外推为生产 SLO 达标** |
| **AC-25** | 付费价值 | ⛔ **BLOCKED** | **无真实试点客户**：无真实支付/续费记录、无工时基线、无完成率 | 依赖外部真实客户，**不可 MOCK 代替** |

### 3.3 P1（3 条）

| ID | 场景 | 判定 | 证据 | 备注 |
|---|---|---|---|---|
| **AC-19** | Bridge 跨社群 | ✅ **PASS** | `verify:ac19:bridge` **69/0**（真实 Chrome + 三租户隔离库 + 5 个真实登录身份）：正向 / 反向五态 / 越权六条 | 三方交集（群主配置 ∩ opt-in ∩ 意图档位），任一层**只能收窄** |
| **AC-20** | Agent 成本 | ✅ **PASS** | T09 Slice 3 预算夹具 **21 例**（额度 `>` 才拒 / 次数 `>=` 即停）+ `agent-reconcile.mjs` **217/0** + **变异自证 15/15** | 🔴 `BLOCKED_QUOTA` 时 **provider 零调用**（A/B 对照） |
| **AC-21** | 账单 | ✅ **PASS**（沙箱口径） | T08 Slice 3：`billing-reconcile.mjs` 用量复算 **65/0** + **变异自证 10/10**；含 `REFUNDED → SUCCEEDED` **409** | 🔴 **真实扣款/退款 `BLOCKED`**（无 Creem 凭据，用户明确排除）；AC 证据列即"**支付沙箱**"⇒ 沙箱可复算即满足 |

### 3.4 P2（1 条）

| ID | 场景 | 判定 | 证据 | 备注 |
|---|---|---|---|---|
| **AC-22** | A2A / MCP | ✅ **PASS** | `verify:ac22:open-sdk` **57/0**：发现面（匿名）· 协作（授权，断言真实数据）· 越权（401 / `isError`·`failed`·403 / 跨租户 403）· 协议健壮（-32700/-32600/-32601/-32602）· **实跑 4 个示例脚本（exit 0）** | MCP / A2A 端点**无独立速率限制** —— 已于 AC-24 **实测证实**（阳性对照下各 200 次零 429），见 §4.3 与 `PERFORMANCE_BASELINE.md §5` |

---

## 4. 未闭合项详述

### 4.1 ✅ AC-10（BLOCKER）—— 数据生命周期（**已于 2026-10-16 闭合**）

| 支 | 状态 | 证据 |
|---|---|---|
| 任务清理 | ✅ | `WorkflowJob` 终态 + 投递 + 站内信（`policy.ts` / `sweep.ts` / cron 端点 + 自证夹具） |
| **缓存清理** | ✅ **本轮闭合** | `executeErasure()` **第 ⑧ 步** + `src/lib/cache-keys.ts` 单一来源 + E2E 缓存回执断言。**同时订正了原文的事实错误**：原写"本仓无独立缓存层" —— 实际 `src/lib/cache.ts` 就是 `redis-cache.ts` 的**别名**，服务端有 4 处用户维度缓存 |
| **索引清理** | **N/A** | 本仓**无**独立搜索/向量索引（Discover 走结构化 SQL 过滤，无 embedding）⇒ 当前**无可失效对象**。这是**核实后的结论**，M6 迁 PG + pgvector 后**必须重评** |
| **导出**（数据可携带） | ✅ **本轮闭合** | `GET /api/v1/me/export` + `lifecycle/export.ts` + `account.ts`：只导自己（`userId` 来自会话，**无** `?userId=`）· 剔除凭据与内部运营备注 · **显式声明未覆盖面** |
| **删除请求**（被遗忘权） | ✅ **本轮闭合** | `GET`/`POST /api/v1/me/erasure`（**两段式**：只读计划 → `?apply=1` 才执行）+ `lifecycle/erasure.ts`：匿化 + 状态收窄（**非裸删**）· 非空列用中性哨兵 · 先关闸门再清正文 |

**🔴 关键设计：为什么是"匿化 + 状态收窄"而不是"硬删"**

① `User.deletedAt` 全仓**无任何业务查询在读**（已核实）⇒ 只置软删标记**等于没删**，用户照样被召回；
② `Profile.profileStatus` 才是各查询面的**实际闸门**（发现/匹配/候选均以 `APPROVED` 为条件），
   置 `DEACTIVATED` + `isApproved=false` 后**无需改动任何查询**；
③ 硬删会打断**对方**的记录（`ConnectionProposal` / `Outcome`）并抹掉审计（`AuditLog` / `TenantAuditEvent`）。
⇒ 保留**不可识别的最小骨架**（行在、id 在、PII 已清），既满足"不可识别"，又不破坏引用完整性与审计链。

**🔴 本轮最有价值的发现：缓存支不是"部分完成"，而是真缺口**

`who-liked-me:<viewerId>` 缓存的值里是**别人的**
`displayName / avatar / age / city / gender / relationshipGoal`。
⇒ 库已匿化而缓存未失效时，被销号者会在**别人的**"谁喜欢过我"列表里继续以原昵称出现 ——
最多 90 秒（TTL 60s + jitter 30s），而且**没有任何报错**。
所以缓存失效被做成执行的**组成部分**（第 ⑧ 步），而不是收尾的"顺手一清"：
本人键按精确键失效，`who-liked-me:` 按前缀**全局**失效（它的键属于他人，按被销号者 id **找不到**）。

⚠️ **仍存在的边界（已在 `LIFECYCLE.md` §4.5 声明，不当作已解决）**：
内存降级路径只能清**本进程**（生产用 Upstash，跨实例生效）；
`/api/who-liked-me` 另设 `Cache-Control: private, max-age=60, stale-while-revalidate=120`，
**浏览器**侧仍可能残留约 3 分钟，服务端无失效手段，靠 TTL 收敛。

> `NotificationDelivery` **不落 PII**（不存邮箱、不存 rationale 全文）⇒ 删人不清此表不构成 PII 残留，但**审计留存期**仍需合规评审定案。
> `ProposalDecision` 追加式改造（T05/R7 已记）**不属本 AC 判据**，仍开放。

### 4.2 ✅ AC-23（P0）—— CI 门禁可信化【已闭合】

**改造前**（CI run `38848356361` / `4ceab89`）：

| Job | 结果 |
|---|---|
| Typecheck · Test (Jest) · Build · Secret scan · CodeQL | ✅ success |
| **Lint (ESLint)** | ❌ **failure** |
| **Dependency audit (npm audit)** | ❌ **failure**（且带 `continue-on-error: true`） |
| DCO sign-off | skipped（仅 PR 触发） |

**根因（均已核实）**：`npm run lint` 是裸 `eslint`（扫全仓），全仓 **1565 problems / 868 errors / 697 warnings**，
其中 `no-unused-vars`(598) + `no-explicit-any`(503) + `no-require-imports`(137) **三条占 79%** ——
全是**历史存量**。恒红 ⇒ 被忽略 ⇒ 真回归被淹没。
`dependency-audit` 同理：全量 **34 high / 3 critical**（生产可达 26 / 2），且标着 `continue-on-error`，等于没有门禁。

#### 闭合的四条（对应 §5 原来的「闭合路径」）

**① Lint job——改为「全仓产出报告 + 棘轮比对」，而非收敛扫描面**

实测数据否决了「收敛扫描面」：1176/1565（**75%**）的债**就在 `src/`**，
排除 `src/` 等于门禁失效；真正该排除的只有构建产物（`coverage/` + `.open-next/` 共 5 条）。
也否决了「降级 severity」（那是削弱）。

改为 `scripts/ci/lint-ratchet.mjs`：以 `docs/implementation/lint-baseline.json` 逐文件×逐规则冻结，**只拦新增**。
**规则强度一点没降**。同时把能安全清零的当场清零：

| 动作 | 数量 |
|---|---|
| `prefer-const` 自动修复 | −15 |
| 失效的 `eslint-disable` 指令（ESLint 自证该规则在该行不再报错） | −3 |
| 构建产物排除（`coverage/` 4 条 + `.open-next/` 1 条） | −5 |
| 本轮新增脚本自身带入并已修掉 | +1 → −1 |
| **净变化** | **1565 → 1542（−23）** |

**② 依赖审计——改为「生产可达棘轮 + 强制书面豁免」**

实测 `npm audit fix` 会动 **162 个包**（含 `undici 7→8`、`deepmerge-ts 7→8` 主版本跃迁），
且 **high/critical 一条都没消掉**（dry-run 前后 metadata 完全一致）。
⇒ 清零不可行；改为 `scripts/ci/dependency-ratchet.mjs`：
**新增 / 严重度升级 / 缺书面理由 / 豁免到期**，四种情况都判红。
28 条生产高危逐组登记（`DEPENDENCY_RISK.md`）。dev 侧降为非阻断报告（jest/ts-jest/eslint-config-next 不上生产）。

**③ 新增 Migration 与 E2E 两个 job**（原 CI 完全没有这两环）

- **Migration**：一次性 libSQL 文件库，**免任何凭据**。
  `db push → rollback → apply → 幂等复跑 → verify → 漂移棘轮`。
  实测全链通过：`verify` **255/255**。
  > 过程中发现三处真问题（详见 `CI_GATES.md` §4 / §4bis / §4ter）：
  > (a) `prisma migrate deploy` 在 sqlite 上**从零建库必然失败**（首个迁移是 PG 专有 SQL）⇒
  >     迁移目录从来不是本项目的建库路径；
  > (b) T01 的 M1 批次给 11 张核心表加了 `organizationId`，而 `prisma/schema` 未建模 ⇒
  >     11 张表**永久漂移**（已冻结为棘轮，`reviewBy=2026-12-15`）；
  > (c) 迁移脚本**优先读 `.env` 文件**、覆盖进程环境变量 ⇒
  >     `DATABASE_URL=file:x npx ...` 会被静默忽略而打到生产库（CI 已加安全断言）。
- **E2E**：`playwright.ci.config.ts` + `tests/e2e-ci/smoke.spec.ts`，
  对**本地构建产物**（`next start`）做真实浏览器冒烟。
  **没有**直接用 `npm run test:e2e` —— 那个配置 `baseURL` 默认是**生产站**且依赖真实测试账号，
  挂到 CI 上等于每个 PR 都去打生产。5 条判据全部取自运行期事实（`/api/health` 会真的 `db.user.count()`）。

**④ 移除两处 `continue-on-error`**

- `build`：CI run `38848356361` 中该 job 结论为 **success**（步骤级全绿）⇒ 免责声明已无依据。
- `dependency-audit`：改为棘轮后它有了真实判据 ⇒ 可以阻断。

#### 本地实证

```
npm run lint:gate                     → 1542 problems / 零新增 / exit 0
npm run check:deps                    → 0 条冻结（2026-10-17 清零）/ 无新增 / exit 0
npm run check:migration-drift         → 11 条冻结 / 零新增 / exit 0（用链路产物，非基线自证）
npm run verify:lint:ratchet           → 8/8（含「总数守恒但发生位移：仍判红」）
npm run verify:check:deps             → 8/8（含「严重度升级：判红」「豁免过期：判红」；2026-10-17 由 6 条扩到 8 条）
npm run verify:check:migration-drift  → 5/5
CI migration job 全链复现              → verify 255/255 + 漂移棘轮 exit 0
门禁链（10 项）                        → 全绿
改动路径 ESLint                        → 新增文件 0/0；既有文件 76 处均为存量债（门禁已证零新增）
```

#### CI 实证（推送后）

**CI run `38863968546`（`8016bb4`）→ `conclusion: success`**，整轮 2m49s，9 个 job 全绿：

| Job | 结论 | 耗时 | 备注 |
|---|---|---|---|
| Typecheck (tsc --noEmit) | ✅ success | — | |
| **Lint (ESLint · 棘轮)** | ✅ **success** | 99s | 改造前 ❌ |
| Test (Jest) | ✅ success | — | 2030 例 |
| **Build (next build)** | ✅ **success** | — | **已去掉 `continue-on-error`** |
| **Migration（libSQL 文件库）** | ✅ **success** | 67s | **新增**；8 个步骤全绿（含安全断言 + 漂移棘轮） |
| **E2E（构建产物 · 浏览器冒烟）** | ✅ **success** | 164s | **新增**；build → start → Playwright 冒烟全绿 |
| Secret scan (gitleaks) | ✅ success | — | |
| **Dependency audit（棘轮）** | ✅ **success** | 70s | 改造前 ❌（且带 `continue-on-error`） |
| DCO sign-off | skipped | — | 仅 PR 触发，预期 |

> 对照：改造前 `38848356361`（`4ceab89`）→ **failure**（Lint ❌ / Dependency audit ❌）。
> 本次是**首次** CI 全绿，且**没有降低任何标准**。

#### ✅ 残留项已于 2026-10-17 办结

**依赖侧原为「门禁化 + 登记」，现已升级为「已修复」。** 2026-10-17 的依赖升级批次把
28 条生产可达高危降到 **0**（`high 0 / critical 0`），做法是「同大版本升级 6 项 + 定向
overrides 16 条」，**没有**采用 `npm audit fix --force` 的 162 包主版本跃迁路线。
`next` 16.3.6 → **16.4.2**、两个 critical（`proxy-addr` / `websocket-driver`）均已修复。
完整施工记录与取证见 `DEPENDENCY_RISK.md` §7、`BACKLOG.md` §7sexies。

仍如实保留的三点：
1. overrides 已从 16 条降到 **4 条**（2026-10-18 退役 13 条 + 为开发工具链新增 1 条嵌套 override）；
   剩 `ws` / `nodemailer` / `@grpc/grpc-js` / `@node-minify/core > glob` 仍在承重，父包追平后须继续逐条删除；
2. `next-auth@beta.32` 的 `peerOptional nodemailer` 声明仍停留在 `^7 || ^8`，
   与实际 `10.1.2` 不符（npm 仅 warn）—— 启用 next-auth 自带 Email provider 前须复核；
3. **开发工具链仍有 5 条 high**（`braces` / `micromatch` / `fast-glob` / `@next/eslint-plugin-next` /
   `eslint-config-next`）：`braces` 最新 3.0.3 即为受影响版本，advisory 写 **Patched versions: None**。
   同日已把可修的修掉（`critical 1 → 0`、`high 9 → 5`）；剩余部分为 dev-only、输入不受外部控制，
   按接受风险登记于 `DEPENDENCY_RISK.md` §7.7，生产侧仍 `0 / 0`、不进 Netlify 产物。

### 4.3 ✅ AC-24（P0）—— 性能基线

**已执行并留档。** 完整方法、未测项与取证见 `docs/implementation/PERFORMANCE_BASELINE.md`；此处只留判定要点。

| 项 | 结果 |
|---|---|
| **SLO 定义** | `docs/implementation/slo.json` —— 两档（交互式 API / SSR 页面）× 三层（c=1/10/50）共 **9 条规则**；阈值**按 UX 可接受度先行确定**，**未按实测反推** |
| **实测对象** | 本仓生产构建产物（`next start` 绑 `127.0.0.1`）· 隔离库 `file:./perf-baseline.db` · **不打生产** |
| **方法** | 8 个端点（健康检查 / 3 个 SSR-REST / MCP 发现与调用 / A2A）· 每档 10s × **3 次取中位数**，**保留每次原始值**与 `p95Spread` |
| **对账** | `npm run check:slo` → **48/48 断言通过** · 错误率三档全 **0.00%** |
| **自证** | `npm run verify:check:slo` → **6/6**：篡改 p95 判红 · 篡改错误率判红 · **删档（缺数据）判红** · 基线非法判红 · **阈值放宽必须通过（非恒红对照）** |
| **T11 交接项** | **MCP/A2A 无独立速率限制 —— 已证实**：阳性对照端点打出**恰好 10 次 429**（印证其 `max=120`），而 MCP/A2A 各 200 次请求 **0 次 429** |
| **CI 集成** | 新增 **确定性** `slo-check` job（只读冻结 JSON，零抖动、不需 `npm ci`）；实跑压测走 **仅手动** `workflow_dispatch` job。**CI 实证**：run `38868575737`（`7e76bc3`）→ **success（151s / 11 job 全绿）**，`Perf SLO 对账` **8s 通过**、`Perf 基线实跑` 在 push 上 **skipped** |

**三条如实标注（不虚报）**：

1. **基线不等于生产性能。** 生产端到端延迟（跨境 RTT / Netlify 冷启 / Turso 远端查询）**未测**。
   本基线**仅可用于同一方法的前后对比**，**不可**外推为生产 SLA 达标证据。
2. **宿主极弱。** `Intel Core m3-7Y32 @ 1.10GHz`（4 核 / 8GB / 无风扇超低压 U），且压测生成器与服务器**同机**争 CPU
   ⇒ 数字是**悲观下界**；~100 rps 的饱和点**无法归因**（服务端 or 生成器，未测）。
3. **单次测量不可靠 —— 已由方法修正。** 首轮**单次**运行 `login@50` p95 = 3044ms（超 3s 阈值）；
   三次原始值 1995 / 2569 / 2757（中位数 2570，通过）⇒ 那个 3044ms 是**离群值**。
   **若直接拿单次数字判 PASS/FAIL，就会在噪声上下结论** —— 这正是引入「多次取中位数 + 保留原始值」的原因。

**顺带发现的既有缺陷（已登记，本轮不修）**：`src/lib/rate-limit.ts` 的取键是
`options.key ? options.key(request) : ip`，而本仓**三处调用都没传 `key`** ⇒
`previewLimit`（120/5min）与 `callSignalLimiter`（300/1min）**共用同一个 `ratelimit:<ip>` 桶**，
且**窗口长短由最先创建该条目的请求决定**。定性为**跨功能干扰**（非安全绕过）。
**诚实边界**：运行期复现需「同一 IP 上同时使用两个功能的**已登录会话**」，本次**未做运行期实证**（仅代码级）。
处置见 `BACKLOG.md`（P1，含修复要点）。

### 4.4 ⛔ AC-25（P0）—— 付费价值

**BLOCKED**：无真实试点客户，无真实支付/续费、工时基线、完成率记录。属**外部依赖**，不可 MOCK 代替。

### 4.5 其他已登记的未闭合项（不阻塞 AC，但影响上线质量）

| 项 | 状态 | 说明 |
|---|---|---|
| **C9 迁移未 apply** | ✅ 已办结 | `CommunityBridge` / `BridgeMemberOptIn` 已随发版前进生产：`connection:migrate apply --batch=C9` → `verify` **255/255**；发版 `2d5385d` 后 `db-snapshot diff` 65→65 表、既有表行数**全未变** |
| **生产侧 OpenAI 连通性** | ✅ 已实跑 | `verify:agent:connectivity:server` **22/0**（2026-10-16）。分层：匿名 401 / **网络 PASS（285ms）** / 身份 INFO / **凭据层 FAIL（端点回 400）**。🔴 生产 `OPENAI_BASE_URL` 指向 **Netlify AI Gateway**（`<origin>/.netlify/ai`，`source=env`）；探针只打不计费的 `/models` ⇒ 400 是「对**请求**的答复」而非「对**凭据**的答复」⇒ **「Agent 生产能否成功出稿」仍未验**（需一次计费调用），不得据此宣称线上出稿可用 |
| **支付凭据未配** | 🟡 **已工程化收口**（2026-10-18） | 生产 40 个环境变量中**无** `CREEM_API_KEY` / `CREEM_WEBHOOK_SECRET` / `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`（用户明确排除，本轮不接）。**「未接入」已变成受支持、可观测、有门禁的状态**：7 个支付入口统一回 **503 + `PAYMENT_NOT_CONFIGURED`**（不再是 500），`/api/health` 的 `payments.missing` 直接列出缺口变量名（不泄值）；`npm run verify:payment:off` 契约脚本已进 CI 的 e2e job。⇒ **接上 4 个变量即收费，零代码改动**。见 `LAUNCH_READINESS.md` |
| **真实邮件外发** | ⛔ | 缺 `RESEND_API_KEY`（接上即 `CAPTURED → SENT`，零代码改动） |
| **Upstash Redis 环境变量** | ✅ 已补配 | #51 闭合（2026-10-16）：`qa:upstash:provision` 建库取凭据 → `qa:upstash:configure` 写 Netlify env 并**回读核对** → 部署 `6ad2201d899a`；生产 `GET /api/health` → `redis:{"backend":"upstash","configured":true,"degraded":false}`（2026-10-17 复验仍成立）；`check:redis` **17/17**（首个双后端验证）。⚠️ 免费档 **10k 命令/天** |
| **生产 qa 账号缺失** | ✅ 已重建 | 根因 = **生产库 `qa.*` 0 行 + `Membership` 0**（`qa:probe:login` 定性为「库中不存在」，**不是密码过期**）⇒ 端点回业务 401 `Invalid email or password`，**不是代码回归**。经授权 `create-qa-accounts.mjs` 重建 2 账号 + 新增 `grant-qa-org.mjs` 建成员关系（角色 **OPERATOR**，**非 ADMIN** —— 保住 AC-08「能跑不能批」）。⚠️ 生产写入已于 **2026-10-17 清理完毕**：`cleanup-qa-accounts.mjs --apply` 删 2 个 User，级联 Profile ×2 / Subscription ×1 / Membership ×2；前后计数精确对账（`qa.*` 残留 0）。**副作用**：`org_default` 现无成员 ⇒ 再次跑生产侧授权复验前需重建账号 |
| **TURN 中继** | ✅ 已激活 | 生产 `source=cloudflare-realtime`，回滚 `npm run turn:rollback`；国内用户连境外 CF 节点 |
| **AC-24 涉及的 e2e 环节** | ✅ 已纳入 | CI 新增 e2e job（构建产物浏览器冒烟）。原 `tests/e2e/**` 仍打生产站，**不**入 CI |
| **生产依赖高危 28 条** | ✅ 已清零 | 2026-10-17 依赖升级批次：`high 26 + critical 2` → **`0 / 0`**（余 2 low + 4 moderate）。同大版本升级 6 项 + 定向 overrides 16 条；`frozen`/`exemptions` 置空。随后并入 Dependabot #27（11 项 minor/patch）并重跑门禁，审计仍 `0 / 0`、16 条 overrides 全部仍生效。见 `DEPENDENCY_RISK.md` §7、`BACKLOG.md` §7sexies / §7septies |
| **11 表 `organizationId` 未建模** | 🟡 | `prisma db push` 会删这 11 列（租户归属丢失）。CI 已加安全断言；`reviewBy=2026-12-15` |
| **迁移目录非建库路径** | 🟡 | `prisma migrate deploy` 在 sqlite 上从零建库必失败（首个迁移为 PG 专有 SQL）；`initial_migration.sql` 是空文件 |
| **迁移脚本 `.env` 覆盖环境变量** | 🟡 | `.env` 优先级高于进程环境变量 ⇒ 裸跑 `apply` 会打到生产库。CI 已加断言；脚本行为改动记入 BACKLOG |

---

## 5. 例外审批清单（P0 未通过项）

> 按 `ACCEPTANCE_MATRIX.md`："P0 未通过必须记录例外审批及明确影响，关键业务链路不能豁免。"

| AC | 级别 | 状态 | 明确影响 | 例外建议 |
|---|---|---|---|---|
| AC-25 | P0 | BLOCKED | 商业模式未验证 | 可例外（**外部依赖**，非工程问题） |

✅ **AC-10（BLOCKER，2026-10-16）· AC-23（P0，2026-10-16）· AC-24（P0，2026-10-16）均已闭合，均未走例外审批。**
**例外面仅剩 AC-25（外部依赖）。**

---

## 6. 风险清单

| 风险 | 级别 | 说明 | 缓解 |
|---|---|---|---|
| **隔离为应用级非 DB 级** | 🟡 中 | libSQL 无 RLS，跨租户隔离全靠应用层 | M6 迁 PG + RLS |
| **发布窗口期 `request.url` = 部署专用域名** | 🟡 中 | 推 `main` 后约 20 分钟内函数拿到 `<deploy-id>--<site>.netlify.app` → 丢 cookie | 已修：一律经 `src/lib/http/public-origin.ts`；发版后立即复验（窗口期会自愈） |
| **支付/邮件生产不可用** | 🟡 中 | 缺凭据 | 接凭据后零代码改动即可启用 |
| **MCP/A2A 无速率限制** | ✅ 已修 | 公开发现面原先无独立限流 —— **AC-24 已实测证实**（阳性对照下各 200 次零 429） | **2026-10-17 修复**：各接 120 次/分钟/IP 的独立桶（`mcp:rpc` / `a2a:task`），429 按各自协议信封返回（JSON-RPC `-32000` / `RESOURCE_EXHAUSTED`）+ `Retry-After`；见 `BACKLOG.md` §7quinquies |
| **限流器三处调用共用 per-IP 桶** | ✅ 已修 | `previewLimit` 与 `callSignalLimiter` 共享 `ratelimit:<ip>`，窗口由先建条目者决定 ⇒ 跨功能干扰（**代码级结论，运行期未实测**） | **2026-10-17 修复**：桶键改 `ratelimit:<name>:<rateKey>`，`name` 必填、同名不同额度**注册期抛错**；另修内存回落路径 `incr` 不认过期导致**永久封禁**的缺陷（由「窗口重置」单测抓出） |
| **生产性能未实测** | 🟡 中 | AC-24 基线为本地弱机（m3-7Y32）；生产跨境延迟 / 写路径 / 长连接**未测** | `PERFORMANCE_BASELINE.md §4` 已列全未测项；发版后可补生产侧观测 |
| **CI lint/dep-audit 红** | 🟢 低 | 回归护栏不完整 | **已闭合**（AC-23，见 §4.2） |
| **`ProposalDecision` 非追加式** | 🟢 低 | 审计可被覆盖（R7） | AC-10 合规评审一并处理 |

---

## 7. 回滚步骤

每个任务均有独立 `rollback.md`；数据库迁移回滚统一走 `connection:migrate`：

```bash
# 1) 数据库迁移回滚（示例：C9，纯新增表 ⇒ 零停机）
npm run connection:migrate -- rollback --batch=C9

# 2) 应用回滚（Netlify 免费计划）
#    在 Netlify 控制台将生产部署回退到上一 ready 版本：
#    当前生产 f6630ea6b（T08 Slice 3）；回退目标 = 上一个 ready 部署
#    或：git revert <SHA> && bash scripts/push-main.sh（推 main 触发新构建）

# 3) TURN 回滚
npm run turn:rollback
```

各任务回滚演练记录：`docs/implementation/T0{1,2,3,4,5,6,7,8,9}/rollback.md`、`T10/`、`T11/`。
迁移批次 `verify` 全绿（C0 25/25 · C1 42/42 · C2/C3 107/107 · C4 · C5 159/159 · C6 205/205 · C7 219/219 · C8 · C9）。

---

## 8. 复跑命令清单（附录）

> 全部命令均为**可复跑**；重负载命令（tsc/jest/E2E）须**后台独占**（8G 机 OOM）。

```bash
# 类型 + 单测
npx tsc --noEmit                                  # → exit 0
npx jest                                          # → 98 套 / 2030 例

# 静态门禁
npm run check:openapi-contract                    # → 5 项全绿（42 操作 / 31 候选能力）
npm run audit:open-source                         # → 5 项全绿
npm run check:script-decls                        # → 80 脚本 / 0 未声明引用
npm run check:bridge-invariants && npm run check:agent-invariants && npm run check:ui-invariants

# 变异自证（最强证据）
npm run verify:bridge-invariants                  # → B1–B5 全捕获
npm run verify:agent-invariants                   # → A1–A5 全捕获
npm run verify:ui-invariants                      # → 11 条变异全捕获

# 端到端取证（真实 HTTP / 真实浏览器 / 隔离库）
npm run verify:ac10:lifecycle                     # → 68/0（导出 / 删除计划 / 执行删除 / 缓存回执）
npm run verify:ac18:console                       # → 84/0（七屏）
npm run verify:ac19:bridge                        # → 69/0
npm run verify:ac22:open-sdk                      # → 57/0（含实跑 4 个示例）
npm run verify:p2:e2e                             # → 130/0

# 对账（SQL 复算）
node scripts/qa/outcome-reconcile.mjs --api=<file>   # → 14/0
node scripts/qa/billing-reconcile.mjs                # → 65/0
node scripts/qa/agent-reconcile.mjs                  # → 217/0

# 幂等 / 生命周期
npm run verify:ac19:bridge                        # 幂等重放不产生第二条
npm run verify:no-release --commit=<SHA>          # → 未见该提交部署记录 ⇒ 保持"可发版未发版"

# 性能（AC-24）—— 详见 PERFORMANCE_BASELINE.md §7
bash scripts/perf/prepare-env.sh                  # 隔离库 + 生产构建（含三重安全闸）
DATABASE_URL="file:./perf-baseline.db" npm run start &
node scripts/perf/load-baseline.mjs --base=http://127.0.0.1:3000 \
     --levels=1,10,50 --duration=10 --warmup=3 --repeats=3   # → 8 端点 × 3 档
npm run check:slo                                 # → 48/48 断言
npm run verify:check:slo                          # → 6/6 自证
node scripts/perf/rate-limit-probe.mjs --base=http://127.0.0.1:3000 --n=200
                                                  # → 对照 429=10（阳性）；MCP/A2A 429=0（缺口）
```

---

## 9. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-10-15 | 首次生成：AC-01~25 逐条判定。**21 PASS / 3 FAIL / 1 BLOCKED**；上线判定 **不建议上线**（AC-10 BLOCKER 未闭合）。Ci run `38757446188` 实证 CI 红（lint + dependency-audit）。 |
| 2026-10-16 | **AC-10（BLOCKER）闭合**：新增导出 / 删除请求 / **缓存失效**三支（`account.ts` · `cache-keys.ts` · `export.ts` · `erasure.ts` · `/api/v1/me/{export,erasure}`），E2E `verify:ac10:lifecycle` **68/0**，单测扩至 **31 例**（全量 **98 套 / 2030 例**）。判定更新为 **22 PASS / 2 FAIL / 1 BLOCKED**，**BLOCKER 已清空、未走例外审批**；剩余阻断为 P0 的 AC-23 / AC-24。同时**订正** `LIFECYCLE.md` 中"本仓无独立缓存层"的事实错误。 |
| 2026-10-16 | **AC-23（P0）闭合 · CI 门禁可信化**：三次「不降标准」的历史债治理落地为**三道棘轮**（lint 1542 / 生产依赖 28 条 / schema 漂移 11 张表），全部「冻结存量 + 只拦新增」；CI 新增 **Migration**（免凭据，`verify` 255/255）与 **E2E**（构建产物浏览器冒烟）两个 job；`build` 与 `dependency-audit` 的 `continue-on-error` **两处移除**。判定更新为 **23 PASS / 1 FAIL / 1 BLOCKED**，**未走例外审批**。过程中发现并登记三处真风险（迁移目录非建库路径 · 11 表 `organizationId` 未建模 · 迁移脚本 `.env` 覆盖环境变量）。**残留如实标注**：28 条生产高危仅「登记 + 棘轮」，未做批量升级。新增 `CI_GATES.md` / `DEPENDENCY_RISK.md`。 |
| 2026-10-16 | **AC-24（P0）闭合 · 性能基线与 SLO**：`slo.json` 定义两档 × 三层共 9 条规则（阈值按 UX 先行确定，**未按实测反推**）；零依赖压测器 `load-baseline.mjs`（**多次取中位数 + 保留原始值与 `p95Spread`**）实测本地构建产物三档并发，`check:slo` **48/48 通过**、错误率 **0.00%**；校验器自证 **6/6**（含「判红有牙齿」与「非恒红」双向）；**证实** T11 交接的 MCP/A2A 无速率限制（阳性对照端点恰好 **10 次 429**，印证其 `max=120`）；顺带发现并登记**限流器共用 per-IP 桶**缺陷（代码级，运行期未实测）。**方法学修正**：首轮单次运行的 `login@50` 3044ms 经三次重复证实为**离群值**（1995/2569/2757，中位数 2570 通过）⇒ 单次测量不可用于判 PASS/FAIL。CI 新增**确定性** `slo-check` job（零抖动）与**仅手动**的 `perf-baseline` job（压测是取证不是门禁）。判定更新为 **24 PASS / 0 FAIL / 1 BLOCKED**，**未走例外审批**；例外面仅剩 AC-25（外部依赖）。新增 `PERFORMANCE_BASELINE.md`。 |

---

| 2026-10-16 | **🚀 发版 + 停用「未发版」状态**：提交 `2d5385d`（34 提交 / T09+T10+T11+T12 + AC-10/23/24）**已发布生产并复验生效**。发版前四项前提实测（C0–C9 全部就位 `verify` **255/255** · 纯新增 schema · 未发版成立 5 条 404 + 3/3 对照 · CI 12 项全绿）；发版后三项复验（`verify:released:surface` **6/6 + 2/2 对照** · `verify-public-origin` **13/0** · `db-snapshot diff` **零数据影响**）。**A1 闭合**（先发现生产 `qa.*` 账号 **0 行** + `Membership` **0** ⇒ 经授权重建账号 + 建成员关系后复跑 **22/0**：真实登录 200 · 诊断端点 200 · 网络层 **PASS** 285ms；**顺带拿到生产事实**：`OPENAI_BASE_URL` 指向 **Netlify AI Gateway**，探针打的 `/models` 回 400 ⇒ 凭据层 FAIL **但 ≠ 凭据无效**）。新增 `RELEASE_T09-T12.md`；探针语义反转（`verify:released:surface` 取代已删除的 `verify-no-release-surface`，避免"清空清单"变成恒绿假门禁）。 |

| 2026-10-18 | **支付「未接入」状态工程化收口**：新增 `src/lib/payments/availability.ts`（唯一判定）与 `not-configured.ts`（503 统一出口），把 7 个支付入口的「缺配置 ⇒ 500」全部改为 **503 + `PAYMENT_NOT_CONFIGURED`**；`CREEM_ENV` 误配（`staging`/`TEST`）由「静默打生产」改为 **fail-closed 拒绝实例化**；`/api/health` 新增 `payments` 块（只回布尔与变量名，公开端点不泄值）；`verify:payment:off` 契约脚本进 CI e2e job；新增 `LAUNCH_READINESS.md`。判定不变（**24 PASS / 0 FAIL / 1 BLOCKED**），支付一项由「⛔ 不可用」改记为「🟡 凭据未配，接上即生效」。 |

---

*本报告为 T12 Release E2E 的交付物，严格对应 `docs/ACCEPTANCE_MATRIX.md`。凡未实测/未接通者均已如实标注，未虚报任何指标。*
