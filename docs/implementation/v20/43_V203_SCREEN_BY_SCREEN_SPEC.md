# V20.3 · 43 — 逐屏八元组规格（六屏 + 七屏 + 横向页）

> 屏幕名 / 路由 / Screen ID 全部以 `v19/07`、`v19/08`、`v20/01_V200_PAGE_API_STATE_MATRIX.md` 与真实源码为准，
> **不虚构新路由**。逐屏八元组 = `① Route/Screen ID ② Figma Node ID ③ 组件路径 ④ 数据 API/Schema
> ⑤ 用户交互事件 ⑥ 状态变化与异常处理 ⑦ Playwright Test ID ⑧ Before/After 截图及证据`。

## 1. 八元组通用字段（真实值，避免逐屏重复）

| 字段 | 全屏统一事实 |
|---|---|
| ② Figma Node ID | **`BLOCKED`** —— `v19/07` §2 / `08` §2 均为 `N/A (HTML source)`；本轮实测 `BLOCKED_FIGMA_WRITE`，见 `42`。**不填臆造 ID** |
| ⑧ 截图 | `docs/implementation/v19/screenshots/production-dc102cd/` 有 1440×900 与 390×844 双视口真实截图（`_workspace__` / `_console__` / `_login__` 等），但属**旧版 `dc102cd`**，不是本轮 After |
| ⑧ 本轮 After | **NOT_TESTED** —— 未跑浏览器；不得把历史截图当新设计自动验收（作战令 §2） |
| ⑦ Test ID | `tests/e2e-ci/workspace-tabs.spec.ts`（六页签，含 `aria-current="page"` 前置断言）、`tests/e2e-ci/authed-mobile.spec.ts`、`mobile.spec.ts`、`auth-dialogs.spec.ts` 等 |

## 2. 体验模块 → 真实六屏映射（作战令 §4.1 要求「保留原屏幕结构并说明对应关系」）

| 作战令体验模块 | 真实屏 | 对应关系说明 |
|---|---|---|
| Intent / Entry | **Studio** | 自然语言输入 + `compileWorkspaceSpec` 本地编译；创建任务才写服务端 |
| Workspace（当前目标/上下文/进度） | **Now** + **Field** | Now = 阶段总览 `buildOsStages`；Field = 2.5D 连接场，点选节点看依据 |
| Mission（计划/步骤/执行状态） | **Studio**（创建）+ **Console/Missions**（队列，独立路由） | Workspace 内 Missions 列表区 `ready:false` **未接线**，不伪装可用 |
| Agent | **Agents** | `agent-board.tsx`，状态来自 `agent.run` 事件 |
| Consent | **Consent** | `consent-gate.tsx` + `bridge-panel.tsx` 子面板 |
| Outcome | **Outcomes** | `outcome-observatory.tsx`，验证流 + 三栏证据 |

> 结论：**不是一一对应**，按要求保留真实六屏结构（`Now/Studio/Field/Consent/Outcomes/Agents`）。

## 3. Living Workspace 六屏八元组

宿主 `src/components/living/living-shell.tsx`（`[data-lf-dual='1']` + Inspector 抽屉）；
单路由 `/workspace`，本轮新增 `?view=<key>` 深链接（见 §5）。

| 屏 (①) | ③ 组件 | ④ 真实 API / Schema | ⑤ 交互事件 | ⑥ 状态与异常 |
|---|---|---|---|---|
| Now | `living-workspace.tsx:678-717`（内联 `StatCard`）、`adaptive/stage-rail.tsx` | `GET /api/notifications`、`/api/chats/unread-count`、`/api/v1/connections/proposals`；`Notification`/`ChatRoom`/`IntroductionWorkflow` | 查看待处理、点阶段条聚焦 | 三态 loading/error/empty；`buildOsStages` 读不到显示「—」≠ 0（有单测 + 变异把守） |
| Studio | `living-workspace.tsx:720-837`、`living-canvas.tsx`、`node-card.tsx` | 读：本地 `compileWorkspaceSpec(draft)`（不发请求）；写：`POST /api/v1/missions` + `Idempotency-Key`；`Mission` | 输入目标 → 编译 → 创建任务 | 禁用态写明差多少字符；**成功只认服务端 `mission.id`**，无 id 按失败，不乐观成功 |
| Field | `field/field-canvas.tsx`、`field-inspector.tsx`、`field-graph.tsx` | `GET /api/v1/missions`、`/connections/pipeline`、`/connections/candidates?missionId=`；`Mission`/`IntroductionWorkflow` | 点选网络节点看依据 | 纯函数装配；未取到显示「—」而非 0 |
| Consent | `consent/consent-gate.tsx`、`bridge/bridge-panel.tsx` | `GET /api/v1/intents`、`/intents/{id}/disclosure`、`/connections/proposals`、`/bridges*`；`SocialIntent`/`IntroductionWorkflow`/`Bridge` | 批准 / 拒绝 / 撤销 / 跨社群 opt-in-out | 服务端 `proposal.decide` 重新判定；**只按服务端 `availableActions` 渲染按钮**；二次 409 原文到界面；时间线只画真实时间点 |
| Outcomes | `observatory/outcome-observatory.tsx` | `GET /api/v1/outcomes`、`/outcomes/metrics`、`/outcomes/timeline`；`Outcome`/`OutcomeVerification` | 查看三栏证据（文字/验证记录/媒体） | `verificationLevel` **派生**自 `OutcomeVerification`；自报 ≠ 已验证；契约未含的媒体证据如实标注 |
| Agents | `agents/agent-board.tsx` | `GET /api/v1/agents/runs`、`/agents/usage`；`AgentRun`/`AgentCall`/`AgentApproval`/`AgentExecution` | 人工接管 / 查看运行 / 按能力降级 | 批准 ≠ 执行；服务端重判 409；`AWAITING_APPROVAL` 仅真实 Provider 可达（S2 BLOCKED）；成本仅展示不参算 |

**统一三态**：`living-states.tsx`（空态文案「这是查询成功后的结论，不是读取失败」）。
**未开放项**：`Missions` 第 7 项 `ready:false` + `MISSIONS_REASON`，显式禁用，不算六屏。

## 4. Console 七屏八元组

| 屏 / ① 路由 | ③ 组件 | ④ 真实 API / Schema | ⑤ 交互 | ⑥ 状态与异常 |
|---|---|---|---|---|
| 总览 `/console` | `console/page.tsx:121-122` | `GET /api/v1/workflow/overview`、`/api/v1/missions?page=1&pageSize=1` | 进入具体异常 | 聚合端点返回；异常跳转真实 |
| 智能体 `/console/agents` | `console/agents/page.tsx:179-188,543-545` | `GET /api/v1/agents/runs?limit=50`、`/agents/usage`；`POST …/runs/{id}/approve\|reject\|execute` | 批准/拒绝/执行、按能力降级 | 缺 `agent.run` → 403 如实展示；执行唯一写入点 `executor.ts` |
| 连接 `/console/connections` | `console/connections/page.tsx:112,128` | `GET /api/v1/connections/pipeline`；`POST …/{id}/introduce` | 管理连接与诊断 | introduce 走真实投递留痕 |
| 成员 `/console/members` | `console/members/page.tsx:81` | `GET /api/v1/members`（`member.read`=OPERATOR+） | 邀请与权限管理 | 权限校验在路由层；无权限操作不可执行 |
| 连接任务 `/console/missions`（+`[missionId]`） | `console/missions/page.tsx:63,91,101` | `GET /api/v1/missions`、`/{id}`；`POST …/{id}/pause` | 检索/审计/暂停 | pause 真实落库 |
| 成果 `/console/outcomes` | `console/outcomes/page.tsx:98,103,208,339,351` | `GET /api/v1/outcomes`、`/connections/proposals?states=MUTUALLY_ACCEPTED`；`POST /outcomes`、`/{id}/confirm`、`/{id}/verify` | 确认（对手方）/核验（ADMIN+） | 自报 ≠ 已验证；`verify` 仅 ADMIN+ |
| 设置 `/console/settings` | `console/settings/page.tsx:137,214,221` | `GET /api/v1/org`、`PATCH /api/v1/org`（OWNER） | 有权限的配置操作 | `GET /api/v1/org` 是 `{success,data}` **信封**（曾读错层级致能力恒空）；PATCH 后 `invalidateCache` |

**组织态纪律**：`console-shell.tsx` 统一导航；无组织成员落 `no-org.tsx` 引导页（不暴露错误）；
列表已消费 `--lf-*` 边框/文字；44px 触控由全局规则兜底（`08` §3）。

## 5. 🔴 本轮真实代码变更：Continuity 深链接（G-03）

**问题**（`v20/02` G-03）：六屏为单路由内部 `activeKey` 切换，无 6 个独立 URL →
刷新回 Now、浏览器返回不回上一屏、无法分享「正在看的那一屏」，违反交互原则 4。

**改动**（3 文件，加性、不重写业务引擎、不改已验收组件）：

| 文件 | 改动 |
|---|---|
| `src/lib/living/workspace-view.ts`（新增） | 纯函数：`resolveWorkspaceView` / `withWorkspaceView` / `workspaceViewUrl`；白名单由 `NAV.filter(ready)` 派生（`missions` 自动排除） |
| `tests/living/workspace-view.test.ts`（新增） | 14 条单测，含「not A」反例与 `missions` 不可达断言 |
| `src/app/workspace/living-workspace.tsx`（改） | `navigateTo` 包装 `pushState`；`useEffect` 首屏从 URL 恢复 + `popstate` 监听；三处调用点（onNavigate / onFocusView / runCompile）改为 `navigateTo` |

**设计取舍**：
- 用原生 `history.pushState` 而非 Next router —— 切视图不换路由、不触发 RSC 往返，不冲掉已加载业务态。
- 初始 state 恒 `'now'`（与 SSR 输出一致），恢复放在 effect —— **避免水合不一致**（仓库历史坑）。
- `StageRail` 的 view 值 `consent/agents/outcomes` 经核验全部在白名单内，不会误挡。
- 只改导航态，**不触碰任何业务状态或服务端数据**。

**本地门禁实测（2026-11-06，全部 `env -u NODE_OPTIONS`）**：
`npx jest tests/living/workspace-view.test.ts --ci` → **14/14 PASS** ·
`npx jest tests/living --ci` → **869/869 PASS**（含构建产物副本，口径见 `40` §6）·
`npx tsc --noEmit` → **0** · `npx eslint <5 文件>` → **0** ·
`npm run check:ui-invariants` → **R1–R11 全通过** · `npm run lint:gate` → **零新增**。
`env -u NODE_OPTIONS` 是必需的：WorkBuddy 注入的 safe-delete shim 会让 Next/OpenNext 构建与工具链误报。

**未验证项（诚实标注）**：`NOT_TESTED` —— 未跑 Playwright Trace（登录态 D-06 BLOCKED）。
需在可登录环境补：`/workspace?view=consent` 刷新仍停在 Consent、点页签→浏览器返回回上一屏、
`?view=missions` 回退 Now、URL 与 `aria-current="page"` 一致。

## 6. 横向关键页面（作战令 §4.3）

| 页面 | 真实状态 | 证据 |
|---|---|---|
| Landing `/` / Login / Register / Pricing / 404 / Error | PASS（真实加载，16 号审计 16 次公开路由导航 ok） | `v19/16` §2 |
| `/hlua` | **P1 生产 404 + 390px 溢出**（生产旧代码 `dc102cd`，HEAD 已有真实页面） | `v19/16` §4 #1/#2 |
| Chats / ReportModal / 分享深链 `/m/[token]/*` | PASS（真实，需夹具） | `v20/01` §C |
| 支付关闭契约 | PASS（503 `PAYMENT_NOT_CONFIGURED` 是受支持状态，不是 500） | `v20/01` §C |
| Loading / Offline / Unavailable | 部分：`living-states.tsx` + provider `unavailable`；**全站离线态未逐页走查** | NOT_TESTED |

## 7. 八元组完整性判定

| 元组 | 判定 |
|---|---|
| ① Route / Screen ID | **PASS**（13 屏全部真实） |
| ② Figma Node ID | **BLOCKED**（全 13 屏，见 `42`） |
| ③ 组件路径 | **PASS**（逐屏真实路径 + 行号） |
| ④ 数据 API / Schema | **PASS**（`v20/01` 矩阵，13 屏 100% 有引用） |
| ⑤ 用户交互事件 | **PASS** |
| ⑥ 状态变化与异常处理 | **PASS（代码级）** / **BLOCKED（生产业务态，D-06）** |
| ⑦ Playwright Test ID | **PASS（存在）** / **NOT_TESTED（本轮未跑）** |
| ⑧ Before/After 截图及证据 | **NOT_TESTED**（仅旧版 Before 截图，无本轮 After） |

> 按作战令「缺任何关键项不得标记完整交付」：**本屏组整体 = NOT COMPLETE**，
> 主因 ② BLOCKED + ⑧ NOT_TESTED。不以「文档写全」冒充「页面验收通过」。
