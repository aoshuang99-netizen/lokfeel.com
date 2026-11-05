# V20.0 · 03 — 设计系统规格（B1 · 代码权威源）

> **状态**：B-01 已决议（2026-11-04）→ 以代码设计系统为 B1 权威交付，Figma 可编辑节点为后续补交项。
> 本文件即「设计系统 + 逐屏规格」的代码侧权威源，**可编辑、可审计、可 1:1 映射到 Figma**。
> 所有 Token 值**取自真实 `src/app/globals.css`**（行号已标），非臆造。
> 当提供 Figma token+file 后，本文件的「Figma 映射协议」章节能直接驱动节点/变量/原型创建，满足用户「Node ID → 组件 → 状态」可核验要求。

---

## 1. 设计哲学：Adaptive Dual World 2.0

以**任务为中心**（不是菜单），以**可验证结果为终点**（不是聊天回复）。五条原则（用户 V20 硬要求）：

1. **单一主操作**：每屏一个最显眼的主 CTA，其余降级。
2. **分层呈现复杂度**：默认简洁，深入时展开（如 Workspace 的 Evidence Lens / Inspector）。
3. **真实状态可见**：加载/空/错误/权限/超时都必须真实渲染，不伪装成功（代码已强制 `Loadable` 三态）。
4. **AI 行动可控制**：每个 Agent 动作必须过 Consent 闸门；批准/拒绝/撤销/过期清晰可见。
5. **证据天然可追溯**：界面上「执行成功 / 已批准 / 已验证」必须有服务端状态与证据映射（见 `01` 矩阵 Evidence 列）。

---

## 2. 双主题 Token（真实值）

### 2.1 Deep Field（深色 · 高专注协作）
来源：`globals.css:1722-1749`（默认/深色块）。

| Token | 值 | 用途 |
| --- | --- | --- |
| `--lf-bg` | `#0b0e11` | 页面底 |
| `--lf-surface` | `#171c21` | 卡片/面板 |
| `--lf-surface-2` | `#1f262d` | 次级表面/输入框 |
| `--lf-line` | `rgba(242,241,236,0.1)` | 描边 |
| `--lf-line-strong` | `rgba(242,241,236,0.18)` | 强调描边 |
| `--lf-text` | `#f2f1ec` | 主文字 |
| `--lf-text-muted` | `#9ba5ad` | 次文字 |
| `--lf-text-faint` | `#868e93` | 弱文字 |
| `--lf-signal` | `#d7ac78` | 品牌强调/主操作 |
| `--lf-signal-soft` | `rgba(215,172,120,0.16)` | 强调底 |
| `--lf-success` | `#69b49b` | 通过/已验证 |
| `--lf-warning` | `#e5b96b` | 待处理/过期 |
| `--lf-danger` | `#dc8580` | 错误/驳回/阻断 |

### 2.2 Paper（浅色 · 阅读/分析/运营）
来源：`globals.css:1754-1768`（浅色块）。

| Token | 值 |
| --- | --- |
| `--lf-bg` | `#f7f5f0` |
| `--lf-surface` | `#ffffff` |
| `--lf-surface-2` | `#efebe3` |
| `--lf-line` | `rgba(11,14,17,0.1)` |
| `--lf-line-strong` | `rgba(11,14,17,0.18)` |
| `--lf-text` | `#0b0e11` |
| `--lf-text-muted` | `#5a636b` |
| `--lf-text-faint` | `#63696d` |
| `--lf-signal` | `#906931` |
| `--lf-signal-soft` | `rgba(184,134,63,0.14)` |
| `--lf-success` | `#3f8c74` |
| `--lf-warning` | `#b8862f` |
| `--lf-danger` | `#b8564f` |

### 2.3 形状 / 动效 / 焦点
- 半径：`--lf-radius=16px`、`--lf-radius-lg=20px`、`--lf-radius-max=24px`（圆角卡片语言）。
- 时长（响应式 + 降级）：`--lf-dur-fast/slow` 在桌面 180/450ms、移动 120/240ms、**`prefers-reduced-motion` 或省电档 = 0ms**（`globals.css:1848-1868`）。
- 缓动：`--lf-ease = cubic-bezier(0.22,1,0.36,1)`。
- 焦点环：`lf-focus-ring` → `outline:2px solid var(--lf-signal)` + `--lf-signal-pulse` 进入动画（`globals.css:1895-1913`），键盘可见。

### 2.4 主题切换机制（真实）
- 双主题**不**是两套组件实现：在区域根（`:root` / 主题根）重声明 `--lf-*` 整棵子树自动换肤（`globals.css:1777` 注释确认）。
- 切换控件（主题切换器）属 B2 实现项，需保证运行期真实切换并被 B4 四视口×双主题实测。
- 已有 Tailwind 镜像变量：`--color-lf-*`、`--radius-lf*`、`--ease-lf`（`globals.css:1874-1890`），便于 Tailwind 类引用。

---

## 3. 组件清单（真实组件映射）

> 现状：组件是**真实 React 组件**（Tailwind + `--lf-*`），尚未抽成「带 Variants 的正式库」。V20 将其固化为可审计组件，变体以 props/状态类表达。

| 组件 | 现状（真实文件） | V20 要求 |
| --- | --- | --- |
| App Shell | `living-shell.tsx`（Workspace）、`console-shell.tsx`（Console） | 统一双主题；导航/主舞台/Inspector 三栏一致 |
| Navigation | `NAV` 数组（`living-workspace.tsx:115`）、Console 侧栏 | 当前视图高亮；未接线项显式 `ready:false` |
| Button | 内联（主操作 `lf-focus-ring` + `border-lf-line-strong`） | 主/次/危险三态 + disabled 说明原因 |
| Input | `composer` textarea（Studio） | 标签/sr-only/placeholder/错误态 |
| Mission Card | `living-canvas.tsx` 节点 | 状态/阶段/可操作动作 |
| Status Badge | `stage-rail.tsx` 阶段条 | 提案→同意→执行→成果四段计数（读不到显示「—」） |
| Agent Card | `agent-board.tsx` | 运行/成本/状态/人工接管 |
| Consent Panel | `consent-gate.tsx` + `bridge-panel.tsx` | 待裁决横幅 + 四步进度 + 时间线 |
| Evidence Viewer | `outcome-observatory.tsx` + Evidence Lens | 文字/验证记录/媒体三栏，如实标注契约未含 |
| Activity Timeline | `consent-gate.tsx` 审批时间线 | 只画真实时间点（`introducedAt`/`expiresAt`） |
| Data Table | Console 各页表格 | 排序/过滤/分页 + 空态 |
| Toast | **UNKNOWN（待建）** | 操作结果轻提示（成功/失败） |
| Dialog | **UNKNOWN（待建）** | 确认/拒绝/撤销模态（焦点陷阱 + ESC） |
| Empty/Error/Loading/Permission | `Loadable`（`living-workspace.tsx:163-199`）、`NodeEmpty` | 全状态覆盖，不伪装 |

---

## 4. 状态矩阵（每屏必备）

来源：用户 V20「每个 Figma 页面必须具备的状态」+ 代码已实现的三态纪律。

| 状态 | 代码现状 | 要求 |
| --- | --- | --- |
| Default | ✅ 正常业务内容 | 数据来自真实端点 |
| Loading | ✅ `Loader2` + `role=status` | 真读取，非假转 |
| Empty | ✅ `rounded-lf border-dashed`（如 Studio 空态） | 展示下一步操作 |
| Error / Blocked | ✅ `role=alert` + 原因 | 说明原因，不伪装成功；重试/查看原因 |
| Permission | ⚠️ 部分（能力探测 403 如实展示） | 统一「无权限」态，不假装可用 |
| Offline | UNKNOWN | 网络失败态（B2 补） |
| Pending Approval | ✅ `AWAITING_APPROVAL` 横幅 | 明确待你裁决 |
| Verified | ✅ `verificationLevel` 派生 | 必须有 `OutcomeVerification` 记录映射 |
| Revoked | ⚠️ 撤销逻辑在 T05/executor，UI 待强化 | 撤销即刻生效并显式提示 |
| Timeout | UNKNOWN | 请求超时态（B2 补） |

---

## 5. 视口与主题覆盖（B4 验收基准）

| 视口 | 尺寸 |
| --- | --- |
| 移动小 | 360×800 |
| 移动 | 390×844 |
| 平板 | 768×1024 |
| 桌面 | 1440×900 |

- 双主题：**Deep Field** + **Paper**，必须**运行期真实切换**后实测（非仅设参）。
- 13 核心屏 × 4 视口 × 2 主题 = 覆盖基准（见 B4 任务 #24）。

---

## 6. Figma 映射协议（待 token 后 1:1 补建）

当提供 Figma Personal Access Token + 目标 file key 后，按此协议把本文件落成 Figma 节点：

1. **变量**：把 §2 的 `--lf-*` 逐条建为 Figma Variables（Color/Radius/Duration/Easing），双主题建为 Theme 变体集合（Deep Field / Paper）。
2. **组件**：§3 每个组件建为 Figma Component + Auto Layout + Variants（Default/Loading/Empty/Error/Permission/…）。
3. **页面**：§（B1 后续）13 屏各建 Desktop + Mobile Frame，组件实例化，Prototype 连线。
4. **映射表**：`Figma Node ID ↔ React 组件文件路径 ↔ --lf- Token ↔ API 状态` 四列对照，存入 `06_FIGMA_TO_CODE_MAPPING.md`。
5. **验收**：每个节点可编辑、引用变量、非截图；链接可打开；实际调用记录可核验。

> 此协议保证：**即使 Figma 节点后补，设计事实已在此文件锚定**，B2/B4 不依赖 Figma 也能推进，且不破坏「设计↔代码↔API↔证据」一一对应。

---

## 7. 与用户 V20 设计要求的对齐

- ✅ Adaptive Dual World 2.0 五原则 → §1。
- ✅ Deep Field / Paper 双主题共享结构与 Token → §2（真实值）。
- ✅ 组件/状态/视口 → §3/§4/§5。
- ⚠️ Figma 可编辑节点 → 降级为补交项（B-01 决议），本文件为权威替代。
- ⚠️ Toast / Dialog / Offline / Timeout 状态 → B2 实现或强化（已标 UNKNOWN）。
