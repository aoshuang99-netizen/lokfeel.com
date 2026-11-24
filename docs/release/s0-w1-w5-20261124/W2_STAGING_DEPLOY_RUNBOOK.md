# W2 — Netlify Staging 部署 Runbook（方案 A 最小树 · 待 W1 资源即执行）

- 分支：`release/webchat-minimal-b50e53e` @ `77bbb222b117537249777f4c5f2e6a5277cfc5ad`
- 性质：`b50e53e`（生产基线）+ S0 支付 fail-closed 10 文件，**零迁移、零新表、零配置常量依赖**
- 目标站点：Netlify `lokfeel-app.netlify.app`（site id `a2ca9da4-17c0-47fb-a59a-4dad715102b3`），Node.js 22（netlify.toml 已配）
- 状态：**待 W1 隔离 DB**。本文件是可一键执行的 runbook，不是已完成的部署。

## 0. 前置（唯一阻断，Owner 侧）

W1 资源未到位前，本 runbook 的任何部署命令都**不得执行**。到位定义：
- 固定隔离 libSQL URL（`libsql://...` 或 `https://...`），DB 标识 ≠ 生产 `lokfeelcom`；
- 仅该库的 auth token（不复用生产 token）；
- 二者由 Owner 经 Netlify Env + GitHub Secrets 注入，不进聊天/仓库/日志。

## 1. 迁移（方案 A = 零迁移，仅校验）

方案 A 不引入任何新表/列（`git diff b50e53e..release/webchat-minimal-b50e53e -- prisma` = 0 文件）。生产库已有的 `User/Match/Conversation/IMMessage/MessageReceipt/OrganizationInvitation` 等核心表即 WebChat 全部所需。隔离库创建后仍需按生产 schema `db push` 等效建表（用仓库现有迁移器对**隔离库**执行，绝不指向生产）：

```bash
# 只在隔离库执行；DATABASE_URL 必须是 W1 提供的新库，先用 probe 自检身份
DATABASE_URL=<W1_URL> TURSO_AUTH_TOKEN=<W1_TOKEN> \
  node scripts/tenancy/migrate.mjs probe     # 只读：确认是空库、非 lokfeelcom
DATABASE_URL=<W1_URL> TURSO_AUTH_TOKEN=<W1_TOKEN> \
  node scripts/tenancy/migrate.mjs apply --batch=ALL --yes
DATABASE_URL=<W1_URL> TURSO_AUTH_TOKEN=<W1_TOKEN> \
  node scripts/tenancy/migrate.mjs verify
```

硬判据：`probe` 输出不得出现生产库 host `lokfeelcom-lokfeelboss`；出现即中止。

## 2. Netlify Staging 环境变量（经 Netlify UI/CLI 注入，不落盘）

| 变量 | 值来源 | 备注 |
| --- | --- | --- |
| `DATABASE_URL` | W1 隔离库 URL | 必须非生产 |
| `TURSO_AUTH_TOKEN` | W1 专属 token | 不复用生产 |
| `AUTH_SECRET` / `NEXTAUTH_SECRET` | 新建随机值 | 与生产不同 |
| `NEXTAUTH_URL` / `NEXT_PUBLIC_APP_URL` | `https://lokfeel-app.netlify.app` | Staging 域名 |
| `DODO_PAYMENTS_API_KEY` | **不设置** | S0 门已 fail-closed；不配即通道关闭，避免真实收费 |
| `WORKBUDDY_LLM_*` | 可选 | AI 线不进首发，可不配 |

## 3. 部署（资源到位后执行）

```bash
# 以精确 SHA 部署，禁止用 main 或本地工作树
netlify deploy --site a2ca9da4-17c0-47fb-a59a-4dad715102b3 \
  --alias staging --build   # 从 release/webchat-minimal-b50e53e @ 77bbb222 checkout 后执行
```

部署后立刻做只读验证（任一失败即不得标 Staging PASS）：

```bash
# Health 200 + 真实 DB 查询成功
curl -sS -i https://lokfeel-app.netlify.app/api/health
# 期望：HTTP 200, "status":"healthy", dbLatency 有值、无 db error

# 支付门 fail-closed
curl -sS https://lokfeel-app.netlify.app/api/payments/dodo/plans
# 期望：pricingPublished=false, plans=[]

# 非法邀请码 4xx（不得 500）
curl -sS -i https://lokfeel-app.netlify.app/api/v1/invitations/accept \
  -X POST -H 'content-type: application/json' -d '{"token":"invalid_probe_token"}'
# 期望：4xx（404/400），非 500

# 运行时 SHA 对齐：health 的 commit 字段须 == 77bbb222（或部署机制注入的等价标识）
```

## 4. 服务重启持久性（W2 硬门槛）

- 在 Staging 完成 W3 的 A/B 邀请+消息后，Netlify 触发一次 redeploy（或重启 DB 服务），再读回邀请/消息记录。
- libSQL/Turso 托管库天然跨应用重启持久；此项实测确认即可。

## 5. 禁止事项

- 不得把本地 `next start` + `file:` 库的 PASS 当 Staging PASS。
- 不得用生产 DB / 生产 token / 生产 AUTH_SECRET。
- health 任一主要 API 500/502 ⇒ Staging 判 FAIL，不进入 W3。

## 6. 完成后移交

W2 PASS 后，用 `scripts/qa/staging-audit-runner.mjs --base=https://lokfeel-app.netlify.app --writes` 执行 W3/W4（见 runner 说明），产出 A/B 录像 + DB 对账 + 八页证据，再进入 W5 审批。
