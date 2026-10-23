# V19-06 · Design System（方案 C 定稿版）

> **状态：DS 定稿（代码侧）**。事实源是 `src/app/globals.css` 的 `--lf-*` 令牌层 —— 不是原型。
> 本文档做三件事：① 声明唯一令牌体系并给出清单；② 处理**原型自由用色 → 既有令牌**的归一（§3，本轮最重要的决策）；③ 组件清单对照任务书 15 个必需组件。

## 1. 唯一事实源：`--lf-*` 令牌层

`globals.css` L1709–L1914（注释块「LIVING CONNECTION OS — 设计令牌层」）。三条铁律（沿用既有注释，非本轮新造）：

1. **加性、作用域化**：不覆盖既有品牌令牌；未设置 `[data-lf-theme]` 的页面零影响。
2. **换肤靠变量重声明，不靠传 props**：所有组件经 `bg-lf-surface / text-lf-text / border-lf-line` 工具类取色 → 子树根上重声明 `--lf-*` 即整树换肤，不会漏死色角落。（V16 已把"给组件传 theme 会漏色"写成红线。）
3. **动效/触控/焦点是令牌不是散落样式**：`--lf-dur-*` 四档 + `prefers-reduced-motion` 强制 L0 + `.lf-focus-ring` + 窄视口 44px 触控（`:where()` 0 特异性）。

**当前门禁证据**（2026-10-23 实跑）：`npm run verify:contrast` → **✓ 全部组合达到 WCAG AA**（5 板块 × 15 组，含双世界作用域与 paper 阅读模式）。

## 2. 令牌清单（核对于 `c3213fd` 树）

| 组 | 令牌 | 值（Deep Field / Living Paper） |
|---|---|---|
| 底色 | `--lf-bg` | `#0b0e11` / `#f7f5f0` |
| 面 | `--lf-surface` / `--lf-surface-2` | `#171c21`,`#1f262d` / `#ffffff`,`#efebe3` |
| 线 | `--lf-line` / `--lf-line-strong` | `rgba(242,241,236,.1/.18)` / `rgba(11,14,17,.1/.18)` |
| 文字 | `--lf-text` / `-muted` / `-faint` | `#f2f1ec`,`#9ba5ad`,`#868e93` / `#0b0e11`,`#5a636b`,`#63696d` |
| 强调 | `--lf-signal` / `-soft` | `#d7ac78`（深）/ `#b8862f`（浅）· soft 为 16%/14% 透明 |
| 状态 | `--lf-success/-warning/-danger` | `#69b49b #e5b96b #dc8580`（深）/ `#3f8c74 #b8862f #b8564f`（浅） |
| 形 | `--lf-radius(-lg/-max)` | 16 / 20 / 24 px |
| 动效 | `--lf-dur-fast/-dur/-dur-slow` + `--lf-ease` | 180/280/450ms + `cubic-bezier(.22,1,.36,1)`；L0–L3 档位 + reduced-motion 强制 0 |
| 双世界 | `[data-lf-dual='1'] [data-lf-world='canvas|inspector']` | canvas 恒深、inspector 恒浅；`[data-lf-theme='paper']` 时全树转纸面 |
| Tailwind | `@theme inline` | `bg-lf-* / text-lf-* / border-lf-* / rounded-lf* / ease-lf` |

**Figma 变量映射就绪度**：令牌命名已是 `组/角色` 二级结构（`text/muted`、`surface/2`），可直接变成 Figma Variables 的 collection + mode（Deep Field / Paper 两个 mode = 现有两个作用域）。Figma 连接器补齐后即可机械导出，**无需重命名**。

## 3. 🔴 原型用色归一（本轮关键决策）

**事实**：方案 C 原型（`design/v19/concept-c-adaptive-dual-world.html`）机械扫描出 **21 个自由十六进制色**（teal/blue 系：`#04211c` `#5eead4` `#7c9bff` `#4ade80`…），与代码里已过 WCAG 门禁的 `--lf-*` 体系（Deep Field + Warm Signal `#d7ac78`）**不是同一套**。

**决策：代码令牌是事实源，原型只贡献结构与交互规格，色板不进代码。**

理由：
1. `--lf-*` 体系有 `verify:contrast` 门禁背书；原型 21 色没有任何对比度证据；
2. 引入第二套色 = 两套并行体系，正是任务书 §7 明令避免的（"避免重建两套不兼容组件库"）；
3. 公开面品牌色（`SIGNAL #b8863f` / `INK #0b0e11` / `PAPER #f7f5f0`）已上线，换色是品牌决策不是设计实现决策。

**归一映射表**（第三轮实现时照此执行）：

| 原型角色 | 原型值（例） | 落地令牌 |
|---|---|---|
| 深底 | `#04211c` `#0a0f1e` `#0d1428` | `--lf-bg` / `--lf-surface` / `--lf-surface-2`（Deep Field） |
| 浅底 | `#f6f3ea` `#efe9db` | `--lf-bg` / `--lf-surface-2`（Living Paper） |
| 主强调（teal/blue） | `#5eead4` `#7c9bff` | `--lf-signal`（Warm Signal `#d7ac78`）—— **品牌强调不换色** |
| 成功/警告/危险 | `#4ade80` `#fbbf24` `#fb7185` | `--lf-success/-warning/-danger` |
| 文字层级 | `#e9eeff` `#a6b3d8` `#65739c` | `--lf-text/-muted/-faint` |
| 浅色态状态色 | `#15803d` `#a16207` `#b91c1c` 等 | paper 侧同名令牌 |

> 原型真正的交付价值（已可照抄进实现）：阶段切换的信息架构、Inspector/Canvas 布局比例、空态/进行中/完成态的卡片形态、抽屉式 Consent 流。

## 4. 组件清单 vs 任务书 15 个必需组件

| 任务书要求 | 现状 | 落地动作（第三轮） |
|---|---|---|
| Button / Input | 全站 Tailwind 工具类 + `.lf-focus-ring`，无独立组件 | **不新建抽象**：13 屏密度差异大，先按屏实现，出现 3 处以上同形态再收敛 |
| Command Composer | ✅ `living-workspace.tsx` composer（含禁用原因 title、min-length 说明） | 文案对齐 Copy Deck（`05` §5 已执行） |
| Mission Card | ✅ `living-canvas.tsx` + `node-card.tsx` | 原型 C 的状态形态（pending/running/done）对齐 |
| Workspace Canvas Node | ✅ `node-card.tsx`（白名单渲染） | 无 |
| Agent Status | ✅ `agents/agent-board.tsx` | 状态必须继续来自真实 `agent.run` 事件 |
| Consent Panel | ✅ `consent/consent-gate.tsx` + `bridge/bridge-panel.tsx` | 服务端权限检查不动（V19 红线） |
| Evidence Panel | ✅ `living-shell.tsx` Inspector | 无 |
| Outcome Card | ✅ `observatory/outcome-observatory.tsx` | 原型 C 的 outcome 纸面形态对齐 |
| Navigation | ✅ `living-shell.tsx`（双世界作用域宿主）+ `adaptive/stage-rail.tsx` | 无 |
| Modal / Drawer | ✅ Inspector 抽屉（`living-shell.tsx` L147/247） | 无 |
| Toast | ⚠️ 分散实现 | 第三轮统一到 `--lf-*` 语义色 |
| Table | ⚠️ `/console/*` 各屏自有表格 | 触控 44px 已由全局规则覆盖，逐屏复核 |
| Empty State | ✅ `living-states.tsx`（含"不会假装可用"的未接通清单） | 无 —— 这是诚实空态的范本 |

**规则**：新组件一律消费 `--lf-*`（禁硬编码色值）；lint 棘轮下新文件零 `any`；schema 一律 `//` 注释。

## 5. 明确不做（本轮）

- 不把原型 21 色搬进 `globals.css`（§3）；
- 不建 Button/Input 基类组件库（§4，避免为抽象而抽象）；
- 不动 Deep Field/Paper 任一色值 —— 它们有 WCAG 门禁与上线品牌连续性背书；
- 不在 `main` 上做任何改动（全部工作留在 `v19/design-exploration`）。
