# Living Connection OS —— 设计 → 真实 API 逐项映射

> 依据：设计基准 §十「将上述页面、状态和交互逐项映射到真实 API」。
> 原则：**每个视觉节点都必须连到真实业务对象 / 真实授权 / 真实执行结果**；
> **没有真实端点的能力一律渲染为「不可点 + 原因说明」，绝不放假数据、绝不放空按钮**（AC-18）。
> 端点为实测存在的 `src/app/api/v1/**`（截止 `0190da8`）。

## 1. 可用端点全清单（实测）

```
missions            GET/POST /api/v1/missions
                    GET      /api/v1/missions/[missionId]
                    POST     /api/v1/missions/[missionId]/pause
                    GET      /api/v1/missions/[missionId]/intents
intents             GET/POST /api/v1/intents      GET/PATCH /api/v1/intents/[intentId]
                    GET/PATCH /api/v1/intents/[intentId]/disclosure
                    GET/PATCH /api/v1/intents/[intentId]/status
                    GET      /api/v1/intents/fields
connections         GET      /api/v1/connections/candidates
                    GET      /api/v1/connections/pipeline
                    POST     /api/v1/connections/proposals
                    POST     /api/v1/connections/[connectionId]/{consent,introduce,revoke}
                    GET      /api/v1/connections/introductions
members             GET      /api/v1/members
org                 GET/PATCH /api/v1/org
outcomes            GET/POST /api/v1/outcomes
                    POST     /api/v1/outcomes/[outcomeId]/{confirm,verify}
                    GET      /api/v1/outcomes/metrics
workflow            GET      /api/v1/workflow/{overview,jobs}
                    POST     /api/v1/workflow/jobs/[jobId]/{requeue,takeover}
billing             GET      /api/v1/billing/{usage,subscription,charges}
                    POST     /api/v1/billing/subscription/events
                    POST     /api/v1/billing/usage/collect
public              GET      /api/v1/public/missions/[token]      POST /api/v1/public/missions/[token]/join
```

## 2. Dock 五项 → 数据源

| Dock 项 | 真实端点 | 状态 |
|---|---|---|
| **Now**（今日工作台） | 聚合：`workflow/overview` + `connections/pipeline` + `outcomes/metrics` | ✅ 可做（纯聚合，无新端点） |
| **Missions** | `missions` + `missions/[id]` + `missions/[id]/pause` | ✅ 可做 |
| **Field**（连接场） | `connections/candidates` + `connections/pipeline` | ✅ 可做 |
| **Agents** | **无端点**（T09 未开工） | 🔴 **渲染为不可点 + 「Agent Runtime（T09）未就绪」** |
| **Outcomes** | `outcomes` + `outcomes/metrics` | ✅ 可做 |

## 3. `WorkspaceSpec.nodes[].type` 六类节点 → 数据源

| node.type | 数据源 | 备注 |
|---|---|---|
| `intent` | `GET /api/v1/intents`、`/missions/[id]/intents` | 含 `disclosure` 投影（逐字段披露） |
| `candidate` | `GET /api/v1/connections/candidates` | 候选**必须带 `rationale`（依据）**；无候选 → 空状态，不伪造（AC-13） |
| `agent` | **无** | 🔴 T09 前**不得产出**该类型节点（否则就是"生成虚假结果"） |
| `consent` | `proposals` + `POST …/{consent,revoke}` | 单方接受不得进入执行（AC-04/05） |
| `action` | `workflow/jobs`、`workflow/overview` | 状态来自 outbox 真相，不由前端推测 |
| `outcome` | `GET /api/v1/outcomes` | `verification_level` 是**派生值**，前端不得自行推断 |

## 4. 五类生成式组件 → 数据契约

| 组件 | 主要字段 | 来源端点 |
|---|---|---|
| **Intent Card** | goal / offer / constraints / successCriteria / expiresAt | `missions/[id]` + `intents` |
| **Connection Graph** | 候选 + `rationale` + 匹配证据 + 权限过滤结果 | `connections/candidates` |
| **Action Panel** | job 状态/重试/接管 + 成本 | `workflow/jobs` + `billing/usage` |
| **Consent Gate** | 披露字段集 / 双向 decision / 撤销 | `proposals` + `intents/[id]/disclosure` |
| **Outcome Timeline** | 三级验证级别 / 时间线 / 指标 | `outcomes` + `outcomes/metrics` |

## 5. 六大场景现状判定

| 场景 | 形态 | 现状 |
|---|---|---|
| Now 今日工作台 | 个人动态画布 | 🟡 **需新建**（无现成屏；可纯聚合现有端点） |
| Mission Studio | 生成式流程画布 | 🟡 需新建（`/console/missions` 已有列表/详情，非生成式画布） |
| Connection Field | 2.5D 关系网络 | 🟡 需新建（需引入画布库；`/console/connections` 为列表态） |
| Agent Constellation | Agent 协作拓扑 | 🔴 **BLOCKED**（等 T09；Dock 项渲染为未就绪） |
| Community Bridge | 跨社群空间网络 | 🔴 等 T10 |
| Outcome Observatory | 时间轴 + 成果网络 | 🟡 部分可做（`/console/outcomes` 已有；缺时间轴/回放） |

## 6. `WorkspaceSpec` 的安全边界（必须写进实现）

1. **`WorkspaceSpec` 只决定「显示结构」，不决定「能否执行」** —— `availableActions[].permission`
   只是**展示用的提示**；真正的权限判定在服务端路由的 `capability` 检查里**重新做一遍**。
   **前端不得因为渲染了一个 `Approve` 按钮就允许其生效**（服务端会 403）。
2. **`availableActions` 只列「已就绪且当前用户有权」的动作**；未就绪能力**不列入**，
   或在 UI 上以 `disabled + reason` 呈现（`reason` 来自 `CONSOLE_NAV.ready` 同源判据，避免"施工中"两套说法）。
3. **`position` 缺省时由布局算法决定**（前端本地布局），**不落库**（用户布局若持久化另开表，不在 P0）。

## 7. 15 项上线阻断标准 → 本次落点

| # | 标准 | 本仓落点 |
|---|---|---|
| 1 | 首页 Logo/导航/登录/注册/CTA/Footer 全部有效 | `(public)` 既有，**回归验证** |
| 2 | 登录后进入**真实工作空间**，非静态演示页 | `/workspace` 走真实端点 + 鉴权守卫 |
| 3 | 自然语言创建 Mission **DB 持久化** | `POST /api/v1/missions`（幂等键 + 服务端校验） |
| 4 | 刷新后画布与任务状态正确恢复 | 状态**从端点重取**（`use-api.ts` 缓存 5min + 重新验证），不存前端本地假状态 |
| 5 | 画布节点对应真实业务实体 | §3 映射表 |
| 6 | **不存在 `setTimeout` 伪装 AI 执行成功** | 新增门禁：扫描 UI 代码里的 `setTimeout` + 成功态伪造 |
| 7 | 匹配结果有来源/解释/权限检查 | `candidates.rationale` + 服务端 capability |
| 8 | 未获双方同意不得介绍或披露 | `connections/[id]/introduce` 服务端门禁（AC-04） |
| 9 | Agent 操作可查看/审批/暂停/审计 | 🔴 等 T09 |
| 10 | 跨租户隔离测试全过 | 既有 `tests/tenancy/*` + §负测 |
| 11 | 失败/空/超时/不可用均有真实反馈 | 每个数据区必须有 loading / empty / error 三态 |
| 12 | 3D 加载失败时首页仍可用 | 首页 3D 独立于文案/导航/登录（P3） |
| 13 | 360px → 桌面无遮挡/无横向溢出 | 新布局显式 `min-w-0` + 移动降级为卡片流 |
| 14 | 键盘操作 / 可见焦点 / 减少动态效果 | 复用 `prefers-reduced-motion`（L0 动效档） |
| 15 | Playwright E2E + 视觉回归 + 性能 + 部署后截图 | 扩 `tests/e2e/*`（P0 起逐步补） |

## 8. 与 P0 的直接结论

- **可立即做（P0/P1）**：Now / Missions / Field / Outcomes 四区 + 五类组件中的 4 类（除 Agent）。
- **必须等**：`agent` 节点类型与 Agent Constellation —— **等 T09**（或先把 Dock 项做成"未就绪 + 原因"）。
- **需要新依赖**：关系图（`@xyflow/react`）与 3D（`three` + `@react-three/fiber`）在 **P1/P3** 引入；
  P0 不引入，避免"先把 3D 做完再发现内部还是静态页"。
