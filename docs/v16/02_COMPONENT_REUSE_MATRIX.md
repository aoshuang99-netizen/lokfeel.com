# 02 · 组件复用矩阵

> 目的：证明设计 C（Adaptive Dual World）是**在既有组件上换布局与令牌**，
> 不是重写一套 UI。下表「本轮改动」列全部为「零改动」的组件，才说明复用是真实的。

## 一、`src/components/living/`（13 个组件）

| 组件 | 职责 | 消费的端点 | 本轮改动 |
|---|---|---|---|
| `living-shell.tsx` | 五区骨架：ContextBar / Dock / Canvas / Inspector / Composer | — | **改**：新增 `dualWorld`、`stageRail`、移动端安全区 |
| `adaptive/stage-rail.tsx` | 阶段条（新增） | 无（纯展示，数据由页面注入） | **新增** |
| `living-canvas.tsx` | WorkspaceSpec → 画布（白名单节点） | — | 零改动 |
| `node-card.tsx` | 单个规格节点 | — | 零改动 |
| `living-states.tsx` | 三态占位 | — | 零改动 |
| `field/field-canvas.tsx` | 2.5D 关系网络 | `/api/v1/missions`、`/api/v1/connections/pipeline` | 零改动 |
| `field/field-graph.tsx` | 图渲染（SVG/Canvas） | — | 零改动 |
| `field/field-inspector.tsx` | 节点详情 | — | 零改动（自动继承 Inspector 的纸面令牌） |
| `field/field-fallback.tsx` | 图渲染不可用时的 2D 降级 | — | 零改动 |
| `consent/consent-gate.tsx` | 同意与逐字段披露 | `/api/v1/intents`、`/api/v1/connections/proposals` | 零改动 |
| `bridge/bridge-panel.tsx` | 跨社群协议 | `/api/v1/bridges` | 零改动 |
| `observatory/outcome-observatory.tsx` | 成果时间轴 + 指标 | `/api/v1/outcomes`、`/api/v1/outcomes/metrics` | 零改动 |
| `agents/agent-board.tsx` | Agent 运行与审批 | `/api/v1/agents/runs`、`/api/v1/agents/usage` | 零改动 |

**结论：13 个里 11 个零改动，1 个扩展，1 个新增。** 双世界之所以能做到，是因为所有组件都通过
`bg-lf-surface` / `text-lf-text` / `border-lf-line` 这些工具类取色，而工具类读 `var(--lf-*)` ——
在区域根上重声明变量，整棵子树自动换肤。

## 二、`/console` 的组织态骨架

| 组件 | 职责 | 本轮改动 |
|---|---|---|
| `console/layout.tsx` | 服务端：会话 / 租户解析 / 无组织说明页 | 零改动 |
| `console/console-shell.tsx` | 客户端：上下文头 + 七屏导航 + 权限降级 | **改**：组织名 `<h1>` → `<p>`（F-04） |
| `console/no-org.tsx` | 「你还没加入任何社群」正常态 | 零改动 |
| 七个页面 | 各自唯一的 `<h1>` | 零改动 |

## 三、全站公共组件（3 个）

| 组件 | 用途 | 本轮改动 |
|---|---|---|
| `LokFeeLogo.tsx` | 品牌标（文件名保留历史拼写，导出符号未改） | 零改动 |
| `ShareButton.tsx` | 分享 | 零改动 |
| `verification-banner.tsx` | 未验证邮箱提示 | 零改动 |

## 四、设计令牌层

| 文件 | 作用 | 本轮改动 |
|---|---|---|
| `src/app/globals.css`（`--lf-*` 段） | 两套调色板 + 四档动效 | **改**：新增双世界作用域；修正 3 个不达 AA 的令牌 |
| `src/lib/living/**` | 领域模型与装配（纯函数） | 新增 `adaptive/stages.ts`（纯函数） |

## 五、复用的判据（怎么验证"零改动"是真的）

```bash
# 本轮改动的 living 组件应只有这两个
git diff --stat e5e8846~1 e5e8846 -- src/components/living
# 期望：living-shell.tsx + adaptive/stage-rail.tsx（新增）
```
