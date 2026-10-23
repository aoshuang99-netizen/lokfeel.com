# V19-19 · Figma-to-Code 追溯性（WB19-44）

> **状态：BLOCKED_FIGMA_CONNECTOR（2026-10-23 复核）。** 不虚构 Node ID；本文把"补齐后要做什么"固化成清单，连接器到位当天即可机械执行。

## 1. 能力现状（同日三次核验结论一致）

| 能力 | 状态 | 证据 |
|---|---|---|
| `figma-create-new-file` / `generate-design` / `generate-library` / `design-to-code` | **SKILL_UNAVAILABLE** | ToolSearch 0 个 Figma 工具；连接器清单仅 GitHub；无 Figma API token |
| `figma` / `figma-to-code` 技能（市场安装） | 已加载，但为**方法论指导**，不具备创建/读取 Figma 文件的能力 | 见 `01_FIGMA_SKILL_EXECUTION.md` |
| Cloudflare Pages check-run | 与 LokFeel 无关（项目 `vpsa`，`vpsa.pages.dev` 实测 404） | 2026-10-23 探测 |

**补齐路径**（二选一，任一即可解锁）：① 安装 Figma 连接器（OAuth）；② 提供 Figma Personal Access Token（写入 env `FIGMA_TOKEN`，可跑 REST API 读文件节点）。

## 2. 设计源的真实状态

- 设计源 = `design/v19/concept-c-adaptive-dual-world.html`（可编辑 HTML，方案 C 已获人工选型，见 `04`）。
- 令牌已在代码侧定稿且**不分叉**（`06` §3：原型 21 自由色归一到 `--lf-*`，有归一映射表）—— FIG-02「Tokens 不分叉」**已在代码侧成立**。

## 3. 连接器到位后的机械执行清单（按序）

1. 新建 Figma 文件 `LokFeel — Connection OS — V19 Design Exploration`；
2. 用 `06` §2 的 `--lf-*` 清单建 Figma Variables（collection=Connection OS，mode=Deep Field / Paper）；
3. 按 `07`/`08` 的六屏+七屏表逐屏建 Frame（390×844 与 1440×900 两套）；
4. 逐屏回填八元组的 `Figma Node ID` 列（`07` §1 / `08` §1 表格预留了该列位置）；
5. 每屏跑一次 design↔browser 截图对照，偏差记入 `16_REAL_UI_AUDIT.md` 的问题列表。

## 4. 追溯链的当前形态（HTML 源版本）

在设计源→代码映射上，目前可成立的追溯链是：

```
design/v19/concept-c-*.html（可编辑结构规格）
  → 06 §3 归一映射（色板）+ 07 §3 差异裁决（交互）
  → src/components/living/*（实现）
  → tests/e2e-ci/*（守卫）+ verify:contrast（令牌门禁）
```

Figma 节点列是这条链上**唯一缺失的一环**，其缺失不影响「真实体验修复」（WB19-40～43、45 均不依赖它）。
