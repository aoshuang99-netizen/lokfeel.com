# 18 · 商业契约：产品线、价格与结账的唯一映射

**产出**：2026-10-22（V18 D4）· 基线 `f62f342`
**配套门禁**：`npm run check:products`（自证 `npm run verify:check:products`）+ `tests/commercial/products.test.ts`
**它守的一句话**：`/pay.html` 是 Hlua 的结账页，Connection OS 的任何入口都不许指向它。

---

## 1. 审计结论：这不是"两个产品"，是**三条产品线**

V18 原文说"LokFeel 与 Hlua 两条线"。实测下来是三条，而第三条比第二条更危险 ——
因为它长得**像** LokFeel 自己的定价。

| # | 产品线 | 事实出处 | 权益内容 | 定价状态 |
|---|---|---|---|---|
| 1 | **LokFeel Connection OS** | `docs/implementation/FEATURE_INVENTORY.md`、`src/app/workspace`、`src/app/console` | 六屏 + 组织态七屏 + MCP/A2A + Consent/Outcome | **无任何定价模型** |
| 2 | **LokFeel 旧会员（B2C）** | `src/config/plans.ts`（`FREE/LADY_FREE/PREMIUM_MONTHLY/PREMIUM_YEARLY/LIFETIME`，$19.99/月·$149.99/年） | 每周匹配数、隐身、保险箱、已读回执、旅行模式 | 有价格，属交友线 |
| 3 | **Hlua Pass** | `public/pay.html`（$12.99 / $99.99 / $32.99，CTA 全指 Gumroad） | streaming、H-Points | 有价格，属另一条业务 |

第三条之所以是"最危险"的：`plans.ts` 里的字段是 `weeklyMatches` / `incognitoMode` /
`vaultControl` —— 一眼能看出是交友会员。但 `pay.html` 的标题是 **"Hlua Pass"**，
卖的是 streaming。两者都不叫 Connection OS，而 `/pricing` 却把它们当成了定价页。

> 顺带修正 V17 的一处表述：`10_PRICING_VALIDATION.md` 把"两套价格"并列比较过。
> 那不是"同一个产品的两个价"，是**两个不同产品的价**。算术都自洽，比较本身没意义。

---

## 2. 九段映射（每一条都能落到文件/路由）

| 段 | Connection OS | 旧会员（B2C） | Hlua Pass |
|---|---|---|---|
| **Brand** | LokFeel | LokFeel | Hlua |
| **Product** | `connection-os` | `legacy-membership` | `hlua-pass` |
| **Plan** | 未定义（未定价） | `FREE / LADY_FREE / PREMIUM_MONTHLY / PREMIUM_YEARLY / LIFETIME` | 页内三档（月/年/季） |
| **Price** | **无**（`displayPrice: null`） | `$19.99 / $149.99`（`plans.ts` 为唯一源） | `$12.99 / $99.99 / $32.99`（页内硬编码） |
| **Provider** | 未定（Creem / Stripe 均未接） | Creem（`src/lib/creem.ts`，1999/14999 分） | Gumroad（外链） |
| **Checkout** | `kind: 'none'` —— 无入口 | 无站内入口（`/api/payments/*` 未配置时 503） | `public/pay.html` → Gumroad |
| **Subscription** | — | `Subscription` 表（`plan` 枚举） | 由 Gumroad 管理，本站不持有 |
| **Entitlement** | 六屏 + 组织能力（`capabilities.ts`） | `PlanFeatures`（匹配/隐身/保险箱） | H-Points 余额 |
| **Refund** | **未定**（未销售，无生效承诺） | 14 天（`/refunds`） | 7 天（`pay.html:167`） |

**这张表就是答案**：7 天与 14 天不是"政策冲突"，是**两条不同产品的两条承诺**。
它们之所以看起来打架，是因为此前被当成同一个产品的两个页面。
（是否维持这样拆开，仍需 `RISK_AND_DECISIONS.md` **D-01** 批准 —— 工程不替产品定政策。）

---

## 3. 这一轮改了什么

### 3.1 路由：不再把「定价」导到别人的结账页

| 路由 | 改前 | 改后 |
|---|---|---|
| `/pricing` | 307 → `/pay.html`（Hlua） | **真实页面**（Connection OS 定价与权益） |
| `/plans` | 307 → `/pay.html` | 307 → `/pricing` |
| `/subscribe` | 307 → `/pay.html` | 307 → `/pricing` |
| `/membership` | 307 → `/pay.html` | 307 → `/hlua`（先说明"这是另一个产品"） |
| `/pass` | 307 → `/pay.html` | 307 → `/hlua` |
| `/pay.html` | 200 | **不动** —— 已有 Hlua 客户的链接/收据不能失效 |

### 3.2 产品目录：`src/config/products.ts`（唯一真相源）

三条产品线各一条记录，字段是上表的九段。三条硬规则写进类型与校验：

- **R1** 未获批定价 ⇒ `displayPrice()` 返回 `null`、`isPurchasable()` 返回 `false`。
  要改成 `APPROVED`，必须同时填 `approvalRef`（谁、何时、依据）——
  **没有审批编号的"已批准"就是自己给自己批**，`validateCatalog()` 会拒绝。
- **R2** 结账入口必须属于本产品。Connection OS 现在 `kind: 'none'`；
  把 `pay.html` 挂上去，`validateCatalog()` 直接报"这正是卖错产品的形状"。
- **R3** 退款承诺必须带 `source`。三个产品可以有不同天数，但不许有无主承诺。

### 3.3 页面：不展示未获批的价格

`/pricing` 明确写"定价尚未公布"，并解释**为什么**不展示金额、也不给结账按钮。
页面上一个数字都没有 —— 不是忘了写，是 `PENDING_APPROVAL` 的直接结果。

> 定价获批后**不需要改页面**：把 `products.ts` 的 `status` 改成 `APPROVED`、
> 填 `displayPrice` 与 `approvalRef`，页面自动开始显示金额与购买入口。

### 3.4 门禁：`check:products`（9 条自证）

| 规则 | 断言 | 变异（证明它有牙齿） |
|---|---|---|
| R1 | `next.config.ts` 里不存在任何 → `/pay.html` 的重定向 | 把 `/pricing → pay.html` 加回去 ⇒ 红 |
| R2 | 剥注释后 `pay.html` 只出现在 5 个白名单文件 | 定价页直连 `pay.html` ⇒ 红 |
| R3 | `connection-os` = `PENDING_APPROVAL` + `displayPrice: null` + 无外部结账 | 未获批填价格 / 挂 Hlua 结账 ⇒ 各红 |
| R4 | 定价页与产品目录都**不得**引用 `config/plans.ts` | 定价页 import 旧 plans.ts ⇒ 红 |
| R5 | `/pricing` 页面必须真实存在 | 删页面 ⇒ 红 |

**R2 为什么要先剥注释**：本仓栽过 —— 枚举里的 `/** */` 块注释会被"只过滤 `//`"的守卫
读成一个真取值。注释里提到 `pay.html` 不该判成"代码引用了它"。
自证里专门有两条对照：注释里出现不误报 / 真代码里出现必被抓 / `https://` 里的 `//` 不吞后文。

---

## 4. 这一轮**没有**做的事（以及为什么）

| 事项 | 状态 | 原因 |
|---|---|---|
| 给 Connection OS 定价 | **未做** | 需 D-02 批准。代码只表达"未获批"，不发明价格 |
| 确定退款天数 | **未做** | 需 D-01。已把冲突**归因**到两个产品，但没有替产品做决定 |
| 接 Creem/Stripe 结账 | **未做** | 需 D-05（凭据 + 真实扣款授权），本周明确不做 |
| 改 `pay.html` 的内容 | **未做** | 已有 Hlua 客户在用；它的 7 天承诺属它自己 |
| 给旧会员补站内管理入口 | **未做** | 属 V18-04（取消订阅能力），下一轮 |

---

## 4.1 一个字段是被 CI 逼出来的：`relation`

单测里「目录自检通过」这条**在 CI 红了**，原因不是代码写错，而是**模型缺一个维度**：

```
hlua-pass:  pricing.status = 'NOT_FOR_SALE'   （我们不卖它）
            checkout.kind = 'external'        （它有结账页，但在别处）
            ⇒ 规则「未获批 + 外部结账 = 卖错产品」当场判它红
```

但 Hlua 的结账页**本来就该存在**（已有客户在用）。所以真正缺的不是"更宽的例外"，
而是「**谁在卖**」这个事实：

| `relation` | 含义 | 允许外部结账？ | 允许 `APPROVED`？ | 本目录可代收？ |
|---|---|---|---|---|
| `SOLD_HERE` | 本平台销售（Connection OS / 旧会员） | 仅在已获批时 | 需 `approvalRef` | 是 |
| `REFERENCED_ONLY` | 只被引用来说明边界（Hlua Pass） | 是（那是它的页面） | **否** | 否，永远 |

`isPurchasable()` 现在先看 `relation`，再看 `status` —— 于是"把 Hlua 标成 APPROVED
就能在本目录收钱"这条最省事的路被堵住了。

静态门禁（`check:products`）与行为单测（`validateCatalog()` + jest）**不是同一实现**：
前者零依赖、任何环境能跑，管路由与文本形状；后者管整张目录的状态一致性。
两者不共享代码（`.mjs` 加载不了 TS），所以"防漂移"靠的是**规则写在同一处注释里 +
单测覆盖全表**，而不是靠复用。

> 教训：**"两条产品线混在一起"不只是文案问题，它会逼出错误的规则。**
> 先分清谁在卖，规则才写得下去。

---

## 5. 复跑

```bash
npm run check:products          # 静态：路由 + 目录 + 白名单
npm run verify:check:products   # 9 条自证（含 6 变异 3 对照）
npx jest tests/commercial       # 行为：displayPrice / isPurchasable / validateCatalog（CI 跑）

# 生产侧（部署后）
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://app.lokfeel.com/pricing   # 期望 200，非 307→pay.html
curl -s https://app.lokfeel.com/pricing | grep -c 'pay.html'                                # 期望 0
```

## 6. 这份文档守不住什么

1. **它不判断该不该收费、收多少。** 那是人的决策，本文只保证"没批就不显示、不导流"。
2. **它管不到 Gumroad 后台。** `pay.html` 的 CTA 指向 `shuangster00.gumroad.com`，
   那边卖什么、价格几何，本仓看不见。若它变了，本站不会知道。
3. **白名单会腐。** 5 个文件都有理由，但新增第 6 个时容易顺手加上而不写理由 ——
   `check:products` 只校验"在不在白名单"，校验不了"理不理由"。
