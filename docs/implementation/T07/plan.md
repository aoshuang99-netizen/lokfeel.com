# T07 · SaaS Console — 社群经营工作台（开工方案）

> **状态**：🚧 **开工中（Slice 1 落地）**。本文件是设计 + 切片计划 + 验收口径。
> **AC-18 尚未认领** —— 它要求"七屏可达且**无空按钮**"，只有七屏都接上真实数据才算。
> 当前只落地了 **Slice 1（骨架 + Dashboard）**，其余屏幕在导航里显式标注"施工中"。

## 0. 任务定义（来自 BACKLOG）

| 项 | 内容 |
|---|---|
| 目标 | Dashboard / Missions / Members / Connections / Agents / Outcomes / Settings **七屏**，真实 API、**无空按钮** |
| 依赖 | T02 / T03 / T04 / T08 的数据面（**壳可先行，数据后接**） |
| 验收 | **AC-18**：`Dashboard/Missions/Members/Connections/Agents/Outcomes/Settings 可达且无空按钮`（Playwright） |
| 交付 | 在既有 `(dashboard)` 之外**新增组织级 IA**（建议 `/console/*`），复用现有布局与鉴权原语 |
| 风险 | 🟡 与既有 B2C 页面**共存** → 必须做明确的「**个人态 vs 组织态**」导航分层，否则用户看不懂 |

---

## 1. 🔴 最关键的取舍：「个人态 vs 组织态」怎么分层

这是 T07 唯一被标 🟡 的风险点，先定它，其余都是执行。

### 现状

既有 `(dashboard)` 是**个人态**（B2C）：打招呼"Good evening, Frank"、Today's Picks、
Connections（喜欢我的人/配对）、Chats、Profile、Subscription。它的侧边栏
（`src/components/layout/sidebar-v2.tsx`）与底部导航（`bottom-nav.tsx`）都以"我"为中心。

T07 要的是**组织态**：一个社群运营者看"我的社群跑得怎么样"——任务、成员、提案、
工作流队列、成果、用量。

### 决策

**两者不混排，用不同的路由前缀 + 不同的导航骨架**：

| | 个人态 | 组织态 |
|---|---|---|
| 路由 | `/dashboard/*`（既有，不动） | **`/console/*`（新增）** |
| 骨架 | `(dashboard)/layout.tsx` + `dashboard-ui.tsx` | **`console/layout.tsx` + `console-shell.tsx`** |
| 视角 | "我" | "我的社群"（顶部常显组织名 + 我的角色） |
| 入口 | 登录后默认落点 | 个人态侧边栏里一条**组织态**入口（`/console`） |

**为什么不用同一套布局加个开关**：一旦共用骨架，两套 IA 会在侧边栏里互相污染
（用户看到的会是一串既像"我的"又像"社群的"条目），这正是 R 里担心的"用户看不懂"。
分开骨架后，**跨态的边界只有一个**：`/console` 顶部那条"返回个人模式"。

### 无组织用户怎么办（不能崩）

`/console` 需要"当前用户有一个 ACTIVE 成员关系"。没有时**不重定向、不 500**，
而是渲染一个**说明页**：为什么看不到、怎么加入（联系社群管理员）、以及返回个人模式的入口。
—— 否则 B2C 用户点进来只会看到一个错误页。

---

## 2. 七屏与数据依赖

| 屏 | 路由 | 主要数据源 | 现状 |
|---|---|---|---|
| Dashboard | `/console` | `/api/v1/workflow/overview`、`/api/v1/missions` | ✅ **Slice 1** |
| Missions | `/console/missions` | `/api/v1/missions`（+ `[missionId]/intents`） | Slice 2 |
| Members | `/console/members` | `/api/v1/members`（**待建**，能力 `member.read`） | Slice 2 |
| Connections | `/console/connections` | `/api/v1/connections`（+ workflow 阶段） | Slice 3 |
| Agents | `/console/agents` | T09 运行时（**尚不存在**） | Slice 4（等 T09） |
| Outcomes | `/console/outcomes` | T08 的 `Outcome` / `UsageRecord`（**尚不存在**） | Slice 4（等 T08） |
| Settings | `/console/settings` | `/api/v1/org`（**待建**，能力 `org.read` / `org.update`） | Slice 3 |

**「无空按钮」怎么落地**：每一屏的每个可点元素必须有**有效行为**（跳转 / 提交 / 展开）。
不能有行为时，**不要渲染成按钮** —— 要么不渲染，要么渲染成**带说明的禁用态**
（Slice 1 里导航的"施工中"就是后者：它是 `<span>`，不是 `<a>`）。

---

## 3. Slice 1 交付了什么（本次）

| 文件 | 作用 |
|---|---|
| `src/app/console/layout.tsx` | 服务端：`auth()` → 未登录跳登录；`resolveTenantForUser()` → 无组织渲染说明页；有组织渲染骨架 |
| `src/app/console/console-shell.tsx` | 客户端骨架：顶部组织名 + 角色 + "返回个人模式"；左侧七屏导航 |
| `src/app/console/no-org.tsx` | 无组织说明页（非错误页） |
| `src/app/console/page.tsx` | **Dashboard**：队列健康度 / 需人处置 / 停滞 / 投递计数（全部真实数据） |
| `src/app/console/nav.ts` | 导航清单（**单一来源**，七屏都在这里登记；未实现的标 `ready:false`） |
| `src/components/layout/sidebar-v2.tsx` | 个人态侧边栏加一条组织态入口 |

**Slice 1 的自证**：Dashboard 的每个数字都能对回一个真实接口的返回值，
且"需人处置"为空时渲染**说明**（"当前没有需要人工处置的任务"）而不是空白。

---

## 4. 切片计划

| 切片 | 内容 | 前置 |
|---|---|---|
| **1** ✅ | 骨架 + 无组织态 + Dashboard | — |
| 2 | Missions（列表/详情/暂停）+ Members（需先建 `GET /api/v1/members`） | 无 |
| 3 | Connections（含工作流阶段与停滞标记）+ Settings（`GET/PATCH /api/v1/org`） | 无 |
| 4 | Outcomes（等 T08）+ Agents（等 T09 技术栈拍板） | T08 / §6-⑥ |
| 5 | Playwright 覆盖 AC-18（七屏可达 + 无空按钮负测） | 全部 |

> 切片的排序理由是**依赖可用性**，不是重要性：2/3 只差一两个端点，4 在等外部任务。

---

## 5. 权限口径（与 T01 能力矩阵对齐）

| 屏 | 需要的能力 | 谁有 |
|---|---|---|
| Dashboard | `workflow.read` + `mission.read` | OPERATOR+ |
| Missions | `mission.read`（写：`mission.create` / `mission.update`） | OPERATOR+ / ADMIN+ |
| Members | `member.read`（邀请：`member.invite`） | ADMIN+ |
| Connections | `proposal.read` + `workflow.read` | OPERATOR+ |
| Settings | `org.read` / `org.update` | ADMIN+ |

**切片 1 的降级行为**：能力不足时（例如未来把 MEMBER 放进 `/console`），
对应的卡片显示"权限不足"而不是报错 —— 前端不做授权判断，**只做降级展示**；
真正的拒绝由 `withTenant(capability)` 在 API 层完成（保持"权限只在服务端判定"这条铁律）。

---

## 6. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-10-12 | 开工：设计 + Slice 1（骨架 / 无组织态 / Dashboard）+ 个人态侧边栏入口。**AC-18 未认领**（七屏未齐）。 |
