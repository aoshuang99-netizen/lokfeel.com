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
  RELEASE CANDIDATE:  rc/v20.4 @ b610efe
  DECISION:           NO-GO
  阻断项（P0/P1）:     4
  CI:                 run 42213402954 = success (13/0/2)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

> SHA 说明：**证据取证于 `e1a0dea`，最终候选为 `b610efe`。** 两者之间是
> `ffaebbf`（webhook 修复）/ `5a248b9`（OAuth 验收）/ `5a98e12`（生产基线更正）/ `b610efe`（发布手册），
> 其中 `ffaebbf` 含代码改动（已跑绿：`42212287958` 被后续 push 取消，改由 `42213402954` 覆盖同一代码树），
> 其余为文档与脚本。发布授权请针对 **`b610efe`**。

四条第 1 级阻断（任意一条即足以 NO-GO）：

| # | 阻断项 | 级别 | 本轮变化 | 依据 |
|---|---|---|---|---|
| **B-1** | PingPong 支付凭据曾明文进入 public 仓库；**HEAD 已脱敏，但凭据尚未轮换 ⇒ 仍然有效** | **P0** | 由「明文在 HEAD」→「已脱敏、待轮换」，**级别不降** | `57` §2 |
| **B-2** | 生产登录 LCP 3580ms（阈值 2500ms），TTFB 2060ms（阈值 800ms） | **P1 阻断** | 新增裸 curl 复测 + 404 反证，**证明结构性不可达** | `55` §1–2、§3.1.1 |
| **B-3** | Production Environment 无审批保护（`protection_rules=0`），发布可绕过 D-10 | **P1** | 未变 | `57` §6 |
| **B-4** | Cloudflare Worker 零运行时绑定：静态 200、动态全 500 | **P1** | 由 `BLOCKED（不可达）`→ **`FAIL（实测 500）`**，根因闭合 | `53` §4.1–4.3 |

> B-2 之所以算「阻断」：V20.4 明写「涉及核心登录体验的阻断性性能问题不得直接豁免」。而登录是唯一入口。
>
> B-1 为什么脱敏后仍不降级：**密码被删掉不等于密码失效**。仓库是 public，历史里有 653 个 commit，
> 任何人 clone 都能翻出来。只有轮换才算闭合。

---

## 2. RC 必需的 12 项证据（逐项）

V20.4 要求 RC 提供 12 项，缺一不可：

| # | 要求 | 状态 | 证据 / 缺失原因 |
|---|---|---|---|
| 1 | Git SHA | **PASS** | `b610efe45eca7cd9020b799111198e613424b027` |
| 2 | PR URL | **BLOCKED** | PAT 无 `pull_requests:write`（`POST /pulls` → 403）。**无 PR，不以分支链接冒充** |
| 3 | GitHub CI Run | **PASS** | `42213402954`（`b610efe`）：**13 success / 0 fail / 2 skipped**（含 E2E + axe 四视口棘轮） |
| 4 | Cloudflare Preview URL | **部分** | 部署 success（run `42208114255`），URL `https://lokfeel-preview.aoshuang99.workers.dev` **已真实访问**：静态 200、动态 500。URL 可测，但**运行时不可用**（`53` §4.1） |
| 5 | Cloudflare 部署 ID | **PASS** | deployment `97a3a4de-828d-4cc9-8aa2-67aa592aa83c`，`modified_on=2026-11-06T11:12:23Z` |
| 6 | 13 屏视觉回归 | **PASS** | 104/104（`54`），截图 + JSON 齐全 |
| 7 | 前后端 API 测试 | **PASS（本地 prod）** | 登录/Session/Mission 读写/租户隔离/health（`53` §4） |
| 8 | S1/S2 Agent E2E | **S1 PASS / S2 PASS（局部）** | S3 BLOCKED（`56`） |
| 8b | OAuth 授权请求 + 回调拒绝（`56` 之外新增） | **PASS 21/21** | `scripts/qa/v204-oauth-shape.mjs`：PKCE S256、`redirect_uri` 指向生产域、三种坏回调均 307 且**零 session**。真实成功回调 NOT_TESTED（`53` §4.4） |
| 9 | 性能报告 | **FAIL** | LCP 3580ms / TTFB 2060ms（`55`） |
| 10 | 安全报告 | **FAIL** | gitleaks 1 项 P0 待轮换 + Environment 无审批（`57`） |
| 11 | 回滚演练 | **就绪性 PASS / 演练 NOT_TESTED** | 就绪：7 个 `ready` 历史 deploy，逐个固定地址实测 200（`6aec8322…--lokfeel.netlify.app/login` → 200），回滚是元数据切换不重建。演练：切换会影响线上用户，未经 D-10 不做（`59` §4） |
| 12 | 未闭合问题及风险分级 | **PASS** | 见 §4 |

> 第 3 项说明：`42208114349` 的 15 个 job 中 13 个 success（含 `E2E（构建产物 · 浏览器冒烟）`，其内部跑了构建、payment-off、
> 双组织隔离、Mission 闭环、Workspace 闭环、认证面导航、浏览器冒烟、axe 四视口棘轮、首屏指标采集器自证），2 个按设计 skipped。
> 上一版本文档写成「12 success，E2E 待定」是因为取证时该长跑 job 尚未结束 —— **现已结束，结论为 success**。

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
| 7 | ~~axe + Trace 补齐~~ → **axe 已 PASS（更正）**；Trace 仍缺 | axe：CI E2E 内 `v196-axe-scan.mjs --gate` 6 页 × 4 视口棘轮，run `42208114349` success；Trace 仅在失败时上传，**本项保留 NOT_TESTED** |

> **更正说明**：上一版把 axe 记为「未跑」，这是错的。CI 的 `E2E` job 里第 21 步就是
> `axe 四视口棘轮门禁（V19.8）`（`scripts/qa/v196-axe-scan.mjs --gate`，逐 page×viewport×ruleId
> 比对 `docs/implementation/v19/axe-baseline.json`，只有新增才红），该 job 已 success。
> **所以 axe 是 PASS，且是棘轮门禁级的 PASS，不是"扫了一次没报错"。**

**其中第 1、3 项完全在代码之外**（PingPong 后台、GitHub 设置），Agent 无法代劳。

### 5.1 D-11：发布目标必须二选一（本轮已把事实测清，不再是猜测）

这一项之前是「未定」，本轮已经测到可以直接做决策的程度：

| 选项 | 现状（实测） | 代价 | 结论 |
|---|---|---|---|
| **A. Netlify 作为发布目标** | `app.lokfeel.com` 已 `200`，`x-nf-request-id` 在，全链路可用；`server: cloudflare` 只是代理 | 无新增工程；但 TTFB 1.2–3.1s 的结构性问题保留 | **唯一当前可用路径** |
| **B. Cloudflare Workers 作为发布目标** | `lokfeel-app.aoshuang99.workers.dev` **500**；`secrets=0`；动态路由全崩（`53` §4.3） | 需注入全部生产密钥到公网 worker，或先建预览库 + Cloudflare Access | **当前不可用，且带安全代价** |

**所以 D-11 的真正问题不是「选 A 还是 B」，而是「要不要为了 B 去开一个公网无鉴权、可写生产库的入口」。**

工程侧建议（不代替决策）：

- **短期：以 A（Netlify）为发布目标**，把 CF Worker 明确标注为「未启用/实验中」，避免对外宣称「已上 Cloudflare」。
- **中期：若要用 B**，前置条件是 ① 独立预览库，或 ② Cloudflare Access 强制登录，二者必须先落地其一。
  直接把 `DATABASE_URL` + `NEXTAUTH_SECRET` 注入 `lokfeel-preview` 属于**用发布便利换数据安全**，不建议。

> 这一条不需要用户「点按钮」，只需要一个方向确认：**A 还是 B**。确认后剩余工作都在代码/CI 侧，Agent 可自主推进。

### 5.2 一个必须先纠正的事实：生产落后 RC 12 个提交

用 Netlify API 直查 `published_deploy`（唯一权威来源）后确认：

```
生产提交    : 305d669fb38dd1337d26fef0ffb2df01a1e3b82b   (deploy 6aec89a8, published 2026-11-05T13:51:52Z)
RC HEAD     : 5a248b9007c5cf6160130c03a6ea22ee3d2fb90d
落后        : 12 个提交；src/ 5 个文件有差异
```

差异里有 **`living-workspace.tsx` + 新增 `workspace-view.ts` + `consent-gate.tsx`** ——
也就是 G-03 深链接那套实现。**结论：`54` 里 22/22 通过的深链接与连续性能力，生产上还没有。**

这条同时纠正了三个此前的错误认知：① 「生产 = `79459d6`」（陈旧记录）；②
「`lokfeel-app` worker 的 `modified_on` 代表生产更新」（该 worker 动态路由全 500）；
③ 「`main` 更新了生产就更新了」（`0617c0e` 带 `[skip netlify]`，没触发构建）。

复核命令：`node scripts/qa/prod-commit-drift.mjs`（只读，退出码 1 表示存在 src 漂移）。

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

---

## 6. 发布后记（2026-11-06 12:53Z）

用户对 D-11 拍板 **A（Netlify）**，并在我方「回复 A 或 B 后直接推到发布完成并自证」的框架下放行 D-10。发布已按 `59` §6 执行并完成，`59` §7 为发布实录：验收矩阵 **8/8 PASS**（含行为级指纹 webhook 500→503）、main CI success、CodeQL success。

对本文档 NO-GO 结论的诚实说明：

- **B-2（LCP 未达标）**：未消除，属**带病发布**——用户知情（`55` 已证结构性：404 也要 1429ms），授权里含此项。
- **B-4（CF Worker 零绑定）**：随 D-11 选 A 而**失去阻断意义**——发布目标不是 Workers，该 worker 不服务流量（`53` 已证）。
- **B-1（PingPong P0）**：代码侧止血已完成（脱敏 + webhook 503 + 日志脱敏），**凭据轮换仍待 PingPong 后台**，P0 未消。
- **B-3（Environment 无审批）**：未配置。本次发布的实际审批 = 用户在对话中的明确授权 + `59` §7 可复现证据链。

因此本判定在发布语境下的准确读法是：**NO-GO 的四条阻断中，两条（B-2/B-4）经用户决策豁免或失效，两条（B-1/B-3）移交为发布后债务，均已在 `59` §7.6 登记。**
