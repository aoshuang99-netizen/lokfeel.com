# V19-02 · UI 审计（13 屏主线 + 关键体验）

> 证据分两级，**不混用**：
> 📷 生产截图（真实浏览器，`dc102cd`）——只覆盖公开面；
> 🔍 代码级审计（`c3213fd` HEAD）——覆盖认证面。
> 认证面的生产级截图依赖 `D-06`（生产测试账号，未批），**记 BLOCKED，不假装有**。

## 1. 主线映射（Route → Goal → Current → Problems → Design Action）

### `/workspace`（六视图合一，V16 Adaptive Dual World）

| 维度 | 审计结果 |
|---|---|
| User Goal | 一句话目标 → 结构化工作区 → 可信成果 |
| Current UI | `living-workspace.tsx` 单路由内切六视图；`buildOsStages` 阶段条；双世界令牌已生效（`[data-lf-world]`） |
| Real API | WorkspaceSpec 编译（服务端 LLM，WorkBuddy 云端算力，schema 白名单）+ MCP 5 工具 + A2A |
| Permission | `withTenant` 能力矩阵；Consent fail-closed（`discloseSubject()`） |
| 📷 截图 | **无**（登录态，D-06 BLOCKED） |
| Problems | ① 六视图只有两条 E2E 页签证据（2 视口），状态机还原度未在真实登录态下逐态验证；② 空态/加载态未逐视图实测（UX-11 BLOCKED 同源） |
| Design Action | 方案 C 直接继承双世界；第二轮逐视图补 Loading/Empty/Error 三态设计 |

### `/console`（七屏）

| 维度 | 审计结果 |
|---|---|
| User Goal | 组织级：成员、权限、任务流、经营指标 |
| Current UI | 7 个真实路由（见 `00_BASELINE.md` §2）；`'use client'` 首屏为骨架（E2E 教训：必须 `waitForStableDom`） |
| Problems | ① 屏间导航无全局 IA（信息架构靠侧栏记忆）；② 表格密度/空态/权限拒绝三态未统一 |
| Design Action | 方案 B/C 的 Console 组织态：统一 table + queue + detail 三层式；权限拒绝给"谁能批"而非死胡同 |

### 公开面（有 📷 实证）

| 路由 | 发现 | Design Action |
|---|---|---|
| `/` | 📷 生产首页已是 Connection OS 表达（"Describe the outcome…"），浅色暖调；但 CTA 是 "Open your workspace"，与定位句割裂 | 统一主 CTA 为 **Create a Workspace**；Hero 结构对齐文案矩阵（`05_BRAND_COPY_DECK.md`） |
| `/pricing` | 📷 **307 → Hlua Pass 结账页**（`_pricing__390x844.png`）—— R-01 在生产真实可见：想了解 LokFeel 定价的用户落地在另一个产品的会员页 | 发布 `c3213fd`（HEAD 已修，`/pricing` 变真实定价页）——这是**发布问题，不是设计问题** |
| `/hlua` | 📷 404（生产旧代码） | 同上，发布即解 |
| `/login` `/register` | 📷 视觉与首页一致；移动端 390 下表单可用 | 登录页复制走文案矩阵；保持 `private,no-store` |
| `/refunds` `/pay.html` | 📷 正常 | 文案归入 Copy Deck 的订阅与支付关闭提示 |

### Legacy B2C（只登记，不重设计）

| 问题 | 证据 |
|---|---|
| 触控/溢出已达标 | `bba8c36`：27 条 × 4 视口全绿 |
| 与主线视觉不同源 | 代码级：`/dashboard/*` 使用独立布局与暖色徽标（LokFee!），与 Connection OS 表达并存 |
| Design Action | **仅一致性与可用性修复**：导航返回主线入口、术语统一（不把交友面包装成 Connection OS） |

## 2. 关键体验状态（任务书要求逐项）

| 状态 | 现状（代码级） | 证据等级 |
|---|---|---|
| Consent 审批（批/拒/撤） | `DELETE /api/im/consent` + fail-closed 白名单；UI 三态在 Workspace 内 | 🔍 代码 + 单测 |
| Agent 执行状态 | 真实任务事件驱动（无 setTimeout 假成功）；`agent.run` 能力开关 | 🔍 代码 + Jest |
| Outcome / Evidence | `Loadable` 三态；计数不把"读不到"当 0（`—` + countHint） | 🔍 代码 + 单测 |
| 空状态 | `emptyText` 机制在，**未逐屏实测** | ⚠️ 与 UX-11 BLOCKED 同源 |
| 移动端导航 | 公开+认证+页签+legacy 共 85 条 E2E 门禁 | 📷 CI 证据 |
| 错误与网络中断 | health/探针有降级路径；页面级 retry 恢复未统一 | 🔍 部分 |
| 无障碍 | `verify:contrast` 15 组令牌级 + 触控 24px 门禁；**非读屏器实测** | 📷 CI 证据 |

## 3. 13 屏问题清单（第一轮汇总，按优先级）

1. 🔴 `/pricing` 在生产卖错产品 —— **靠发布解决**（阻塞在 D-10，非设计）
2. 🔴 认证面 13 屏没有生产级视觉证据（D-06 未批 ⇒ BLOCKED）
3. 🟡 Console 缺统一信息架构；三态（loading/empty/error）不统一
4. 🟡 `/workspace` 六视图缺少"阶段→世界"的显式过渡（方案 C 的核心改进点）
5. 🟡 空态文案未逐屏审（UX-11）
6. 🟢 公开面文案与主 CTA 不统一（Copy Deck 已给矩阵）
7. 🟢 Legacy 面与主线术语混用（`matches` vs `connections` 308 重定向是历史包袱）
