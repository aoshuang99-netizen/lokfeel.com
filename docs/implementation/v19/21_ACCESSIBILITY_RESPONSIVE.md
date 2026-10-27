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

---

## 5. 【2026-10-26】公开面键盘走查（WB19-46 补证）+ 三处缺陷已修

### 5.1 方法与工具

新增可复跑脚本 `scripts/qa/v19-a11y-public-audit.mjs`（**只测不判，永远 exit 0**）：
真实 Chromium 对 4 个公开路由 × 2 视口（390×844 / 1440×900）做**逐 Tab 遍历**，
记录每个停点的标签/可访问名/**焦点指示**（outline / box-shadow），并统计文档结构
（h1 数量、标题跳级、landmark、图片 alt、控件可访问名）。

🔴 两个测量坑（都实际踩到，写下来避免复发）：
1. **必须显式绕过系统代理**：macOS 系统代理指向本地端口（如 10808），代理一挂，
   Chromium 全部 `ERR_TIMED_OUT`，而 `curl` 直连正常 —— 会误判成"站点挂了"。
   → `chromium.launch({ args: ['--proxy-server=direct://', '--proxy-bypass-list=*'] })`。
2. **可访问名不能只看元素自身文本**：复选框包在 `<label>` 里时，名字来自 label，
   按元素自身算会得到"无名"的**假阳性**（本报告初版就误报过一次，已剔除）。

### 5.2 修复前（生产 `dc102cd`）→ 修复后（preview `429bf31`，真实浏览器实测）

| 判据 | 修复前（4 路由 × 2 视口） | 修复后 | 结论 |
|---|---|---|---|
| `<main>` landmark | **全 8 页 = N（全缺）** | **全 8 页 = Y** | ✅ 已修 |
| 标题跳级（h1→h4） | `/login` = 1 处 | **全 8 页 = 0** | ✅ 已修 |
| Tab 序闭环（无陷阱） | 8/8 闭环 | 8/8 闭环 | ✅ 本来就对 |
| 自有控件焦点指示 | 缺失 0（唯一 1 处是 Netlify 徽章 iframe） | 同样仅第三方 iframe | ✅ 本来就对 |
| 无名控件 | `/login` = 1（密码可见性按钮） | **0** | ✅ 已修 |
| 图片缺 alt | 0（1 张图有 alt） | 0 | ✅ |

`/login` 的 **Tab 停点 27 → 28**：多出来的正是密码可见性按钮 —— 它原本带
`tabIndex={-1}`（键盘用户完全够不到，属 WCAG 2.1.1 键盘可达性问题），
本次去掉并补 `aria-label` + `aria-pressed`，`reset-password` 的两个同款按钮一并修。

数据：`screenshots/v194-a11y/a11y-before-prod-dc102cd.json`、
`screenshots/v194-a11y/a11y-after-preview-429bf31.json`（含逐停点明细）。

### 5.3 代码改动（6 文件 + 1 脚本）

| 文件 | 改动 |
|---|---|
| `src/app/(public)/page.tsx` | `<header>` 之后、`<SiteFooter />` 之前包 `<main>`（nav/footer 留在 main 外） |
| `src/app/(public)/pricing/page.tsx` | 页面无自带 nav/footer，根 `<div>` → `<main>` |
| `src/app/(auth)/layout.tsx` | 认证面主内容容器 `<div>` → `<main>`（登录/注册/重置密码全部受益） |
| `public/pay.html` | `</header>` 后 `<main>`，`<footer>` 前闭合 |
| `src/app/(auth)/login/login-inner-client.tsx` | 密码可见性按钮：去掉 `tabIndex={-1}`，补 `aria-label` / `aria-pressed` |
| `src/app/(auth)/reset-password/reset-password-client.tsx` | 两个同款按钮同样处理（一致修） |
| `src/components/layout/footer.tsx` | 栏目标题 `h4` → `h2`（页脚分组是 footer 内一级，样式走 class，视觉不变；`globals.css` 无 h4 选择器，已核） |

### 5.4 诚实边界

- 修复的**浏览器复验只在 preview**（`deploy-preview-32`，构建自 `429bf31`）做了；
  生产仍是旧代码，要等 D-10/合并后才在 `app.lokfeel.com` 生效。
- 生产侧 `/pricing` 实测是 **307 → `/pay.html`**，所以"修复前 `/pricing`"那一行
  实际量的是 pay.html 的表单元素（这也解释了它和 pay.html 的 Tab 数相同）。
- 仍有 **PENDING（本轮未解）**：抽屉/弹窗 **focus trap**（`living-shell` Inspector）、
  错误提示的 `aria-describedby` 逐个核、软键盘遮挡（需真机/可信模拟）、
  登录后业务面（`/workspace`、`/console/*`）的键盘走查 —— 后两项都要 D-06 账号才能测。

---

## 6. 【2026-10-27】对话框键盘行为 + 表单错误播报（aria-describedby 项闭环）

### 6.1 盘点结论（先盘后改）

- **全仓 0 处 `aria-describedby`** —— 表单错误提示从未与输入框程序化关联。
- **共享 `ui/dialog.tsx` 基元零消费者**（grep 实证）——改它无实际影响，真实弹窗各自实现。
- **公开面唯一弹窗** = 落地页 `QuickSignupModal`。修复前缺口（读码 + 浏览器实测确认）：
  无 `role="dialog"`/`aria-modal`、无 Escape 关闭、无 focus trap、无焦点恢复、
  X 关闭按钮纯图标无名（与密码可见性按钮同款缺陷）、`<label>` 无 `htmlFor`、
  错误 `<p>` 无任何播报机制。

### 6.2 改动（提交 `17a215d`，CI 19 success / 0 失败）

| 文件 | 改动 |
|---|---|
| `src/lib/a11y/use-dialog-a11y.ts`（新增） | 键盘对话框行为 hook：Escape 关闭、Tab 圈定容器内、开时聚焦首个可聚焦元素、关时恢复焦点。只接管键盘/焦点，不碰视觉 |
| `quick-signup-modal.tsx` | 接入 hook；`role="dialog"` + `aria-modal` + `aria-label`；X 按钮补 `aria-label`；全部 `<label htmlFor>` 关联；错误 `<p role="alert">` + 输入框 `aria-describedby`；OTP 输入补 sr-only label + `inputMode="numeric"` + `autoComplete="one-time-code"` |
| `login-inner-client.tsx` | 错误容器 `role="alert"`；email/password 输入框错误时 `aria-describedby="login-error"` |
| `register/page.tsx` | 三处错误容器 `role="alert"`（多步表单逐字段 describedby 关联另排期） |
| `reset-password-client.tsx` | 错误容器 `role="alert"` |

### 6.3 浏览器实测（preview `17a215d`，真实 Chromium，10/10 PASS）

| 行为 | 结果 |
|---|---|
| `role="dialog"` 存在 / `aria-modal="true"` / `aria-label` 非空 | ✅ |
| 打开后焦点自动进入弹窗 | ✅ |
| **Tab 圈定**：连续 20 次 Tab 焦点始终在弹窗内 | ✅ |
| **Escape 关闭** 且焦点恢复到触发按钮（"Create an account"） | ✅ |
| 错误以 `role="alert"` 播报（gender 步骤空选路径） | ✅ |
| X 关闭按钮有 aria-label（"Close signup dialog"） | ✅ |
| `label[for]` 与输入框程序化关联 ≥2 | ✅ |

🔴 探针陷阱（记下避免复发）：登录/注册表单 input 带 `required`，**浏览器原生校验会拦截
空表单提交**，React 错误路径根本不执行——"空表单提交"探针显示 alerts=0 是探针路径错误
而非代码缺陷；有效测法是走无原生校验的步骤（gender 纯按钮选择）触发 React 校验路径。

### 6.4 诚实边界

- focus trap 已应用于公开面唯一弹窗并实测；`ReportModal`/`ConfirmDialog`/`VideoCallModal`
  等**认证面弹窗尚未接入 hook**（无法在无账号环境实测，等 D-06；hook 本身可复用）。
- register 多步表单的逐字段 `aria-describedby` 关联、Inspector 抽屉 focus trap、
  软键盘遮挡、登录后业务面键盘走查：仍 PENDING（需 D-06 或另排期）。

---

## 6. 【2026-10-27】对话框键盘行为 + 表单错误播报（aria-describedby 项闭环）

### 6.1 盘点结论（先盘后改）

- **全仓 0 处 `aria-describedby`** —— 表单错误提示从未与输入框程序化关联。
- **共享 `ui/dialog.tsx` 基元零消费者**（grep 实证）——改它无实际影响，真实弹窗各自实现。
- **公开面唯一弹窗** = 落地页 `QuickSignupModal`。修复前缺口（读码 + 浏览器实测确认）：
  无 `role="dialog"`/`aria-modal`、无 Escape 关闭、无 focus trap、无焦点恢复、
  X 关闭按钮纯图标无名（与密码可见性按钮同款缺陷）、`<label>` 无 `htmlFor`、
  错误 `<p>` 无任何播报机制。

### 6.2 改动（提交 `17a215d`，CI 19 success / 0 失败）

| 文件 | 改动 |
|---|---|
| `src/lib/a11y/use-dialog-a11y.ts`（新增） | 键盘对话框行为 hook：Escape 关闭、Tab 圈定容器内、开时聚焦首个可聚焦元素、关时恢复焦点。只接管键盘/焦点，不碰视觉 |
| `quick-signup-modal.tsx` | 接入 hook；`role="dialog"` + `aria-modal` + `aria-label`；X 按钮补 `aria-label`；全部 `<label htmlFor>` 关联；错误 `<p role="alert">` + 输入框 `aria-describedby`；OTP 输入补 sr-only label + `inputMode="numeric"` + `autoComplete="one-time-code"` |
| `login-inner-client.tsx` | 错误容器 `role="alert"`；email/password 输入框错误时 `aria-describedby="login-error"` |
| `register/page.tsx` | 三处错误容器 `role="alert"`（多步表单逐字段 describedby 关联另排期） |
| `reset-password-client.tsx` | 错误容器 `role="alert"` |

### 6.3 浏览器实测（preview `17a215d`，真实 Chromium，10/10 PASS）

| 行为 | 结果 |
|---|---|
| `role="dialog"` 存在 / `aria-modal="true"` / `aria-label` 非空 | ✅ |
| 打开后焦点自动进入弹窗 | ✅ |
| **Tab 圈定**：连续 20 次 Tab 焦点始终在弹窗内 | ✅ |
| **Escape 关闭** 且焦点恢复到触发按钮（"Create an account"） | ✅ |
| 错误以 `role="alert"` 播报（gender 步骤空选路径） | ✅ |
| X 关闭按钮有 aria-label（"Close signup dialog"） | ✅ |
| `label[for]` 与输入框程序化关联 ≥2 | ✅ |

🔴 探针陷阱（记下避免复发）：登录/注册表单 input 带 `required`，**浏览器原生校验会拦截
空表单提交**，React 错误路径根本不执行——"空表单提交"探针显示 alerts=0 是探针路径错误
而非代码缺陷；有效测法是走无原生校验的步骤（gender 纯按钮选择）触发 React 校验路径。

### 6.4 诚实边界

- focus trap 已应用于公开面唯一弹窗并实测；`ReportModal`/`ConfirmDialog`/`VideoCallModal`
  等**认证面弹窗尚未接入 hook**（无法在无账号环境实测，等 D-06；hook 本身可复用）。
- register 多步表单的逐字段 `aria-describedby` 关联、Inspector 抽屉 focus trap、
  软键盘遮挡、登录后业务面键盘走查：仍 PENDING（需 D-06 或另排期）。

---

## 6. 【2026-10-27】对话框键盘行为 + 表单错误播报（aria-describedby 项闭环）

### 6.1 盘点结论（先盘后改）

- **全仓 0 处 `aria-describedby`** —— 表单错误提示从未与输入框程序化关联。
- **共享 `ui/dialog.tsx` 基元零消费者**（grep 实证）——改它无实际影响，真实弹窗各自实现。
- **公开面唯一弹窗** = 落地页 `QuickSignupModal`。修复前缺口（读码 + 浏览器实测确认）：
  无 `role="dialog"`/`aria-modal`、无 Escape 关闭、无 focus trap、无焦点恢复、
  X 关闭按钮纯图标无名（与密码可见性按钮同款缺陷）、`<label>` 无 `htmlFor`、
  错误 `<p>` 无任何播报机制。

### 6.2 改动（提交 `17a215d`，CI 19 success / 0 失败）

| 文件 | 改动 |
|---|---|
| `src/lib/a11y/use-dialog-a11y.ts`（新增） | 键盘对话框行为 hook：Escape 关闭、Tab 圈定容器内、开时聚焦首个可聚焦元素、关时恢复焦点。只接管键盘/焦点，不碰视觉 |
| `quick-signup-modal.tsx` | 接入 hook；`role="dialog"` + `aria-modal` + `aria-label`；X 按钮补 `aria-label`；全部 `<label htmlFor>` 关联；错误 `<p role="alert">` + 输入框 `aria-describedby`；OTP 输入补 sr-only label + `inputMode="numeric"` + `autoComplete="one-time-code"` |
| `login-inner-client.tsx` | 错误容器 `role="alert"`；email/password 输入框错误时 `aria-describedby="login-error"` |
| `register/page.tsx` | 三处错误容器 `role="alert"`（多步表单逐字段 describedby 关联另排期） |
| `reset-password-client.tsx` | 错误容器 `role="alert"` |

### 6.3 浏览器实测（preview `17a215d`，真实 Chromium，10/10 PASS）

| 行为 | 结果 |
|---|---|
| `role="dialog"` 存在 / `aria-modal="true"` / `aria-label` 非空 | ✅ |
| 打开后焦点自动进入弹窗 | ✅ |
| **Tab 圈定**：连续 20 次 Tab 焦点始终在弹窗内 | ✅ |
| **Escape 关闭** 且焦点恢复到触发按钮（"Create an account"） | ✅ |
| 错误以 `role="alert"` 播报（gender 步骤空选路径） | ✅ |
| X 关闭按钮有 aria-label（"Close signup dialog"） | ✅ |
| `label[for]` 与输入框程序化关联 ≥2 | ✅ |

🔴 探针陷阱（记下避免复发）：登录/注册表单 input 带 `required`，**浏览器原生校验会拦截
空表单提交**，React 错误路径根本不执行——"空表单提交"探针显示 alerts=0 是探针路径错误
而非代码缺陷；有效测法是走无原生校验的步骤（gender 纯按钮选择）触发 React 校验路径。

### 6.4 诚实边界

- focus trap 已应用于公开面唯一弹窗并实测；`ReportModal`/`ConfirmDialog`/`VideoCallModal`
  等**认证面弹窗尚未接入 hook**（无法在无账号环境实测，等 D-06；hook 本身可复用）。
- register 多步表单的逐字段 `aria-describedby` 关联、Inspector 抽屉 focus trap、
  软键盘遮挡、登录后业务面键盘走查：仍 PENDING（需 D-06 或另排期）。
