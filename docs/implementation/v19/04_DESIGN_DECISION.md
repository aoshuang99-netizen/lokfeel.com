# V19-04 · 设计决策（DESIGN_DECISION_GATE）· 待人工选型

> **状态：BLOCKED（等待人工选型）。** 在你选定方案之前，正式前端不做任何大规模视觉改动。

## 1. 请你决策的一件事

| 选项 | 方案 | 工程侧意见 |
|---|---|---|
| A | Living Intelligence（深色沉浸） | 可行但成本高，且与实测的主线程瓶颈冲突 |
| B | Precision Workspace（浅色企业级） | 可行，最省性能，辨识度弱 |
| **C（工程推荐）** | **Adaptive Dual World（继承 V16 双世界，随阶段切换）** | 成本中低、直接继承无障碍与性能资产，阶段感即产品逻辑 |

## 2. 评审入口

- 在线预览：（部署后由 WorkBuddy 会话提供链接；也可本地打开 `design/v19/index.html`）
- 本地文件：`design/v19/index.html`（对比 + 成本矩阵）→ 三案原型各自可点、可切 1440/390。

## 3. 选型通过后的第一轮实现顺序（供预期，未批不动）

1. 把选定案的令牌映射进 `src/app/globals.css` 的既有令牌作用域（C 案 = 扩展 `dualWorld`，**不另起体系**）；
2. `/workspace` 阶段条接入"阶段→世界"映射；
3. Copy Deck 落地公开面（`/`、`/login`、`/pricing`）；
4. 每屏保留 `Figma Node ID / Route / Component / API / Commit / Screenshot / E2E / Acceptance` 八元组（Figma 能力补齐前 Node ID 记 `N/A (HTML source)`）。

## 4. 决策记录

| 日期 | 决策 | 人 |
|---|---|---|
| 2026-10-23 | 三案提交，等待选型 | — |
