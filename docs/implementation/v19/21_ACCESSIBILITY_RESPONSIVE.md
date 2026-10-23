# V19-21 · 无障碍与响应式回归（WB19-46）

> **状态：部分证据（2026-10-23）。** 本报告只写**有真实证据**的格子；没有的如实标 PENDING，不凑数。

## 1. 视口覆盖

| 视口 | 覆盖方式 | 状态 |
|---|---|---|
| 390×844 | ① CI 门禁：`mobile.spec.ts`（公开 6 路由）+ `authed-mobile.spec.ts`（认证 9 屏）+ `workspace-tabs.spec.ts`（6 页签）——溢出 ≤1px + 触控 ≥24px + `waitForStableDom`；② 本轮 16 审计：公开 8 路由真实截图 | **PASS**（CI 于 `c3213fd`；审计今日生产实拍） |
| 360×800 | `legacy-mobile.spec.ts` 4 视口同判（24 条版面 + 3 交互） | **PASS**（CI 于 `bba8c36`/`c3213fd`） |
| 768×1024 | 同上 | **PASS** |
| 1440×900 | 同上（页脚缺陷即被此视口抓到并修复）；本轮 16 审计公开面复拍 | **PASS** |

## 2. 检查项矩阵

| 检查项 | 证据 | 状态 |
|---|---|---|
| 颜色对比度 | `verify:contrast` 5 板块 × 15 组 WCAG AA（2026-10-23 本地实跑 ✓） | **PASS** |
| Reduced Motion | `prefers-reduced-motion: reduce` 强制动效档位 0（`globals.css` L1864–1870，CSS 级保证）+ CI `audit:release` 含 reduced-motion 检查 | **PASS**（CSS 门禁级） |
| 触控目标 | 窄视口 44px 全局规则（`:where()` 0 特异性）+ E2E 24px 断言 | **PASS** |
| 水平溢出 | E2E 四视口断言 + 16 审计实测（唯一溢出 = 生产旧 404 页，已记 `16` §4） | **PASS**（发布后复测 404 页） |
| Focus Visible | `.lf-focus-ring`（`--lf-signal` 2px outline）+ 16 审计键盘抽样（`/`、`/login` Tab 序无断链） | **PASS**（抽样级；全屏走查 PENDING） |
| 屏幕阅读器语义 | 组件级 aria：`stage-rail`（nav+aria-label/aria-describedby）、living-shell 抽屉（aria-expanded/label）、表格语义 | **部分**（代码级；读屏真人走查 PENDING） |
| 动态内容公告 | `role="status"`（agent 诚实块）等 | **部分** |
| Modal/Drawer 焦点管理 | living-shell Inspector 抽屉有 aria-expanded/关闭按钮；**焦点陷阱（focus trap）未实现/未测** | **PENDING** |
| 错误提示关联 | `LivingErrorBox` 等（aria 关联未逐个核） | **PENDING** |
| 软键盘遮挡 | 需真机或可信模拟（CDP 虚拟键盘），本轮未测 | **PENDING** |

## 3. PENDING 清单（下一轮输入）

1. Drawer/Modal 焦点陷阱 + Esc 关闭的行为测试；
2. 错误提示 aria-describedby 关联逐屏核；
3. 软键盘弹出后输入与提交控件可见性（390px 真机/模拟）；
4. 全屏键盘走查（16 审计只抽样 2 屏）。
