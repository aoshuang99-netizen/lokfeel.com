# 00 · V16 仓库审计与资产盘点（T00）

> 分支 `feat/lokfeel-v16-os-ux`（自 `9ba9075` 切出）· 2026-10-21
> 本文是 T00 交付的合并版：仓库审计 + 路由清单 + 组件复用要点 + 风险登记。
> 逐屏交互审计在 `04_UX_AUDIT_13_SCREENS.md`；品牌扫描门禁见 §4。

## 1. 仓库状态

- 基线：`9ba9075`（= 生产产物，远端 main 一致）
- 工作分支：`feat/lokfeel-v16-os-ux`
- 未跟踪的历史遗留：`deploy/selfhost/test-tunnel.sh`、`tunnel-once.sh` 有旧改动（非本轮产生，未触碰）

## 2. 规模（实测）

| 项 | 数 |
|---|---|
| App Router 页面 | 78 |
| API 路由 | 200 |
| Prisma 模型 / 枚举 | 62 / 61 |
| 测试文件 | 103 |
| 公开路由（`(public)` 组） | 18 页 + layout |

## 3. 13 屏的真实接线（审计确认）

- `/workspace` 六屏 = `living-workspace.tsx`（838 行）内的组件级视图，Dock 切换，URL 不变；
  数据全部来自真实端点（`/api/notifications`、`/api/matches`、`/api/v1/org`、
  `/api/v1/connections/proposals`、`/api/v1/workflow/jobs`、`/api/v1/outcomes`），
  由 `check:ui-invariants` 门禁把守「无假数据、三态齐全、未接线即禁用」。实测成立。
- `/console` 七屏 = 7 个独立路由（home/missions/connections/agents/members/outcomes/settings），
  组织态 fail-closed（需 ACTIVE 成员）。
- WorkspaceSpec 链路：`src/lib/workspace-spec/`（zod strictObject）+ `assemble.ts` 纯函数装配。

## 4. 本轮新增的工程资产

| 资产 | 作用 |
|---|---|
| `src/config/brand.ts` | 品牌/定位文案与禁词表的**唯一来源** |
| `src/lib/admin/subscription-view.ts` | 订阅 API→视图行归一化（修白屏） |
| `src/lib/admin/feature-flags.ts` | 功能开关归一化 + hydration 安全时间格式 |
| `scripts/qa/verify-brand-scan.mjs` | 公开路由禁词门禁（含 --self-test） |
| `scripts/qa/v16-ux-audit.mjs` | 13 屏真实交互审计采集器 |
| `scripts/qa/v16-unit-runner.mts` | 本地单测运行器（node_modules 半装时的 jest 兼容层） |
| `tests/admin/*.test.ts` | T01 回归（27 例） |

## 5. 风险登记（RISK REGISTER）

| 编号 | 等级 | 风险 | 现状 / 缓解 |
|---|---|---|---|
| R-01 | P1 | CSP 阻断 CF beacon（F-01） | 每页 1 条 console error；待二选一修复 |
| R-02 | P1 | 功能开关存于 API 进程内存，重启丢失 | 页面已显式告知；建议建 FeatureFlag 表（需迁移窗口） |
| R-03 | P1 | 11 表无 organizationId（跨租户路径待逐一分类） | 应用层隔离 + 负向测试兜底；建模需迁移窗口，`db push` 会删列 |
| R-04 | P2 | `LokFeel Inc.` 法律实体名未经核实 | 法律页已统一写法，需法务复核 |
| R-05 | P2 | 本地依赖半装 → jest/tsc 无法全量本地跑 | 用 v16-unit-runner + 托管区 tsc 覆盖新增代码；全量验证在 CI |
| R-06 | P3 | `.mut-run.log` 等临时文件在仓库根 | 已列 .gitignore 候选；提交前清理 |

## 6. 路由清单与组件复用

- 全量页面/API 清单以 `npm run ui:gallery` 与 `docs/implementation/FEATURE_INVENTORY.md` 为准
  （v2，78 页 / 200 API），本文不重复维护第二份清单，避免漂移。
- 组件复用矩阵（T04 落地时用）：
  - 可直接复用：`glass-card`、`btn-primary/ghost`、Evidence Lens 数据源装配（`tenantSource`）、
    `Loadable` 三态渲染器、`lucide-react` 图标体系
  - 三套原型中对应：A（星群=新 Canvas 层，其余复用）、B（纸张排版=新皮肤，组件结构不变）、
    C（Inspector=改造 Evidence Lens；Canvas=新组件，按屏接入）
