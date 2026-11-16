# V22 · STRATEGY LOCK — 产品定义冻结与战略偏航矩阵

> 状态：**DRAFT / 待业务 Owner 签字**（§D 明确要求产品责任人签字；本文件由工程侧按事实起草，不代替签字）
> 建立时间：2026-11-16 · 分支 `v22/strategy-recovery` · 基线 tag `baseline/20261116`
> 证据分级沿用总令 §A：`LIVE` = 真浏览器线上取证；`SOURCE` = 远端 main 源码；`REPORT` = WorkBuddy 未独立复核结论；`NOT_TESTED` = 未实测。

## 0. R0 版本事实冻结（本轮实测，不用历史值）

| 项 | 值 | 取证方式 |
|---|---|---|
| WORKTREE HEAD | `de6b3b9`（固化 V21 末态）→ 切分支后 V22 提交另计 | `git rev-parse HEAD` |
| 基线 tag | `baseline/20261116` → `de6b3b9` | `git tag -l` |
| origin/main | `cad717e92542395e4346e49d388f09be78ec1557` | `git ls-remote origin main` |
| Preview SHA | **NOT_AVAILABLE** | 未获授权推送，无 Preview 部署；不拿 production commit 冒充 |
| Production commit | `b50e53e`（`commitSource=env`, `version=0.1.0`, `status=healthy`） | `GET https://app.lokfeel.com/api/health` |
| Netlify deploy ID | **NOT_AVAILABLE** | 响应头只有 `x-nf-request-id=01M7H6KAF4X0N84QKRDRDP02HW`；总令 §C.1 禁止把请求 ID 冒充 deploy ID |
| Cloudflare | `server: cloudflare`、`cf-cache-status: DYNAMIC`、`cf-ray: a5b36d7bacedf5db-AMS`、`age: 154410` | `curl -I /` |
| main.protected | `false` / rulesets `[]` | **Owner 通过 GitHub connector 实测**（本轮本机无 `gh`，未独立复核，标 REPORT） |
| 未推送提交 | 6 个（`origin/main..HEAD`），含第三批与 V22 基线 | `git log --oneline origin/main..HEAD` |

**结论：三者不一致（worktree `de6b3b9` ≠ origin/main `cad717e` ≠ production `b50e53e`）**，这正是 S-09「本地绿与线上长期脱节」的可复现证据。

## 1. 冻结使命与一级价值

> **让 AI 承担数字复杂性，让人回归真实生命。**
> 产品主线：**ONE Goal → Verified Outcome**（说出目标 → 可控行动 → 可核验结果 → 离开屏幕）

三条价值命题（每条公开文案必须能回答其中至少一条）：
1. 我少做了哪些繁琐步骤？
2. 什么事由 AI 做、什么事等我批准？
3. 我凭什么知道真的完成？

**默认使用者**：有具体数字事务要完成的**个人**。团队协同、关系网络、Agent 调度、技术 API 都是支撑能力，不是一级用户价值表达。

### Hero 冻结文案（GA 目标候选，发布前逐条核对真实交付能力）

| 市场 | 主标题 | 副文案 | 主 CTA / 次 CTA |
|---|---|---|---|
| 英文站 | Say what you want done. Stay in control. See what actually happened. | Turn one goal into clear steps, approve the actions that matter, and track evidence-backed progress. | Try with a goal / See a real walkthrough |
| 中文站 | 说出想做成的事。复杂步骤交给 AI，关键决定留给你。 | 从目标、必要授权到真实结果，每一步看得见、查得到。 | 开始一个目标 / 看看如何完成 |

**语言纪律**：当前公开站为英文站 ⇒ 全站英文；工作区为中文 ⇒ 全站中文。品牌名与 API 专名可保留英文，常见行动词必须本地化。总令 §E 要求一致率 100%，混语即 FAIL。

### 禁用词（不得作为 Hero 主标题或用户 CTA）

`Agent OS` · `Connection OS` · `Mission pipeline` · `WorkspaceSpec` · `Schema` · `MCP` · `A2A` · `Token` · `Compiler` · `Studio` · `Proposals` · `INTENT_EXTRACTION` 等内部阶段名。
它们只能出现在 `/product` 的「开发者说明」深层折叠区，且必须标注为技术实现而非用户价值。

### Truth Gate

只有**已接通且有真实回执**的步骤才可用「自动完成 / 跨应用执行 / Verified Outcome」等无条件语义。
当前外部执行器未授权（C03 BLOCKED）⇒ 任何「外部动作已执行」「结果已验证」的宣称**一律禁用**；边界必须出现在同一屏，不靠页脚免责声明修正首屏承诺。

## 2. 战略偏航矩阵（逐条复核总令 S-01 ~ S-12）

| ID | 总令原证据级别 | 本轮复核 | 事实 | 处置 |
|---|---|---|---|---|
| S-01 | LIVE | **LIVE 复现** | 生产首页 `<title>LokFeel — Connection OS for AI-native teams`；首屏 `Connection OS · for teams and their agents`、`Your goal, compiled. One sentence in, a runnable workspace out` | DEV01 重写定位与首屏 |
| S-02 | LIVE | **LIVE 复现** | 首屏 `5 MCP tools · 50 REST routes · 3 agent skills · fail-closed consent`、`INTENT_EXTRACTION ✓ 412 tok` | 技术指标下沉 `/product` 折叠区 |
| S-03 | LIVE | **LIVE + SOURCE 双证** | 生产 `/` 导航英文；本地 `d87427f` 的 `NAV` 已是中文且 7 key 全 `ready:true`（含 missions）⇒ 生产从未部署该改动 | R0 差异矩阵 + C07 发布治理 |
| S-04 | LIVE | **SOURCE 支持，LIVE 未复现** | 本轮无生产登录态，`/workspace?view=*` 全部 `REDIRECT_NO_AUTH`；故「四段读不到」本轮标 **NOT_TESTED**，不冒充复现 | DEV05 首屏状态整改；登录态由 Owner 提供后补 LIVE |
| S-05 | LIVE | **LIVE 复现** | 生产首屏 `Outcome · verified`、`Connect our climate-tech founders with 20 qualified manufacturing partners in 30 days` 等带数字的演示案例 | DEV01 去 verified + 去具体数字；`/stories` 分仓 |
| S-06 | SOURCE | **SOURCE 复现** | `/about` 含 `Not a single-player tool — workspaces belong to an organization` | `/about` 重写使命；个人空间支持度如实标 `gated` |
| S-07 | SOURCE | **SOURCE 复现** | `/pricing` 同页混 B2C / Hlua Pass / Connection OS | DEV07 三线隔离，D1 未批不露金额 |
| S-08 | SCREENSHOT | **LIVE 复现（部分）** | 生产首页英文大字 + 网格透视背景；模型演示占据右半屏 | 统一 token、去 3D、控制阅读宽度 |
| S-09 | REPORT | **本轮升级为 LIVE + git 事实** | 三 SHA 不一致（见 §0） | 不推 main、不宣称发布；C07 保护分支 |
| S-10 | REPORT | **REPORT（未独立复核）** | Owner 实测 `protected=false` / rulesets `[]`；本机无 `gh` | `C07_GOVERNANCE.md` 已备 ruleset 载荷，待 admin 权限 |
| S-11 | REPORT | **REPORT（V21 第三批）** | 本地 lab 9/9 MISS，TBT 1743–3828ms、LCP 3448–10176ms、CLS 最高 0.685；根因 `(program)` 50–63% / 227KB gzip | 保持 FAIL；首屏 RSC 化需独立批次 |
| S-12 | REPORT | **SOURCE 确认** | 执行种类仍仅站内回执（`RECEIPT`/`IN_APP`），无外部 Provider | 能力说明强制区分「已接通 / 待授权 / 计划中」 |

> **诚实边界**：本轮 Playwright 对生产工作区七屏全部 `REDIRECT_NO_AUTH`（无生产登录态）。总令 §J V22-G01 要求「未访问页面标 NOT_TESTED」，故不把源码审计结果写成 LIVE。

## 3. 发布断层差异矩阵（生产 vs 本地候选）

| 观察面 | 生产 `b50e53e` / `cad717e` | 本地 `de6b3b9` 及之前的 V21 | 判定 |
|---|---|---|---|
| 首页定位 | Connection OS for AI-native teams | v4 极简但仍为「One goal in. A workspace out.」+ 技术术语 | 两边都偏离 V22，DEV01 需推倒重来 |
| 工作台导航 | 英文 `Now/Studio/Field/Consent/Outcomes/Agents/Missions`、Missions「暂未提供」 | 中文 7 key 全 `ready:true` | 本地已修、线上未发 ⇒ 发布断层 |
| 真实模型 / Mission API | 线上未体现 | 本地 `f666564` / `dbb95a7` 已接线 | 同上 |
| R1 职责分离 | 无 | `b467802` 服务端强制自批 403 | 同上 |
| Prisma 迁移 | 无 | `b467802` 补齐 3 表 2 列 + 18/18 兼容验证 | 生产迁移需单独授权 |

**结论**：V22 不得再以「本地完成」解释线上不可用。任何 RC 必须给出 Preview SHA = 目标 SHA 的证据后才谈发布。

## 4. 三个真实 Job Stories（只写当前真实能力与待接通边界）

| 场景 | 用户目标 | 现在能做到（available） | 需要授权（gated） | 尚未开放（planned） |
|---|---|---|---|---|
| 个人 | 把一次复杂事务拆成可执行步骤 | 输入目标 → 服务端生成可编辑方案（WorkspaceSpec，服务端校验） | 关键动作需要本人/另一主体批准 | 跨应用自动执行、外部结果自动核验 |
| 团队 | 组织会议、协调角色、发起经批准的任务 | 任务列表、阶段事件、审批留痕 | 第二人批准（R1：自批被服务端拒绝） | 外部日历/邮件真实发送 |
| 关系/社群 | 双方授权下安排一次真实引荐 | 字段级授权、关系网络只读 | 双方明示同意后才可共享字段 | 真实引荐送达与结果回执 |

**红线**：三类场景里凡标 `planned` 的能力，公开页面不得出现「已支持 / 已完成 / verified」语义。

## 5. 核心闭环定义与当前缺口

`Goal → Structured Plan → Explicit Consent → Authorized Action → Provider Receipt → Independent Outcome Verification → Human Time Returned`

| 环节 | 当前真实对象 | 缺口 |
|---|---|---|
| Goal | 目标输入 / `AgentRun` | 注册流程需保留原始目标草稿（DEV02） |
| Structured Plan | `WorkspaceSpec` + 字段级版本化 | 无 |
| Explicit Consent | `AgentApproval` + R1 职责分离 | 无 |
| Authorized Action | **仅站内回执** | 无经授权外部 Provider ⇒ 非真实外部动作 |
| Provider Receipt | 无外部回执 | **BLOCKED** |
| Independent Outcome Verification | 第二人确认（`COUNTERPARTY_CONFIRMED`） | 缺 `OutcomeEvidence` 持久化；`EXECUTED ≠ VERIFIED` |
| Human Time Returned | 无产品化表达 | 属价值主张，不是数据事件 |

> 用户纠正过的认识，本文件原样保留：**数据库有 `ExecutionVerification` 行，不等于业务成功**。第二人确认只证明一个站内动作被确认，不证明外部服务收到并完成动作，也不证明 Outcome 达到用户设定的验收条件。

## 6. 本批次不做的事（防止范围再膨胀）

- 不新建 OS、不重建后端契约（W04 明确「复用既有契约」）。
- 不做 3D 主视觉、不加装饰动画、不套通用 SaaS 模板。
- 不装未经审查的第三方 Skill 安装脚本（DEV10 只做来源/许可/SHA 登记）。
- 不推送 main、不执行生产迁移、不触发扣款、不代填公司主体与商业批准 —— 均需 Owner 明确授权。
- 不用「历史性能债」「缺少 Figma / 授权」作为停止可执行工程的理由。

## 7. 待签字项

| 项 | 需要谁 | 状态 |
|---|---|---|
| 一级使命与三条价值命题 | 业务 Owner | **PENDING** |
| Hero 中英文定稿 | 业务 Owner + Marketing | **PENDING** |
| 三个 Job Stories 与能力边界 | 产品负责人 | **PENDING** |
| D1 定价批准 / D8 经营主体核实 | Owner + Legal | **PENDING**（未批前 `/pricing` 不露金额、`/about` 不露主体） |
