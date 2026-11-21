# UX17 — 未批准生产 Checkout 止损：静态确认（V25.6）

- 日期：2026-11-20
- 证据类型：`LOCAL_SOURCE_READONLY`。本轮**未**新增支付测试、**未**访问生产登录态、**未**扣款、**未**改生产密钥。
- 原则：作战包禁止"重复已通过的测试刷数字"；支付 fail-closed 在 V25.3/V25.5 已多轮验证，本轮只确认本批改动未破坏该防线。

## 1. fail-closed 代码仍成立（只读核对）

| 位置 | 事实 |
|---|---|
| `src/config/pricing-gate.ts:21` | `export const PRICING_APPROVED = false;` —— 总开关仍硬编码关闭 |
| `src/lib/payments/commercial-gate.ts:39-44` | `approved = PRICING_APPROVED && pricing.status==='APPROVED' && Boolean(approvalRef)`；`enabled = store.ready && approved` —— 三者缺一即不开卖 |
| `src/app/(public)/pricing/page.tsx:36-46` | `pricingPublished = PRICING_APPROVED && gate.commercialApproved && gate.enabled`；未批渲染 "Pricing is not published yet" |
| `src/app/api/payments/dodo/plans/route.ts:38-56` | `if(!PRICING_APPROVED)` 直接返回 `pricingPublished:false, plans:[]`；`checkoutReady=gate.enabled` |
| `src/components/billing/plan-cards.tsx:194` | `sellable = checkoutReady && skuBound`；未就绪按钮不可用 |

结论：本轮改动（服务端 AI 授权、tsconfig、首页文案）均未触及支付门代码；静态 fail-closed 三处（UI/JSON/Checkout 入口）依赖的开关仍为 false。

## 2. 本轮已做的回归确认（非重复生产测试）

- 全量源码类型检查（`npm run typecheck`）exit 0：确认支付门相关源码 uninvolved 且类型完好。
- 定向 ESLint（含支付门未改，0 错误）。
- 相关单测 `tests/billing/commercial-gate.test.ts` 等在既往轮次已 PASS；本轮**不重跑**以避免刷数字。

## 3. 诚实未闭合项（维持 BLOCKED）

- **真实生产 Checkout 负例**（已登录创建订单、Provider 创建次数=0）：**NOT_TESTED** —— 无 Owner 授权访问生产登录态，本轮不触碰生产。
- 生产 `b50e53e` Reported `checkoutReady=true`/`live_mode` 的风险（见 V25.5 报告）：本轮未复核、未修复、未部署。这是独立 P0 生产风险，**不得借 V25.6 UI 改造推迟**。
- 商户准入 / Dodo sandbox 回执 / 回滚演练：未做。

## 4. 下一步可执行（需 Owner）

1. Owner 授权后，从生产 SHA 分支准备最小 fail-closed Hotfix 包（独立安全线，不并 V25.6）。
2. 对精确 SHA 批准后再部署 + 生产迁移 `AIProcessingConsent`（本轮新增表）。
3. 生产已登录负例：UI/JSON/checkout 全部拒绝，Provider 事件=0，历史订阅不破坏。

## 5. 门禁判定

G15 商业止损：**PARTIAL（静态成立，生产未验）**。整体 release 维持 NO_GO。
