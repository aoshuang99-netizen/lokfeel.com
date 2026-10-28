# V19-08 · Console 七屏规格（方案 C 落地版）

> **状态：已复核（2026-10-23）**。结论：七屏已全部消费 `--lf-*` 令牌（硬编码色扫描 **0 违规**），组织态导航走 `console-shell.tsx`，无组织成员落 `no-org.tsx` 引导页（不暴露错误）。

## 1. 七屏清单与八元组

| 屏 | 路由 | 真实 API | 备注 |
|---|---|---|---|
| 总览 | `/console` | 组织概览端点 | 组织态首页 |
| 智能体 | `/console/agents` | `/api/v1/agents/runs`、`/agents/usage`、`/agents/runs/[id]` 裁决 | 与 workspace Agents 区同一组端点，**不重复建状态机** |
| 连接 | `/console/connections` | `/api/v1/connections/pipeline` 等 | 流水线视图 |
| 成员 | `/console/members` | `/api/v1/members` | 角色/成员管理 |
| 连接任务 | `/console/missions`（+ `/[missionId]` 详情） | `/api/v1/missions` | 详情页为第八条路由，归入本屏 |
| 成果 | `/console/outcomes` | `/api/v1/outcomes`、`/connections/proposals` | 与 Observatory 同源 |
| 设置 | `/console/settings` | `/api/v1/org` | 组织设置 |

## 2. Figma Node ID

`N/A (HTML source)`（同 `07` §2）。

## 3. 本轮核验结论（没有大改的理由）

1. **令牌合规**：`src/app/console/**` 与 `src/components/living/**` 硬编码色扫描 **0 违规** —— 七屏在 V16 已完成 token 化，方案 C 无需重做。
2. **文案**：七屏标题（智能体/连接/成员/连接任务/成果/设置）与术语表一致，未混用 Workspace/Mission 词汇。
3. **触控**：窄视口 44px 由全局规则（`globals.css` `@media (max-width:1023px)`）覆盖，逐屏不重复实现。

## 4. 唯一的遗留违规（本轮裁决：不修）

`src/components/dashboard/analytics-report.tsx` 有 3 处 `bg-[#111111] border-white/5`（legacy B2C 仪表盘线）：

- 它**不在** Workspace/Console 13 屏范围内（legacy 线按任务书只做一致性与可用性修复）；
- dashboard 页面未启用 `[data-lf-theme]` 作用域，`--lf-*` 在该上下文回退到 `:root` 的 Deep Field 值 —— 直接替换成 `bg-lf-surface` 会把浅色仪表盘的卡片**意外变成深色**；
- 修法属于"把 dashboard 纳入令牌作用域"的独立小任务，登记进 backlog，不夹带在本轮。

## 5. Toast / Table 结论（对任务书 §7 的回答）

- **Toast**：workspace 与 console **没有任何 toast 调用点**（全仓 toast 只存在于 admin 线 `components/admin/toast-provider.tsx` 与 legacy chat 线）。任务书"Toast 统一"在 13 屏范围内是**零工作量** —— 无需引入组件，也就不会新增抽象。
- **Table**：console 七屏各自的列表已消费 `--lf-*` 边框/文字工具类，触控由全局规则兜底。无需再建统一 Table 组件（`06` §4 同一结论）。
