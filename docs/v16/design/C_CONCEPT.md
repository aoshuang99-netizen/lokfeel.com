# 方案 C · Adaptive Dual World（**已采纳并上线**）

> 状态：**已实现**。首次上线提交 `e5e8846`（2026-10-21），生产 `app.lokfeel.com`。
> 原型：`design/preview/C-adaptive-dual-world.html`
> 评分：综合 **4.30**（最高）

## 一、核心命题

一个屏幕里同时存在两个世界：

| 世界 | 位置 | 调色板 | 回答的问题 |
|---|---|---|---|
| **Living Canvas** | 左/上 | Deep Field 深色 | 「事情现在长什么样」——关系、流向、下一步 |
| **Inspector** | 右/下 | Living Paper 纸面 | 「这一步凭什么」——依据、字段、审批、证据 |

"自适应"体现在三处，且都**由真实数据驱动**：

1. **阶段聚焦**：四段流水线（提案 → 同意 → 执行 → 成果）里第一个有待办的那段自动成为焦点；
2. **点击变形**：点某一段 → 聚焦到对应屏（Consent / Agents / Outcomes），不是跳转新页面；
3. **明暗可迁移**：Contrast 控件在双世界下把 Canvas 也切成纸面（阅读模式），不是死按钮。

## 二、实现结构（真实文件）

```
src/components/living/living-shell.tsx        # 五区骨架 + dualWorld + stageRail
src/components/living/adaptive/stage-rail.tsx # 阶段条（展示层）
src/lib/living/adaptive/stages.ts             # buildOsStages / focusStage（纯函数）
src/app/globals.css                           # [data-lf-dual][data-lf-world] 令牌作用域
src/app/workspace/living-workspace.tsx        # 注入四段真实计数
```

### 为什么用 CSS 令牌作用域，而不是给组件传 `theme`

所有既有组件都通过 `bg-lf-surface` / `text-lf-text` / `border-lf-line` 取色，工具类读 `var(--lf-*)`。
在区域根上重声明变量，整棵子树自动换肤 —— **13 个 living 组件里 11 个零改动**（见 `02_COMPONENT_REUSE_MATRIX.md`）。
传 theme 的写法会漏掉任何一处写了死色的角落。

```css
[data-lf-dual='1'] [data-lf-world='canvas']    { --lf-surface:#171c21; --lf-text:#f2f1ec; … }
[data-lf-dual='1'] [data-lf-world='inspector'] { --lf-surface:#ffffff; --lf-text:#0b0e11; … }
```

## 三、阶段条的数据契约

| 段 | 计数来源 | 口径 |
|---|---|---|
| 提案 | `/api/v1/connections/proposals` | `state === 'CONSENT_PENDING'` 的行数 |
| 同意 | 同上 | `state === 'MUTUALLY_ACCEPTED'` 的行数；「待办」看服务端下发的 `canIntroduce` |
| 执行 | `/api/v1/agents/runs` | `AWAITING_APPROVAL` + (`APPROVED` 且 `requiresApproval`) |
| 成果 | `/api/v1/outcomes/timeline` | 服务端 `counts.unverified`（前端不重算） |

铁律（单测把守，变异即红）：

- 端点未返回 → `count: null` → 显示「—」，**不是 0**；
- `ready` 由"端点是否返回"决定，不由计数决定；
- 全未就绪 → `focusStage` 返回 `null`，不编一个起点。

## 四、五种交互的落点

| 交互 | 落点 | 是否真实 |
|---|---|---|
| Intent Morphing | Studio：一句话 → `WorkspaceSpec` → 画布节点 | 真实（`compileWorkspaceSpec` 纯函数 + zod 严格校验） |
| Living Connection Field | Field 屏 2.5D 图 + 阶段条 | 真实（`/api/v1/connections/pipeline`） |
| Agent Constellation | Agents 屏运行列表 + Inspector 审批 | 真实（`/api/v1/agents/runs`，`execution.available` 原样透传） |
| Evidence Lens | Inspector 常驻证据（端点 + 数字 + 口径） | 真实（每个数字标端点） |
| Outcome Time Travel | Outcomes 时间轴 + 核验标记 | 真实（`/api/v1/outcomes/timeline`） |

## 五、无障碍与降级

| 项 | 做法 | 证据 |
|---|---|---|
| 对比度 | 两套调色板各自满足 AA（正文 4.5、状态 3.0） | `npm run verify:contrast`：5 板块 × 15 组全绿 |
| 键盘 | 阶段条是 `<ol>` + `<button>`，`aria-current="step"` 标当前段 | 源码 |
| 屏幕阅读器 | 每段 `aria-label` = 段名 + 真实计数 + 是否当前 + 是否你在此屏 | 源码 |
| 动效降级 | `prefers-reduced-motion` 强制 L0（`--lf-dur-*` 归零） | `globals.css` + `audit:release` 实测 |
| 移动端 | Inspector 变底部浮层（纸面），composer 与浮层都加 `env(safe-area-inset-bottom)` | F-09 修复 |

## 六、已知取舍

- 阶段条在 390px 下需横向滚动（G-03）；
- 不做自动跳屏（C-03），"自适应"只体现在焦点与排序；
- 六屏仍无 URL 状态（G-01），刷新回 Now。
