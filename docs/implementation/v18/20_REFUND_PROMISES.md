# 20 · 退款承诺：四个对外面、三处冲突、一个待批决定

> V18 的说法是「统一退款承诺」。统一之前先要**知道现在到底承诺了什么** ——
> 本文只做盘点与归因，**不选 7 天也不选 14 天**（那是 D-01，产品决策）。

复跑方式（不需要凭据、不需要服务端）：

```bash
# 对外承诺面：4 个页面；其余 300+ 行命中是实现细节（退款状态机、webhook、admin 路由）
node -e "…"   # 见 §1 的扫描口径：只扫 src/app/(public)、public/、src/config/
```

## 1. 四个**对外**承诺面

| # | 面 | 位置 | 说了什么 | 面向谁 |
|---|---|---|---|---|
| A | Refunds Policy | `src/app/(public)/refunds/page.tsx:30,53,69` | 覆盖「paid workspace subscriptions, seats and credits」；**首次订阅 14 天内**取消可退（未大量使用）；非首订不退未使用部分（除 14 天冷静期） | Connection OS（工作区订阅） |
| B | Cancellations Policy | `src/app/(public)/cancellations-policy/page.tsx:33,67,76,97` | 随时可取消，停止未来计费；**不自动退款**；EU/UK 有法定撤回权；年付需在续费前 **7 天**取消 | Connection OS |
| C | Hlua Pass 结账页 | `public/pay.html:167` | 「7-day refund policy on every Pass — 在扣款后 7 天内申请退最近一期」 | Hlua Pass（另一条业务） |
| D | 产品目录（代码事实源） | `src/config/products.ts` | connection-os: `days: null`（尚无生效承诺）· legacy: **14** · hlua: **7** | 内部口径 + 定价页渲染依据 |

> 扫描到 386 行含 refund/7 天/14 天的文本，但绝大多数是状态机（`REFUNDED` 终态）、
> webhook 分支、admin 路由与注释。**只有上面 4 处是"对用户说的话"** ——
> 盘点必须先做这个区分，否则会得出"386 处不一致"这种没法行动的结论。

## 2. 三处冲突

### C1（最贵的一条）工作区订阅到底有没有 14 天承诺？

| 说法 | 出处 |
|---|---|
| 「首次订阅 14 天内可退」 | `/refunds` §2（footer 有链接、`region-policy` 白名单内、外部可访问） |
| 「尚未对外销售，因此没有已生效的退款承诺」 | `/pricing` 退款条款行（读 `products.ts` 的 `days: null`） |
| 「14 天」 | `products.ts` 里 `legacy-membership` 那一条（**旧 B2C**，不是 Connection OS） |

三者不是"措辞不同"，是**三种互斥的事实陈述**。后果具体：
一旦按现价开卖，用户拿 `/refunds` 的 14 天来找我们，而定价页写着"没有承诺"——
这不是文案问题，是**合同条款冲突**，且公开可取证。

### C2 7 天 / 14 天属于不同产品，但用户看不出自己在哪个产品里

C（7 天）在 `pay.html`，A（14 天）在 `/refunds`。两个页面都没有"这条承诺属于哪条产品线"的
显式标注。V17 曾把两套价格并列比较 —— 同一个错误在退款上重演了一次：
**它们不是同一产品的两个数字，是两个产品的各一个数字。**

（工程侧已在 `products.ts` 里给每条承诺绑 `source`，且 `/pricing`、`/hlua` 都不再跨产品复制承诺。
但那只能防止**代码**串线，防不住用户从搜索/旧链接直达某一个页面。）

### C3 `/refunds` 指了一条目前不存在的路

`/refunds:105` 写「To cancel your subscription, go to **Account Settings → Manage Subscription**」。
当前仓里**没有**这个界面 —— 取消能力只到 API（`POST /api/payments/cancel`）。
这与 `pay.html` 的 "cancel in one click" 是同一类问题：**承诺了一个入口，但入口不存在**。
（API 有了，界面还没接。）

## 3. 判定

| 项 | 状态 | 说明 |
|---|---|---|
| 承诺盘点 | **PASS** | 4 个面全部定位到文件与行号，可复跑 |
| 冲突归因 | **PASS** | C1/C2/C3 各自指出"谁 vs 谁" |
| 承诺统一 | **BLOCKED_POLICY_APPROVAL** | 需 D-01。工程不替产品选 7 或 14 |
| 取消入口 | **PARTIAL** | API 已实现且「不许假成功」有 9 条单测；UI 入口未接（C3） |

## 4. D-01 的三个选项及其改动面（不选，只列代价）

| 选项 | 要改哪里 | 代价 |
|---|---|---|
| **① 全线 14 天** | `pay.html` 167 行（Hlua 已售，**改文案等于改已有客户的合同**）；`products.ts` 三处 | Hlua 已有客户可能主张 14 天；但规则最简单 |
| **② 全线 7 天** | `/refunds` §2、§3；`products.ts` legacy 14→7 | 与 EU/UK 的法定 14 天撤回权冲突（`cancellations-policy:76` 已声明该权利）；除非按法定方式取得消费者明示同意放弃，**这需要法务判断，工程不能自行决定** |
| **③ 分产品保留，但在每个页面显式标注归属** | 四处各加一行"本条承诺仅适用于 X 产品"；定价页在获批后照抄 | 改动最小、不改既有权利；但要求每个页面都写清"我是谁"，文案更长 |

> 选项 ② 不能由工程单方面做：EU/UK 的 14 天撤回权是法定权利，要覆盖它需要
> 按法定方式取得消费者明示同意（并说明后果），这是法务判断。
> `cancellations-policy` 里已经写了这条权利，但**没人把它和 `/refunds` 的 14 天对上**。

## 5. 工程侧这一轮做了什么 / 没做什么

**做了**

- `products.ts` 给每条退款承诺绑 `source`（无出处的承诺无法通过 `check:products`）；
- `/pricing` 在定价未获批时**不显示任何金额或承诺**，并说明为什么；
- `/hlua` 明确"7 天属于 Hlua，14 天属于旧会员" —— 把 C2 的混淆在页面上讲开；
- 取消能力落到 API，并钉死"先让服务商确认、再写库"（`cancel-subscription.ts` 9 条单测）。

**没做（刻意的）**

- 没改任何一处天数（那是 D-01）；
- 没删 `pay.html` 的 7 天（已有客户的合同依据）；
- 没在 `/refunds` 上加"Connection OS"字样（会替产品做出产品线归属判断）。

## 6. 解除条件

1. **D-01 拍板**（选项 ①②③ 任一）；
2. 按选项改文案 → 复跑 `npm run check:products` + `npm run check:pricing`；
3. C3 的界面入口接上后，`/refunds:105` 那句话才成立；在那之前它是个**未兑现的指路**。
