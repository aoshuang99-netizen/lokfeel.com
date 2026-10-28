# V19.5-28 · Figma 交互一致性（WB19-55）

> 状态：**BLOCKED_FIGMA_CONNECTOR**（2026-10-28 复核，与 `19_FIGMA_CODE_TRACEABILITY.md` 结论一致）
> 本文件不虚构 Node ID，只做**连接器缺席时仍可做**的那部分：设计系统一致性的代码侧核验。

## 1. 能力复核（今日重跑）

| 能力 | 结果 |
|---|---|
| `figma-use` / `figma-design-to-code` / `figma-generate-library` 工具 | **0 个**（ToolSearch 三次查询均无 Figma 工具返回） |
| Figma OAuth 连接器 | 未安装 |
| `FIGMA_TOKEN` 环境变量 | 未提供 |

结论：**读取现有设计节点、组件与变量**这一步无法执行。按任务书要求「Node ID 不可用时明确标记 BLOCKED，不得虚构」处理。

## 2. 连接器缺席时做了什么（不是空转）

任务书的核心诉求是「**禁止重新创建第二套视觉系统**，优先复用现有 `--lf-*` 变量与组件」。这件事不需要 Figma 也能验：

```
git diff -U0 -- register/page.tsx confirm-dialog.tsx report-modal.tsx
  → 新增 340 行
  → 含 hex 色值 0 处
  → 含 rgba() 1 处：style={{ border: "1px solid rgba(255,255,255,0.1)" }}
      （原有样式，随节点层级平移，不是新增）
```

| 检查项 | 结论 |
|---|---|
| 新增硬编码颜色 | **0** |
| 新增字体 / 字号变量 | **0**（沿用既有 `text-sm` / `text-xs` / `text-lg` 刻度） |
| 新增组件 | **0**（未新建 Dialog / Field / Error 组件，全部就地补语义） |
| 破坏既有令牌作用域 | 否 —— `[data-lf-dual]` 双世界令牌未被触碰（本批文件均不含 `--lf-` 覆写） |
| 视觉回归风险 | 低：改动集中在 `aria-*`、`id`、焦点顺序与两个新增 `<p>`（帮助文本、字段错误），后者复用 `text-xs text-error` / `text-xs text-foreground-subtle` |

## 3. 设计规格与实现的对齐点（代码侧可核）

| 交互态 | 规格来源 | 实现 | 状态 |
|---|---|---|---|
| Focus State | `06_DESIGN_SYSTEM` 焦点环 | `:focus-visible` 全局环（本次未改） | 未变更 |
| Error State | 错误色 `text-error` + 边框 `border-error/20` | `#reg-*-error` 用 `text-xs text-error`；输入框靠 `aria-invalid` + 既有 class | 与既有规格一致 |
| Disabled State | `disabled:opacity-50 disabled:cursor-not-allowed` | 未改 | 未变更 |
| Loading State | `Loader2 animate-spin` | 未改 | 未变更 |
| Dialog | 圆角 `rounded-2xl` / 遮罩 `rgba(0,0,0,0.8)` | 保持原值 | 未变更 |
| Mobile Layout | 390 / 360 无溢出 | 由 `tests/e2e-ci` 既有移动端用例守住 | 见 `30` |

## 4. 缺口（连接器到位后才能做）

沿用 `19_FIGMA_CODE_TRACEABILITY.md` §3 的五步清单，本轮无新增缺口。
需要补的仍是同一件事：**Figma Node ID 列**（`07` §1 / `08` §1 表格里预留、当前为空）。

## 5. 判定

- Figma ↔ 代码的**节点级**一致性：**BLOCKED**（无连接器、无 token）；
- 设计系统的**令牌级**一致性：**PASS**（0 新增色值/组件，未分叉）；
- 结论不升级：不能因为「令牌一致」就说「Figma 交互一致性通过」——那是两件事。
