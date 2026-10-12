# T07 · SaaS Console — 社群经营工作台（开工方案）

> **状态**：🚧 **开工中（Slice 1 + 2 + 3 已落地并上线 —— 发版 `564802a` / 部署 `6accbb986762`）**。本文件是设计 + 切片计划 + 验收口径。
> **AC-18 尚未认领** —— 它要求"七屏可达且**无空按钮**"，只有七屏都接上真实数据才算。
> 已落地 **Slice 1（骨架 + Dashboard）**、**Slice 2（Missions / Members）**、
> **Slice 3（Connections / Settings）**；
> Agents / Outcomes 仍在导航里显式标注"施工中"（是 `<span>`，不是死链）——
> 它们分别等 T09 技术栈拍板与 T08 的成果数据面，**不是**没做，而是依赖未就绪。
>
> ✅ **已修复的既有不一致**（Slice 1 起就存在，2026-10-12 发版复验发现并补偿修复）：
> `src/app/console/layout.tsx` 未登录时把回跳地址**写死**为 `/console`，与该文件头注释
> 「跳登录（保留回跳地址）」不符 → 深链（如 `/console/settings`）登录后被送回控制台入口。
> 现改为**对齐个人态** `src/app/(dashboard)/layout.tsx`：**从 Referer 取真实路径**，仅接受
> `/console` 命名空间内的相对路径（缺失/非法 → 回落入口）；`/login` 侧另有 `isSafeRedirect`
> 兜底，不引入新的开放重定向面。复验脚本新增 **§2b 带 Referer 探针** + **负向对照**
> （别态 Referer 不被采信），使"保留回跳地址"可复跑取证。

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
| Missions | `/console/missions` · `/[missionId]` | `/api/v1/missions`（+ `/[missionId]/pause` 状态迁移） | ✅ **Slice 2** |
| Members | `/console/members` | `/api/v1/members`（**Slice 2 新建**，能力 `member.read`） | ✅ **Slice 2** |
| Connections | `/console/connections` | `/api/v1/connections/pipeline`（**Slice 3 新建**）+ `/api/v1/connections/{id}/introduce` | ✅ **Slice 3** |
| Agents | `/console/agents` | T09 运行时（**尚不存在**） | Slice 4（等 T09） |
| Outcomes | `/console/outcomes` | T08 的 `Outcome` / `UsageRecord`（**尚不存在**） | Slice 4（等 T08） |
| Settings | `/console/settings` | `/api/v1/org`（**Slice 3 新建**，读 `org.read` / 写 `org.update`） | ✅ **Slice 3** |

**「无空按钮」怎么落地**：每一屏的每个可点元素必须有**有效行为**（跳转 / 提交 / 展开）。
不能有行为时，**不要渲染成按钮** —— 要么不渲染，要么渲染成**带说明的禁用态**
（Slice 1 里导航的"施工中"就是后者：它是 `<span>`，不是 `<a>`）。

---

## 3. Slice 1 交付了什么

| 文件 | 作用 |
|---|---|
| `src/app/console/layout.tsx` | 服务端：`auth()` → 未登录跳登录；`resolveTenantForUser()` → 无组织渲染说明页；有组织渲染骨架 |
| `src/app/console/console-shell.tsx` | 客户端骨架：顶部组织名 + 角色 + "返回个人模式"；左侧七屏导航（**导航清单内嵌在本文件的 `CONSOLE_NAV` 常量里**，未实现的标 `ready:false`） |
| `src/app/console/no-org.tsx` | 无组织说明页（非错误页） |
| `src/app/console/page.tsx` | **Dashboard**：队列健康度 / 需人处置 / 停滞 / 投递计数（全部真实数据） |
| `src/components/layout/sidebar-v2.tsx` | 个人态侧边栏加一条组织态入口 |

> 📌 本文件早前写"导航清单放 `src/app/console/nav.ts`" —— 实际实现在
> `console-shell.tsx` 的 `CONSOLE_NAV`。差异已更正，避免后人按旧路径白找。

**Slice 1 的自证**：Dashboard 的每个数字都能对回一个真实接口的返回值，
且"需人处置"为空时渲染**说明**（"当前没有需要人工处置的任务"）而不是空白。

---

## 3.5 Slice 2 交付了什么

| 文件 | 作用 |
|---|---|
| `src/lib/tenancy/members.ts` | **新增**成员目录服务层（只读）：`listMembers` / `countMembersByRole` / `getMemberById` / `parseMemberFilters` / `displayNameOf` / `toMemberDto` |
| `src/app/api/v1/members/route.ts` | **新增** `GET /api/v1/members`（`member.read`），分页 + `role` / `status` / `q` 过滤 |
| `src/app/console/missions/page.tsx` | 任务列表：状态过滤 + 分页 + 行跳详情 |
| `src/app/console/missions/[missionId]/page.tsx` | 任务详情：字段 + **由状态机派生的迁移按钮** |
| `src/app/console/members/page.tsx` | 成员目录：角色过滤 + 搜索 + 分页 |
| `src/app/console/console-shell.tsx` | `CONSOLE_NAV` 中 missions / members → `ready: true` |

**Slice 2 的三条设计决定**

1. **动作按钮由状态机派生，不写死**。页面的 `ACTIONS_BY_STATUS` 与
   `lib/connection/missions.ts` 的 `TRANSITIONS` 同源：
   `DRAFT→[发布,关闭]`、`ACTIVE→[暂停,关闭]`、`PAUSED→[恢复,关闭]`、`CLOSED→[]`。
   `PAUSED` 下 `publish` 与 `resume` 都合法（同义）→ **只渲染 `resume`**；
   `CLOSED` 是终态 → **不渲染任何按钮**，改为说明"终态不可迁移"。
   这样用户点不到必然 409 的按钮。
2. **成员目录的投影边界写进 `select`**：`password` / `tokenVersion` / `accounts` /
   `sessions` **根本不查**（不是"查了再过滤"）；Profile 只取
   `displayName` / `avatar` / `city`，**不取匹配域字段**（性别取向、关系蓝图、雷区等）。
3. **没做的功能就说没做**：任务创建界面、成员邀请流程均未实现 →
   **不渲染对应按钮**，只在页面上陈述事实并指出接口路径。
   渲染一个点了没反应的按钮，正是 AC-18 要排除的"空按钮"。

**Slice 2 的自证**：`tests/tenancy/members.test.ts` 覆盖分页 / 过滤 / 租户谓词 /
投影边界；`members-api.test.ts` 覆盖 `MEMBER 403 · OPERATOR 200 · 非法值忽略 ·
500 不泄漏内部信息`。

---

## 3.6 Slice 3 交付了什么

| 文件 | 作用 |
|---|---|
| `src/lib/connection/operations.ts` | **新增**租户级连接运营视图：`listOrgConnections`（提案 × T06 阶段 × 停滞 × 可介绍性）、`bucketOf`、`parseConnectionBucket` |
| `src/app/api/v1/connections/pipeline/route.ts` | **新增** `GET /api/v1/connections/pipeline`（`workflow.read`），四个语义桶 + `stalled` + 分页 |
| `src/app/console/connections/page.tsx` | 连接屏：分桶 tab（带计数）+ 只看停滞 + 停滞徽章 + 阶段列 + **行内「发送介绍」** |
| `src/lib/tenancy/org.ts` | **新增**组织档案服务：`getOrganization` / `getOrganizationOverview` / `parseOrganizationUpdate` / `updateOrganization` |
| `src/app/api/v1/org/route.ts` | **新增** `GET /api/v1/org`（`org.read`，**全员**）/ `PATCH`（`org.update`，**仅 OWNER**） |
| `src/app/console/settings/page.tsx` | 设置屏：只读档案 + 成员数；编辑表单**仅所有者可见**；转让/删除为说明而非按钮 |
| `src/lib/connection/proposals.ts` | **重构**：`loadLiveParties` → `introductionBlockersByProposal`（批量、单一判据），执行点与之共用 |
| `src/app/console/console-shell.tsx` | connections / settings → `ready: true`（settings 的 gate 是 `org.read` 而非 `org.update`） |

**Slice 3 的四条设计决定**

1. **「可介绍」只留一个判据**。把 T05 里"提案可介绍性 + 双方意图存活"两层校验抽成
   `introductionBlockersByProposal()`（批量、一次查意图），`POST /connections/{id}/introduce`
   与连接屏的「发送介绍」按钮**共用它**。否则"界面说能点、端点 409"这类漂移迟早发生。
   接入时踩到一处：意图查询改用 (missionId,userId) 作键（`missionId` 是 cuid，已隐含租户），
   连带把两条测试夹具补上 `missionId` —— 夹具缺字段会让"过期"用例**因为错的理由通过**。
2. **租户级视图只 gate 一个能力**。`withTenant` 对数组是 **`some()`**，把 `proposal.read`
   （连 MEMBER 都有）写进数组会把端点**降级**成全成员可读。故 `pipeline` 只 gate
   `workflow.read`，并在路由与测试里各写一条说明/负向断言。
3. **分桶是运营语义，不是状态值**。`INTRODUCED` 必须先于状态判断（`deriveProposalState`
   对已介绍行返回 `MUTUALLY_ACCEPTED`，先判状态就会把"已介绍"算成"待介绍"）；
   `REJECTED/REVOKED/EXPIRED` 合并为 `CLOSED`。桶名 `PENDING_CONSENT` **词序刻意**与状态
   `CONSENT_PENDING` 相反，避免被当成同一个东西互换。
4. **组织档案"读公共、写专属"**。`org.read` 在 `SELF_SERVICE`（全员），`org.update` 在
   `OWNER_ONLY`（仅所有者）。设置屏据此分岔：非所有者看到的是**只读视图 + 说明**，
   而不是一个必然 403 的保存按钮。`status` 刻意不可改 —— 允许自助把 `SUSPENDED` 改回
   `ACTIVE` 等于让欠费社群自己解封。

**Slice 3 的诚实口径**：`pipeline` 的派生过滤（分桶 / 停滞）无法下推 SQL，实现是
"取最近 300 条 → 派生 → 过滤 → 内存分页"。当窗口被截断时响应带 `truncated: true`，
界面**必须**把它显示出来 —— 否则"共 N 条"会被读成全量。

**Slice 3 的自证**：`tests/connection/operations.test.ts` 覆盖租户谓词 / 投影边界
（DTO **不含**双方 userId）/ 分桶（含"已介绍不能被算成待介绍"）/ 停滞（终态不判停滞）/
`canIntroduce` 与执行点同源 / `truncated` 不虚报；`pipeline-api.test.ts` 覆盖
`MEMBER 403 · OPERATOR 200 · 未知 bucket 400`（含防 `some()` 降级的负向断言）；
`tests/tenancy/org.test.ts` + `org-api.test.ts` 覆盖 `OWNER 可写 / ADMIN 也不可写 /
slug 冲突 409 / 非法输入不静默跳过 / 审计不记新值`。

---

## 4. 切片计划

| 切片 | 内容 | 前置 |
|---|---|---|
| **1** ✅ | 骨架 + 无组织态 + Dashboard | — |
| **2** ✅ | Missions（列表 / 详情 / 状态迁移）+ Members（新建 `GET /api/v1/members`） | 无 |
| 3 ✅ | Connections（含工作流阶段与停滞标记）+ Settings（`GET/PATCH /api/v1/org`） | 无 |
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
| Connections | `workflow.read`（**单条**，见下方 ⚠️） | OPERATOR+ |
| Settings | `org.read`（读）/ `org.update`（写） | 全员 / **仅 OWNER** |

> ⚠️ **Connections 为什么只 gate `workflow.read`**：`withTenant` 对能力数组是
> **`some()`（任一满足）**，不是 `every()`。最初设计的 "`proposal.read` + `workflow.read`"
> 若照字面写进数组，会因为 `proposal.read` 连 MEMBER 都有而**把租户级视图降级**成全成员可读。
> 故这里只留 OPERATOR+ 的 `workflow.read`。`pipeline-api.test.ts` 有一条
> "MEMBER → 403" 的负向断言专门防这次降级被重演。
>
> 同理，`settings` 的导航 gate 的是**读**能力（`org.read`）而不是写 —— 否则 ADMIN/OPERATOR
> 连"社群叫什么"都看不到。能不能编辑由页面按 `capabilities` 降级渲染。

**切片 1 的降级行为**：能力不足时（例如未来把 MEMBER 放进 `/console`），
对应的卡片显示"权限不足"而不是报错 —— 前端不做授权判断，**只做降级展示**；
真正的拒绝由 `withTenant(capability)` 在 API 层完成（保持"权限只在服务端判定"这条铁律）。

---

## 6. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-10-12 | 开工：设计 + Slice 1（骨架 / 无组织态 / Dashboard）+ 个人态侧边栏入口。**AC-18 未认领**（七屏未齐）。 |
| 2026-10-12 | **Slice 2 落地**：Missions（列表 / 详情 / 状态机派生的迁移按钮）+ Members（新建 `GET /api/v1/members` + 成员目录屏）。导航四项 → 两个已就绪。**AC-18 仍未认领**（Connections / Agents / Outcomes / Settings 未做）。 |
| 2026-10-12 | **Slice 3 落地**：Connections（新建 `GET /api/v1/connections/pipeline` + 连接屏，含停滞标记与同源「可介绍」判据）+ Settings（新建 `GET/PATCH /api/v1/org` + 设置屏，读全员 / 写仅所有者）。顺带把 T05 的可介绍性抽为单一判据。**AC-18 仍未认领**（Agents 等 T09、Outcomes 等 T08）。 |
| 2026-10-12 | **Slice 2 + Slice 3 发版上线**（`564802a` / 部署 `6accbb986762` @ 10:51Z，**无 schema 变更**）。上线复验 **43/43**（`verify-t07-prod.mjs` 扩展至 Slice 1–3）· T06 25/25 · T04 19/19 · 窗口期 13/13。**发版前基线 19 通过 / 10 失败**，10 处精确落在未上线的 Slice 2/3 面 ⇒ 脚本能区分「路由缺失」与「已上线但被守卫拦下」。同时记录一处**既有**不一致（`console/layout.tsx` 未登录回跳写死 `/console`，与其注释「保留回跳地址」不符）→ 待拍板。**AC-18 仍未认领**。 |
