# 58 · V20.4 RC GO / NO-GO（Batch 6 Release Candidate 判定）

> RC 候选：`rc/v20.4 = e5fa76226e1344e28b1206df1354c0d44389d033`
> 判定时间：2026-11-06 19:10 (GMT+8)
> 判定规则（来自 V20.4）：`GO` = 所有必需门禁通过且 P0=0、阻断性 P1=0；
> `NO-GO` = 任一必需的安全/登录/授权/核心业务/部署门禁失败；
> `CONDITIONAL` 仅可容纳非核心、可隔离、人工批准的问题，**不得自动转 GO**。

---

## 1. 判定：**NO-GO**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  RELEASE CANDIDATE:  rc/v20.4 @ e5fa762
  DECISION:           NO-GO
  阻断项（P0/P1）:     4
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

四条第 1 级阻断（任意一条即足以 NO-GO）：

| # | 阻断项 | 级别 | 依据 |
|---|---|---|---|
| **B-1** | PingPong 支付凭据明文在 public 仓库 HEAD | **P0** | `57` §2 |
| **B-2** | 生产登录 LCP 3580ms（阈值 2500ms），TTFB 2060ms（阈值 800ms） | **P1 阻断** | `55` §1–2 |
| **B-3** | Production Environment 无审批保护（`protection_rules=0`），发布可绕过 D-10 | **P1** | `57` §6 |
| **B-4** | Cloudflare Worker 零运行时绑定，无法承接业务 | **P1** | `53` §2 |

> B-2 之所以算「阻断」：V20.4 明写「涉及核心登录体验的阻断性性能问题不得直接豁免」。而登录是唯一入口。

---

## 2. RC 必需的 12 项证据（逐项）

V20.4 要求 RC 提供 12 项，缺一不可：

| # | 要求 | 状态 | 证据 / 缺失原因 |
|---|---|---|---|
| 1 | Git SHA | **PASS** | `e5fa76226e1344e28b1206df1354c0d44389d033` |
| 2 | PR URL | **BLOCKED** | PAT 无 `pull_requests:write`（`POST /pulls` → 403）。**无 PR，不以分支链接冒充** |
| 3 | GitHub CI Run | **PASS** | `42188252386`：13 success / 0 fail / 2 skipped |
| 4 | Cloudflare Preview URL | **部分** | 部署成功（run `42188252454`），但 `*.workers.dev` 从本地网络不可达（代理 502 / 直连超时），**URL 无法实测** |
| 5 | Cloudflare 部署 ID | **PASS** | version `34eaafc4-682a-4f37-9a1a-f9eb1ac153a2`，`modified_on=2026-11-06T08:34:48Z` |
| 6 | 13 屏视觉回归 | **PASS** | 104/104（`54`），截图 + JSON 齐全 |
| 7 | 前后端 API 测试 | **PASS（本地 prod）** | 登录/Session/Mission 读写/租户隔离/health（`53` §4） |
| 8 | S1/S2 Agent E2E | **S1 PASS / S2 PASS（局部）** | S3 BLOCKED（`56`） |
| 9 | 性能报告 | **FAIL** | LCP 3580ms / TTFB 2060ms（`55`） |
| 10 | 安全报告 | **FAIL** | gitleaks 1 项 P0 + Environment 无审批（`57`） |
| 11 | 回滚演练 | **NOT_TESTED** | 未发布即无回滚对象 |
| 12 | 未闭合问题及风险分级 | **PASS** | 见 §4 |

**12 项中：PASS 7 / 部分 1 / FAIL 2 / BLOCKED 1 / NOT_TESTED 1。**

按规则，第 9、10 项失败即 NO-GO；第 2 项 BLOCKED 使「受保护合并」这条治理要求也无法满足。

---

## 3. 为什么不能给 CONDITIONAL

`CONDITIONAL` 的适用条件是「**非核心、可隔离、经人工批准**」。逐条对照四条阻断项：

| 阻断项 | 是否非核心 | 是否可隔离 | 结论 |
|---|---|---|---|
| B-1 凭据泄漏 | 否（支付通道） | 否（已公开，必须轮换） | 不适用 |
| B-2 登录性能 | 否（唯一入口） | 否（结构性 TTFB） | 不适用 |
| B-3 审批保护缺失 | 否（发布治理） | 否（属流程前提） | 不适用 |
| B-4 CF 运行时为空 | 否（部署目标） | 是（可继续用 Netlify） | 这一条本可隔离，但另外三条已足够 |

**结论：不降级为 CONDITIONAL。**

---

## 4. 未闭合问题清单（分级）

### P0（阻断发布，必须闭合）

| ID | 问题 | 谁能闭合 |
|---|---|---|
| P0-1 | PingPong API Key + Secret 明文在 public 仓库 | **人**（PingPong 后台轮换）+ 已完成的代码脱敏 |

### P1（阻断发布）

| ID | 问题 | 谁能闭合 |
|---|---|---|
| P1-1 | 生产 LCP 3580ms / TTFB 2060ms | 工程 + CF/Netlify 配置（需面板权限） |
| P1-2 | Production Environment 无 required reviewers | **仓库管理员**（GitHub 设置） |
| P1-3 | CF Worker 零绑定，不能作为运行时 | 工程（注入 Secrets）+ 发布授权 |
| P1-4 | Preview URL 无法实测（本地网络） | 换网络环境即可 |
| P1-5 | PR 无法创建（PAT 权限） | 换 token 或人工开 PR |

### P2（可延期，需登记）

| ID | 问题 |
|---|---|
| P2-1 | Console 七屏不接 `--lf-*`，与 Workspace 双色源并存（`54` §0） |
| P2-2 | Figma 可编辑节点 / Node ID 仍 `BLOCKED_FIGMA_WRITE`（`54` §5） |
| P2-3 | axe 无障碍扫描本轮未跑（历史 PASS 不作数） |
| P2-4 | Playwright Trace 未落盘 |
| P2-5 | Loading / Empty / Error 三态未逐一触发（本轮只覆盖稳定态与真实空态） |
| P2-6 | OAuth 回调未做真实交互验证 |
| P2-7 | 无 Workers Logs / Sentry 访问，异常可观测性未验 |
| P2-8 | `.env.test` 仍被跟踪（值为 `test-*` 占位；`tests/setup.ts` 依赖它） |

### P3

| ID | 问题 |
|---|---|
| P3-1 | `/workspace?view=now` 不自动去冗余参数 |
| P3-2 | 本地无法验证 DiceBear 头像；生产未复验 |
| P3-3 | 17 个 moderate 依赖漏洞（0 high） |
| P3-4 | 依赖审计 / SBOM 未跑（`check:deps`、`audit:open-source`） |

---

## 5. 什么情况下可以转 GO

按当前状态，转 GO 需要**全部满足**：

| # | 条件 | 当前差距 |
|---|---|---|
| 1 | PingPong 凭据已轮换并确认旧 Key 失效 | **未做（人）** |
| 2 | 生产 LCP ≤ 2500ms（或出具人工批准的书面豁免 + 明确风险接受） | 3580ms |
| 3 | `production` environment 配好 required reviewers | 0 个 |
| 4 | 明确发布目标是 Netlify 还是 CF Workers；若后者，先完成绑定注入 | 未定 |
| 5 | 至少完成一次回滚演练 | 未做 |
| 6 | PR 可创建（受保护合并）或书面说明为何允许直推 | 403 |
| 7 | axe + Trace 补齐 | 未跑 |

**其中第 1、3 项完全在代码之外**（PingPong 后台、GitHub 设置），Agent 无法代劳。

---

## 6. 可以安全发布的那部分（如果要做「受限版本」）

V20.4 允许的发布边界是：「已验证的登录、Workspace、Console、只读展示及**无需未获批外部动作**的功能」。

按本轮证据，以下**已具备可发布性**：

| 能力 | 证据 | 前置 |
|---|---|---|
| 登录 / Session | `53` §4 | 无 |
| Workspace 六屏 + 深链接 | `54` §3（22/22） | 无 |
| Console 七屏（只读 + 空态） | `54` §1（56/56） | 无 |
| Mission 创建（服务端强制租户） | `57` §4（6/6） | 无 |
| Agent 真实模型调用 | `56` §2（生产 9/9） | 依赖生产环境变量，已具备 |

以下**必须先关或标注为不可用**：

| 能力 | 原因 |
|---|---|
| 支付（含 PingPong / Creem / Stripe） | 凭据 P0 + 商业决策未批（`charging=false` 已是当前状态） |
| 未授权的外部执行（Action） | 无 S3 验证 |
| 对外宣称「完整 Connection OS」 | 审批→执行→Verified Outcome 链路未验（`56` §0） |

**但这个「受限版本」仍不能算 RC GO**：B-2（性能）与 B-3（治理）与功能范围无关，属于发布质量与流程前提。

---

## 7. 一句话总结

> 代码侧这轮实质推进了三件事：**104 屏视觉全绿、G-03 深链接 22/22、S2 生产真实模型调用 9/9**；
> 同时挖出并止血了一个**从未被登记过的 P0（PingPong 凭据）**，也把「性能未达标」从一句结论变成了可复现的 TTFB 归因。
> 但 RC 仍是 **NO-GO**：凭据要人去轮换，审批保护要管理员去配，性能要外部配置去改——**这三件都不在代码里**。
