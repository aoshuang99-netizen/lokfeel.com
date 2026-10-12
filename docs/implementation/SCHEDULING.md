# 调度粒度（R8）—— 小时级 → 分钟级

> **状态**：🟡 **路径已就绪，未启用**。三条路都验证过可行性；选哪条是**成本决策**，需要拍板。
> 未启用**不影响正确性** —— 见 §1。

## 1. 为什么"慢"不是正确性问题

`T06/risks.md` R8 记的原始风险是"免费计划只保证小时级 cron，退避 30s 起步的设计意义变小"。

但引擎的正确性**不依赖调度频率**：

- 幂等键 `(organizationId, dedupeKey)` → 晚跑不会重复介绍；
- 租约 `lockedUntil`（60s）+ CAS 领取 → 并发/崩溃不会重复执行；
- 终态（SUCCEEDED / FAILED / DEAD / TAKEN_OVER / CANCELLED）**永不被自动复活**；
- `runWorkflowTick` 自带 **8s 时间预算**主动收手，避免被平台硬杀（那会既无报告也无收尾）。

⇒ **晚一点跑只是慢一点**。要提升的只是"重试的实际延迟"与"对账补漏的及时性"。

当前**小时级**这一条本身是 Netlify 免费计划的硬约束：
`netlify/functions/cron-runner.ts` 按 `netlify.toml` 的 schedule 触发，依次打
`/api/cron/workflow-tick` 与 `/api/cron/lifecycle-sweep`。**它继续保留** ——
分钟级调度是**叠加**，不是替换。

---

## 2. 三条路（选一条）

| # | 方案 | 粒度 | 成本 | 需要什么 |
|---|---|---|---|---|
| ① | **GitHub Actions**（`.github/workflows/scheduler.yml`，已就绪） | `*/10` 或 `*/5` | 公开仓库**免费**；私有仓库按分钟计（`*/10` ≈ 1300 分/月，`*/5` ≈ 2600 分/月**会超**） | 仓库 Secrets 配 `CRON_SECRET`；取消 workflow 里 `schedule` 的注释 |
| ② | **cron-job.org**（推荐，零 CI 额度） | 1–5 分钟 | 免费 | 注册 → 建一个 job → URL 见 §3 → 加 `Authorization: Bearer <CRON_SECRET>` 头 |
| ③ | **Netlify 付费计划** | 平台支持更高频 | 付费 | 升级计划后改 `netlify.toml` 的 schedule |

> 为什么把 ① 默认关掉：`*/10` 在私有仓库上 ≈ 1300 分钟/月（占免费额度 2000 的 2/3），
> `*/5` 直接超。是否用掉这部分额度是**成本决策**，代码不该替你决定。

---

## 3. 端点（任何调度器都打这两个）

```
POST /api/cron/workflow-tick?limit=20      # 领取 → 执行 → 收尾 → 对账 → 运营告警
POST /api/cron/lifecycle-sweep             # AC-10 保留期清理（保留期以天计，可低频）
Authorization: Bearer $CRON_SECRET
```

- 两两可单独关：`/api/cron/workflow-tick?reconcile=0&alerts=0`（排障用）；
- `/api/cron/lifecycle-sweep?dry=1` 只统计不删；
- 守卫与其余内部 cron 端点一致：`CRON_SECRET` 不匹配 → `401`。

---

## 4. 启用步骤

### 方案 ①（GitHub Actions）

```bash
# 1) 仓库 Settings → Secrets and variables → Actions → New repository secret
#    CRON_SECRET = <与 Netlify 站点级变量同值>
# 2) 若要固定基础域名（默认 https://app.lokfeel.com），加一个 Variable：
#    CRON_BASE_URL
# 3) 打开 .github/workflows/scheduler.yml，取消这两行注释：
#      schedule:
#        - cron: '*/10 * * * *'
# 4) 先手动跑一次验证：Actions → Sub-hour workflow scheduler → Run workflow
```

未配置 `CRON_SECRET` 时该 workflow 会**优雅跳过**（`exit 0`，不刷红）。

### 方案 ②（cron-job.org）

1. 注册 / 登录 → **Create cronjob**；
2. URL：`https://app.lokfeel.com/api/cron/workflow-tick?limit=20`，Method：**POST**；
3. **Advanced → Headers** 加 `Authorization: Bearer <CRON_SECRET>`；
4. 频率选 5 或 10 分钟；先点 **TEST RUN** 确认返回 `200`。

---

## 5. 怎么确认它真的生效

```bash
# 手动打一次，看 tick 报告而不是只看 HTTP 200
curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" \
  "https://app.lokfeel.com/api/cron/workflow-tick?limit=20" | head -c 400
```

判据（**不是**"返 200"）：响应体里出现结构化 `tick` 报告
（`claimed` / `executed` / `released` 等字段）—— 这一步同时证明"代码已上线"与
"运行时读得到 C3 表"。`scripts/qa/verify-t06-prod.mjs` 已把这条做成了可复跑断言
（25/25，含带真实 `CRON_SECRET` 的实跑）。

---

## 6. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-10-12 | 新增 `.github/workflows/scheduler.yml`（dispatch + 优雅跳过；schedule 默认注释）+ 本文档。**未启用**任何分钟级定时。 |
