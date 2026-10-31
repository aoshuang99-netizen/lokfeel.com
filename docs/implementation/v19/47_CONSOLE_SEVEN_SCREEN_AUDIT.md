# 47 · Console 七屏深度审计（V19-84 · Batch 5）

- 日期：2026-10-31
- HEAD：`f0e53de` → 本批新增探针未改产品代码
- 探针：`scripts/qa/v198-console-deep-audit.mjs`（三视角 × 七屏 × 双视口 + 失败态注入 + 键盘 + axe）
- 结果：**49 PASS / 0 FAIL**（复跑一次确认；截图 55 张 `/tmp/v198-console/`，明细 `audit-results.json`）
- 环境：本地生产构建 @ localhost:3000 + `file:/tmp/v196-e2e.db`

## 0. 与 Batch 2（44 号文档）的关系

Batch 2 证明「入口能加载、有标题与 CTA」（浅层 IA，8 屏 × 2 视口）。
本轮在其之上做**深度功能审计**：每屏取证真实 API（方法+状态码）、数据来源、权限边界（三视角）、
空态、加载态、**失败态（真实网络拦截）**、CTA 可用性（含诚实禁用）、键盘可达、axe（wcag2a+2aa）。

## 1. 审计矩阵

视角：
- **owner-data**：`v198.owner`（v198_org，Batch 4 探针灌入的真实数据）
- **empty-owner**：`v198b4.out`（v198b4_o2，零数据组织 → 真实空态）
- **member**：`v198b4.peer`（v198_org 内 MEMBER → 真实权限边界）

每格 = 3 视角 × 7 屏 × 2 视口（390×844 / 1440×900）= 42 格 + 失败态 7 格 = 49 项断言。

## 2. 逐屏深审表（390 实测；1440 双跑一致）

| 屏 | 真实 API（探针捕获） | 空组织（empty-owner） | 失败态（网络拦截） | 权限（member） | CTA | 键盘 | axe |
|---|---|---|---|---|---|---|---|
| `/console` 总览 | workflow/overview + missions | 指标 0 + 诚实空态 | ⚠️「暂时读不到队列状态」+ **重新加载**按钮 | 「权限不足…这不是错误，而是权限边界」+ 重新加载 | 链接型 CTA ✅ | ✅ | 0 |
| `/console/agents` | agents/runs + usage | 「本社群还没有 Agent 运行」 | 「读不到」诚实反馈 | 全功能（能力内） | 刷新+筛选 ✅ | ✅ | 0 |
| `/console/connections` | connections/pipeline（3 次） | 计数徽标真实为 0 | 「读不到」 | ✅ | 刷新+阶段筛选 ✅ | ✅ | 0 |
| `/console/members` | members + 相关（3 次） | 空态 | 「读不到」+「尚未实现」标注可见 | ✅ | 刷新+角色筛选 ✅ | ✅ | 0 |
| `/console/missions` | missions（含详情路由） | 空态 | 「读不到」 | ✅ | 刷新+状态筛选 ✅ | ✅ | 0 |
| `/console/outcomes` | outcomes + connections/proposals | 自报/已验证区分明确 | 「还没有…」+「读不到」 | ✅ | 刷新+验证筛选 ✅ | ✅ | 0 |
| `/console/settings` | org（读写） | 表单空态 | ⚠️「读不到社群档案」 | 角色相关 | 保存（无改动禁用） | ✅ | 0 |

**axe（wcag2a+wcag2aa）**：49 格全部 **0 违规**（含 owner/member/empty 三视角与双视口）。
Console 七屏不在 V19.6 的 24 格基线内 —— 本轮是它們的首次 axe 取证，直接零违规。

## 3. 失败态取证（真实网络失败，非 mock 数据）

用 Playwright 路由拦截各屏主 API（`route.abort('failed')`），7/7 屏全部给出**诚实错误反馈**：

- 总览：⚠️「暂时读不到队列状态 / Service unavailable」+ **重新加载**按钮（唯一带重试入口的屏）；
- 设置：「读不到社群档案」；
- 其余五屏：「读不到」类反馈，页面保持结构（h1 + 导航）不白屏、不渲染假数据。

截图证据：`/tmp/v198-console/fail-owner-data-{overview,agents,…}-m390.png`。

## 4. 权限边界取证（member 视角）

- `/console` 对 MEMBER 渲染**权限矩阵**：总览/任务/成员/连接/智能体逐项标注「无权限」，
  成果/设置按能力放行 —— 权限边界**逐屏可见**，而非一刀切 403；
- 总览的权限视图给出「权限不足…这不是错误，而是权限边界」的解释性文案 + 重新加载。

## 5. 发现的问题清单（本轮新增）

| # | 级 | 屏 | 问题 | 建议 |
|---|---|---|---|---|
| D-1 | P2 | `/console`（member 权限视图） | 权限矩阵视图缺 `<h1>`（常规视图有「社群总览」） | 权限视图补 `sr-only` h1 |
| D-2 | P2 | `/console/settings` 失败态 | 错误态无 h1（与 D-1 同根：错误分支不渲染标题） | 错误分支补 sr-only h1 |
| D-3 | P3 | `/console` 失败态 | 仅总览有「重新加载」按钮，其余六屏错误态无重试入口（需手动刷新） | 统一错误组件带重试 |

以上均为 P2/P3，不阻断发布候选（P0/P1 = 0）。诚实禁用/未实现标注（Batch 2 的三处实证）在本轮复验仍然成立。

## 6. 复跑方式

```bash
PW_CHANNEL=chrome node scripts/qa/v198-console-deep-audit.mjs            # 全矩阵
PW_CHANNEL=chrome node scripts/qa/v198-console-deep-audit.mjs --shot-dir=/tmp/x  # 指定截图目录
```

退出码 0=无 FAIL / 1=有 FAIL。单元格内置一次重试以消除限流/竞速采样抖动；重试仍败才判 FAIL。
