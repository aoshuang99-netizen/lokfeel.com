# 16 · 生产上线记录（V20.7 GA）

**上线时间** 2026-11-13 19:13–19:15 (GMT+8)
**生产提交** `531c07c`（`531c07cf78090568af3ca2f74d249ec4ae65f4e9`）
**上一个生产提交** `0e16959`
**部署 ID** `6af6f0d8f35d21df4997e59d` · state `ready`
**健康检查** `/api/health` → `commit=531c07c` · `status=healthy`

## 上线了什么

相对 `000a7a6`：47 个新文件、25 个修改。

- **公开面冻结**：`/product` `/solutions` `/stories` `/how-it-works` `/help` 在渲染层与中间件双拦，改写 `/holding`；同时下发 `X-Robots-Tag: noindex, nofollow`；导航、页脚、sitemap 用同一份名单过滤。
- **定价商业门**：未获商业批准时页面不渲染金额，`/api/payments/dodo/plans` 返回 `checkoutReady=false`。
- **无障碍**：行内链接触控 ≥24px、对比度修正。
- **首屏瘦身**：移除无效 Sentry SDK（485KB）；`AuthProvider` 从根布局下放到受保护布局。
- **法人表述**：清除未核实的 `LokFeel Inc.` / `Delaware` / `Wilmington`。

## 验收（全部为生产实测，非模拟）

| 项 | 结果 | 证据 |
| --- | --- | --- |
| 支付面风险 | `PRODUCTION_RISK_CLOSED`（`checkoutReady=false`、`commercial=PENDING_APPROVAL`、`env=live_mode`、匿名 POST 401、R-15 分态结算键 present） | `evidence/s04-after-ga-531c07c.json` |
| 五页封存 | 5/5 渲染 `/holding` 内容（h1「该页面正在最终审核」），可见文本 535 字符，无金额、无法人断言 | `evidence/ga-live-531c07c.json` |
| 定价页 | 可见文本无 `$`/`¥` 金额；「定价」仅出现在「尚未公布」文案 | 同上 |
| 导航 / sitemap | 五个冻结路由均不出现 | 同上 |
| 无障碍 | 2 视口 × 4 页 = 8 次 axe 扫描，serious/critical = 0；<24px 可点击目标 = 0 | `evidence/ga-live-axe.json` |
| 全站冒烟 | 公开页 200；`/workspace` `/dashboard` `/console` `/admin` 未登录 307 跳登录 | `evidence/ga-live-531c07c.json` |
| 控制台 | 5 页 console error = 0、pageerror = 0、失败请求 = 0 | 同上 |
| CI | 远端 `531c07c`：16 项 check 全 success（Build / Jest / E2E / Lint / Typecheck / gitleaks / 迁移等），2 项 skip | GitHub Actions |

## 过程中发现并处理的问题

1. **push 不会自动触发 Netlify 构建。** `531c07c` 于 10:57 UTC 推上 main，Netlify 的 `build_settings.updated_at` 同步为 10:57:23，但部署队列里没有新记录，生产在 15 分钟内一直停留在 `0e16959`。改用 Netlify API `POST /sites/{id}/builds` 手动触发，2 分钟后 `ready`，`commit_ref=531c07c`。**后续每次发版都要显式触发，不能只 push。**
2. **`8840b26` 的提交信息带 `[skip netlify]`。** 直接推这条不会构建，所以补了一个空提交 `531c07c`（代码树 diff 为 0）作为头提交。
3. 本地 `eslint .` 被 OOM kill（exit 137），未取得本地 lint 结果。CI 的 Lint 步骤在同一提交上通过，以 CI 为准。

## 未完成（不在本次自动化范围）

这四项卡在外部输入或时间窗，代码层面无法替代：

- Dodo `test_mode` 真实投递与账本对账：无沙箱凭据，且定价未批准（D1）。
- Figma 比对与 ≥5 名真人验收（G3 / G5）：无 Figma 写入凭据，无真人可用。
- 定价与法律主体批准（D1 / D8）：需人工签字。
- G13 48 小时观察窗：时间未到。

生产当前状态：**已上线、支付门关闭、无真实扣款**。

---

## 追加部署 · 2026-11-13 20:37 GMT+8 · `71c54c6`

**触发原因**：所有者确认「不把『折合每席/月』对外展示」，要求直接部署。本次无代码改动，
仅把生产构建对齐到 main 头提交，消除「生产 SHA ≠ main SHA」的对账歧义（生产此前停在
`6fa6772`，main 已到 `ff9ef3d`）。

| 项 | 值 |
| --- | --- |
| 部署 ID | `6af7043889f9a9dbb514d34a` |
| commit_ref | `71c54c67fdf31938cbba54ac81f26f57c48be597` |
| 状态 | `ready`（20:36:16 building → 20:37:38 ready） |
| 触发方式 | Netlify API `POST /sites/{id}/builds`（头提交带 `[skip netlify]`，不会自动构建） |
| 产物 | 「All files already uploaded」——与 `6fa6772` 资产完全一致，无代码变化 |

生产实测（`https://app.lokfeel.com`）：

| 项 | 结果 |
| --- | --- |
| `/api/health` | `commit=71c54c6`、`status=healthy` |
| `/api/payments/dodo/plans` | `catalogVersion=2026-11-13.1`、`checkoutReady=true`、`APPROVED`、`live_mode`、`missing=[]` |
| 定价（月付） | `$89.00 / 月` · `$199.00 / 月` · `$449.00 / 月`，三档席位 25 / 100 / 500 |
| 定价（年付） | `$890.00 / 年`（折合 $74.17/月）· `$1990.00 / 年`（折合 $165.83/月）· Scale 年付按钮 `disabled`、文案「年付暂不可用」 |
| 按钮可点 | `订阅 Starter` / `订阅 Growth` 均 enabled |
| 五页封存 | 5/5 仍渲染 h1「该页面正在最终审核」，未因改价回归 |
| 路由 | 公开页 200；`/workspace` 未登录 307 |
| 无障碍 | 2 视口 × 4 页 = 8 次 axe，serious/critical = 0；<24px 可点击目标 = 0 |
| 控制台 | `/pricing` console error = 0、pageerror = 0 |
| CI | 远端 `71c54c6`：17 项 check，0 失败 0 跳过中（1 项在跑） |

**口径决定（记录在案）**：`折合每席/月` 只作内部锚点，不上对外页面。
原因有二 —— ① 该列只有月付口径成立（$3.56 / $1.99 / $0.90），年付折算为 $2.97 / $1.66，
同一列混两种口径会被读成降价 20%；② Circle / Skool / Mighty 是社群一口价，Notion 才是
按席位，把我们的折算价与对方一口价比，看起来便宜二十倍，属于换了计量单位的比较。

**仍未闭合**：Dodo `test_mode` 真实投递与账本对账、Figma 与 ≥5 真人、定价与法律主体纸质批准、
G13 48h 观察窗。本次**未做任何真实扣款**。

**追记（20:42）**：上表 `71c54c6` 之后又随本文档提交产生 `e944e9e`，为避免生产 SHA 落后于
main 头，已再次 `POST /builds`，部署 `6af705591943a37aff1a9dcb` `ready` 于 20:42:26。
生产 `/api/health` 现返回 `commit=e944e9e`，与 `git ls-remote origin refs/heads/main` 逐字一致。
两次部署资产相同（「All files already uploaded」），差异仅为文档。
