# Living Connection OS —— 分阶段实施计划（P0–P3）

> 依据：设计基准 §十「我建议按四个阶段执行，不能先把 3D 首页做完，再发现 SaaS 内部还是静态页面」。
> 约束：**不破坏线上既有品牌与页面**（本仓现为暗色 Lime 品牌、76 页在跑、`User` 12,922）。
> 因此设计层一律**加性（additive）+ 作用域化（`[data-lf-theme]`）**，不回改既有令牌。

## 0. 与 T09–T12 的关系

设计基准的「执行能力」侧（Agent Constellation / 生成式编排）依赖 **T09 Agent Runtime**；
「跨社群网络」依赖 **T10 Community Bridge**。故两条线**交错推进**：

- **前端线**（本文档 P0→P3）
- **后端线**（`docs/implementation/BACKLOG.md` 的 T09→T12）

`Agents` 相关 UI 在 T09 交付前**一律渲染为「未就绪 + 原因」**（继承 `console-shell.tsx` 既有做法），
**不做假 Agent、不做假拓扑**。

## P0 · Design Foundation（设计基础）

**范围**：设计令牌、布局系统、响应式、登录、组件库。
**验收**：页面统一、无溢出、导航真实。

| 交付 | 内容 |
|---|---|
| 令牌层 | `[data-lf-theme="field"]`（Deep Field 暗）/ `[data-lf-theme="paper"]`（Living Paper 亮）双主题；`--lf-*` 命名空间；**不改既有 `--primary` 等** |
| 动效档 | L0 静态 / L1 微动效 / L2 空间动效 / L3 沉浸动效 四档令牌（时长 180–450ms）；`prefers-reduced-motion` → 强制 L0 |
| 布局系统 | 五区脚手架组件 `LivingShell`：Dock(64–80) + ContextBar(56–64) + Canvas + Inspector(320–400，可收起) + Composer(浮动) |
| 响应式 | ≥1024 五区；<1024 降级为「卡片流 + 聚焦视图 + 底部操作面板」；显式 `min-w-0` |
| 组件库 | 补齐 P0 缺口：`Switch` / `SegmentedTabs` / `Drawer`（手写，沿用 `cva`+`cn`，不引 Radix，保持一致性）；`EmptyState`/`Skeleton` 复用既有 |
| 无空按钮 | 所有动作要么真实可用、要么 `disabled + reason`；新增门禁脚本扫描 |
| 预览路由 | `/workspace`（鉴权守卫内），先用真实端点渲染五区，证明「不是静态演示页」 |

## P1 · Generative Workspace（生成式工作空间）

**范围**：Intent-to-UI、Mission Studio、Living Canvas。
**验收**：输入目标后生成**真实结构化任务**。

- **Intent-to-UI Compiler**：自然语言 → **受约束的 `WorkspaceSpec`**（`zod` 校验）→ 前端按**已审核组件**渲染。
  **禁止**让模型直接产 HTML/React 代码（基准 §二 明确）。
- **Mission Studio**：`POST /api/v1/missions`（幂等键）；成功后画布出现 `intent` 节点。
- **Living Canvas**：P1 用 **DOM/SVG 混合**（不引 3D）；节点可展开/聚焦/拖动（布局本地状态）。
- **空结果不伪造**：无候选 → 显示「供给不足 / 建议扩展授权 / 发布 Mission Link」（基准 §五）。

## P2 · Connection Intelligence UI

**范围**：Field、Consent、Agent、Outcome。
**验收**：全链路真实 API、审批与状态更新。

- Field 升级为 **2.5D 关系网络**（P2 引入 `@xyflow/react`；大规模关系另评估渲染方案，**不强迫一个库承担所有场景**）。
- Consent Gate 接 `intents/[id]/disclosure` 的**逐字段披露**投影。
- Outcome Observatory 时间轴（`outcomes` + `metrics`）。
- Agent 区**等 T09**；T09 落地后接 `agent` 节点类型。

## P3 · Immersive Experience

**范围**：首页 3D、空间动效、时间回放。
**验收**：性能、无障碍、降级与视觉验收。

- 首页 Hero 的 Living Connection Field 用 **WebGL/Three.js/Spline**；
  🔴 **首屏核心文案与登录入口必须独立于 3D 渲染**（3D 挂了首页仍可用 —— 阻断标准 #12）。
- `Outcome Time Travel` 回放。
- 性能：公开页 LCP ≤ 2.5s / INP ≤ 200ms / CLS ≤ 0.1；复杂画布另设交互延迟/节点数/帧率预算。

## 门禁（每阶段必过）

```
tsc --noEmit                      # 0 error
jest                              # 全量（8G 机与 eslint 串行）
eslint --max-warnings=0 <dir>     # 0/0
check:script-decls                # 脚本未声明引用 0
npm run check:ui-invariants       # 【P0 新增】无 setTimeout 伪成功 / 无空按钮 / 无 3D 依赖核心内容
```

## 风险与取舍

| # | 风险 | 处置 |
|---|---|---|
| D1 | 新品牌色（Warm Signal）覆盖全站会**改掉线上观感** | 令牌**作用域化**，先在 `/workspace` 生效；全站切换单独拍板 |
| D2 | 76 页回归面巨大 | 新布局**新增路由**渐进迁移，不一次性替换 |
| D3 | `use-api.ts` 无去重/重试语义 | P1 评估换 `@tanstack/react-query`；不迁移则补 `AbortController` + 错误态 |
| D4 | 生成式 UI 被当成「模型直接写代码」 | 强制 `WorkspaceSpec` + `zod` + 白名单组件；**服务端二次校验权限** |
| D5 | 无画布/3D 经验，易做成"炫技但不可用" | 每引入一个库先问：**它是否承担了唯一必要的表达**？否则不上 |
| D6 | Agent 区缺后端 | 等 T09；**不可用假的**（阻断标准 #6/#9） |
