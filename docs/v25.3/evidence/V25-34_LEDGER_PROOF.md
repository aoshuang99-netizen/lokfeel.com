# V25-34 · Dodo 支付账本真实四方核对证据

**执行**：2026-11-18 · **VERDICT**：`PASS`（LOCAL_TESTED，非 PRODUCTION_VERIFIED）
**脚本**：`scripts/qa/v253-dodo-ledger-proof.mts` · **机器证据**：`V25-34_LEDGER_PROOF.json`
**隔离库**：`/tmp/v253-dodo-ledger.db`（66 表，seed-t02-e2e 灌入完整 schema，与生产/开发库无关）

## 一、核对对象（四方，逐方真实取证，不 mock）

`ProviderEvent → WebhookSignature → BillingEvent(账本) → Entitlement(权益视图)`

| 方 | 真实实现 | 证据来源 |
|----|---------|---------|
| ProviderEvent | 手工构造 Dodo 事件体（payment.succeeded/failed、subscription.renewed/cancelled）| 脚本内事件工厂 |
| WebhookSignature | `verifyDodoSignature` 真实 HMAC-SHA256，`computeSignature` 对拍 | 伪造签名→401、过期时间戳→401 |
| BillingEvent | 真实 `POST /api/webhooks/dodo` → `translateDodoEvent` → `applyCommands` → `appendBillingEvent`（真实 Prisma 写隔离库）| 每步 `SELECT` BillingEvent 实际行数与字段 |
| Entitlement | 真实 `readOrgSubscription()` 从账本折叠出 plan/status/paid/net | 每步权益视图快照 |

## 二、逐场景结果（11 次真实 handler 调用，0 失败）

| 步骤 | 场景 | HTTP | plan/status | paid(分) | 账本行数 | 判据 |
|------|------|------|-------------|----------|---------|------|
| S1 | 首单 payment.succeeded | 200 | GROWTH/ACTIVE | 14900 | 3 | 开通→建款→收款三条，顺序固定 |
| S2 | 同事件重放 | 200 | GROWTH/ACTIVE | 14900 | 3 | **不重复入账**（行数/金额不变）|
| S3 | subscription.renewed | 200 | GROWTH/ACTIVE | 29800 | 5 | 新增一笔成功收款 |
| S4 | 乱序：同 payment_id 的 succeeded 后到 | 200 | GROWTH/ACTIVE | 29800 | 5 | **整体回放不重复**（renewed/succeeded 同键）|
| S5a | 同笔先 payment.failed | 200 | GROWTH/PAST_DUE | 29800 | 7 | 记一笔 CHARGE_FAILED |
| S5b | 同笔后 succeeded（R-15 核心）| 200 | GROWTH/PAST_DUE | 29800 | 7 | **`deferred:true` + `ledger_rejected`**，内核拒绝 FAILED→SUCCEEDED 非法改判；无静默吞单、无偷偷收钱不开通 |
| S6a | subscription.cancelled | 200 | GROWTH/CANCELED | 29800 | 8 | 权益收敛 |
| S6b | 重复取消 | 200 | GROWTH/CANCELED | 29800 | 8 | **幂等，不写第二条** |
| S7 | 跨租户 orgB 事件 | 200 | orgB=GROWTH/ACTIVE | orgB=14900 | orgB=3 / orgA=8 | **leak=false**，orgA 账本零变化 |

**签名负例**：伪造签名 `webhook-signature` → **401**；时间戳偏移 -3600s（重放）→ **401**。

## 三、R-15 缺陷的历史对照（本轮实证修复有效）

生产旧版 `b50e53e` 的 R-15：同 payment_id 先失败后成功，成功事件被判 replayed 吞掉，账本停在 FAILED、钱已收（收钱不开通）。
本轮 **S5b 真实复现了防御路径**：内核返回 `非法款项迁移：pay_v253_003 处于 FAILED 时不允许变为 SUCCEEDED`，webhook 层转 `200 + deferred + LEDGER REJECT` 告警日志，既不重复入账也不静默丢失。缺陷注入在 `tests/billing/p0-02-dodo-ledger-e2e.test.ts` 仍有内存级牙齿；本条是**真实 DB 级**证据。

## 四、诚实边界（不可过度声明）

1. **LOCAL_TESTED，非 PRODUCTION_VERIFIED**：调用的是真实编译的 route handler 代码，但通过 `POST(new NextRequest(...))` **进程内调用**，非监听端口的 TCP HTTP；无真实 Deploy Preview、无生产域名复验。
2. **假凭据、零扣款**：`DODO_PAYMENTS_API_KEY` / `WEBHOOK_KEY` 是构造的 test 值，验证的是账本逻辑，**未连接 Dodo 沙箱/生产、未创建收款会话、未发生任何真实扣款**。
   - 这满足 V25-34 的「事件→验签→账本→权益」逻辑核对，但**不等于**"用真实 Dodo test_mode 事件 ID + Webhook test delivery 的真实回执"——后者需 Owner 提供沙箱凭据与事件 ID。
3. **组织夹具为脚本自建**：`org_e2e` / `org_t08_other` 由脚本在隔离库幂等创建，用于 FK 与跨租户谓词；不触碰生产组织。
4. **退款分支**：Dodo webhook 事件翻译层当前无独立 `refund` 命令分支（见 `events.ts` switch，无 `refund` case）。本轮**未验证真实退款入账**，只验证了 `CHARGE_REFUNDED` 在内核的净额口径（既有 `tests/billing/creem-refund-accounting.test.ts` 与 `seed-t08-billing` 覆盖）。这是**未闭合项**，不冒充已验证。
5. **安全门未放宽**：全程未改商业门 `PRICING_APPROVED` / `checkoutReady`；生产仍是 `b50e53e`、`checkoutReady=true`、`live_mode`（见 `T01_PRODUCTION_RISK_REVERIFY.md`），支付止损仍待 U-1。

## 五、可复跑命令

```bash
# 1) 建/重置隔离库
E2E_DB_FILE=/tmp/v253-dodo-ledger.db E2E_DDL_FILE=/tmp/v253-dodo-ledger-ddl.sql \
  env -u NODE_OPTIONS node scripts/qa/seed-t02-e2e.mjs --reset --regenerate
# 2) 跑四方核对
env -u NODE_OPTIONS npx tsx scripts/qa/v253-dodo-ledger-proof.mts \
  --out=docs/v25.3/evidence/V25-34_LEDGER_PROOF.json
```

脚本内置凭据泄漏自检：证据序列化后若含任何测试密钥片段即拒绝写盘（exit 2）。本轮扫描 0 命中。

## 六、门禁链

- tsc `--noEmit`：**0**（含新 `.mts` 脚本）
- 定向 eslint（新脚本）：**0 error**
- 全量 jest：未改动任何 jest 源文件，沿用 V25.3 的 **167 suites / 3078 tests PASS**
- 未 build、未部署、未推送；远端 main 仍 `cad717e`
