# R6 执行台账（T2 / T7 / T8）与门禁变化

> 2026-11-13 · 未发布、未改生产配置、未发生扣款
> 所有数字都能在 `docs/release/lokfeel-v20.7-ga/evidence/` 里找到对应 JSON/日志。

## 1. 三个任务的结果

| 任务 | 结果 | 判据与证据 |
|---|---|---|
| **T2 公开面四视口 + 无障碍** | **PASS** | 4 视口 × 8 路由 = 32/32 单元格；axe 4.13.0 的 serious/critical **0**；横向溢出 0；焦点可见性 32/32。`evidence/t2-viewports-axe-final.json` |
| **T2 全链路封存** | **PASS** | 12 路由 × 三条通道（HTML 可见文本 / RSC flight / metadata）+ sitemap + 缓存头；未批准金额 0、未核实法人 0、冻结页 noindex 5/5、sitemap 不列冻结页、`s-maxage=0`。`evidence/t2-fullchain.json` |
| **T7 性能归因与首屏瘦身** | **代码层 DONE；TBT 判定 `NOT_CERTIFIABLE_ON_THIS_HOST`** | 首屏 JS −31%（196→135KB，冻结页）；长任务 22→4（`/product`）；但本机框架地板 212ms > 200ms，且同一构建 1 小时内自漂 3.4×。详见 `14_T7_PERFORMANCE.md` |
| **T8 健康检查 / DB 基线** | **PASS（10/10）** | 干净 sqlite 库 → `db push` + 两批迁移 → 真构建产物 → health 200/healthy/dbLatency 有限 ×3 次；**负向对照**：库不可用时 503 + `unhealthy`（不谎报）。`evidence/t8-db-health.json` |

## 2. 本轮修掉的真缺陷（都不是"调阈值"）

| # | 缺陷 | 怎么发现的 | 怎么修 |
|---|---|---|---|
| 1 | Sentry 浏览器 SDK（含 Replay）被静态引入每个页面首屏，而**没有配 DSN** | Trace 归因：`EvaluateScript 1484ms @396KB chunk`；chunk 内含 `browserTracingIntegration` | 改为「有 DSN 才动态导入」；`withSentryConfig` 条件挂载 |
| 2 | `SessionProvider` 挂在根布局，营销页白下载 next-auth/react 并多打一次 `/api/auth/session` | `useSession` 全仓只出现在 dashboard/workspace | 下放到 4 棵子树（含新增 `dashboard/layout.tsx`） |
| 3 | 页脚/头部链接高度 16px（<24px） | 四视口审计：每页 15–20 个 | `min-h-6` + `inline-flex` |
| 4 | 轨道标签淡出到 0.35 时对比度 3.0–4.06 | axe `color-contrast` 3 个节点 | 淡出下限 0.7 |
| 5 | 冻结页 `s-maxage=31536000`（一年） | 全链路审计的缓存通道 | 冻结页 `s-maxage=0` + `X-Robots-Tag` |
| 6 | T8 的"本地复现不了 CI 的库" | 上一轮 E2E ① 恒红 | 新增 `r6-db-health-e2e.mjs`（含负向对照） |
| 7 | 采集脚本：全部轮次失败时 `cls.toFixed()` 抛错，整份报告崩 | 用它测空白页时自爆 | 补齐字段 + 打印兜底 |

## 3. 13 项门禁：**5/13**（只上调有证据的那一项）

| 门禁 | 上轮 | 本轮 | 变化依据 |
|---|---|---|---|
| G0 / G1 / G6 | PASS | PASS | 未变 |
| G4 a11y | PASS | **PASS（证据加强）** | 从"单矩阵"升级为 4 视口 × 8 路由 + axe |
| G2 pages-legal | PARTIAL | PARTIAL | 封存已全链路一致，但 **D8 主体未批**、C-31 三条仍 NOT_TESTED |
| G8 security | PARTIAL | PARTIAL | 远端 `Secret scan (gitleaks)` / `Dependency audit` / `租户作用域审计` 均 **success**；仍差"部署产物复扫"（按门禁文本留到 G13） |
| G9 infra | PARTIAL | PARTIAL | D6 范围未定 |
| G10 perf | PARTIAL | PARTIAL | TBT 未达标且**本机不可判定**（见 §4） |
| G11 same-rc-gates | PARTIAL | **PASS** | 同一 SHA `d4f9e8f` 上远端 CI **13 成功 / 0 失败 / 2 跳过**（含 E2E 冒烟、gitleaks、租户审计、build、jest、tsc、lint 棘轮）；`evidence/g11-remote-ci.json` |
| G3 / G12 | BLOCKED | BLOCKED | Figma 写权限、D1 定价批准 |
| G5 | NOT_TESTED | NOT_TESTED | 真人不可替代 |
| G7 | PASS_CODE_ONLY | PASS_CODE_ONLY | 不计入 PASS（口径未变） |
| G13 | N/A | N/A | 未发布 |

> **一句实话**：门禁从 4/13 到 5/13，只涨了一项（G11），因为只有这一项在本轮拿到了**新的、可复核的**证据。其余六项修掉的缺陷（Sentry 死代码、provider 下放、24px、对比度、缓存头、T8 库基线）都不对应"门禁转绿"——它们对应的是"不该红的地方不再红"。**用"修了多少 bug"衡量进度，正是这次要避免的**。

## 4. T7 的结论为什么必须这么写

- 本机（`m3-7Y32 @1.10GHz` + 4× 降速）上，**零客户端组件的服务端页** `/holding` 中位 TBT = **212ms**；
- 零 JS 静态页 = **12ms**（仪器正常）；
- 同一份构建，07:5x 中位 271ms、08:2x 中位 920ms（**1 小时内自漂 3.4×**，热降频）。

在"地板 212ms > 阈值 200ms"的仪器上，继续调代码不可能得到可信的 PASS。要么换测量环境（CI 或桌面机），要么改合同——**改合同需要你签字，我不动**。

## 5. 唯一剩余的技术阻塞（其余都需要人或凭据）

| 阻塞 | 归属 | 需要什么 |
|---|---|---|
| TBT 无法在本机判定 | 我 + 你选方案 | 选 CI 测量 / 换机 / 改合同（见 `14_T7_PERFORMANCE.md` §5） |
| ~~远端 CI 全绿~~ | 已闭合 | `rc/v20.7-ga` @ `d4f9e8f` → 13/0/2；上一轮 `total_count=0` 的真因是 `ci.yml` 的 `push.branches=[main,'rc/**']`，`release/**` 不在名单 |
| Preview **运行时** | 你（CF 环境配置） | 部署 job `success`，但 `lokfeel-preview.aoshuang99.workers.dev` 探到 502 后拒连 ⇒ 缺 preview 的绑定/密钥；构建成功 ≠ 运行可用 |
| T3 OWNER→503 | 你 | 一个生产/Preview 的 QA OWNER 会话 |
| T4 Dodo test_mode | 你 / Dodo 后台 | test_mode key + 商户事件订阅清单 |
| G3 / G5 / G12 / D8 | 你 | Figma 写权限、真人、定价批准、法人信息 |
| 发布治理 | 你（管理员） | 仓库 ruleset + 关闭 Netlify 自动发布 |
