# 17 · 定价方案（2026-11-13 重设）

**依据** 产品所有者 2026-11-13 指令：定价页重新设置价格，参考行业竞争对手。
**生效** `b858db1` · 目录版本 `PRICING_APPROVAL.version = 2026-11-13.1`

## 竞品采集（2026-11-13）

| 产品 | 入门档 | 中档 | 高档 | 计费口径 | 免费试用 |
| --- | --- | --- | --- | --- | --- |
| Circle | $89（Professional） | $199（Business） | $419（Scale） | 按社群，不限成员，年付价 | 14 天 |
| Notion | $10/席（Plus） | $20/席（Business） | 定制（Enterprise） | 按席位，年付价 | 有 |
| Skool | $99 | — | — | 固定，不分档 | 14 天 |
| Mighty Networks | $79 | — | — | 按社群 | 14 天 |
| Discourse | $100 | — | — | 按社群 | 有 |

采集来源：circle.so/pricing、notion.com/pricing、skool.com/pricing、mightynetworks.com/pricing、discourse.org/pricing。Circle 的 Scale 档是 2026-09-28 新增的，说明这个赛道的高档位还在往上走。

## 三条定价原则

1. **按平台收费，不按人头叠加。** 三档分别是 25 / 100 / 500 席，席位越多每席越便宜（$3.56 → $1.99 → $0.90）。Notion 那种 $20/席 的线性计价，25 人团队一个月就是 $500，会把小团队挡在门外。
2. **锚定同档竞品，不靠低价换量。** 入门对齐 Circle / Skool / Mighty 的起价区间，中档与 Circle Business 同价，高档略高于 Circle Scale。理由写在下面每一档里。
3. **年付 = 付十个月。** 和 Notion、Circle 的 17% 年付折扣同构。用「送两个月」表达，比一个 16.7% 的百分比更容易向客户解释，也避免每年重算。

## 三档

| 档位 | 月付 | 年付 | 席位 | 折合每席/月 |
| --- | --- | --- | --- | --- |
| Starter | $89 | $890 | 25 | $3.56 |
| Growth（主推） | $199 | $1,990 | 100 | $1.99 |
| Scale | $449 | 仅月付 | 500 | $0.90 |

**Starter $89** — Circle Professional 是 $89，Skool 是 $99，Mighty 是 $79，取这个区间的中位。它含 25 席，折下来每席 $3.56，比 Notion Business 的 $20/席 低一个量级。这一档存在的意义是让一个 5–10 人的小组能完整跑通「目标 → 工作区 → 任务 → 成果」，而不是把人挡在门外。

**Growth $199** — 与 Circle Business 完全同价。Circle 要到 Business 才给 API 和 MCP，LokFeel 在这一档就把 MCP（5 工具）和 A2A 任务端点全量开放。100 席、每月 1,500 次提案、800 份成果上报。这是绝大多数客户会落的那一档，所以标了「最受欢迎」。

**Scale $449** — 比 Circle Scale 的 $419 高 $30。差异在跨社群 Bridge、审计导出和 500 席；Circle 在 $419 档给的是 AI agents 和高限额，但没有跨组织桥接这个概念。年付 $4,490 超过 Dodo 单笔 $3,000 上限，建不出商品，所以**只提供月付**，年度客户走对公合同——价格与权益不变。

## 试用与退款

- 14 天免费试用，对齐 Circle / Skool / Mighty 的行业惯例。Dodo 侧 `trial_period_days=14` 已经配在五个商品上。
- 首次订阅 14 天冷静期，出处 `/refunds`，没变。

## 已同步的外部状态

| 商品 | 旧价 | 新价 | Dodo 商品 ID |
| --- | --- | --- | --- |
| Starter 月付 | $49 | $89 | `pdt_0NrdGj3pC4ibJ6Oljxn81` |
| Starter 年付 | $490 | $890 | `pdt_0NrdGjJ4J6YOnJZ4pCdGf` |
| Growth 月付 | $149 | $199 | `pdt_0NrdGjSPkO55wB1t76sB2` |
| Growth 年付 | $1,490 | $1,990 | `pdt_0NrdGjapl7pWTfInwAvCV` |
| Scale 月付 | $399 | $449 | `pdt_0NrdGjgAfanjOrHpT1N2s` |
| Scale 年付 | 无 | 无（超单笔上限） | — |

五个商品都做了 PATCH 后回读，金额与代码里的 `PLAN_CATALOG` 逐项相等。Dodo 的规则是改价只影响新客户，存量订阅按注册时价格续费，所以这次调价不会改动任何已有订阅的扣款金额。

## 风险与后续

- **价格上调 82%（Starter $49 → $89）。** 如果已有客户在这个价位上，需要单独沟通；目前账本 `BillingEvent=0`，没有存量付费用户，所以没有需要 grandfathering 的合同。
- **Scale 年付缺口。** 年付 $4,490 撞 Dodo 单笔上限。要卖年度合同只能走线下，或者把年度拆成两次收款。这属于商务流程，不在代码里解决。
- **竞品价格会变。** `PRICING_RATIONALE` 里每条都带采集日期，下次复核时按日期判断哪条过期，不用重读整张表。
