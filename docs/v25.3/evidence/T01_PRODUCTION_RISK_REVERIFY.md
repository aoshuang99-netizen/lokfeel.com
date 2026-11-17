# V25.3 · T01（V25-01/33）生产支付风险 — 本轮只读复验

**状态：生产风险未关闭（生产旧构建，本轮未部署、未改生产、未推送）。**

## 1. 本轮真实只读取证（2026-11-17T08:54:52Z，`curl --noproxy '*'`）

| 端点 | 实测返回 | 判读 |
|------|---------|------|
| `GET /api/health` | `commit=b50e53e`、`status=healthy`、`payments.charging=true`、`commitSource=env` | 线上仍是 11-14 旧构建 |
| `GET /api/payments/dodo/plans` | `checkoutReady=true`、`environment=live_mode`、`commercialApproval.status=APPROVED`（目录自填引用）、`pricingPublished` 字段**不存在** | 旧构建未带 fail-closed 信封；面向公网暴露可购买价格 |
| `POST /api/payments/dodo/checkout`（匿名） | `HTTP 401` | 仅证明未登录被拒；**不能**替代"已登录 + 未批商业门"负例 |

## 2. 结论

- 生产仍运行旧 commit `b50e53e`，其 `plans` API 返回 `checkoutReady=true & live_mode & pricingPublished` 缺失 —— 与 V25.2 报告一致，风险未关闭。
- **无证据**表明已发生真实扣款（本轮未做任何扣款、未构造有效 Checkout）。
- 匿名 401 不是 T01 要的负例：T01 硬验收要求"授权 QA 登录态在 PENDING_APPROVAL 下创建 checkout 返回 403/503 + PRICING_NOT_APPROVED，Provider session 数 0"。该负例需要 Owner 授权的 QA 凭据 + 隔离环境，本轮未执行。

## 3. 最小 Hotfix 候选（沿用 V25.2，未改）

`docs/v25.2/P0_SAFE_01_HOTFIX_PACKAGE.md` 已备好隔离止损候选（三重合取商业门 `PRICING_APPROVED && 目录 APPROVED && approvalRef`、SSR/JSON/Checkout 三层 fail-closed、回滚不重开门防护）。本地代码层候选实测：check:pricing EXIT 0、billing 374/374、匿名 POST 401。

## 4. 明确的授权边界（未越界）

- 未推送 main（远端仍 `cad717e92542395e4346e49d388f09be78ec1557`）。
- 未部署、未改 Netlify 环境变量、未获取/使用真实 Deploy Preview ID。
- 未生成 Provider session、0 真实扣款。
- 缺真实 Deploy Preview URL + deploy ID + 独立 Reviewer ⇒ **不得**声称 `REMOTE_PREVIEW_VERIFIED` 或 `PRODUCTION_RISK_CLOSED`。

## 5. 交 Owner 的 U-1 决策（未获批则不动作）

① 唯一 hotfix exact SHA；② 真实 Deploy Preview 结果；③ 部署窗口；④ 回滚 ID 与"回滚即摘 `DODO_PAYMENTS_API_KEY`"联动；⑤ 是否授权生产部署。
