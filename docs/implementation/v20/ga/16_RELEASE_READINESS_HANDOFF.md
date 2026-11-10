# 16 · 生产发布前任务推进汇总（V20.5 GA → V20.6 收银台）

> 用途：**交给外部评审（Codex）复核**。本文件只陈述可核事实 + 已知风险，不辩护、不美化。
> 状态词只用 `PASS` / `FAIL` / `BLOCKED` / `NOT_TESTED`。
> 生成时间：2026-11-10 17:00 GMT+8 · 生成时工作区 HEAD = `facb4a6`（main，clean，除本文件所在提交）
> 配套：`17_CODEX_REVIEW_BRIEF.md`（评审指令）、`evidence/2026-11-10_release_readiness_summary.log`（本次复跑原始输出）

---

## 0. 一屏结论

| 问题 | 答案 |
|---|---|
| 线上是什么？ | `https://app.lokfeel.com`，生产产物 = `5a161c4`（deploy `6af2d9afb8e9`，state=ready，`/api/health.commit` 实测一致） |
| 远端 main 是什么？ | `facb4a6` = `5a161c4` + 1 个纯文档提交（带 `[skip netlify]`）⇒ **远端 HEAD ≠ 线上 SHA**，属预期但有治理含义（见 R-09） |
| 开发是否完成？ | V20.5 GA 全 9 批 `PASS`/`GO`；V20.6 收银台 `PASS`（功能）、`FAIL`（6 档商品缺 1 档，见 R-01） |
| 能不能开卖？ | **不能全量开卖**。5/6 个 SKU 可售；SCALE 年付被 Dodo 硬上限阻断（R-01）；真实扣款未测（R-02） |
| 门禁是否绿？ | `tsc` 0 · `eslint` 0 · `jest` 142 套 2705 例 0 · `next build` 0 · `check:products` 0（自证 9/9） |
| 最大的未证明项 | **Webhook 密钥一致性 `NOT_TESTED`** —— 此前的"已证明"是自签自验的循环论证，已在本轮修正（R-03） |

---

## 1. 版本与部署事实（全部实测）

```
local HEAD       = facb4a6  (main, worktree clean)
remote main      = facb4a6392d0e6a4804cb0d2273b73737125f7c1   ← git ls-remote 实核
tag v20.5.0-ga   = 0aa24f36...（V20.5 GA 发布点，**无 v20.6 tag**）
生产 deploy      = 6af2d9afb8e9  ready  5a161c4  2026-11-10T08:45:35Z
生产 health      = status=healthy, commit=5a161c4, builtAt=08:45:57Z, dbLatency=225ms
前一部署        = 6af2c1cb7b87  ready  0aa24f3  （V20.5 GA，= 当前回滚点）
更早回滚点      = 6aef0c3e303b  ready  3e27f3c
```

**漂移说明**：`facb4a6` 是本次评审文档的上一个提交（只改 `docs/`），带 `[skip netlify]`，Netlify 只看头提交 ⇒ 不触发构建，线上仍是 `5a161c4`。产物与源码等价，但"远端 main 的 SHA"不再等于"线上运行的 SHA"，审计时需按 health 字段判定（R-09）。

---

## 2. 任务推进总表

### 2.1 V20.5 GA（Batch 0–8，2026-11-07 ~ 11-10）

| Batch | 内容 | 状态 | 关键量化 | 文档 |
|---|---|---|---|---|
| 0 | 安全应急：明文 ADMIN 口令已在生产可用（确认是后门，非潜在风险）+ 5 账号轮换 + tokenVersion 联推 + 零依赖密钥门禁 | `PASS`（1 项 `NOT_TESTED`） | 泄漏口令→401 / 新口令→200 / 轮换前 cookie→401 / 新会话→200（4/4）；门禁自测 9/9 含 5 负例 | 01 |
| 1 | 组织 / 成员 / 权限收口 + D-12 回归（不重开发） | `PASS`（线上路径当时未发布） | 30 PASS / 0 FAIL；jest 275/275 | 02 |
| 2 | 13 屏 × 4 视口 × 2 主题 UI/UX + WCAG 2.2 AA | `PASS`（Figma `BLOCKED_FIGMA_WRITE`） | 视觉 104/104；axe 39/39（serious 以上归零） | 03 |
| 3 | OAuth 形状 / 会话续期 / 撤销 / 登出 / 切租户 / 权限即时生效 / CSRF | `PASS`（2 项 `NOT_TESTED`） | 22 PASS / 0 FAIL；撤销延迟 61.4s（上界 90s）；权限变更 0s | 04 |
| 4 | Agent → Consent → Action → Outcome | `PASS`（1 项 `NOT_TESTED`） | 核验阶梯 15/15 + 4 条反自证负例；jest 231/231 | 05 |
| 5 | 性能 Before/After（同条件同阈值） | `PASS`（TBT `FAIL`=P1 已登记） | LCP 4/4 达标；CLS 0.000；INP p75 64–192ms；**TBT 600–2500ms 超 200ms 预算**（非回归）；console TTFB 3330→1667ms | 06 |
| 6 | 十项监控 + 发布治理 + Workers 不切流护栏 | `PASS` | 生产 11/11 | 07 |
| 7 | RC 验收 GO/NO-GO | `GO`（10/10） | 期间修 2 个真缺陷：CI 密钥字面量、paper 信号色对比度 | 08 |
| 8 | 单次生产发布 + 15 步验证 | `PASS` | 15/15；发布 `0aa24f3`；回滚点 `3e27f3c` | 09–12 |

**Batch 0–8 期间发现并修复的真缺陷（10 个，均有复现路径）**

| # | 缺陷 | 若不修的后果 |
|---|---|---|
| 1 | `errorResponse` 丢弃 `details` | 403/404 语义码退化为 `PERMISSION_DENIED`，客户端无法区分 |
| 2 | libSQL 唯一冲突不抛 P2002 → 建组织返回 500 | 重复 slug 时 500 而非 409 |
| 3 | 过期邀请从未落库（事务内 throw 全回滚） | 库中永远停留 `PENDING`，无法审计 |
| 4 | 移出成员 `TRANSACTION_CLOSED`（Prisma 默认 5s vs Turso） | 移出成员 500 |
| 5 | 产品缺"登出" | 用户无法退出（JWT 策略下只能等过期） |
| 6 | 产品缺"组织切换" | 多租户用户被钉在最早 ACTIVE 关系上 |
| 7 | CI 密钥字面量（B0 脚本注释复写旧口令） | CI 红灯埋 3 天；G1 门禁本该拦住 |
| 8 | paper 主题 `--lf-warning` 2.72:1 | axe 红；success/danger 同类潜伏 |
| 9 | **Dodo webhook 端点指向 `https://lokfeel.com/` 静态首页** | **收了钱不开通，支付页仍显示成功** |
| 10 | 缺 1 个 SKU 就禁售全部 6 档 | Scale 年付卖不了连带 Growth/Starter 全禁 |

### 2.2 V20.6 收银台 + 订阅套餐（2026-11-10）

| 项 | 状态 | 证据 |
|---|---|---|
| 套餐目录单一事实源 `src/config/subscription-plans.ts` | `PASS` | 金额只在此文件出现，display 由 cents 派生；年付=月付×10 由函数计算；配额 `toBe` 引用 `PLAN_LIMITS` |
| Dodo 接入层（config / signature / client / events / store） | `PASS` | 零新增依赖、零 schema 变更、免迁移 |
| API `/api/payments/dodo/{checkout,plans,subscription}` + `/api/webhooks/dodo` | `PASS` | 未登录 checkout → 401；未配置 webhook → 503；签名错 → 401 |
| `/pricing` 收银台化 + 逐 SKU 降级 + `/checkout/success` | `PASS` | 生产页面含三个「订阅 X」按钮；SCALE 年付显示「年付暂不可用」 |
| 6 个商品写入 Dodo live | **`FAIL`（5/6）** | STARTER×2 / GROWTH×2 / SCALE 月 建成；SCALE 年付 `CART_AMOUNT_EXCEEDS_LIMIT` |
| 8 个 env 写入 Netlify 生产 | `PASS`（含安全妥协） | 201 创建成功；复核 52 个变量无残留；**均为非 secret 变量**（R-05） |
| 真实结账会话（Dodo live，不付款） | `PASS` | `cks_0NrdKupMmvpM7oKLhLoZA`，商品 id 与字段全部被接受 |
| Webhook 端点 URL / 9 事件 / 未禁用 | `PASS` | `GET /webhooks` 实核 |
| Webhook 密钥一致性 | `NOT_TESTED` | 自签自验不算证据；`GET /webhooks` 不返回 secret；`/test` 端点 403（R-03） |
| 真实扣款 → 开通闭环 | `NOT_TESTED` | 需真实卡 + 真实投递（R-02） |

**变更面（`605316e..5a161c4`）**：29 files, +4623 / −101
```
新增代码 12：src/config/subscription-plans.ts
            src/lib/payments/dodo/{config,signature,client,events,store}.ts
            src/app/api/payments/dodo/{checkout,plans,subscription}/route.ts
            src/app/api/webhooks/dodo/route.ts
            src/components/billing/plan-cards.tsx
            src/app/(public)/checkout/success/page.tsx
            scripts/ops/dodo-provision-plans.ts
新增测试  4：tests/billing/dodo-{signature,plan-catalog,events,store-readiness}.test.ts
修改      7：.env.example / products.ts / availability.ts / pricing/page.tsx
            verify-product-catalog.mjs / payment-availability.test.ts / products.test.ts
prisma 变更：0  ⇒ 无需迁移
```

---

## 3. 门禁证据（本次复跑，`evidence/2026-11-10_release_readiness_summary.log`）

| 门禁 | 命令 | 退出码 | 结果 |
|---|---|---|---|
| 类型 | `npx tsc --noEmit -p tsconfig.json` | `0` | 无输出 |
| Lint | `npx eslint <V20.6 全部新增/改动文件>` | `0` | 无输出 |
| 单测（全量） | `npx jest` | `0` | **142 套 / 2705 例 全过** |
| 单测（定向） | `npx jest tests/billing tests/commercial tests/tenancy` | `0` | 33 套 / 622 例 |
| 构建 | `npx next build` | `0` | `Compiled successfully in 68s` |
| 产品目录 | `npm run check:products` | `0` | 9/9 |
| 门禁自证 | `node scripts/qa/verify-product-catalog.mjs --self-test` | `0` | 9/9（含负例） |
| 生产健康 | `GET /api/health` | 200 | `healthy`，`commit=5a161c4` |
| 生产套餐 | `GET /api/payments/dodo/plans` | 200 | 5 configured / 1 not |
| 页面 | `GET /{/,/pricing,/checkout/success,/login,/refunds,/terms,/privacy}` | 200 ×7 | — |
| 受保护页 | `GET /{/console,/workspace}` | 307 | → 同域 `/login` |

> 注：`npx jest` 有一个告警 `A worker process has failed to exit gracefully`（既有问题，非本次引入，退出码 0）。

---

## 4. 风险登记（按严重度）

| ID | 风险 | 级别 | 状态 | 证据 / 复现 | 建议处置 |
|---|---|---|---|---|---|
| R-01 | Dodo 商户**单笔上限 $3,000**，SCALE 年付 $3,990 建不出；二分实测 $2,998 通过 / $3,001 拒绝，一次性与订阅同限 | **P1 阻塞该 SKU** | `FAIL` | 15 §2 | 找 Dodo 提额到 ≥$4,000 后重跑脚本；或改报价 ≤$2,999（需新 `PRICING_APPROVAL`） |
| R-02 | 真实扣款 → webhook → 开通，端到端未跑 | **P1** | `NOT_TESTED` | 15 §8.5 | 首笔真实成交后查投递日志 `applied=1` |
| R-03 | Webhook 密钥一致性未证明（自签自验是循环论证，上一版报告误称"已证明"，本轮已修正） | **P1** | `NOT_TESTED` | 15 §8.2 修正块 | 同上；或在 Dodo 控制台人工比对密钥指纹 |
| R-04 | 端点订阅 9 事件，代码支持 13 类型；未订 `subscription.updated / paused / unpaused / update_payment_method / failed` | **P2** | 待判定 | `GET /webhooks` vs `events.ts:236-422` | 若 Dodo 用 `updated` 表达降级/暂停，则状态会漏更新；建议补订并加重放测试 |
| R-05 | Netlify **免费计划无法建 secret 变量**，Dodo live API key 与 webhook 密钥以普通变量存于站点 env，账号成员可见 | **P1 安全** | `BLOCKED`（计划限制） | 15 §5 | 升级计划转 secret；或缩短 key 生命周期、按需轮换 |
| R-06 | `/api/health` 返回 `payments.configured=false` 而 `charging=true` | **P2 语义** | 现状 | 见 §3 健康输出 | `configured` 原义是"7 通道全就绪"，`charging` 已改 OR；运维易误判。建议重命名或加 `activeProvider` |
| R-07 | `plans` 顶层 `checkoutReady=true` 但 SCALE 年付 `configured=false` | **P2 语义** | 现状 | 见 §3 | 字段名易读成"全店可售"；建议改 `credentialsReady` 或直接移除顶层字段 |
| R-08 | `products.ts` 中 `connection-os` 由 `PENDING_APPROVAL` 改为 `APPROVED` + `approvalRef: '2026-11-10'` | **P2 治理** | 待你确认 | `git diff` products.ts | **定价审批是人的决定**；此改动等于代填审批。若未获你明确同意，应回退为 PENDING 并把 approvalRef 换成你的工单号 |
| R-09 | 远端 main (`facb4a6`) ≠ 线上 (`5a161c4`) | P2 治理 | 现状 | `git ls-remote` + health | `[skip netlify]` 的必然结果；建议发布后统一以 health.commit 为审计锚点，或改用 tag 标记发布 |
| R-10 | **无 `v20.6` tag**，V20.6 未打发布标记 | P2 治理 | 缺失 | `git ls-remote --tags` | 补 `v20.6.0` 指向 `5a161c4`（或本次文档提交后的代码 SHA） |
| R-11 | TBT 600–2500ms 超预算（4 页全中） | P1（V20.5 已登记） | `FAIL` | 06 §3/§4.1 | 按路由拆包 + 懒水合；下一版本首位 |
| R-12 | 真实 Google OAuth 成功回调未验（缺 `GOOGLE_CLIENT_SECRET` + 需真人） | P2 | `NOT_TESTED` | 04 §5 | 人工走一遍 |
| R-13 | 支付域 D-01 退款口径 / D-02 定价展示 / D-03 法律主体 未定稿 | P1（开卖前） | 待定 | 11 §三 | 开卖前与财务/法务定稿；`/refunds` 现承诺与订阅形态需对齐 |
| R-14 | 续费双记风险：`subscription.renewed` 与 `payment.succeeded` 的 dedupeKey 都含 `payment_id`（`events.ts:154/165/177` vs `310-334`）。若 Dodo 给这两个事件**不同的** `payment_id`，同一笔续费会被记成两笔款；若相同则后到者被 `replayed` 跳过（符合预期） | **P1 对账** | 待判定（需真实 payload） | `events.ts` | 首次真实续费后核对账本 `CHARGE_SUCCEEDED` 笔数 == Dodo 收款笔数 |
| R-15 | **失败后同 id 成功会被幂等键吞掉（已实测确认）**：`CHARGE_SUCCEEDED` 与 `CHARGE_FAILED` 共用 `dodo:charge-settled:${paymentId}`（`events.ts:165` / `:177`）；`CHARGE_CREATED` 同理。同一 `payment_id` 先 failed 后 succeeded 时，成功事件两条命令的键均已存在 ⇒ 全被判 `replayed`，**账本停在 FAILED，钱实际已收** | **P1（条件触发）** | **已确认（合成序列）** | 复现：`npx tsx scripts/qa/_probe-charge-settle-key.ts` → 输出「重叠的 dedupeKey = [dodo:charge-created:pay_same, dodo:charge-settled:pay_same]」 | 结算键带终态：`charge-settled:${id}:succeeded` / `:failed`；修复后把探针转成正式回归测试 |

---

## 4.5 本轮（17:00）自查修正的三处

写这份汇总时回头核对代码，发现并修了三处"文档比代码更自信"的地方，记录在此以免评审者被误导：

| # | 原表述 | 实际 | 处置 |
|---|---|---|---|
| 1 |（15 §8.2）"证明你提供的 webhook 密钥确实是该端点的签名密钥" | 自签自验是循环论证；`GET /webhooks` 不返回 secret；`POST /{id}/test` 403 | 已改 §8.2，结论下调为 `NOT_TESTED`（R-03） |
| 2 |（原 R-14）"`payment.succeeded` 与 `subscription.renewed` 共用同一组 dedupeKey，后到者整体回放" | 键确实相同（都含 `payment_id`），但行为是**逐条 `replayed` 跳过**，不是"回放"；真正的风险是**若 id 不同则双记** | 已重写 R-14 |
| 3 |（原 R-15）"读侧来源不明，可能事件写了读不到" | 读侧是 `reduceBillingEvents` 纯函数回放，且**覆盖写入侧全部 6 种类型**（`SUBSCRIPTION_STARTED` / `PLAN_CHANGED` / `SUBSCRIPTION_CANCELED` / `CHARGE_CREATED` / `CHARGE_SUCCEEDED` / `CHARGE_FAILED`），此项不成立 | 已换成真实风险：成功与失败共用 `dodo:charge-settled:${paymentId}` ⇒ 同 id 先失败后成功会被吞（R-15），**并已用探针实测确认** |

> 这三处的共同点：**原判断都偏向"已完成"**。评审时若再发现同类偏差，按 17 的格式直接标 `MAJOR`。

---

## 5. 给评审者的"反自证"清单（本项目已踩过的坑，请勿被同类话术骗过）

1. **"验签通过"≠"密钥一致"**：自己签名自己验，循环成立。R-03 就是上一版报告犯的错。
2. **"5/6 商品建成"不是"可开卖"**：还缺真实扣款与投递闭环。
3. **"页面 200"不是"功能可用"**：`/pricing` 200 只说明能渲染，订阅按钮依赖 env，需看 `/plans` 的 `configured`。
4. **"jest 全绿"不是"行为正确"**：2705 例里包含大量快照/形状断言；金额与降级逻辑要看 `dodo-plan-catalog` / `dodo-store-readiness` 两组。
5. **"构建成功"不覆盖运行时**：`next build` 不执行 route handler。
6. **"门禁自证 9/9"要看负例**：只数正例的 self-test 是无意义的。`check:products --self-test` 含 5 个负向对照。
7. **"远端已推送"只认 `git ls-remote`**：本项目沙箱下 `git push` 退出码曾出现假失败/假成功。

---

## 6. 待人工决策（发布前必须有人签字）

| # | 决策 | 选项 |
|---|---|---|
| D1 | SCALE 年付怎么办 | ① 找 Dodo 提额（推荐，报价不变）② 降价至 ≤$2,999（改审批版本）③ 年付下架，只卖月付 |
| D2 | 是否在"未验证真实扣款"状态下开放 `/pricing` 按钮 | ① 保持可点（当前）② 先隐藏按钮直到首笔人工测试通过 |
| D3 | R-08 的定价审批是否由你正式确认 | 确认 → 保留 `APPROVED`；否则回退 `PENDING_APPROVAL` |
| D4 | Netlify 是否升级以启用 secret 变量 | 升级 / 接受明文 / 改走自建注入（如 Doppler） |
| D5 | 是否补订 R-04 的 5 个事件 | 补订（推荐）/ 说明 Dodo 语义后维持 |
| D6 | TBT（R-11）是否进 V20.7 首位 | 是 / 先做商业闭环 |

---

## 7. 复核入口（给评审者）

```bash
cd <repo>
git log --oneline -6                     # facb4a6 → 5a161c4 → 18b3ecf → 937a23d
git diff --stat 605316e 5a161c4          # 29 files, +4623/-101
bash /tmp/readiness.sh                   # 复跑全部门禁 + 生产探针（只读）
# 逐层验证（不需要真实支付）：
npx jest tests/billing/dodo-plan-catalog.test.ts      # 价格与限额一致性
npx jest tests/billing/dodo-store-readiness.test.ts    # 5/6 场景的逐格降级
npx jest tests/billing/dodo-events.test.ts             # 事件→账本命令翻译
npx jest tests/billing/dodo-signature.test.ts          # Standard Webhooks 验签
npx jest tests/commercial/products.test.ts             # 产品目录状态自洽
```

**评审时请特别关注**：§4 的 R-04 / R-08 / R-14 / R-15 四条我没有给出"已验证"结论的项 ——
它们要么是设计判断，要么需要生产数据，我倾向于认为其中至少一条是真问题。
