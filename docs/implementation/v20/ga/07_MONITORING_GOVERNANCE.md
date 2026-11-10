# 07 · 监控 + 发布治理（Batch 6）

- 日期：2026-11-10
- 生产基线实测：**11 PASS / 0 FAIL / 0 BLOCKED**（`evidence/2026-11-10_monitor_prod.log`）

## 1. 监控分层（零预算约束下的务实解）

| 层 | 机制 | 频率 | 覆盖 | 告警通道 |
| --- | --- | --- | --- | --- |
| L1 存活 | `.github/workflows/uptime.yml` | 每 20 分钟（cron） | 生产可达 + 4 项基础检查 | GitHub 失败邮件（job 红） |
| L2 深度 | `scripts/qa/v205-monitor.mjs`（`npm run monitor:ga`） | 按需 + 发布后 15 步内 | **十项信号**（§2） | 退出码=FAIL 数；红记录可查 |
| L3 门禁 | 发布前后各跑一遍（Batch 7 GO 证据之一） | 每次发布 | 同 L2 + `--expect-commit` 核对 | GO/NO-GO 判据 |

L2 不进 cron 的原因：它需要 `TURSO_AUTH_TOKEN` 与 QA 口令文件作为 secrets 注入 CI——把 DB 令牌放进 CI 环境的攻击面大于收益。发布后人工跑 + uptime 兜底的组合足够「1 人项目」的故障发现粒度（uptime 中位发现延迟 ~10 分钟）。

## 2. 十项信号与首跑实测（2026-11-10 · 生产 `3e27f3c`）

| # | 信号 | 数据源 | 实测 |
| --- | --- | --- | --- |
| M01 | 5xx 比例 | 公开 4 + 登录态 3 端点电池 | **PASS** 0/7 个 5xx |
| M02 | 延迟 p50/p95 | 12 采样（/、health×3、console×3） | **PASS** p50=457ms p95=851ms（含跨境 RTT ~250ms，基线记录） |
| M03 | 登录成功 | 真实 QA 登录 + session 回读 | **PASS** login 3890ms（跨境网络） session=200 |
| M04 | Agent 成功/失败 | `TenantAuditEvent` 7 天 `agent.run.*` 分布 | **PASS** created=8 executed=3 blocked=0 degraded=0 |
| M05 | Provider 降级 | `agent.run.degraded` 计数 + 生产出口自检端点 | **PASS** degraded=0 · 出口=PASS 894ms · 身份=PASS |
| M06 | Consent 异常 | `member.opted_*` 必须有 actor（"没人点头的同意"）+ `bridge.optin_rejected` | **PASS** 窗口内无 opted_* 事件、无 actor 缺失 |
| M07 | Outcome 核验 | `outcome.*` 分布 + workflow 死信计数 | **PASS**（窗口内 0 事件 0 死信；写路径失败信号由 Batch 4 的 P01–P15 断言覆盖，监控不重复造假断言） |
| M08 | DB 错误 | `/api/health` × 3 采样 | **PASS** healthy 3/3 dbLatency 5–6ms（热连接） |
| M09 | Secrets | health.payments | **PASS** charging=false（GA 关支付）· malformed=0 · missing=4（**已知人工项 H-4**，非本轮新增） |
| M10 | 部署漂移 | Netlify `published_deploy.commit_ref`（**唯一权威**） | **PASS** deployed=3e27f3c == health.commit |
| G06 | Workers 轨道不变量 | `x-nf-request-id` 存在 | **PASS** Netlify 源在役（Worker 未劫持流量） |

M04 的「created=8 executed=3」非异常：8 次 created 是本周 QA 复验播种的运行，其中 3 次完整执行、其余为断言中途清理（`--keep` 未留）。

## 3. 事实修正：生产基线是 `3e27f3c`，不是 `bc46a22`

台账原记载「线上 = bc46a22」。本次用 Netlify API 实核：`published_deploy.commit_ref = 3e27f3c`，`/api/health` 同报 `3e27f3c`（builtAt 2026-11-07T11:32Z）——B0–B2 的成果已随 11-07 的 main 推送上线。

**GA 的回滚点因此是 `3e27f3c`**（回到它 = 回到含 B0–B2 的已知良好版）。Batch 8 发布后回滚点更新为 `1a54de3`。

## 4. Workers 独立验证轨道（未切流，仍不切）

- **结论维持**：生产流量 = Cloudflare Proxy → Netlify 源（G06 每次监控实核）。Cloudflare Worker `lokfeel-app` 动态路由全 500、零绑定（V20.4 已实测定性），**GA 不切 Workers**。
- 已有治理护栏（V20.2 P0-02，复核有效）：`.github/workflows/cloudflare-production.yml` 仅接受显式 `workflow_dispatch` + `confirm=DEPLOY` + 受保护 Environment 审批；push/main 不会触发它。
- 切流的先决条件（留给独立轨道，不在 GA 内）：Worker 通过 `prod-smoke` 全量 + 13 屏视觉 + 十项监控双跑对比，且经用户批准。

## 5. 发布治理（Batch 8 将执行的规则，此处定死）

1. **单一发布通道**：main 分支推送 → Netlify 构建。非发布推送必须带 `[skip netlify]`（Netlify 只看头提交）；本批次 b5 推送即如此（`1a54de3`，生产未动）。
2. **先迁移后发版**：本 GA 周期无 prisma 变更 ⇒ 无迁移；若发版前出现 schema 变更，迁移先行并复验。
3. **GO 证据链**（Batch 7 逐项核）：CI 绿（`1a54de3` CI 运行中，CodeQL 已绿）、P0=0、阻塞性 P1=0、管理员口令风险已消除（B0）、核心登录/业务 E2E、Outcome 核验、Preview==RC SHA、回滚点=`3e27f3c`、支付关闭（M09）。
4. **发布后**：15 步验证（Batch 8 文档），其中包含本监控脚本 `--expect-commit=<发布 SHA>` 复跑。
5. **禁止事项**（纪律十条内化）：不改阈值伪达标、不删断言求绿、不经批准切运行时、不伪造 Figma/凭据证据。

## 6. 复验命令

```bash
npm run monitor:ga                          # 十项信号（默认对生产）
npm run monitor:ga -- --expect-commit=<SHA> # 发布后核对
npm run monitor:ga -- --base=http://localhost:3111 --window=1
```
