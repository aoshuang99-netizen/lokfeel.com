# V19-01 · Figma 技能执行记录（FIGMA READY）

> 结论先行：**方法论技能已就位；文件级 Figma 执行能力不可用（SKILL_UNAVAILABLE）**。
> 以下每一条都是实测结果，不是推断。

## 1. 技能发现与安装（实测）

| 步骤 | 结果 |
|---|---|
| 工具搜索 `figma create file design` 等 4 组关键词 | **0 个 Figma 工具**（命中的全是 GitHub 文件操作） |
| 已安装连接器清单 | 仅 `github` —— **无 Figma 连接器**（`list_installed_plugins` 实测） |
| 技能市场搜索 | 命中 `figma`、`figma-to-code` 等 5 个 |
| **已安装** | ✅ `figma`（Figma）✅ `figma-to-code`（Figma to Code）—— 本轮已实际加载执行 |

## 2. 加载后的真实能力边界（读完技能正文后判定）

| 技能 | 能提供 | 不能提供 |
|---|---|---|
| `figma` | Figma 操作**方法论**：Frame/Auto Layout/组件化/原型的标准流程、术语、经验库 | **不提供任何可编程工具** —— 它明确写"以浏览器/桌面端 Figma 为准"，文件创建仍需人在 Figma 里操作或调 REST API |
| `figma-to-code` | 从 Figma 链接/截图生成 React/Vue 代码的流程 | 需要一个**已存在的 Figma 文件或设计图**；本轮没有可输入的 Figma 源 |

## 3. 逐项判定（对齐任务书 §2 的 9 项能力）

| 能力 | 判定 | 原因 | 替代方案（已执行/可执行） |
|---|---|---|---|
| `figma-use` 前置规范 | ✅ **DONE** | 技能已加载，规范用于约束后续所有设计动作 | — |
| `figma-create-new-file` | ❌ **SKILL_UNAVAILABLE** | 无 Figma 连接器、无 Figma API token；技能本身不建文件 | **可编辑 HTML/CSS 设计源文件**（design/v19/*.html），令牌=CSS 变量 |
| `figma-generate-design` | ❌ **SKILL_UNAVAILABLE** | 同上 | 三套交互原型即"设计生成物"，图层即 DOM，可直接改 |
| `figma-generate-library` | ❌ **SKILL_UNAVAILABLE** | 同上 | 令牌表 + 组件清单以 CSS 变量与 `06_DESIGN_SYSTEM.md`（第二轮）交付 |
| `figma-design-to-code` | ❌ **SKILL_UNAVAILABLE**（暂） | 需先有 Figma 源；补齐能力后可用本原型的 DOM 结构直接产出 TSX | 原型本身就是 HTML/CSS —— 与 TSX 的映射是机械翻译 |
| 设计上下文读取 | ❌ **SKILL_UNAVAILABLE** | 无文件可读 | 基线审计改用**真实浏览器截图 + 源码**（`02_UI_AUDIT.md`） |
| 节点/组件检查 | ❌ **SKILL_UNAVAILABLE** | 同上 | 原型内以 class 命名规范承担（`.card` `.mission` `.pill-*` 等） |
| 原型能力 | ⚠️ **替代达成** | 无 Figma Prototype 连线 | **真实可点击 HTML 原型** × 3，真实 Chromium 走通并留证（见 §4） |
| 设计审查 | ⚠️ **替代达成** | 无 Figma 对照工具 | 原型截图 vs 生产截图并排对比（`03_DESIGN_CONCEPTS.md`） |

## 4. 替代方案的"真实性"证明（不是嘴说的）

`scripts/qa/v19-prototype-verify.mjs` 在**真实 Chromium** 里把三套原型各走一遍完整流程
（输入意图 → 编译动画 → Workspace → Consent → Outcome → 切 390 移动视口），并抓 9 张状态截图：

```
A  errors=0  B  errors=0  C  errors=0  world=paper   → ALL_PROTOTYPES_INTERACTIVE_OK
```

- 截图：`docs/implementation/v19/screenshots/prototypes/{A,B,C}-{workspace,consent,mobile}.png`
- C 的双世界切换被脚本观察到（Outcome 阶段 `data-world=paper`），不是概念描述。

## 5. 补齐真实 Figma 能力需要什么（给人的一段话）

1. 在连接器里绑定 **Figma connector**，或提供 **Figma REST API token**（需 file 编辑权限）；
2. 之后：`figma-create-new-file` 建 `LokFeel — Connection OS — V19 Design Exploration` →
   用 `figma-generate-design` 把三套原型的结构与令牌搬入 → `figma-generate-library` 落变量 →
   `figma-design-to-code` 反向校准实现。
3. 在此之前，**FIG-01/03/04 只能给"替代证据"**，不给 PASS —— 不把 HTML 原型冒充 Figma 文件。

## 6. 第一轮实际的 Figma 相关产物清单

| 产物 | 路径 | 性质 |
|---|---|---|
| 原型 A | `design/v19/concept-a-living-intelligence.html` | 可编辑 HTML/CSS 设计源 · 可点击 |
| 原型 B | `design/v19/concept-b-precision-workspace.html` | 同上 |
| 原型 C | `design/v19/concept-c-adaptive-dual-world.html` | 同上 |
| 评审入口 | `design/v19/index.html` | 对比 + 成本分析 + 推荐 |
| 原型验证 | `scripts/qa/v19-prototype-verify.mjs` | 真实浏览器交互自证 |
