# 04 · 生产已登录 OWNER 商业门负控（T3）

| 项 | 值 |
|---|---|
| 状态 | **`NOT_TESTED`**（缺生产 QA 会话凭据）· 匿名 401 已证 · 路由级 7/7 已证 |
| 目标 | 未批准定价时，已登录 OWNER 调 `POST /api/payments/dodo/checkout` 必须 **503 `PRICING_NOT_APPROVED`**，且**不创建** Dodo Checkout Session |
| 证据 | `evidence/s04-post-deploy-verify.json`（匿名 401 + plans 门禁）· `tests/billing/hotfix-checkout-gate-closed.test.ts`（7/7） |

## 1. 已有证据（能证明什么）

| 事实 | 证据 | 强度 |
|---|---|---|
| 生产 `plans.checkoutReady=false`、`PENDING_APPROVAL/ref=null`、`missing=[]`、`live_mode` | live HTTP | 强 |
| 生产匿名 POST → **401** | live HTTP | 强 |
| 路由在鉴权之后、建会话之前调用 `readCheckoutGate()`，未批准直接 503 | 源码 + 路由级测试 | 强（代码层） |
| 已登录 OWNER 的真实 503 回执 | — | **缺** |

`plans` 与 `checkout` 共用同一个 `readCheckoutGate()`，因此"plans 说关闭、checkout 却放行"需要两份实现分叉才会发生；现有代码不存在分叉。但**这不等于"实测过 503"**，按口径记 `NOT_TESTED`。

## 2. 为什么没有生产 QA 会话

- 生产库中没有可用的 QA 账号口令（`.env.local` 无 `QA_*`），`scripts/qa/probe-qa-login.mjs` 无凭据可打；
- 我不使用 `AUTH_SECRET` 自签会话 —— 那是**认证绕过**，即使目的是测试也不做；
- 创建生产 QA 账号属于对生产数据的写操作，需要你在 D7/QA 授权里明确同意。

## 3. 补齐它需要什么（一次就够）

二选一：

- **A（推荐，零生产写入）**：给一个**Preview/测试环境**的 OWNER 会话（cookie 或测试账号口令），我在 Preview 上跑 401/503/无会话创建的三身份矩阵；
- **B**：授权我在生产创建一个隔离组织的 QA OWNER（`scripts/qa/create-qa-accounts.mjs`），测完用 `cleanup-qa-accounts.mjs` 删除，并留前后计数差。

## 4. 验收脚本（已就绪，拿到凭据即可跑）

```bash
# 匿名
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://app.lokfeel.com/api/payments/dodo/checkout \
  -H 'content-type: application/json' -d '{"plan":"STARTER","interval":"monthly"}'
# 期望 401

# 已登录 OWNER（带会话 cookie）
# 期望 503 + {"code":"PRICING_NOT_APPROVED","approvalStatus":"PENDING_APPROVAL"}
```
