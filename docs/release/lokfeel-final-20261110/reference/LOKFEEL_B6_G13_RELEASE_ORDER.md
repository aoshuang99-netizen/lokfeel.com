# LokFeel | V20.7 B6 发布与 G13 生产验收最终任务书

> 适用范围：直接交给 WorkBuddy 总调度、Codex 独立评审、Figma/前端 Agent、QA Agent、Release Agent。
> 资料基线：2026-11-12 用户提供的 WorkBuddy 执行报告；`RELEASE_STATUS.md`（最后写明 NO_GO）、`10_REMAINING_TASKS_AUTOMATION_PLAN.md`。**这份任务书不是已完成部署的证明。**
> 仓库路径（由执行端核验）：`/Users/frankzhao/WorkBuddy/20260402202519/nexus-app`。生产参考 URL：`https://app.lokfeel.com`。

## 0. 唯一目标和不可篡改的状态语义

**目标：** 一次性消除上市阻断问题，完成用户可理解的商业站点、真实可执行的 AI 业务链、可核验的订阅与支付、专业 UI/UX，并在**特定 RC SHA 获明确授权之后**发布生产；生产端 G13 全通过后才记 `RELEASED_AND_VERIFIED`。

状态只允许：`PASS / FAIL / PARTIAL / BLOCKED / NOT_TESTED / N/A`。`PARTIAL`、`BLOCKED`、`NOT_TESTED` 不计入完成。总状态：`NO_GO → READY_FOR_APPROVAL → RELEASED_NOT_VERIFIED / RELEASED_AND_VERIFIED`。不得写“全部完成”却没有实际 E2E、生产证据或第三方真实回执。

**默认风险阻断**：最新报告中生产 `5a161c4` 的 live `/pricing` 入口仍可结账，包含尚未在生产修复的 R-15 幂等缺陷；候选已修复并锁定审批门，但尚未部署。WorkBuddy 的每小时只读巡检已创建且 ACTIVE；不重复创建。第一任务是重验和申请 D2 风险止损，不得把「哨兵告警」当作「止损」。

## 1. 先自动执行的 P0 任务队列（不得再次询问排序）

| ID | Owner/技能 | 具体动作 | 自动化边界 | 完成证据 |
|---|---|---|---|---|
| P0-01 | WorkBuddy/Browser/QA | 重验 `health`、`plans`、`pricing`、远端 main、生产部署、历史 R-15 风险 | **只读自动**；生产止损需 D2 授权 | `evidence/p0-01-production-risk.json`，每字段有 HTTP、时间、SHA；不能取证为 ERROR |
| P0-02 | Codex/TDD | 对 R-15 重跑 FAILED→SUCCEEDED、SUCCEEDED→FAILED、同事件重放、逆序、并发；R-14 续费双记 | 本地/Preview 自动；真实卡、live 写入禁用 | 测试日志、数据库前后状态、负控注入导致 FAIL |
| P0-03 | WorkBuddy/UX/Browser | 审计 B1/B2 所有公开页，确认八问都在真实可见 UI 中、CTA 真实有效 | 自动改可逆 UI/文案；法律主体不能代填 | 英/中文案、来源证明、页面 ID、截图、跳转轨迹 |
| P0-04 | Figma/Frontend | 以 `--lf-*`、Concept C Deep Field/Paper 为权威；检查 import kit 与代码路径；有写权限才建真实可编辑 Figma | 代码端自动；G3 无权限仍 BLOCKED | Figma URL、Node ID、组件映射；否则明确阻塞证据 |
| P0-05 | QA/Playwright | 全站 29 路由×4视口矩阵，重测网页的导航、状态、深链接、支付关闭状态 | Preview 自动 | 116 格：112 PASS/4 N/A 只是**历史基线**，新 RC 必须重跑并记录全部差异 |
| P0-06 | Performance/Browser | 8 页×5轮测 TBT，排查主线程/第三方脚本/水合成本，修到所有强制页达标 | 代码优化自动 | TBT≤200ms 8/8；LCP/CLS/INP/TTFB不回退，原始 JSON |
| P0-07 | Security/QA | 生产产物/浏览器 bundle 密钥扫描、租户权限、鉴权/CSRF/Webhook 重放、审计 | 只读生产/隔离测试自动 | 负例、gitleaks、产物哈希、0 P0/P1 blocker |
| P0-08 | WorkBuddy/Docs | D8 公司主体与真实联系方式的占位清单；C-31 社媒链接逐项访问核实，失效链接隐藏/移除 | 可自动核验、修正无效链接；主体信息等用户 | `about/terms/privacy/refunds/contact` 一致性表及证据 |
| P0-09 | Research/UX | 准备 G5 五名外部目标用户测试、脚本、观察表、招募与统计脚本 | 准备自动；真人测试不能冒充 | ≥5真实用户、成功率、任务耗时、原始记录和知情同意 |
| P0-10 | Release/GitHub | 建独立 RC PR，锁 SHA，完整 CI、安全、构建、Preview 与本地 E2E | 预览自动；生产发布需授权 | `rcSha`, CI Run, Preview Deploy ID, GO/NO-GO |

### 立即执行顺序

**0～第一阶段：** P0-01 安全风险取证；P0-02 支付核验；P0-03/04/06/08 可并行修复。不得让 Figma 或人工决策阻塞其他任务。所有更改必须进入同一个待发布分支，独立 PR 审核，禁止直接将文档标 PASS。

## 2. 商业站点逐页验收（不是只有页面 HTTP 200）

| 页面/模块 | 必须能回答的客户问题 | UI 最少交付 | 验收 |
|---|---|---|---|
| 首页 / | 你是谁？为谁服务？解决什么？ | Hero + 目标客户 + 价值证据 + 主要 CTA + How it works | 首屏 5 秒理解测试；CTA 对应真实路由与状态 |
| Product / How it works | 什么是 Connection OS？与聊天机器人/CRM有什么差异？ | 8 步链路图、真实界面、不授权不会外部执行 | 与实际 API 逐项核对；不展示未实现能力为已上线 |
| Use cases | 团队、社群、机构分别用它做什么？ | 3 类用户任务示例与边界 | 案例若为演示必须标 `Demo`，不得宣称真实客户成功数据 |
| Pricing | Starter/Growth/Scale 对象与权益区别？ | 目标人群、额度、14 天试用条件、月/年价、缺 SKU 说明 | 页面价格来自唯一目录；未批准不生成 checkout；Scale 年付说明限额 |
| Docs / Getting started | 新用户如何完成第一个任务？ | 3～5 步真实操作、截图、空态与常见错误 | 新用户不依靠客服完成端到端基础流程 |
| About/Contact | 谁负责、怎么联系、主体是什么？ | 真实主体、客服路径、品牌理念、适用范围 | 无编造创始人履历/虚假公司信息；D8 未批则不标 PASS |
| Terms/Privacy/Refunds | 谁收款、如何退款、数据如何处理？ | 一致的法律主体与支付服务商描述 | 法务一致性、链接可达、未授权价格承诺不得发布 |
| Workspace/Console | AI 做了什么？为什么？能否批准、撤销、验证？ | 任务状态、Consent、Action、Evidence、Outcome | API + DB + 审计同事件可追溯 |

**客户理解测试（G5）：** 5 位真实非项目成员，至少 4/5 能说出“平台面向谁、提供什么结果”；每人完成预定核心任务，并记录是否无需提示、错误、时间、主动反馈。测试不满足门禁必须修文案或交互后重测。不得用 AI 模拟问答当真人研究。

**文案示例（供审阅、不得自动冒称产品事实）：**
- Hero: “LokFeel — Turn human intent into trusted action.”
- Sub: “A Connection OS for teams and communities to understand goals, coordinate AI-assisted work, approve sensitive actions, and verify outcomes.”
- CTA: “See how it works” / “Start a workspace”
- Evidence: “Proposed → Awaiting consent → Executed → Verified (only when independently evidenced).”
- 场景演示标注：`Illustrative workflow. Not a customer testimonial.`
- Pricing 需按已批准目录显示；代码、页面、Dodo 商品金额完全一致。

## 3. Figma/UX 执行标准与可视化示例

真实 Figma 连接器仍按最新回报为 BLOCKED；已有 `figma-import-kit`：20 Color Tokens / 20 Frames / 9 Components。不得把资产包说成已创建 Figma 文件。

**设计优先级：** 网站认知/订阅说明（G1/G2/G5） > Workspace/Consent/Outcome 实际工作流 > 高密度管理 Console > 装饰性动效。现有 `--lf-*` Token 唯一事实源，不引入第二色板。界面与业务状态完全对应，动效服从 `prefers-reduced-motion`，WCAG 2.2 AA。

**示例文件：** `examples/lokfeel_visual_reference.html`（浏览器直接打开，含公共首页、订阅、Deep Field Workspace、发布门禁视觉参考）。它是 HTML/CSS 概念稿，**不是**已部署生产截图、Figma 实际 Node，也不是已接线业务代码。

**验收链：** Frame/HTML Spec → React component → URL/Screen ID → API contract → Playwright trace → AXE scan → before/after screenshots → Git SHA。G3 无写权限保持 BLOCKED；不阻断其他可逆工程。

## 4. D1—D8：一次集中确认，不允许 WorkBuddy 自行决定

| 决策 | 推荐默认方案（仅建议，**不是审批**） | 解锁条件 |
|---|---|---|
| D1 定价 | 暂不批准，直到三档成本与权益通过评审 | 用户明确批准 Starter 49 / Growth 149 / Scale 399 USD 月费及对应年付，审批记录 |
| D2 生产收银台 | **优先立即止损**，防止旧代码 live checkout 暴露风险 | 用户授权最小止损方式，确认对已有订阅/Webhook影响；先核验再操作 |
| D3 SCALE 年付 | 保持不可售显示，申请提额≥4000美元；不得擅自降价 | 用户选择提额/下架/新批准价格，Dodo 结果实证 |
| D4 Dodo 沙箱 | 使用专属 test_mode 凭据，绝不能使用 live key 冒充 | 用户通过受控密钥存储提供环境权限；实投通过 |
| D5 真实扣款 | 独立、受控、最小金额人工测试；不授权前不扣款 | 用户针对金额、账户、用途明确批准；真实回执/账本/开通一致 |
| D6 Cloudflare | **建议维持 CF 代理 → Netlify 源站**完成此次业务上线，Workers 另行实验 | 用户明确批准架构范围，架构文档和生产 HEAD 实测 |
| D7 真实用户 | 招募≥5名真实目标客户进行 G5，不接受代理模拟 | 招募、参与记录、问卷和任务日志齐全 |
| D8 法律主体 | 不猜测或代填 | 真实实体、注册地、官方客服/隐私联系方式及法务确认 |

其他待办：G10 TBT 仍 PARTIAL，G8 生产产物复扫仍待 G13；C-31 社媒、H-3/H-5 的遗留问题要按范围确认是否阻断核心路径。现有 2 个只读定时任务已 ACTIVE，不重复注册；如未在 WorkBuddy 运行时查到，则核查现有 automations ID 后再处理。

## 5. 高标准发布门禁矩阵（每项必须有 SHA/证据）

### G0—G13

- **G0 Baseline**：本地/远端/部署 SHA、产物来源、当前生产入口可证。
- **G1 内容八问**：每一页都回答对应问题，claims 有可回溯支持；坏链接、虚构案例、无说明收费 CTA 均 FAIL。
- **G2 页面/法律**：全部目标路由可用，主体/条款/隐私/退款一致；D8 缺失 BLOCKED。
- **G3 Figma**：编辑节点 URL + Node ID + 代码映射；无连接时 BLOCKED（不能替代 PASS）。
- **G4 UX/AXE**：29 路由×4视口；112 适用格逐项 PASS，4 N/A 附原因；0 serious/critical，扫描非空断言。
- **G5 真人**：≥5目标真人、4/5理解达标、真实任务操作完成；没有参与即 NOT_TESTED。
- **G6 Agent**：生产对应环境的 Provider 与 Outcome 阶梯 E2E，禁止把本地 28/28 当生产证明。
- **G7 Billing**：代码层幂等与官方沙箱**真实**投递、订阅权益对账分开证明。
- **G8 Security**：生产产物真实值反查、浏览器 bundle 反查、权限/租户隔离、无 P0/P1。
- **G9 Infra**：审定目标架构，与上线实际一致；不假称 Cloudflare Workers 已承载生产。
- **G10 Perf**：8页×5轮 TBT≤200ms；LCP/CLS/INP/JS/TTFB无回退；不能以 P1 债绕过强制标准。
- **G11 同 RC 门禁**：冻结 RC SHA 后 Typecheck / ESLint / Jest / Build / brand / products / secrets / Browser / Security 全绿；旧 SHA 不算。
- **G12 定价**：商业审批可查；`APPROVED` 不能由代理代填；按钮/API/产品目录同一约束。
- **G13 生产**：发布后再执行，必须显式 `--base=https://app.lokfeel.com`，SHA 一致，业务数据和审核无回归。

### 强制禁止的“假通过”

1. 页面返回 200 ≠ CTA 真实可用。
2. 自签自验 Webhook ≠ Dodo 侧密钥一致。
3. 单测通过 ≠ 真实投递完成。
4. `git push` 成功 ≠ 生产 SHA 更新。
5. Figma 资产 CSV ≠ 可编辑 Figma 文件。
6. 29×4 截图存在 ≠ 每格运行了 axe（必须 `rulesEvaluated>0`）。
7. 本机 `localhost` 测试 ≠ 生产结果。
8. Demo 案例 ≠ 实际客户案例。
9. 用观察窗口内 0 笔真实交易宣称支付对账 100% ≠ 支付已验收。
10. 定时任务/作战书 ≠ 用户对发布、真实扣款或生产改动的授权。

## 6. Release Candidate 的实际步骤

**B6 前**：
1. 拉取最新 repo、校验 `git ls-remote`、工作区干净。不得因 `origin/main` 本地缓存旧而得出错误结论。
2. 以 `release/<version>` 建隔离 RC，包含所有已批准代码；审计差异，禁止未审核的生产密钥或无关功能。
3. 生成 `release-manifest.json`（模板见 `examples/release_manifest.template.json`），填真实 `rcSha`、部署/回滚目标、审批证明、必需门禁证据。
4. 独立 Codex 复核；要求每项有正负控，输出 BLOCKER/MAJOR/MINOR/NIT。
5. RC 门禁须全部 PASS；G13 是发布后动作，不能在 RC 前提前判 PASS。
6. 如果 D1–D8 任意必需输入缺失，或 G3/G5/G10 未达标，不可自动进入 GO。

**发布准备完成时**：向用户集中提交**一次**签字包：RC 全 SHA、运行时目标（Netlify+CF 代理）、完整 GO/NO-GO、回滚部署 ID、不可替代授权事项、已知不阻断问题、测试矩阵。用户明确回复批准该 SHA 后才执行生产部署。

**发布期间**：
1. 记录发布前生产 `health.commit`、Netlify deploy ID、站点设置快照、回滚目标。
2. 使用仓库现有受控流程一次部署；不得仅推送 `[skip netlify]`。
3. 等到 `published_deploy.state=ready`；核对新 deploy 的 `commit_ref`、与批准的 RC 代码产物等价关系（文档 SHA 与 runtime SHA 可能不同）。
4. 运行 G13 生产端到端，只执行已授权、可控的动作；不要向 live 发模拟交易。
5. 任一 P0 失败马上 `RELEASED_NOT_VERIFIED`，按已批准应急预案升级回滚决策；不得直接改写为 GO。
6. 通过后写 `RELEASED_AND_VERIFIED`，再启动48小时只读观察期。

### G13 必跑（实际脚本名称和参数先在仓库核实）

```bash
BASE=https://app.lokfeel.com
node scripts/qa/prod-smoke.mjs --base="$BASE"
npm run verify:payment-off -- --base="$BASE"
QA_BASE_URL="$BASE" node scripts/qa/verify-public-origin.mjs
node scripts/qa/verify-released-surface.mjs --base="$BASE"
# 另跑 G6 生产 provider 出口、G8 部署产物扫描、G4 生产视口子集。
# 应对真实付费状态使用对应已批准的 checkout-on 或 checkout-off 验收，不可无条件验证 payment-off。
```

**注意：** 生产开放结账要有真实 D1+D5+G7 证据；如果商业门禁仍关闭，任何 `checkoutReady=true` 应触发阻断和审计。支付部署前必须确认旧状态与候选的不同，不得把生产 RISK_OPEN 当作正常。

## 7. 自动化架构（已存在任务不重复建）

- L0 硬护栏：保留 D1–D8、D-10 人工决策；未审批不得写生产 env / 真实支付 / 切流 / 回滚。
- L1：已 ACTIVE 的每小时收银台只读哨兵、每日 09:20 门禁日检；必须检查是否仍在运行且日志持续更新。
- L2：发布预检与 manifest 生成可自动；生产部署 workflow 必须 `workflow_dispatch` + Environment required reviewers，**不得由 main push 自动发生产**。
- L3：外部授权到达时，自动触发对应补齐和复验，不能让授权自动替代真实执行证据。
- L4：G13 全绿后48小时巡检 health、plans、SHA、5xx、账本对账；无法获取真实数据时为 NOT_TESTED。

建议 Release Agent 严格产出：`STATUS.json`、`GATES.csv`、`RELEASE_MANIFEST.json`、`PRODUCTION_SMOKE.log`、`POST_RELEASE_48H.log`。每项含 `timestamp`, `rcSha`, `productionCommit`, `command`, `exitCode`, `source`, `verdict`, `evidencePath`。

## 8. 需要 WorkBuddy 回答的最后七个问题（禁止空泛“完成”）

1. 为什么当前生产允许 `checkoutReady=true`？谁批准了 D1，证据何在？
2. 候选与生产的功能差异有哪些？R-15、G12是否在生产生效？
3. Dodo 真实事件有没有投递到正确 Webhook？能否提供 provider event ID、HTTP、数据库行和权益状态？
4. `G10 TBT` 的八页原始样本在哪里，是否都达到 ≤200ms？
5. 首页访客能否独立说明 LokFeel 是什么，G5 真实五人测试证据在哪里？
6. Figma 文件与 Node ID 是否真实创建；否则为什么 G3 仍 BLOCKED？
7. 此次提交用户审批的**唯一 RC SHA** 是多少？对照哪份可即时回滚的 Netlify deploy？

**WorkBuddy 下一条交付的标题必须为：`LOKFEEL RC FINAL GO/NO-GO — Evidence Based`。若仍是 NO_GO，必须给出最短关键路径和已自动完成的修复内容，不得再给一份无执行结果的建议书。**
