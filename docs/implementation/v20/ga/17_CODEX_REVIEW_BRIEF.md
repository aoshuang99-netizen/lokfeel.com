# 17 · Codex 评审指令（可直接粘贴）

> 用法：把本文件全文粘贴给 Codex（工作目录指向仓库根）。它是自包含的，Codex 无需看到此前的对话。
> 配套阅读：`16_RELEASE_READINESS_HANDOFF.md`（事实汇总）、`evidence/2026-11-10_release_readiness_summary.log`（原始输出）。

---

## 你的角色

你是**独立评审者**，不是实现者。仓库是 LokFeel（Next.js 16 + Prisma 7 + libSQL/Turso + NextAuth v5），
本次评审对象是**已上线的一个变更包**：收银台对接 Dodo Payments + 订阅套餐目录（V20.6）。

请假设作者（我）有"把推断写成结论"的倾向——事实上已经犯过一次（见下方"已知的自证陷阱"）。
你的价值在于**找出把 NOT_TESTED 写成 PASS 的地方**，而不是确认它做得对。

## 评审范围（只读）

```bash
git log --oneline -6
git diff --stat 605316e 5a161c4     # 29 files, +4623/-101, prisma 变更 0
```

核心文件：

| 层 | 路径 |
|---|---|
| 套餐单一事实源 | `src/config/subscription-plans.ts` |
| 商品/定价元数据 | `src/config/products.ts` |
| Dodo 配置解析 | `src/lib/payments/dodo/config.ts` |
| 验签 | `src/lib/payments/dodo/signature.ts` |
| REST 客户端 | `src/lib/payments/dodo/client.ts` |
| 事件→账本翻译 | `src/lib/payments/dodo/events.ts` |
| 账本写入 / 幂等 | `src/lib/payments/dodo/store.ts` |
| 路由 | `src/app/api/payments/dodo/{checkout,plans,subscription}/route.ts`、`src/app/api/webhooks/dodo/route.ts` |
| UI | `src/components/billing/plan-cards.tsx`、`src/app/(public)/pricing/page.tsx`、`src/app/(public)/checkout/success/page.tsx` |
| 可用性判定 | `src/lib/payments/availability.ts` |
| 商品写入脚本 | `scripts/ops/dodo-provision-plans.ts` |
| 测试 | `tests/billing/dodo-*.test.ts`、`tests/commercial/products.test.ts` |

## 必须亲自执行的核验（不要只读代码）

```bash
# 1. 门禁是否真绿（约 3 分钟；不要相信文档里的数字）
npx tsc --noEmit -p tsconfig.json; echo "tsc=$?"
npx eslint src/lib/payments/dodo src/app/api/payments/dodo src/app/api/webhooks/dodo \
            src/config/subscription-plans.ts src/components/billing; echo "lint=$?"
npx jest tests/billing tests/commercial --silent; echo "jest=$?"

# 2. 价格是否存在"第二事实源"（关键：脚本里必须零价格字面量）
grep -nE "4900|14900|39900|49000|149000|399000|49|149|399" scripts/ops/dodo-provision-plans.ts

# 3. 幂等键是否可能互相吞掉（P2-R14）
grep -n "dedupeKey\|dedupe" src/lib/payments/dodo/store.ts src/lib/payments/dodo/events.ts

# 4. 事件覆盖 vs 端点订阅（P2-R04）
grep -nE "case '" src/lib/payments/dodo/events.ts

# 5. 生产只读探针（不带任何 key）
curl -s https://app.lokfeel.com/api/health
curl -s https://app.lokfeel.com/api/payments/dodo/plans
curl -s -o /dev/null -w "%{http_code}\n" https://app.lokfeel.com/pricing
```

**禁止事项**：不得修改任何文件、不得提交/推送、不得执行真实支付、不得使用生产 API key 调用写接口
（`POST /products`、`POST /checkouts`、`PATCH /webhooks/*`）。只读探测允许。

## 重点质疑清单（我给出的判断，请逐条挑战）

| ID | 我的判断 | 请你回答 |
|---|---|---|
| R-01 | Dodo 单笔上限 $3,000，SCALE 年付 $3,990 无法创建，二分实测 $2,998 过 / $3,001 拒 | 这个结论的推理链是否成立？`CART_AMOUNT_EXCEEDS_LIMIT` 是否可能由别的字段导致（如 `subscription_period_count`）？ |
| R-02 | 真实扣款→开通闭环 `NOT_TESTED` | 是否存在无需真实卡的验证路径被我漏掉？ |
| R-03 | "验签通过"不能证明 Dodo 侧密钥一致（自签自验） | 有没有第三条证据路径（如 Dodo 投递日志 API、签名密钥指纹端点）？ |
| R-04 | 端点订 9 事件、代码支持 13 类型，缺 5 个可能导致状态漏更新 | 缺的 5 个里哪几个**必然**造成账本状态错？给出具体事件序列 |
| R-05 | Netlify 免费计划无法建 secret 变量，key 以明文存 env | 是否真的只有升级一条路？有没有 Netlify 侧的替代（snippet/deploy-scoped/环境隔离）？ |
| R-06/07 | `configured` / `checkoutReady` 字段语义与运维直觉不一致 | 会不会在监控告警里真的造成误判？ |
| R-08 | 我把 `connection-os` 从 `PENDING_APPROVAL` 改成 `APPROVED` 并自填 `approvalRef` | 这是否属于"实现者自我授权"？应从哪个门禁上拦住？ |
| R-14 | `subscription.renewed` 与 `payment.succeeded` 的 dedupeKey 都含 `payment_id`：id 相同则后到者被跳过（对），id 不同则同一笔续费记两笔 | 用 `tests/billing/dodo-events.test.ts` 的夹具构造"id 不同"的续费序列，算账本里有几笔 `CHARGE_SUCCEEDED` |
| R-15 | 已实测确认：`CHARGE_FAILED` 与 `CHARGE_SUCCEEDED` 共用 `dodo:charge-settled:${paymentId}`，同 id 先失败后成功时成功事件整条被吞（`npx tsx scripts/qa/_probe-charge-settle-key.ts`） | 判定触发概率：Dodo 失败重试是否复用 `payment_id`？若复用，这是收钱不到账。并评估"结算键带终态后缀"是否引入新的重放问题 |

## 已知的自证陷阱（别被同样的话骗）

1. 用密钥 K 签名、由持有 K 的服务端验签通过 ⇒ 只证明两端用同一把钥匙，**不证明** Dodo 配的是这把。
2. 页面返回 200 ⇒ 只说明能渲染，不说明按钮可点、env 齐备。
3. `jest` 全绿 ⇒ 2705 例含大量形状断言；金额/降级只看两个专项文件。
4. "5/6 商品建成" ⇒ 不等于可开卖（缺扣款闭环）。
5. "自证 9/9" ⇒ 只数正例的自测无意义，必须看负向对照。
6. `git push` 退出码 ⇒ 本项目曾出现假失败/假成功，只认 `git ls-remote`。

## 输出格式（严格）

按严重度分四档，每条必须带**证据 + 复现命令**，无证据的判断标 `SPECULATION`：

```
[BLOCKER]   会导致收钱不开通 / 数据错 / 安全暴露
[MAJOR]     会导致用户可见错误或运维误判
[MINOR]     可维护性、命名、注释与实现不符
[NIT]       风格
```

每条格式：

```
[级别] <标题>
位置：path:line
现状：<代码/输出实际是什么>
问题：<为什么错，触发条件>
证据：<命令 + 输出片段>
建议：<最小修复>
```

最后给一个总判定，三选一，并说明理由：

- `APPROVE` —— 可保持线上
- `APPROVE_WITH_COMMENTS` —— 可保持线上，但 R-xx 必须在下一版修
- `REQUEST_CHANGES` —— 建议先下线 `/pricing` 的结账按钮或回滚

并单独回答一句：**如果你是付款客户，此刻是否愿意在 `/pricing` 上输入卡号？为什么？**

---

## 附：本次评审的边界（避免无效结论）

- 不要评审 V20.5 GA 的 Batch 0–8 实现细节（已于 `08_RC_ACCEPTANCE.md` 结案），只评审它对 V20.6 的影响。
- 不要要求补齐 Figma 设计稿（环境无 connector，已 `BLOCKED`）。
- 不要建议"加 allowlist 绕过密钥门禁"（项目明令禁止）。
- 不要建议改历史提交（D-09 已受控：55 处形似凭据留在历史，门禁只看新增）。
