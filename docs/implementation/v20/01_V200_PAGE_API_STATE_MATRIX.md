# V20.0 · 01 — 逐屏 Page → Component → API → Database → State → Action → Evidence 矩阵（Batch 0）

> 每一行都对应**真实代码引用**（文件:行 已核验）或可核验端点。未接线的项标 `UNKNOWN` / `未接线`，不编造「已接通」。
> 这是 B2/B4 实现时的「契约对照表」：每一屏的「执行成功 / 已批准 / 已验证」都必须能在右列找到服务端状态与证据映射（用户 V20 硬要求）。

---

## 约定

- 「DB」列写 Prisma 模型（`prisma/schema/*.prisma`）。
- 「State」列写前端可观测的业务状态（来自 `living-workspace.tsx` 的 `Loadable` 三态 / `AgentRunStatus` 等）。
- 「Evidence」列写「该状态在服务端的可追溯来源」——即界面断言必须有后端记录支撑。

---

## A. Workspace（单路由 `/workspace`，内部视图切换）

### A1 · Now
| 项 | 值 |
| --- | --- |
| Component | `living-workspace.tsx:678-717`（内联 `StatCard`） |
| API | `GET /api/notifications`、`GET /api/chats/unread-count`、`GET /api/v1/connections/proposals`（待你介绍计数） |
| DB | `Notification`、`ChatRoom`/消息、`IntroductionWorkflow`(proposal) |
| State | 三态：`isLoading` / `error` / `empty`（空态文案明确「真实结果，不凑内容」） |
| User Action | 查看待处理、跳转 |
| Evidence | 数字全部来自上方端点回读；空态不伪造 |

### A2 · Studio（Intent/目标编译器）
| 项 | 值 |
| --- | --- |
| Component | `living-workspace.tsx:720-837`（`composer` + `LivingCanvas` + `runCompile`/`runCreateMission`） |
| API（读） | 本地 `compileWorkspaceSpec(draft)`（纯前端，不发请求） |
| API（写） | `POST /api/v1/missions`，**带 `Idempotency-Key` 头** |
| DB | `Mission`（经 `missionDraftFromSpec` 校验 need/offer/对价/判据非空） |
| State | `compiled.ok` / `createResult.kind`（`ok`/`error`）；**只有服务端返回 `id` 才算成功** |
| User Action | 输入目标 → 编译 → 创建连接任务（幂等键同体复用、异体换新） |
| Evidence | 成功仅认 `mission.id`；无 id 一律按失败，不乐观成功 |

### A3 · Field（连接场 2.5D）
| 项 | 值 |
| --- | --- |
| Component | `field-canvas.tsx` + `field-inspector.tsx` + `field-graph.tsx` |
| API | `GET /api/v1/missions`、`GET /api/v1/connections/pipeline`、`GET /api/v1/connections/candidates?missionId=…` |
| DB | `Mission`、`IntroductionWorkflow`(pipeline)、candidate 视图 |
| State | 节点选中态（`fieldSelection`）→ 详情面板 |
| User Action | 点选网络节点看依据 |
| Evidence | 取数 + 纯函数装配；未取到显示「—」而非 0 |

### A4 · Consent（同意与逐字段披露 + 跨社群子面板）
| 项 | 值 |
| --- | --- |
| Component | `consent-gate.tsx` + `bridge-panel.tsx`（子面板 `ConsentSubTabs`） |
| API | `GET /api/v1/intents`、`GET /api/v1/intents/{id}/disclosure`、`GET /api/v1/connections/proposals`、`GET /api/v1/bridges`(+`/{id}`、`/{id}/discovery`) |
| DB | `SocialIntent`(disclosure)、`IntroductionWorkflow`(proposal)、`Bridge` |
| State | 待裁决横幅 → 四步进度（比较 `CONSENT_NO_DECISION_LABEL` 常量，不用状态字面量）→ 审批时间线（只画 `introducedAt`/`expiresAt` 真实时间点） |
| User Action | 批准 / 拒绝 / 撤销 / 过期提示（子面板：跨社群 opt-in/out） |
| Evidence | 提案来自服务端 `availableActions`；时间线标注来源；撤销读回当时披露表 |

### A5 · Outcomes（成果时间轴与指标）
| 项 | 值 |
| --- | --- |
| Component | `outcome-observatory.tsx` |
| API | `GET /api/v1/outcomes`、`GET /api/v1/outcomes/metrics` |
| DB | `Outcome`、`OutcomeVerification` |
| State | 验证流程条：已自报 → 验证记录 → 服务端判定（`verified` 只读服务端布尔） |
| User Action | 查看三栏证据（文字 / 验证记录 / 媒体证据） |
| Evidence | `verificationLevel` **派生**自 `OutcomeVerification`；自报≠已验证；契约未含的媒体证据如实标注 |

### A6 · Agents（Agent 运行与审批）
| 项 | 值 |
| --- | --- |
| Component | `agent-board.tsx`（`useAgentBoardData(capabilities.has('agent.run'))`） |
| API | `GET /api/v1/agents/runs`、`GET /api/v1/agents/usage` |
| DB | `AgentRun`、`AgentCall`、`AgentApproval`、`AgentExecution` |
| State | `AgentRunStatus` 全枚举；成本条形（`costMicroCents` 仅展示不参算） |
| User Action | 人工接管 / 查看运行 / 按能力降级 |
| Evidence | 运行来自 `/api/v1/agents/runs`；**`AWAITING_APPROVAL` 当前仅真实 Provider 成功路径可达**（A-03b） |

### A7 · Missions（Workspace 内）
| 项 | 值 |
| --- | --- |
| Component | `NAV` 中 `ready:false`，未渲染入口 |
| API | `UNKNOWN`（列表区尚未接线；创建已在 Studio） |
| DB | `Mission` |
| State | 显式 `MISSIONS_REASON` 文案，**不假装可用** |
| User Action | — |
| Evidence | 诚实标注「未接线，不是需要权限」，避免误判为权限问题 |

---

## B. Console（7 真实路由）

### B1 · Overview
| 项 | 值 |
| --- | --- |
| Component | `console/page.tsx:121-122` |
| API | `GET /api/v1/workflow/overview`、`GET /api/v1/missions?page=1&pageSize=1` |
| DB | 工作流聚合、`Mission` |
| State | 系统概况 / 异常 / 待处理 |
| User Action | 进入具体异常（跳转对应屏） |
| Evidence | 聚合端点返回；异常跳转真实 |

### B2 · Agents
| 项 | 值 |
| --- | --- |
| Component | `console/agents/page.tsx:179-188,543-545` |
| API | `GET /api/v1/agents/runs?limit=50`、`GET /api/v1/agents/usage`；`POST …/runs/{id}/approve|reject|execute` |
| DB | `AgentRun`/`AgentCall`/`AgentApproval`/`AgentExecution` |
| State | 运行列表 + 成本 + 技能 + 运行状态；**按能力降级**（缺 `agent.run` 则 403 如实展示） |
| User Action | 查看 Agent、限制；批准/拒绝/执行 |
| Evidence | 执行唯一写入点 `executor.ts`；`EXECUTED` 与 `AgentExecution` 库级一致 |

### B3 · Connections
| 项 | 值 |
| --- | --- |
| Component | `console/connections/page.tsx:112,128` |
| API | `GET /api/v1/connections/pipeline`；`POST /api/v1/connections/{proposalId}/introduce` |
| DB | `IntroductionWorkflow` |
| State | 连接健康 / 能力 / 授权状态 |
| User Action | 管理连接与诊断；执行 introduce |
| Evidence | pipeline 端点返回；introduce 走真实投递留痕 |

### B4 · Members
| 项 | 值 |
| --- | --- |
| Component | `console/members/page.tsx:81` |
| API | `GET /api/v1/members`（`member.read`=OPERATOR+） |
| DB | `User` / 组织成员关系 |
| State | 成员 / 组织 / 角色 / 权限 |
| User Action | 邀请与权限管理（按能力） |
| Evidence | 端点返回；权限校验在路由层 |

### B5 · Missions
| 项 | 值 |
| --- | --- |
| Component | `console/missions/page.tsx:63,91,101`；详情 `missions/[missionId]/page.tsx` |
| API | `GET /api/v1/missions`、`GET /api/v1/missions/{id}`；`POST …/missions/{id}/pause` |
| DB | `Mission` |
| State | 全任务队列 / 执行阶段 / 过滤器 |
| User Action | 检索 / 审计 / 处理异常 / 暂停 |
| Evidence | 列表与详情端点；pause 动作真实落库 |

### B6 · Outcomes
| 项 | 值 |
| --- | --- |
| Component | `console/outcomes/page.tsx:98,103,208,339,351` |
| API | `GET /api/v1/outcomes`、`GET /api/v1/connections/proposals?states=MUTUALLY_ACCEPTED&limit=50`；`POST /api/v1/outcomes`（自报）、`/{id}/confirm`、`/{id}/verify` |
| DB | `Outcome`、`OutcomeVerification` |
| State | 结果状态 / 证据来源 / 验证记录 |
| User Action | 审核与追溯；确认（对手方）/ 核验（运营 ADMIN+） |
| Evidence | `verificationLevel` 派生；verify 仅 ADMIN+；自报≠已验证 |

### B7 · Settings
| 项 | 值 |
| --- | --- |
| Component | `console/settings/page.tsx:137,214,221` |
| API | `GET /api/v1/org`、`PATCH /api/v1/org`（OWNER） |
| DB | `Organization` |
| State | 组织 / 通知 / 安全 / 账户配置 |
| User Action | 有权限的配置操作 |
| Evidence | `GET /api/v1/org` 返回 `capabilities`（**信封读取**，曾因读错层级致能力恒空）；PATCH 后 `invalidateCache` |

---

## C. 跨页面关键旅程

| 旅程 | 文件 / 端点 | 状态 |
| --- | --- | --- |
| Landing → Register → Login | `(public)/page.tsx`、`(auth)/register`、`(auth)/login`（`/api/auth/register`、`/api/auth/login`） | ✅ 真实 |
| Chats（B2C 遗留线） | `(dashboard)/dashboard/chats`、`/api/im/*` | ✅ 真实但非主线 |
| ReportModal（举报） | 依赖真实会话夹具（CI `seed-chat-fixture`） | ✅ 真实（需夹具） |
| 分享深链 `/m/[token]/*` | `m/[token]/(intent|proposals|matches|page)` | ✅ 真实 |
| 支付关闭契约 | `GET /api/payments/status` → 503 `PAYMENT_NOT_CONFIGURED`；`verify-payment-off` | ✅ 受支持状态（未接入是合法态，不是 500） |

---

## D. 矩阵完整性自检

- 13 核心屏：Workspace 6（Now/Studio/Field/Consent/Outcomes/Agents，Missions 未接线不计入）+ Console 7 = 13。**✅ 100% 有真实代码引用**（除 Workspace·Missions 显式未接线，已如实标注）。
- 100% 关键状态有服务端来源：Studio 成功认 `mission.id`、Outcomes `verificationLevel` 派生、Agents `EXECUTED` 库级一致、Consent 时间线用真实时间点。
- `UNKNOWN`：Workspace·Missions 列表区端点（未接线）；Field 是否在 V20 六屏内（产品决策）。
