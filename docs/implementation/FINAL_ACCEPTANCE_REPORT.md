# LokFeel Connection OS — 最终验收报告（T12 Release E2E）

> **报告口径**：`docs/ACCEPTANCE_MATRIX.md` 的 AC-01 ~ AC-25 逐条判定 `PASS` / `FAIL` / `BLOCKED`。
> **铁律**：**所有 BLOCKER 必须 PASS 才建议上线**；缺真实凭据的流程只能 `MOCKED` / `BLOCKED`，**不得以 mock 冒充生产验收**。
> **本报告不虚报任何未实测指标** —— 凡未执行、未接通者，一律如实标注。

- **生成时间**：2026-10-15（CST）
- **HEAD（代码基线）**：`8419f500972d2aa84206fbb799c8222da6a0b532`（T11 Open SDK，已推 `origin/main`）
- **生产部署版本**：`f6630ea6b`（T08 Slice 3 发布，2026-10-13）
- **发版状态**：**可发版 · 未发版**（`[skip netlify]` 生效，`verify:no-release --commit=8419f5009` → exit 0）
- **迁移状态**：C0–C8 已应用到生产 Turso；**C9（`CommunityBridge` / `BridgeMemberOptIn`）尚未 apply**

---

## 1. 结论摘要（先看这里）

| 维度 | 结果 |
|---|---|
| **BLOCKER（10 条）** | ✅ **10 PASS / 0 FAIL** —— AC-10 已于 2026-10-16 闭合 |
| **P0（11 条）** | 8 PASS / 2 FAIL / 1 BLOCKED —— 🔴 **AC-23 CI 红 · AC-24 未压测 · AC-25 无试点** |
| **P1（3 条）** | 3 PASS（AC-21 为沙箱口径，真实扣款 BLOCKED） |
| **P2（1 条）** | 1 PASS |
| **合计（25 条）** | **22 PASS / 2 FAIL / 1 BLOCKED** |

### 🟡 上线判定：**BLOCKER 已清空 —— 待 P0 两项闭合后即可发版**

按 `ACCEPTANCE_MATRIX.md` 的上线判定"**所有 BLOCKER 必须 PASS**"：
- **AC-10（BLOCKER）已转 PASS**（2026-10-16）—— 「导出」「删除请求」「缓存清理」三支全部落地并端到端取证：
  `npm run verify:ac10:lifecycle` → **68 PASS / 0 FAIL**（真 dev server + 真隔离库 + 真会话 + **逐表库状态断言**）；
  单测 `tests/lifecycle` 由 **13 例扩到 31 例**（新增账号政策 + 缓存键单一来源）。
  ⇒ **硬阻断已解除**，且**未走例外审批**。详见 §4.1。

**剩余阻断（均为 P0，非 BLOCKER）**：
1. **AC-23 CI**：lint job 的扫描面与 dependency-audit 仍需处理（§4.2）；
2. **AC-24 性能**：无 SLO、无压测基线（§4.3）。

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
| CI | `.github/workflows/ci.yml`（GitHub Actions） |
| 最新 CI run | `38757446188`（commit `8419f5009`）→ **failure**（详见 AC-23） |

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
| **AC-23** | CI | ❌ **FAIL** | CI run **`38757446188`**：**Lint ❌** + **Dependency audit ❌**；typecheck / jest / build / secret-scan / CodeQL ✅ | 见 §4.2；CI **未含 e2e 与 migration** 两个环节 |
| **AC-24** | 性能 | ❌ **FAIL** | **未执行** —— 无 SLO 定义、无压测脚本（`scripts/` 无 perf/load 件） | 生产真实量级参考：`User` 12922 / `Profile` 11887 行（T06 快照）；**不得虚报未测指标** |
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
| **AC-22** | A2A / MCP | ✅ **PASS** | `verify:ac22:open-sdk` **57/0**：发现面（匿名）· 协作（授权，断言真实数据）· 越权（401 / `isError`·`failed`·403 / 跨租户 403）· 协议健壮（-32700/-32600/-32601/-32602）· **实跑 4 个示例脚本（exit 0）** | MCP / A2A 端点**暂无独立速率限制** ⇒ 应在 AC-24 负载项里被看见 |

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

### 4.2 🔴 AC-23（P0）—— CI

CI run `38757446188`（commit `8419f5009`）job 明细：

| Job | 结果 |
|---|---|
| Typecheck (tsc --noEmit) | ✅ success |
| Test (Jest) | ✅ success |
| Build (next build) | ✅ success |
| Secret scan (gitleaks) | ✅ success |
| CodeQL | ✅ success |
| **Lint (ESLint)** | ❌ **failure** |
| **Dependency audit (npm audit)** | ❌ **failure** |

**根因（已核实，均为既有债，非本轮引入）**：
- **Lint**：`npm run lint` 是裸 `eslint`，会扫 `.open-next/`、`coverage/`、`prisma/*`、`scripts/*` 等**非门禁面**，全仓报 **1573 problems**（870 errors / 703 warnings）⇒ 🔴 **全仓 lint 不是本项目门禁**；**本轮 13 个改动路径单独 lint exit 0**。
- **Dependency audit**：`npm audit --audit-level=high` 有高危条目（该 job 标 `continue-on-error: true`，但仍影响 run 结论）。

**其他缺口**：CI **未包含 e2e（Playwright）与 migration 校验**两个环节（AC-23 明确要求）。

**闭合路径**：① `lint` job 改为只扫门禁面（或先清零既有债）；② 处理高危依赖；③ 新增 e2e / migration job；④ `build` 与 `dependency-audit` 去掉 `continue-on-error`。

### 4.3 🔴 AC-24（P0）—— 性能

**完全未执行**：无 SLO 定义、无压测脚本、无负载报告。生产真实量级已知（`User` 12922 / `Profile` 11887），但**未做任何压测**。
按 AC 原文"**不得虚报未测指标**"⇒ 如实记 **FAIL**。T11 遗留的「MCP/A2A 端点无速率限制」应纳入此项评估。

### 4.4 ⛔ AC-25（P0）—— 付费价值

**BLOCKED**：无真实试点客户，无真实支付/续费、工时基线、完成率记录。属**外部依赖**，不可 MOCK 代替。

### 4.5 其他已登记的未闭合项（不阻塞 AC，但影响上线质量）

| 项 | 状态 | 说明 |
|---|---|---|
| **C9 迁移未 apply** | 🟡 | `CommunityBridge` / `BridgeMemberOptIn` 未上生产 ⇒ **发版前需 `connection:migrate apply --batch=C9`** |
| **生产侧 OpenAI 连通性** | 🟡 | `GET /api/v1/agents/diagnostics/connectivity` 已交付，但**尚未在生产跑过** ⇒ 发版后须实跑 `verify:agent:connectivity:server` |
| **支付生产不可用** | ⛔ | 缺 `CREEM_API_KEY` / `WEBHOOK_SECRET` / 两个 `PRODUCT_ID`（用户明确排除） |
| **真实邮件外发** | ⛔ | 缺 `RESEND_API_KEY`（接上即 `CAPTURED → SENT`，零代码改动） |
| **Upstash Redis 环境变量** | 🟡 | 生产未补配（task #51 待办） |
| **生产 qa 账号缺失** | 🟡 | `verify-login-realpath` 12 项失败属既有取证盲区；修复 = 重跑 `create-qa-accounts.mjs`（需授权） |
| **TURN 中继** | ✅ 已激活 | 生产 `source=cloudflare-realtime`，回滚 `npm run turn:rollback`；国内用户连境外 CF 节点 |
| **AC-24 涉及的 e2e 环节** | 🟡 | 端到端链路已由 API/浏览器 E2E 覆盖，但**未纳入 CI** |

---

## 5. 例外审批清单（P0 未通过项）

> 按 `ACCEPTANCE_MATRIX.md`："P0 未通过必须记录例外审批及明确影响，关键业务链路不能豁免。"

| AC | 级别 | 状态 | 明确影响 | 例外建议 |
|---|---|---|---|---|
| AC-23 | P0 | FAIL | CI 红不影响线上运行时（typecheck/jest/build/secret-scan 均绿）；但**回归护栏不完整**（无 e2e/migration job） | 可例外，**条件**：先修 lint job 扫描面 + 增 e2e/migration job |
| AC-24 | P0 | FAIL | **性能未知**，无 SLO；高并发下可能超时 | 可例外，**条件**：上线前补一轮基线压测并定 SLO |
| AC-25 | P0 | BLOCKED | 商业模式未验证 | 可例外（**外部依赖**，非工程问题） |

✅ **AC-10（BLOCKER）已闭合，无需例外审批**（2026-10-16）。例外面仅剩 P0 的 AC-23 / AC-24 / AC-25。

---

## 6. 风险清单

| 风险 | 级别 | 说明 | 缓解 |
|---|---|---|---|
| **隔离为应用级非 DB 级** | 🟡 中 | libSQL 无 RLS，跨租户隔离全靠应用层 | M6 迁 PG + RLS |
| **发布窗口期 `request.url` = 部署专用域名** | 🟡 中 | 推 `main` 后约 20 分钟内函数拿到 `<deploy-id>--<site>.netlify.app` → 丢 cookie | 已修：一律经 `src/lib/http/public-origin.ts`；发版后立即复验（窗口期会自愈） |
| **支付/邮件生产不可用** | 🟡 中 | 缺凭据 | 接凭据后零代码改动即可启用 |
| **MCP/A2A 无速率限制** | 🟡 中 | 公开发现面无独立限流 | 纳入 AC-24 负载评估 |
| **CI lint/dep-audit 红** | 🟡 中 | 回归护栏不完整 | 见 §4.2 闭合路径 |
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
```

---

## 9. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-10-15 | 首次生成：AC-01~25 逐条判定。**21 PASS / 3 FAIL / 1 BLOCKED**；上线判定 **不建议上线**（AC-10 BLOCKER 未闭合）。Ci run `38757446188` 实证 CI 红（lint + dependency-audit）。 |
| 2026-10-16 | **AC-10（BLOCKER）闭合**：新增导出 / 删除请求 / **缓存失效**三支（`account.ts` · `cache-keys.ts` · `export.ts` · `erasure.ts` · `/api/v1/me/{export,erasure}`），E2E `verify:ac10:lifecycle` **68/0**，单测扩至 **31 例**（全量 **98 套 / 2030 例**）。判定更新为 **22 PASS / 2 FAIL / 1 BLOCKED**，**BLOCKER 已清空、未走例外审批**；剩余阻断为 P0 的 AC-23 / AC-24。同时**订正** `LIFECYCLE.md` 中"本仓无独立缓存层"的事实错误。 |

---

*本报告为 T12 Release E2E 的交付物，严格对应 `docs/ACCEPTANCE_MATRIX.md`。凡未实测/未接通者均已如实标注，未虚报任何指标。*
