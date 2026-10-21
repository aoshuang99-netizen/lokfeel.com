# 05 · 监控与告警（WB17-05）

**任务包**：WB17-05 · P0-05 前哨
**执行日期**：2026-10-21
**基线**：HEAD `82412b1`
**判定**：**存活监控 PASS / 业务指标 BLOCKED / 错误追踪 BLOCKED / SLO BLOCKED**

| 能力 | 判定 | 现状 |
|---|---|---|
| 存活监控（站点是否活着） | **PASS** | 本轮新建：`scripts/qa/uptime-probe.mjs`（自证 12/12）+ `.github/workflows/uptime.yml`（每 20 分钟） |
| 探针本身是否可信 | **PASS** | 自证含 9 条变异（503 / 慢库 / 状态错 / Redis 降级 / 支付矛盾 / 非 JSON / 空白页 / 越权 200 / 挂死）+ 1 条负数对照 |
| 健康数据新鲜度 | **PASS** | 已有 `verify:health:live`（发布前门禁），本轮探针复用其结论并加 cache-buster |
| 业务指标（注册/付费/失败率） | **BLOCKED** | 无指标存储、无看板；`cache.hitRate` 是**假指标**（见 §4） |
| 错误追踪（异常聚合） | **BLOCKED** | Sentry 代码在，但无 DSN 确认、**无脱敏钩子**（`beforeSend` 缺失），且删除请求不会清它 |
| SLO / 错误预算 | **BLOCKED** | 无流量基线（当前无真实用户），任何 SLO 数字都是编的 |
| 有人被叫醒（on-call） | **N/A** | 1 人项目，无 on-call。告警是**异步邮件**，不是分页 |

> 这张表的重点是：**"站点挂了能发现"已经解决了；"业务在恶化能发现"完全没解决。**
> 后者需要真实用户与真实流量，现在做只能是假数据，所以记 BLOCKED 而不是硬凑。

---

## 1. 现状盘点（有什么 / 没什么）

| 面 | 现状 | 位置 |
|---|---|---|
| 健康端点 | 有，返回 `status` / `dbLatency` / `cache` / `redis` / `payments` / bot 策略 | `src/app/api/health/route.ts` |
| 健康端点新鲜度 | **有门禁**（连续两次必须 `timestamp` 不同） | `scripts/qa/verify-health-live.mjs`（`verify:health:live`） |
| 支付通道状态 | **有**，自报 `configured/charging/missing` | health 的 `payments` 字段 |
| Redis 状态 | **有**，`backend/configured/degraded/degradedForMs` | health 的 `redis` 字段 |
| 定时任务 | 有 10 个 `/api/cron/*`，由 GitHub Actions `scheduler.yml` **手动触发**（schedule 被注释掉） | `.github/workflows/scheduler.yml` |
| 存活监控 | **本轮新建** | `scripts/qa/uptime-probe.mjs` + `.github/workflows/uptime.yml` |
| 错误聚合 | 代码级接入 Sentry（含 `next.config.ts`），**DSN 是否存在未确认** | `sentry.server.config.ts` / `sentry.edge.config.ts` |
| 业务指标看板 | **无** | — |
| 请求日志检索 | Netlify Functions 日志（保留期需按计划确认） | 平台侧 |
| 告警收件人 | 仓库 owner 的 GitHub 通知邮箱 | GitHub |

**没有的东西也要点名**：没有 APM、没有分布式追踪、没有指标库（Prometheus/VictoriaMetrics 之类）、没有日志聚合（Loki/ELK）、没有值班表。

---

## 2. 实测数字（2026-10-21，真打生产）

| 场景 | TTFB | `dbLatency` | 说明 |
|---|---|---|---|
| `/api/health` **冷启动** | **13.20 s** | **5053 ms** | Netlify 免费计划函数冷启动 + Turso 首连 |
| `/api/health` 暖机 #1 | 1.85 s | 282 ms | |
| `/api/health` 暖机 #2 | 2.13 s | 10 ms | |
| `/api/health` 暖机 #3 | 2.31 s | 24 ms | |
| `/api/health`（另一轮） | 3.03 s | — | 波动下限到 1.5s、上限到 3s |
| `/` 落地页 | 1.97 s | — | 53.8 KB HTML |
| `/pay.html` 店面页 | 1.26 s | — | 9 字节重定向体 `/pay.html` |
| `/workspace`（未登录） | 3.38 s | — | **307** 跳登录（正确行为） |

### 2.1 冷启动 13 秒是一个必须记住的数字

它决定了两件事：

1. **任何 10 秒超时的监控都会误报**。市面上多数免费 uptime 服务默认超时 10s。这就是为什么本轮的探针超时设为 **20s**、并带 **2 次重试**。
2. **首屏体验的真实瓶颈不在应用代码**。TTFB 里绝大部分是函数冷启动与数据库首连，不是查询本身（暖机 `dbLatency` 只有 10–24ms）。

**这条不能靠改代码解决**：要么预热（外部定时打点，本身也消耗调用额度），要么升计划（常驻实例）。属于**成本决策**，见 §8。

### 2.2 冷启动只能记 WARN，不能判红

把"冷启动慢"和"站点挂了"混进同一个红色信号，结果是**每次告警都可能是假的**，然后人就再也不看了。所以探针的判据是：

- 首次尝试 ≥ 5000ms → 记 `! 冷启动` WARN；
- 重试后仍然失败 → 才判 FAIL。

---

## 3. 已建立的告警通道（以及它的三条硬限制）

`uptime.yml` 每 **20 分钟**跑一次，检查 4 个面：

| 检查 | 路径 | 判据 | 为什么是这四条 |
|---|---|---|---|
| `health` | `/api/health` | `status=healthy`、`dbLatency ≤ 3000ms`、Redis 未降级、支付状态自洽 | 唯一能反映**数据库 / Redis / 支付接入**的汇总口 |
| `landing` | `/` | 200 且 HTML ≥ 2KB 且含 `<html>` | 落地页挂了 = 拉新断流，且**不产生任何应用错误日志** |
| `pay-surface` | `/pay.html` | 200 且含 `Pass|refund` | 客户实际下单页。它挂了 = 收不到钱，同样没有应用日志 |
| `auth-guard` | `/workspace` | **307/302** | 若返回 200 = 未登录能进（越权）；若 500 = 鉴权链路炸了 |

失败即 job 红 → GitHub 给 owner 发失败邮件。**不需要任何新凭据、不需要付费。**

### 3.1 三条限制（不藏）

1. **GitHub 的 `schedule` 是 best-effort**。高峰期可能延迟 5–15 分钟，极端情况会跳过某一轮。它适合"分钟级发现"，**不适合**作为 SLA 依据。
2. **仓库连续 60 天无提交，GitHub 会自动停用定时 workflow**（会发通知）。本项目持续发版，实际不会触发；但长期静止的仓库必须记得手动 Run。
3. **邮件是异步的，没有 on-call**。1 人项目的真实兜底是"用户投诉 + 红色记录"，而不是"5 分钟内有人被叫醒"。想要后者只能上付费分页服务（PagerDuty 之类），属成本决策。

### 3.2 为什么先跑自证

```
node scripts/qa/uptime-probe.mjs --self-test   # 12 条，含 9 条变异 + 1 条负数对照
```

一个探针最坏的失效方式不是"抓不到故障"，而是**永远绿**。自证里专门喂给它一个坏站点，逐条验证：

- 503、`dbLatency=9999`、`status=degraded`、`redis.degraded=true`、
  `configured=true 且 charging=false`、非 JSON、空白落地页、受保护页返回 200、挂死不响应
  → **必须全部判红**；
- 并且**只红该红的那一条**（喂 503 时不许把 `landing` 也带红）；
- 负数对照：**支付未接入必须只记 WARN**，不能判红 —— 否则已知缺口会淹没真故障。

这条自证跑在 workflow 的**探测之前**。没有它，恒绿的探针与"没有探针"等价。

---

## 4. `cache.hitRate` 恒为 0 —— 一个必须点名的假指标

三次实测都是：

```json
"cache": { "hits": 0, "misses": 0, "hitRate": 0 }
```

看起来像"缓存完全没用上，命中率 0%"，实际是 `getCacheStats()` 统计的是**进程内内存计数器**。在 serverless 部署下每个函数实例都是新进程，计数器刚创建就被读走 ⇒ 永远是 0/0。

**结论**：这个字段在 Netlify 部署形态下**没有意义**。它既不能用来判断缓存好坏，也不能用来告警。

**不要**基于它设阈值（那会造出一个永远触发或永远不触发的告警）。真正的缓存健康度要看 Upstash 侧（命中率、延迟、被驱逐数），当前**没有接入**，记在 §7 行动项。

`redis.degraded` 是**有意义**的（它反映熔断状态），探针用它，不用 `cache.hitRate`。

---

## 5. 故障剧本（Runbook）

告警响了之后第一步做什么。**先定性，再修** —— 不要上来就重启。

| 症状 | 先判 | 第一步 | 常见根因 |
|---|---|---|---|
| `health` FAIL，HTTP 5xx | 全站还是单路由 | 打 `/api/health` 看是否 502；再看 Netlify 部署列表最近一次发布 | 坏发布 / 函数崩溃 |
| `health` FAIL，`dbLatency` 超预算 | 数据库还是网络 | 直连 Turso 控制台看实例状态；对比 `/` 的 TTFB | Turso 限流或跨区延迟 |
| `health` FAIL，`redis.degraded=true` | 配置还是可达性 | 看 `degradedForMs`；Upstash 控制台看用量是否超额 | 免费额度用尽 / 网络 |
| `health` FAIL，`configured=true 且 charging=false` | 矛盾状态 | 查 4 个凭据是否齐全、是否写错环境（preview vs production） | 部分注入 |
| `landing` FAIL 但 `health` PASS | 应用活着但页面挂了 | 直接 curl `/` 看是不是构建产物缺页 | 部署产物不完整 |
| `pay-surface` FAIL | 店面还是 DNS | curl `https://app.lokfeel.com/pay.html`；再 curl `lokfeel.netlify.app/pay.html` | Cloudflare 规则 / 文件被覆盖 |
| `auth-guard` FAIL（200） | **安全事件** | 立刻确认是否真的未登录可进 `/workspace` | 中间件（仓库根 `proxy.ts`）失效 |
| 全部超时 | 站点还是本地网络 | 用手机流量再打一次 | 大陆网络 / Cloudflare 侧 |

**回滚优先于修复**：坏发布导致的故障，先回滚到上一个 `ready` 的部署，再在本地修。理由：用户正在受影响，而修复需要时间。

**发布后的窗口期**（约 20 分钟）内 URL 会变成部署专用域名，跳转丢 cookie —— 一律经 `src/lib/http/public-origin.ts`。这段时间内的"登录后跳回首页"不是新故障，别误判。

---

## 6. 未建立的部分（诚实清单）

| 缺什么 | 为什么现在做不了 | 解除条件 |
|---|---|---|
| 业务指标（注册数、付费转化、失败率） | 无指标存储；当前**没有真实用户**，任何基线都是编的 | 有 ≥ 20 个真实用户后，先埋点再谈 SLO |
| 错误聚合（Sentry 是否真在收） | `NEXT_PUBLIC_SENTRY_DSN` 是否存在未确认；且**无 `beforeSend` 脱敏** | 确认 DSN + 加脱敏钩子（与 WB17-04 的隐私清单联动） |
| 缓存健康度 | 需要 Upstash 侧指标，当前未接入 | 接 Upstash 指标或改用其 Web UI 人工巡检 |
| 日志检索 | Netlify Functions 日志的保留期与检索能力需按计划确认 | 确认后写进本文档，不要凭印象承诺 |
| SLO / 错误预算 | 无流量基线 | 同上，等真实流量 |
| 分页告警（有人被叫醒） | 付费服务，预算 ≈ 0 | 成本决策 |

---

## 7. 行动清单

| # | 动作 | 类型 | 状态 |
|---|---|---|---|
| 1 | 新建存活探针 + 自证 | 工程 | **已完成**（12/12） |
| 2 | 新建 `uptime.yml`（每 20 分钟 + 失败注解 + artifact） | 工程 | **已完成**，首次定时将在下一次 cron 周期生效 |
| 3 | 确认 GitHub 通知邮箱可达（告警唯一出口） | 运营 | **待做**（5 分钟，但决定告警是否真能到达） |
| 4 | 确认 `NEXT_PUBLIC_SENTRY_DSN` 是否配置 | 工程 | 待做 |
| 5 | Sentry 加 `beforeSend` 脱敏 | 工程 | 待做（与 04 的行动项 4 是同一件） |
| 6 | 确认 Netlify Functions 日志保留期，填进 §6 | 运营 | 待做 |
| 7 | 接入 Upstash 命中率（替代假的 `cache.hitRate`） | 工程 | 待做 |
| 8 | `scheduler.yml` 的 schedule 是否开启（现在靠手动触发） | 成本决策 | 待拍板（见 §8） |

---

## 8. 需要拍板的两件事

1. **要不要为"消除冷启动"付费升 Netlify 计划？**
   不升：探针已把超时放到 20s，能容忍 13s 冷启动，但**用户首屏也是 13s**（首次访问者）。
   升：常驻实例，TTFB 有望降到 1s 内。
   这是"每月几十美元"换"首屏 12 秒"的交换，不是技术问题。

2. **`scheduler.yml` 的定时要不要开？**
   现状：`schedule` 被注释，靠手动 Run。后果是 `workflow-tick` 的重试退避（30s 起、租约 60s）
   在没人手动触发时**根本不会推进** —— 也就是 T06 的 outbox 机制事实上停摆。
   三条路（手动 / cron-job.org 免费打点 / Netlify 付费计划）写在
   `docs/implementation/SCHEDULING.md`，需要选一条。
   > 严格说这不只是监控问题：它是**功能是否在工作**的问题。已记入 V17 最终验收的风险清单。
