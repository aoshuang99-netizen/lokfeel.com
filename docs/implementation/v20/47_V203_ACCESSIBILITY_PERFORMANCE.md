# V20.3 · 47 — 无障碍与性能（性能判定 `FAIL` / 本轮复测 `NOT_TESTED`）

> 作战令 §6 原文：「不得继续宣称登录性能已达标」「如性能门槛未达到，明确标记 `PERF_TARGET_NOT_MET`，提交归因和修复，不得伪绿」。
> 继承 `v19/20_LOGIN_PERFORMANCE.md`（状态 `PERF_TARGET_NOT_MET`）。

## 1. 性能：历史真实数据（`v19/20` §2，2026-10-23 实测）

测量条件：390×844 / DPR2 · CDP 节流 1.6Mbps↓ / 750kbps↑ / 150ms RTT · CPU 4× · 每路由 5 冷 + 5 暖 ·
脚本 `scripts/qa/perf-baseline.mjs`（与 WB18-36 同脚本同条件）。

| 路由 | 冷 LCP | 暖 LCP | 冷 TBT | JS 传输 | 第三方 |
|---|---|---|---|---|---|
| `/` | 8028ms | — | 8945ms | 272KB / 14req | — |
| `/login` | **6544ms** | **5472ms** | **3450ms** | 244KB / 13req | cloudflareinsights **1029–2072ms** |
| `/pricing` | 3540ms | — | 1190ms | 11KB / 2req | — |
| `/pay.html` | 4592ms | — | 1496ms | 11KB / 2req | — |

**目标对照（作战令 §6 移动实验室）**：LCP ≤2500ms → **FAIL（6544ms）**；CLS ≤0.1、TBT ≤200ms → 未达标/未复测；
真实用户 p75 INP ≤200ms → **NOT_TESTED**（无 RUM 数据）。

## 2. 已实施的优化与其**真实**收益（不夸大）

`v19/20` §7：优化 #1「LazyMotion 下放」（framer-motion 迁出根布局）。
同会话 prod↔preview 前后对照（`perf-samesession-2026-10-26-{prod,preview}.json`）：

| `/login` 冷态中位 | 生产 `dc102cd` | preview `44e49c5` | 差值 | 判读 |
|---|---|---|---|---|
| JS 传输 | 244KB / 13req | **201KB / 11req** | **−37KB / −2req** | ✅ 载荷级收益实证 |
| TBT | 3313ms | 3382ms | +2% | 噪声内，非主因 |
| 冷 LCP | 3524ms | 5656ms | — | ⚠️ preview 裸域受 GFW 干扰，跨环境差值不具判定力 |

**结论**：载荷收益真实，但 **LCP 仍 `NOT MET`**。禁止沿用「性能已优化」的笼统说法。

## 3. 结构性归因（`v19/20` §4 / §8，可行动）

1. 瓶颈在**主线程不在网络**：FCP≈LCP（`/login` 5792 vs 6544），首字节仅占 LCP 9%。
2. `/login` 201KB JS 中 **框架基线 ≈216KB br（react-dom + App Router + core-js polyfills + turbopack）占 ~88%**，
   业务代码仅 ~30KB —— **代码级可裁空间已榨干**，剩余是 Next 16 Turbopack 固定成本。
3. 第三方实锤：`static.cloudflareinsights.com` 单 beacon 占 **1.0–2.1s**；GTM 内联 + `gtm.js` 每页加载。

## 4. 剩余杠杆（全部非代码 / 需立项，作战令 §6 须复核）

| 杠杆 | 预期收益 | 归属 |
|---|---|---|
| CF 控制台关闭 Web Analytics Auto-Inject | −1.0–2.1s 主线程/网络 | 用户（CF 面板） |
| 清除 `NEXT_PUBLIC_GTM_ID`（Netlify env） | −35KB 级 JS + 主线程 | 用户（Netlify env） |
| 框架基线 216KB br | 仅 Preact 替换（大改，不建议） | 不动 |
| 字体与关键 CSS 复核 | 待测量 | 待立项 |

## 5. 本轮复测判定

| 项 | 判定 | 原因 |
|---|---|---|
| 6 条核心路由（`/`、`/login`、`/register`、`/pricing`、Workspace、Console）LCP/INP/CLS/TBT | **NOT_TESTED** | 本轮未跑浏览器；且 Workspace/Console 需 D-06 登录态 |
| 每路由 5 冷 + 5 暖、报告中位数与分布 | **NOT_TESTED** | 同上 |
| 同环境同节流前后对照 | **NOT_TESTED** | 同上 |
| 性能发布门槛 | **FAIL（继承 `PERF_TARGET_NOT_MET`）** | 6544ms > 2500ms |

> 按作战令 §9.1「Performance：核心性能目标通过**或有明确发布阻断裁决**」——
> 当前属**发布阻断**状态，不得因 UI 改动直接推生产。

## 6. 无障碍（WCAG 2.2 AA）

| 项 | 判定 | 证据 |
|---|---|---|
| `npm run verify:contrast` 对比度门禁 | **PASS**（历史，2026-10-23） | `v19/06` §1：5 板块 × 15 组全 WCAG AA，含双世界与 paper 阅读模式 |
| 普通文本 ≥4.5:1 / 大字 ≥3:1 / 非文本 UI ≥3:1 | PASS（历史门禁） | 同上；本轮未复跑 |
| 键盘可操作 / 焦点可见 | **PASS（历史抽样）** | `v19/16` §3：`/` 与 `/login` 各 5 次 Tab 焦点序列，无断链 |
| 44px 触控目标 | PASS（代码） | `globals.css` L1839–1844 `@media (max-width:1023px)` + `:where()` |
| `prefers-reduced-motion` 强制 L0 | PASS（代码） | `globals.css` L1864–1870 |
| 对话框焦点管理 / 状态消息可感知 | **PASS（历史）** | `v19/29_DIALOG_ACCESSIBILITY.md`、`34_AXE_FOUR_VIEWPORTS.md` |
| axe 四视口自动检查 | **PASS（历史）** | `v19/34_AXE_FOUR_VIEWPORTS.md`、`screenshots/v194-a11y/*.json` |
| **axe 之外的人为/脚本化键盘流程全走查** | **NOT_TESTED** | 作战令 §5.4 明确要求；本轮未做 |
| 本轮改动（深链接）对焦点/键盘的影响 | **NOT_TESTED** | 未跑浏览器；`aria-current="page"` 逻辑未改动 |

## 7. 复跑命令

```bash
node scripts/qa/perf-baseline.mjs            # 同环境同节流，5 冷 + 5 暖
npm run verify:contrast                      # 对比度门禁
env -u NODE_OPTIONS npx playwright test --config playwright.ci.config.ts   # 需 D-06 登录态
```
