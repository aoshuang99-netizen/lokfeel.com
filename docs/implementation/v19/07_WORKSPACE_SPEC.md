# V19-07 · Workspace 六屏规格（方案 C 落地版）

> **状态：已复核（2026-10-23，`v19/design-exploration` = `a08d07a`）**。
> 结论先行：**六屏已全部消费 `--lf-*` 令牌（硬编码色扫描 0 违规），阶段→视图映射已由纯函数实现并有单测**。方案 C 的落点不是"重做"，而是把三处与原型的**设计差异**记录为已裁决项（§3）。

## 1. 六屏清单与八元组

宿主：`src/components/living/living-shell.tsx`（双世界作用域 `[data-lf-dual='1']` + Inspector 抽屉）。

| 屏 | 组件 | 真实 API | 能力/权限 | 状态 |
|---|---|---|---|---|
| Now（阶段总览） | `adaptive/stage-rail.tsx` | `proposals`+`runs`+`outcomes/timeline` 三端点折算 | 只读 | ✅ 纯函数 `buildOsStages`（"—"≠0 有单测与变异把守） |
| Studio（意图编译） | `living-workspace.tsx` composer | 编译纯前端；创建任务才写服务端 | 登录 | ✅ 禁用态写明差多少字符 |
| Field | `field/field-canvas.tsx` + `field-inspector.tsx` | 意图/联系域端点 | 租户域 | ✅ 点选记录→看依据 |
| Consent | `consent/consent-gate.tsx` + `bridge/bridge-panel.tsx` | `/api/v1/intents`、`/intents/[id]/disclosure`、`/connections/proposals` | 服务端 `proposal.decide` 重新判定 | ✅ 三列并置、只按服务端 `actions` 渲染按钮 |
| Agents | `agents/agent-board.tsx` | `/api/v1/agents/runs`、`/agents/usage` | OPERATOR+ `agent.run` | ✅ 批准≠执行、服务端重判 409、诚实块 |
| Outcomes | `observatory/outcome-observatory.tsx` | `/api/v1/outcomes/timeline` | 租户域 | ✅ 自报≠验证、假设随指标显示 |

空/错/载态统一走 `living-states.tsx`（"这是查询成功后的结论，不是读取失败"式空态）。

## 2. Figma Node ID

`N/A (HTML source)` —— Figma 连接器补齐前，设计源为 `design/v19/concept-c-adaptive-dual-world.html`（可编辑、可交互）。

## 3. 与原型 C 的三处设计差异（已裁决）

| # | 原型 C | 代码实现 | 裁决 |
|---|---|---|---|
| 1 | 阶段驱动**整体世界翻转**（outcome 阶段全屏转纸面） | **阶段聚焦视图**（`focusStage`）+ **双世界并置恒定**（canvas 恒深 / inspector 恒浅） | **保留代码方案**。整树翻转会让用户失去空间记忆，且"阅读模式"（paper）已作为显式控件存在；`focusStage` 已实现"根据阶段转换重点"的产品意图 |
| 2 | 自由色板（21 色） | `--lf-*` 唯一体系 | 保留代码（见 `06` §3 归一映射表） |
| 3 | 原型卡片形态（pending/running/done 徽章） | 服务端下发 `statusLabel`/`statusHint` 徽章 | 保留代码 —— 前端不得自建第二套状态机（agent-board 纪律 ②） |

## 4. 文案处置（对应 `05` §5）

Agent / Consent / Outcomes 三屏逐条对照文案库后**全部保留**：现有文案的诚实度（批准≠执行、自报≠验证、"该端点尚未返回因此不显示数字"）高于文案库候选行。状态标签/动作标签来自服务端常量（`LIVING_AGENT_*`、`CONSENT_*_LABELS`），前端改字符串 = 编造语义，**不动**。
