# V20.3 · 46 — 视觉回归（本轮判定 `NOT_TESTED`）

> 作战令 §9.2 要求每页提交：Figma 设计截图、浏览器 Before、After、视觉差异图、移动/PC 截图、
> 两种主题、Playwright Trace、网络/API 证据。**本轮未跑浏览器，一律不填臆造结果**。

## 1. 本轮判定

| 验收项 | 判定 | 原因 |
|---|---|---|
| Figma 设计截图 | **BLOCKED** | `BLOCKED_FIGMA_WRITE`，无可编辑节点可导出（见 `42`） |
| 浏览器 Before（本轮基线） | **NOT_TESTED** | 未启动浏览器 |
| 浏览器 After | **NOT_TESTED** | 未启动浏览器 |
| 视觉差异图 | **NOT_TESTED** | 依赖 Before/After |
| 390×844 / 1440×900 截图 | **NOT_TESTED** | 依赖浏览器 |
| Deep Field / Living Paper 双主题 | **NOT_TESTED** | 依赖浏览器 |
| Playwright Trace | **NOT_TESTED** | 依赖 D-06 可登录 QA 账号 |
| 网络 / API 证据 | **NOT_TESTED** | 依赖浏览器 |

## 2. 已有的历史真实截图（可作 Before，**不得当作本轮 After 自动验收**）

`docs/implementation/v19/screenshots/production-dc102cd/` 含 1440×900 与 390×844 双视口：
`home__` / `_login__` / `_register__` / `_pricing__` / `_console__` / `_workspace__` / `_hlua__` / `_refunds__` / `_pay.html__`。
来源 SHA `dc102cd`（生产旧版）。另有 `v194-a11y/` 的 axe JSON 与 `v194-perf/` 性能 JSON。

作战令 §2 明确：「核实已有 Before/After 截图，**不得当作新设计自动验收**」。本文件遵守。

## 3. 已知视觉问题（继承 `16_REAL_UI_AUDIT.md`，未修，不隐瞒）

| # | 严重度 | 问题 | 状态 |
|---|---|---|---|
| 1 | P1 | `/hlua` 生产 404（两视口） | 生产 `dc102cd` 落后 HEAD；发布即消（D-10），不另修代码 |
| 2 | P1 | 生产 404 页 390px 水平溢出（scrollWidth 453 > 390） | 待发布后复测 `not-found.tsx` |
| 3 | P2 | 404 页底部 Netlify "Powered by" 徽章 | 面板可关，不动代码 |
| 4 | BLOCKED | `/workspace` 六屏 + `/console` 七屏真实业务态 | D-06 无可登录 QA 账号 |

## 4. 本轮代码改动的视觉影响

`G-03` 深链接改动**不产生任何视觉变化**（只改 URL 与导航态同步），因此不产生新的视觉差异图需求；
但它需要交互回归（刷新/返回/分享恢复），见 `43` §5 的 NOT_TESTED 清单。

## 5. 解锁后复跑

```bash
node scripts/qa/v19-real-ui-audit.mjs                 # 16 路由 × 2 视口，产出 audit-report.json + 32 张截图
env -u NODE_OPTIONS npx playwright test --config playwright.ci.config.ts --reporter=line
# 深链接专项（待补 spec）：/workspace?view=consent 刷新仍 Consent / 返回回上一屏 / ?view=missions 回退 Now
```
