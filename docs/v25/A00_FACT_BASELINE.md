# A00 | V25 事实基线（LIVE 只读取证，2026-11-17T04:17Z / 12:17 GMT+8）

纪律：`git ls-remote` + 生产 GET 为唯一权威；脚本退出码、历史报告、本地状态页一律不作最新事实。未携带任何凭据、未采集 `set-cookie` / `Authorization`，未做任何生产写操作。

## 四 SHA（实时）

| 项 | 值 | 来源 |
|---|---|---|
| 本地 worktree | `07486db6f3bcaa0fd7c808520bf88c7daf1be749`（分支 `v25/open-ai-social`） | `git rev-parse HEAD` |
| 远端 main | `cad717e92542395e4346e49d388f09be78ec1557` | `git ls-remote origin refs/heads/main` |
| 生产 | `b50e53e`，`commitSource=env`，`builtAt=2026-11-14T08:38:05.985Z` | `GET https://app.lokfeel.com/api/health` |
| Preview | `NOT_AVAILABLE`（无已授权可用连接） | V22/V23 沿用；不虚构 |

**结论：四值不一致，发布断层仍在。** V25 总令禁止重置历史证据，本文件只是刷新事实，不改变任何生产状态。

## 支付风险（LIVE，仍为 BLOCKER）

- `GET /api/payments/dodo/plans` → HTTP 200，`checkoutReady:true`、`environment:"live_mode"`、`catalogVersion:"2026-11-13.1"`、`approvedAt:"2026-11-13"`、`commercialApproval.status:"APPROVED"`（ref 声称 2026-11-13 所有者重新定价指令），plans 含 `$89.00` / `$199.00` / `$449.00` 三档及 14 天试用、席位配额。
- `GET /pricing` → HTTP 200，页面可见 `$89.00` / `$199.00` / `$449.00`（`$12/$20/$23` 等为 React Flight 序列化标记，非金额）。
- `GET /api/health` → `payments.charging:true`、`dodo.checkout:true`、`dodo.webhook:true`；`botModule.enabled:true`（`enabledSource=env`）。
- 本地 `07486db` 已实现 `PRICING_APPROVED=false` 与三重合取商业门，**未部署**。

判定：生产泄价风险持续存在，处置方式（发布热修复 / 摘除生产支付密钥）仍待 Owner 一次批复；本批不改生产。

## 与其他事实源的关系

- V24 战略 §0.6 要求"下一轮务必重新核实"——本文件即该动作，V23 `BASELINE.json`（15:09）与 V22 `W02_LIVE_AUDIT.md` 的结论被本轮 LIVE 复核印证，未自动升级为最新事实。
- 本轮未取得 deploy ID（`x-nf-request-id` 不是 deploy ID），不据此宣称构建来源。
