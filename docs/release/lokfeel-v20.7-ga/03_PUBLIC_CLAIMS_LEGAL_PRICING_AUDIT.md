# 03 · 公开面商业/法律/定价审计（T2）

> 脚本：`scripts/qa/ga-public-claims-audit.mjs` · 证据：`evidence/t2-public-claims.json`
> 口径：打**构建产物**（`next start`）取**可见文本**，不是扫源码。
> 为什么要剥 `<script>`：Next 的 RSC flight payload 里全是 `$2`/`$L4` 这类 chunk 引用，
> 直接正则会把它当金额 —— 第一版审计因此对每页报了 6~10 个假金额。

## 1. 判定结果（2026-11-13 13:44 GMT+8，本地构建产物）

| 路由 | 状态 | 可见正文 | 冻结 | 占位 | 金额命中 | 主体命中 |
|---|---|---|---|---|---|---|
| `/` | 200 | 3.9 KB | n | n | **0** | **0** |
| `/pricing` | 200 | 3.9 KB | n | n | **0** | **0** |
| `/product` | 200 | 668 B | **Y** | **Y** | 0 | 0 |
| `/solutions` | 200 | 670 B | **Y** | **Y** | 0 | 0 |
| `/stories` | 200 | 668 B | **Y** | **Y** | 0 | 0 |
| `/how-it-works` | 200 | 673 B | **Y** | **Y** | 0 | 0 |
| `/help` | 200 | 672 B | **Y** | **Y** | 0 | 0 |
| `/about` | 200 | 3.1 KB | n | n | **0** | **0** |
| `/terms` | 200 | 8.8 KB | n | n | **0** | **0** |
| `/privacy` | 200 | 8.5 KB | n | n | **0** | **0** |
| `/refunds` | 200 | 4.0 KB | n | n | **0** | **0** |
| `/contact` | 200 | 1.5 KB | n | n | **0** | **0** |

**判定 `PASS`**：12/12 路由 200 且非空；未批准金额 0 命中；未核实法律主体 0 命中；五个冻结页只输出占位。

## 2. 改了什么（逐条对应总令 T2）

| 总令要求 | 实现 | 位置 |
|---|---|---|
| 未批准前价格不做已批准报价呈现 | 金额显示条件从"目录里有数字"改为 **`gate.commercialApproved`**；未批准时显示"定价尚未公布" | `src/app/(public)/pricing/page.tsx`、`src/components/billing/plan-cards.tsx` |
| 订阅 CTA 禁用 + 明确"计费方案尚未开放" | `checkoutReady=false` 时按钮 disabled；页面文案"计费方案尚未开放，在线开通前会先完成定价审批" | 同上 |
| 服务端同步拦截（非仅隐藏按钮） | 路由层 `readCheckoutGate()` → 503 `PRICING_NOT_APPROVED`（既有） | `src/app/api/payments/dodo/checkout/route.ts` |
| 五个介绍页不提供未审核商业模块 | **渲染层冻结**：页面组件直接返回 `PublicHold`，原 JSX 不执行 | `src/components/marketing/public-hold.tsx` + 5 页面 |
| 从导航/页脚/sitemap 移除导流 | 同一份 `FROZEN_PUBLIC_ROUTES` 驱动三处过滤 | `src/config/public-surface.ts`、`navbar.tsx`、`footer.tsx`、`sitemap.ts` |
| noindex（补充，不是替代） | 五个页面 metadata `robots:{index:false,follow:false}` | 各 `page.tsx` |
| 未核实法律主体不得发布 | `LokFeel Inc.` → `LokFeel`；删除 `a Delaware corporation` / `State of Delaware` 断言；地址块改为 `Registered address pending verification` | `terms`、`privacy`、`refunds`、`contact`、`footer`、`brand.ts` |
| 触控目标 ≥24×24 | `inline-flex min-h-6 items-center` | pricing 两处链接 + `plan-cards` 的 mailto |

## 3. 仍然欠着的（不冒充已做）

| 项 | 状态 | 原因 |
|---|---|---|
| axe serious/critical = 0 | **未跑** | 需要把 axe 注入到构建产物；本轮未执行，不写"0 问题" |
| 360/390/768/1440 四档截图 | **未做** | 同上是浏览器级验收，留给 CI/下一轮 |
| 死链与社媒归属 | **`NOT_TESTED`** | 需要外链探测与账号归属确认 |
| 真实法律主体 | **`BLOCKED`（D8）** | 只能由你提供 |
