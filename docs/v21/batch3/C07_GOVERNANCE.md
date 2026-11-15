# V21 第三批 · C07 发布治理（未生效，只给可执行配置）

**状态：BLOCKED / 未生效。** 本文件不是「已完成」的证据，是**待 Owner 执行**的最小配置清单。写下它的理由：治理是仓库设置，不是代码，但它必须**可被复核**，而不是一句「已保护」。

## 1. 当前事实（用户侧独立核查 + 本地核查）

| 项 | 实测 | 来源 |
|---|---|---|
| 远端 main | `cad717e92542395e4346e49d388f09be78ec1557` | `git ls-remote origin main` |
| `main.protected` | **false** | GitHub API（Owner 侧查询） |
| 仓库规则集 | **空列表** | GitHub API（Owner 侧查询） |
| 本地 `gh` CLI | **未安装**（`gh: command not found`） | 本机实测 |
| 本地候选 `b467802` | **未推送** | `git log origin/main..HEAD` |

⇒ 当前**没有任何**「未经审核的 push 不能进 main」的机制；也没有任何 required check。
⇒ 本批**不冒充**已配置，也不试图用仓库内文件"声明"保护（`.github/` 里放什么都替代不了服务端规则）。

## 2. 现有 CI 任务（决定 required checks 名单）

`.github/workflows/ci.yml`，workflow `name: CI`，触发 `push: [main, rc/**]` + `pull_request: [main]` + `workflow_dispatch`：

```text
typecheck · lint · test · build · migration · e2e · secret-scan
dependency-audit · dco · slo-check · launch-check-selftest
payment-apply-selftest · tenancy-scoping-gate · cron-method-gate
perf-baseline   ← 仅 workflow_dispatch，不得设为 required
```

⚠️ `perf-baseline` 是**手动触发的 SLO 压测**，不是浏览器 TBT/LCP/CLS 门槛（G15）。
把它设成 required 会让 PR **永远**卡在「Expected — Waiting for status to be reported」。

## 3. 可直接提交的 ruleset 载荷（Owner 用 admin 权限执行）

`POST /repos/aoshuang99-netizen/lokfeel.com/rulesets`

```json
{
  "name": "protect-main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/main"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": true,
        "required_review_thread_resolution": true
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "CI / typecheck" },
          { "context": "CI / lint" },
          { "context": "CI / test" },
          { "context": "CI / build" },
          { "context": "CI / migration" },
          { "context": "CI / e2e" },
          { "context": "CI / secret-scan" },
          { "context": "CI / dependency-audit" },
          { "context": "CI / dco" },
          { "context": "CI / tenancy-scoping-gate" },
          { "context": "CI / cron-method-gate" }
        ]
      }
    }
  ]
}
```

> `context` 写的是 GitHub 上 check run 的实际名字（`<workflow name> / <job id>`）。
> 首次应用后必须到 PR 页面确认名字逐字一致 —— 名字错了等于没有 required check（会一直 pending，很容易被误当成「CI 挂了」）。

## 4. 还缺一个门禁：G15 没有 required check

仓库里**没有**浏览器 TBT/LCP/CLS 的 CI 门禁，只有 `perf-baseline`（SLO 压测，手动）。
所以即使把 §3 全部应用，**性能仍然不是合并阻断项**。要补的是：

1. 新增 job（例如 `perf-g15`）：起本地生产构建 → 跑 `scripts/qa/v21-batch2-perf.mjs --runs=3` → **按逐页 MEET/MISS 判红**（不是看脚本退出码）。
2. 把 `CI / perf-g15` 加进 §3 的 required 列表。
3. 门槛保持 `{tbtMs:200, lcpMs:2500, cls:0.1}` / `mobile-4g-4xcpu`；在此之前 G15 **FAIL**，不得因「已配置 required」而改判。

⚠️ 但这一步现在**不能直接做**：G15 当前 9/9 MISS，加了 required 会让所有 PR 恒红 —— 恒红的门禁等于没有门禁（与 lint 棘轮文件头同一条教训）。正确顺序是：先做 §5 的 RSC 改造把 G15 拉进门槛，再加 required。

## 5. Preview 与回滚演练（同样未做）

- Netlify Preview：需要先推送 `rc/**` 或 PR 分支。**本轮未推送**，所以没有 Preview 可看。
- 回滚演练：生产当前 `b50e53e`，没有本次任何改动。回滚演练应在**候选部署之后**做（`Netlify → Deploys → 上一版 → Publish`），并用 `https://app.lokfeel.com/health` 复核 `commit` 字段变化。
- 本批含 Prisma 变更 ⇒ 发布顺序必须是 **先迁移（expand）→ 发版（compat）→ 观察 → 再 contract**，且迁移前**必须**有可恢复备份（`down.sql` 不写 `DROP COLUMN`，SQLite 回退走备份）。

## 6. 为什么这份文件不算 C07 通过

C07 的验收是「**受保护分支 + required checks + PR 审查 + Preview 都真实存在**」。
现在四条一条都不存在，本文件只是把「怎么做到」写成可执行载荷。
⇒ C07 维持 **BLOCKED**，解除条件是：Owner 提供 admin 权限（或安装 `gh` 并 `gh auth login`）+ 授权推送。
