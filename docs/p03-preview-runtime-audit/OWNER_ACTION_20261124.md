# Owner 行动单（一次性）· WebChat Node RC · 2026-11-24

> **唯一阻断：Turso 组织欠费，平台拒绝创建隔离 QA 数据库。**
> 本单只列必需权限与唯一阻断证据，不含新开发计划。

## 1. Infra P0 阻断（原始证据）

| 检查 | 结果 |
|---|---|
| `POST /v1/organizations/lokfeelboss/databases` `{"name":"lokfeel-webchat-staging-20261124","group":"lokfeel"}` | **403** `organization lokfeelboss has payment overdues, please update your payment method or contact support` |
| `GET /v1/organizations` | 仅 1 个组织：`lokfeelboss`（personal / starter） |
| `GET /v1/organizations/lokfeelboss/databases` | 仅 `lokfeelcom`（**生产库**） |
| `.env` / `.env.local` 的 `DATABASE_URL` | 全部指向 `lokfeelcom-lokfeelboss.aws-us-east-1.turso.io` |
| 其他 staging 库别名 | 无 |

按执行令「严禁复制生产 DB/密钥」：不能复用生产库、不能从生产库建分支、
也不能用 `file:` 占位或内存库冒充（会构成假绿）。因此 Node Staging 的
`/api/health` 无法做到 200 healthy，SHIP-02/03/04 全部 BLOCKED。

- **唯一责任人**：Owner / Infra（Turso 账号与账单持有人）
- **最小修复（二选一）**：
  - A. 在 Turso Dashboard 更新支付方式 / 结清欠费，恢复创建 database 能力；
  - B. 提供另一个**隔离** libSQL/Turso 库的 `libsql://…` 主机名 + **仅该库**的 full-access token（不得为 `lokfeelcom`）。
- **下一次检查点**：资源到位后 2 小时内完成干净库迁移 → 部署 → `/api/health` 200 healthy → 非法邀请码 4xx。

## 2. 同时需要的另两项权限

| # | 权限 | 用途 | 责任人 |
|---|---|---|---|
| 2 | 隔离 QA 双账号凭据，或授权在隔离库创建两个测试账号（不得复用生产账号） | SHIP-03：A 邀请 → B 接受 → 关系落库 → 双方各 5 条消息 | Owner / QA |
| 3 | 指定独立 Reviewer；对精确 SHA 的部署范围 / 迁移 / 回滚书面批准 | SHIP-04 安全负例复核、SHIP-05 发布 | Owner / Release |

## 3. 本轮已锁定、无需权限的事实（一次权威核验，不重复选型）

- **DEPLOY_TARGET**：`app.lokfeel.com` → Cloudflare DNS/CDN 代理（`cf-ray`）→ **Netlify Node.js origin**（`x-nf-request-id` + `Netlify Edge/Durable` cache-status）→ Turso libSQL；生产 `/api/health` **200 healthy**、`commit=b50e53e`、`commitSource=env`。**首发 Node 22 路线与生产运行时一致，不需要切换 DNS/CDN/流量入口。**
- **RC_SHA** `9c6b7415b64b865de9db129b0b60735d15d089f1`（邀请闭环 + Turbopack chunk 补丁）。分支头 `4b4b1f6` 与之 diff 仅 docs/workflow/QA，**无代码差异**，不得当成新构建。
- **CI** `45155686794` completed success（含 `npm run build` / tsc / Jest / E2E / gitleaks）；`45157012131` 亦 success。生产站点 `lokfeel` 从 `main` 构建，已发布 deploy `b50e53e4`；`main` 远端 `cad717e`（旧版）。
- 独立空站点 `lokfeel-app.netlify.app`（env 为空、无 repo 关联）已存在，Netlify CLI 27.20.1 + token 已验证可用 ⇒ Staging 站点本身**不是**阻断，DB 才是。
- RC 的 `src/config/pricing-gate.ts` = `PRICING_APPROVED = false`（代码级 fail-closed），邀请端点 `accept/lookup/revoke` 齐备。

## 4. SHIP-S0（并行、独立裁决，本轮未执行）

- 生产 `GET /api/payments/dodo/plans` 仍返回 **`checkoutReady: true`** 且公开未审批 `amountCents`；生产 health `payments.charging=true`、`dodo.checkout=true`；生产 Netlify env 含 `DODO_PAYMENTS_API_KEY` / `DODO_PAYMENTS_WEBHOOK_KEY`。
- RC 已 fail-closed（Preview 实测 `pricingPublished=False`）。历史 hotfix 候选 `77bbb222` 相对生产 `b50e53e4` 的 diff = 10 文件 / +367 −187，核心为新增 `pricing-gate.ts`、修改 `plans/route.ts`、`pricing/page.tsx`、`commercial-gate.ts` 及测试。
- **未获精确 SHA 批准：未部署、未摘除生产凭据、未宣称已止损。**
- 请 Owner 二选一并给出精确 SHA 批准：
  - A. 单独发布 fail-closed hotfix（独立 Reviewer 核对 Checkout create=0、旧订阅/webhook 不回归、回滚不重开收费）；
  - B. 在 Netlify 生产 env 临时摘除 `DODO_PAYMENTS_API_KEY`（配置层止损，不改代码）。

## 5. 状态与边界

`CODE_READY` = PASS ｜ `STAGING_BUSINESS_VERIFIED` = **BLOCKED** ｜ `RC_APPROVED` = BLOCKED ｜ `PRODUCTION_VERIFIED` = **NO**

未部署/迁移生产、未改支付凭据、未切流量、未写生产数据、未复用生产 DB/密钥、未用默认口令或假消息；未把 Cloudflare Preview 的 8/8 公开页 PASS 冒充 WebChat 发布 PASS。
