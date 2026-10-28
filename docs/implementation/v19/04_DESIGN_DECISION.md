# V19-04 · 设计决策（DESIGN_DECISION_GATE）

> **状态：APPROVED（2026-10-23）。** 选定 **方案 C · Adaptive Dual World**。正式前端的大规模视觉改动自此解锁，但**仍然只在 `v19/design-exploration` 分支进行**，合入 `main` 属于发布动作，另行审批。

## 1. 决策结果

| 选项 | 方案 | 结果 |
|---|---|---|
| A | Living Intelligence（深色沉浸） | 未选用 |
| B | Precision Workspace（浅色企业级） | 未选用 |
| **C（工程推荐）** | **Adaptive Dual World（继承 V16 双世界，随阶段切换）** | **✅ 选定** |

- **决策人**：用户（Frank），会话指令「c 开始做！」，2026-10-23 20:28 (GMT+8)。
- **评审依据**：`design/v19/index.html` 在线评审站（三案可交互原型 + 成本矩阵）+ `03_DESIGN_CONCEPTS.md` §2。

## 2. 本决策解锁 / 不解锁的事

**解锁**：
1. Design System 以 C 案为基准定稿（`06_DESIGN_SYSTEM.md`）；
2. Copy Deck 按 C 案语境落地公开面与 `/workspace`（`05_BRAND_COPY_DECK.md` §5 处置表）；
3. 第三轮 Workspace 六屏 / Console 七屏实现可以开始（仍在 v19 分支）。

**不解锁**：
- 合入 `main` / 生产部署（`D-10` 与 V19 合并是两个独立审批）；
- 支付、Consent、租户隔离相关的任何行为改动（V19 只动表现层与文案）。

## 3. 选型后的实现顺序

1. ✅ 令牌映射：C 案令牌与 `src/app/globals.css` 既有 `--lf-*` 体系**逐一对照**（`06` §2/§3；发现原型 21 个自由色，已裁决归一到既有体系）；
2. ✅ `/workspace` 阶段条"阶段→世界"映射复核（`07` §3：代码方案 = 阶段聚焦视图 + 双世界并置恒定，裁决保留；整树翻转不采纳）；
3. ✅ Copy Deck 落地（`05` §5 处置表全表闭环：1 改 / 其余保留且给出组件级证据）；
4. ⬜ 每屏八元组：`07`/`08` 已建表，Figma Node ID 暂记 `N/A (HTML source)`（连接器补齐后回填）。

## 4. 决策记录

| 日期 | 决策 | 人 |
|---|---|---|
| 2026-10-23 | 三案提交，等待选型 | — |
| 2026-10-23 | **选定方案 C（Adaptive Dual World）** | 用户（Frank） |
