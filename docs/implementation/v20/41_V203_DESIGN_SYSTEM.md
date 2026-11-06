# V20.3 · 41 — 设计系统（唯一事实源 `--lf-*`）

> **权威源**：`src/app/globals.css` L1709–L1880（注释块「LIVING CONNECTION OS — 设计令牌层」）。
> 不是原型，不是参考图，不是任何新建色板。作战令 §3.1：「以现有 `--lf-*` 为权威源」「禁止另建一套不兼容的颜色和间距体系」。

## 1. 定调：Concept C — Adaptive Dual World

两个体验世界**共用同一套 token**，靠 CSS 变量作用域重声明切换，不是两套产品：

| 世界 | 作用域 | 用途 |
|---|---|---|
| Deep Field | `[data-lf-theme='field']`（默认）/ `[data-lf-dual='1'] [data-lf-world='canvas']` | 沉浸式 AI 协作：专注、意图、任务进展、温度 |
| Living Paper | `[data-lf-theme='paper']` / `[data-lf-dual='1'] [data-lf-world='inspector']` | 高可读管理：组织、证据、成本、审批、复盘 |

`living-shell.tsx` 以 `[data-lf-dual='1']` 让 **Canvas 恒深 / Inspector 恒浅并置**；
`[data-lf-theme='paper']` 时全树转纸面（阅读模式）。这是 `07` §3 已裁决的实现，不重做。

## 2. 全量 Token（真实值，逐行核对 globals.css）

### 2.1 色彩

| 组 | Token | Deep Field | Living Paper |
|---|---|---|---|
| 底色 | `--lf-bg` | `#0b0e11` | `#f7f5f0` |
| 面 | `--lf-surface` | `#171c21` | `#ffffff` |
| 提升面 | `--lf-surface-2` | `#1f262d` | `#efebe3` |
| 线 | `--lf-line` | `rgba(242,241,236,.1)` | `rgba(11,14,17,.1)` |
| 强线 | `--lf-line-strong` | `rgba(242,241,236,.18)` | `rgba(11,14,17,.18)` |
| 主文字 | `--lf-text` | `#f2f1ec` | `#0b0e11` |
| 次文字 | `--lf-text-muted` | `#9ba5ad` | `#5a636b` |
| 弱文字 | `--lf-text-faint` | `#868e93` | `#63696d` |
| 品牌强调 | `--lf-signal` | `#d7ac78`（Warm Signal） | `#906931` |
| 强调软底 | `--lf-signal-soft` | `rgba(215,172,120,.16)` | `rgba(184,134,63,.14)` |
| 成功 | `--lf-success` | `#69b49b` | `#3f8c74` |
| 警告 | `--lf-warning` | `#e5b96b` | `#b8862f` |
| 危险 | `--lf-danger` | `#dc8580` | `#b8564f` |

> 🔴 **品牌强调不换色**：`06` §3 归一映射把原型的 teal/blue（`#5eead4` / `#7c9bff`）统一到 Warm Signal。
> 用户提供的两张参考图中的紫蓝/星云是**视觉方向**，不是落地色板。本轮上一版 HTML 规格用了
> `#4F46E5` / `#FB7185` 属「另建不兼容体系」，已在 `40` §5 明确作废。

### 2.2 形 / 间距 / 动效 / 无障碍

| 组 | Token | 值 |
|---|---|---|
| 圆角 | `--lf-radius` / `-lg` / `-max` | `16px` / `20px` / `24px` |
| 动效 L2（默认） | `--lf-dur-fast` / `--lf-dur` / `--lf-dur-slow` | `180ms` / `280ms` / `450ms` |
| 缓动 | `--lf-ease` | `cubic-bezier(.22,1,.36,1)` |
| 动效档位 | `[data-lf-motion='0'\|'1'\|'3']` | L0 全 0ms / L1 120·180·240ms / L3 240·420·700ms |
| 减弱动效 | `@media (prefers-reduced-motion: reduce)` | 强制 L0（三个 dur 全 0ms） |
| 触控目标 | `@media (max-width:1023px)` + `:where()` | `min-height:44px`（0 特异性，组件可覆盖） |
| 焦点 | `.lf-focus-ring` | 全站统一（见 `06` §1 铁律 3） |
| Tailwind 映射 | `@theme inline` | `bg-lf-* / text-lf-* / border-lf-* / rounded-lf* / ease-lf` |

**动效预算对照作战令 §5.3**：微反馈 180ms（目标 100–200ms ✓）、状态切换 280ms（目标 150–300ms ✓）、
复杂空间切换 450ms（按可用性测试决定）。`prefers-reduced-motion` 已强制归零 ✓。

### 2.3 断点是**代码事实**，不是设计臆测

`globals.css` 实际使用 `@media (max-width: 1023px)` 作为触控/布局切换点；
E2E 视口以 `tests/e2e-ci/lib/measure.ts` 的 `VIEWPORTS` 为准（含 390 / 360）。
作战令 §5.2 要求的 360×800 / 390×844 / 768×1024 / 1440×900 属**验收视口**，不新增断点 token。

## 3. Figma Variables 映射方案（就绪，未执行）

`06` §2 已确认令牌命名是 `组/角色` 二级结构，可直接机械导出，**无需重命名**：

- Collection：`Connection OS`
- Modes：`Deep Field` / `Living Paper`（= 现有两个作用域，不新增第三套）
- 变量组：Color（上表 14 项 × 2 mode）、Radius（3）、Motion（3 dur + 1 ease）、Space（按 8pt 栅格派生）

**判定 `BLOCKED`**：本轮 PAT 无写入端点、无写入连接器，无法创建 Variables/Styles/Component/Variant。
详见 `42_V203_FIGMA_NODE_TRACEABILITY.md`。**不宣称 Figma 已交付**。

## 4. 基础组件现状（真实，来自 `06` §4 与源码）

作战令 §3.2 列出 20 个组件。仓库现状分三类，**不重复修改已验收且无缺陷的组件**（作战令 §11）：

| 类别 | 组件 | 真实路径 |
|---|---|---|
| 已实现（真实端点驱动） | Command Composer / Mission Card / Canvas Node / Agent Status / Consent Panel / Evidence Panel / Outcome Card / Navigation / Modal-Drawer / Empty State | `living-workspace.tsx` composer、`living-canvas.tsx`、`node-card.tsx`、`agents/agent-board.tsx`、`consent/consent-gate.tsx`、`bridge/bridge-panel.tsx`、`living-shell.tsx` Inspector、`observatory/outcome-observatory.tsx`、`adaptive/stage-rail.tsx`、`living-states.tsx` |
| 分散但可用 | Button / Input / Select / Tabs / Card / Table / Toast / Inline Alert / Skeleton / Error State | 全站 Tailwind + `.lf-focus-ring`；`06` §4 明确裁决「**不新建抽象基类**」，13 屏密度差异大，出现 ≥3 处同形态再收敛 |
| 缺失 | 统一 Component 库（Figma Component/Variant） | `BLOCKED_FIGMA_WRITE` |

**状态覆盖判定 `NOT_TESTED`**：作战令要求每个组件定义 Default/Hover/Focus/Active/Disabled/Loading/Error/Success
并含键盘与触控规范。代码侧 `.lf-focus-ring` + 44px 触控 + 三态 `living-states.tsx` 有实现，
但**逐组件状态矩阵未做人工/脚本走查**，本轮不标 PASS。复跑见 `47_V203_ACCESSIBILITY_PERFORMANCE.md`。

## 5. 门禁证据

| 门禁 | 结果 | 来源 |
|---|---|---|
| `npm run verify:contrast` | PASS（5 板块 × 15 组 WCAG AA，含双世界与 paper 阅读模式） | `06` §1（2026-10-23 实跑） |
| 13 屏硬编码色扫描 | PASS（0 违规） | `07` §1 / `08` §3 |
| `console`/`workspace` token 合规 | PASS | `08` §3 |
| legacy `dashboard/analytics-report.tsx` 3 处硬编码 | **已知未修**（不在 13 屏范围，`08` §4 裁决不修） | 登记为 backlog，不夹带 |
| 本轮改动文件 lint/tsc | PASS（0 / 0） | 本轮实测 |
