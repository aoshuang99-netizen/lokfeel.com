# 全站页面正确性检查报告

| 项 | 值 |
| --- | --- |
| 被测对象 | `https://app.lokfeel.com`（生产，非 Preview、非本地） |
| 生产版本 | `eb53f39`（`/api/health` → `commit=eb53f39`、`status=healthy`，与 `git ls-remote` main 头一致） |
| 检查时间 | 2026-11-13 20:50 – 21:10 GMT+8 |
| 检查方式 | ① 82 条路径 HTTP 直取（禁跟随重定向）② 35 个公开页 × 2 视口 = 70 次真实浏览器运行（Chrome 147，Playwright）③ axe-core 4.x WCAG 2.0/2.1 A+AA ④ 站内链接爬取 ⑤ 静态源码交叉核对 |
| 仪器口径 | 桌面 1440×900、移动 390×844；`networkidle` + 400ms 静置后取样；axe 仅计 `serious`/`critical` |
| 原始数据 | `evidence/page-correctness-2026-11-13/{http-sweep,browser-audit,link-crawl}.json` |

---

## 一、结论摘要

**没有一页是坏的：0 个 5xx、0 个错误页、0 个白屏报错、0 个控制台错误、0 个横向溢出、0 条断链。**
但存在 **12 项内容/可访问性/索引层面的缺陷**（3 项 P1、4 项 P2、5 项 P3），其中 1 项会让搜索引擎把整站子页从索引里删掉。

| 维度 | 范围 | 通过 | 失败 |
| --- | --- | --- | --- |
| HTTP 可达性 | 82 条路径 | 82 | 0 |
| 响应体错误特征（`Application error` / `digest:` / `MISSING_MESSAGE` / `Internal Server Error`） | 82 | 82 | 0 |
| 状态码语义（公开页 200 / 受保护 307 / 未知 404 / 静态重定向 308） | 82 | 82 | 0 |
| 浏览器控制台错误、未捕获异常、请求失败 | 70 次运行 | 70 | 0 |
| 横向溢出（移动端 390px） | 35 页 | 35 | 0 |
| 图片资源损坏（`naturalWidth=0`） | 70 次运行 | 70 | 0 |
| 空可点击目标（无文本无 aria-label） | 70 次运行 | 70 | 0 |
| 语义标题（恰好 1 个 `<h1>`） | 35 页 | 34 | 1 |
| axe serious/critical = 0 | 70 次运行 | 64 | 6（3 页） |
| 站内链接可达 | 29 条 | 29 | 0 |
| 品牌与法人表述一致 | 35 页 | 9 | 26 页含旧品牌 `LokFee!`；3 页含未核实法人 |

---

## 二、缺陷清单（按严重度）

### P1-1 · 全站 canonical 都指向首页，子页等于自请出索引

- **现象**：`/pricing`、`/terms`、`/about`、`/faq`、`/refunds`、`/dmca`、`/careers`、`/support`、`/holding`、`/product`、`/help`、`/hlua`、`/checkout/success`，以及 `/login`、`/register` 全部输出
  `<link rel="canonical" href="https://app.lokfeel.com">`（首页）。
- **根因**：`src/app/layout.tsx:47-48` 在根布局写死
  `alternates: { canonical: 'https://app.lokfeel.com' }`，全仓仅此一处定义，没有任何页面用自己的 `alternates` 覆盖（`grep -rn "alternates" src/app` 只命中这一行）。
- **影响**：canonical 是“这一页的正本在哪”的声明。所有子页都声明“正本是首页”，爬虫会把这些页判为重复内容而不收录。等于花钱做的定价页、条款页、FAQ 一页都进不了搜索结果。
- **为什么之前没发现**：所有道此前只断言“canonical 存在”（检查脚本打印 `canon=Y` 就放过），没有断言“canonical 等于本页 URL”。存在性检查恒真，是典型的假绿。
- **修法**：根布局改为 `alternates: { canonical: './' }`（Next 会按当前路由解析），或删掉根级 canonical 让各页自报；随后加一条断言：任一页的 canonical 必须等于其自身最终 URL。

### P1-2 · 导航栏 logo 渲染的是旧品牌 “LokFee!”，26 个内页全中

- **现象**：`/pricing`、`/about`、`/terms`、`/privacy`、`/dmca`、`/product`、`/help` 等内页左上角 logo 文案是 **`LokFee!`**（带感叹号，旧约会产品名），页脚和 `<title>` 却是 `LokFeel`。
- **证据**：全量 35 页逐页比对，**26 页可见文本含 `LokFee!`**（`/pricing /blocked /about /faq /contact /community-guidelines /safety-tips /cookies /press /terms /privacy /refunds /support /careers /dmca /hlua /18-usc-2257 /cancellations-policy /content-removal-appeals-policy /fan-creator-agreement /product /solutions /stories /how-it-works /help /checkout/success`）。
- **范围为什么不是全部**：`/`、`/login`、`/register`、`/forgot-password`、`/verify-request`、`/admin-login`、`/auto-login`、`/holding`、`/invitations/accept` 这 9 页**没有**该串 —— 首页用的是另一套头图/导航，登录注册是独立布局。也就是说：**首页是对的，一进内页就换成了旧品牌**。这说明问题不在文案，而在内页共享的那个导航组件。
- **影响**：站点在卖 SaaS，抬头却是另一个产品的名字。这不是风格问题，是合同主体、发票抬头、商标一致性都会对不上的问题。
- **修法**：导航组件里把品牌字面量换成 `src/config/brand.ts` 的 `BRAND.name`，禁止再出现硬编码品牌串；CI 加一条 `grep -r "LokFee!" src/` 必须为空的守卫。

### P1-3 · `/checkout/success` 主按钮 1.5:1，是同一类 bug 的漏页

- **现象**：`<a class="... bg-primary ... text-white">` 实测对比度 **1.5:1**（要求 4.5:1）。
- **根因**：白天修定价页按钮时补了 `--color-primary-foreground`，但这一页硬编码 `text-white` 而不是 `text-primary-foreground`，所以没被那次修复覆盖。
- **影响**：这是**付完钱之后**的第一屏。用户刚扣款成功，看到的 CTA 几乎不可读。
- **修法**：`src/app/(public)/checkout/success/page.tsx` 把 `text-white` 改为 `text-primary-foreground`；同时全局 grep `bg-primary` 与 `text-white` 共现的节点，一次清干净。

### P2-1 · 三份政策文件仍写着未核实的法人主体

- **现象**：`/dmca`、`/cancellations-policy`、`/content-removal-appeals-policy` 的正文仍含
  `LokFeel Inc. Wilmington, Delaware, USA`。
- **背景**：11-13 上午的“法人清洗”只覆盖了 terms / privacy / refunds / contact 四页，这三页漏了；`BRAND.legalName` 早已改为 `LokFeel`。
- **影响**：DMCA 通知地址写的是一个未经核实的法律主体，收到真实 DMCA 时这份地址在法律上站不住；同时与条款页自相矛盾。
- **修法**：三页统一改为 `BRAND.legalName` + 真实通信地址（需所有者提供）；在此之前不要写虚构的州与城市。

### P2-2 · `/blocked` 是旧约会产品的页面，且对比度不足

- **现象**：文案 `LokFee! — Find Real Love. No Swiping.`、`Detected region: Mainland China`，对比度 2.69:1，邮箱还是 `[email protected]` 混淆串。
- **影响**：地区拦截页是新用户可能看到的第一屏，现在讲的是另一个产品；`[email protected]` 说明邮箱地址渲染失败，用户拿不到联系方式。
- **修法**：换成 LokFeel 文案 + 真实 `support@` 地址；对比度提到 4.5:1。若这条 B2C 线已下线，直接 410 或并入 `/holding`。

### P2-3 · `/admin-login` 四处对比度不足（3.67 / 2.57）

- 提交按钮 `#fff` on `#3b82f6` = 3.67:1；版本号 `zinc-500` on `zinc-900` = 3.67:1；返回链接同 3.67:1；版权行 `zinc-600` = 2.57:1。
- 影响：管理员登录页，属于内部页面，优先级低于对外页，但仍是 WCAG AA 不达标。
- 修法：蓝色底改 `blue-700`（4.5:1 以上）；`zinc-500/600` 提到 `zinc-400`。

### P2-4 · `/dashboard/users/[userId]` 未登录返回 200 空白页

- **现象**：其余 `/dashboard/*` 全部 307 → `/login?callbackUrl=%2Fdashboard`，唯独这一条返回 **200、可见文本仅有标题、无任何内容**。
- **根因**：`src/app/dashboard/users/[userId]/page.tsx` 是 `"use client"` + `useSession`，会话未就绪时 `return null`，而它不在 `(dashboard)` 路由组的鉴权布局下（该组已有 `src/app/dashboard/layout.tsx` 做守卫）。
- **影响**：匿名访问得到一个“存在但空白”的 200，爬虫会收录一个空页；用户点进去以为站坏了。
- **修法**：把该路由并入受保护布局，或页面内 `useEffect` 在 `unauthenticated` 时 `router.replace('/login?callbackUrl=...')`；同时服务端返回 307 更彻底。

### P3-1 · `/auto-login` 是一条走不通的死流程，却告诉用户“已验证”

- **链路**：读取 `?email=` → `POST /api/auth/check-user` → 该接口**恒返回 `exists:false`**（防枚举）→ 页面显示 “Email verified! Redirecting to dashboard...” → 1500ms 后跳 `/register?email=...&verified=true`。
- **安全性**：**不存在后门**。`src/lib/auth/config.ts` 的 `authorize()` 走真实 `verifyPassword`，代码里那个 `password: "MAGIC_LINK_AUTH"` 永远无法通过校验，且该分支因 `exists:false` 根本到不了。
- **问题**：文案撒谎（没验证就说已验证）、逻辑永远走不到“登录成功”、白留一个公开路由。品牌仍是 `LokFee!`。
- **修法**：删除该路由（或 302 到 `/login`），把“邮箱验证”真正做在验证邮件里；若要保留，文案改为“正在跳转注册”。

### P3-2 · 8 个页面共用同一个 `<title>`

`/` `/login` `/register` `/forgot-password` `/verify-request` `/auto-login` `/blocked` `/invitations/accept` 的 title 都是 `LokFeel — Connection OS for AI-native teams`。另外 `/18-usc-2257` 与 `/fan-creator-agreement` 共用 `Retired document | LokFeel`。

影响：浏览器多标签页、分享卡片、搜索结果里分不清是哪一页。登录/注册页应有自己的标题。

### P3-3 · `/invitations/accept` 无 `<h1>`、正文仅 46 字符

页面停在“正在加载邀请…”，服务端输出没有任何标题元素。若脚本失败，用户面对一页空白无标题的 200。建议加 `<h1>` 与服务端兜底文案（“邀请链接无效”）。

### P3-4 · 404 页主 CTA 是 “Go to Dashboard”，对匿名用户无意义

404 页首个按钮指向 `/dashboard`，匿名点击会 307 弹回登录页 —— 404 → 登录 → 登录后仍不知道原来要找什么。建议主 CTA 为“返回首页”，次 CTA 才是登录。

### P3-5 · sitemap 漏了 6 个已提供链接的页面

sitemap 收录 13 条。站内实际可点、返回 200、却不在 sitemap 的：
`/refunds`、`/support`、`/careers`、`/dmca`、`/cancellations-policy`、`/content-removal-appeals-policy`。
反过来 sitemap 里没有死链（13 条全部 200）。五个冻结页（`/product` `/solutions` `/stories` `/how-it-works` `/help`）正确排除 —— 这一项是对的。

---

## 三、逐页结果（35 个公开页，双视口）

`HTTP`=服务端状态码；`字数`=可见文本长度；`h1`=标题元素数量；`axe`=两视口 serious/critical 合计；`err`=控制台错误合计；`溢出`=移动端横向溢出像素。

| 页面 | HTTP | 字数 | h1 | axe | err | 溢出 | 判定 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/` | 200 | 3805 | 1 | 0 | 0 | 0 | 通过 |
| `/pricing` | 200 | 1679 | 1 | 0 | 0 | 0 | 通过 |
| `/login` | 200 | 509 | 1 | 0 | 0 | 0 | 通过（title 重复、视频 range 中断见注） |
| `/register` | 200 | 1290 | 1 | 0 | 0 | 0 | 通过（title 重复） |
| `/forgot-password` | 200 | 450 | 1 | 0 | 0 | 0 | 通过（title 重复） |
| `/verify-request` | 200 | 580 | 1 | 0 | 0 | 0 | 通过（title 重复） |
| `/admin-login` | 200 | 472 | 1 | 2 | 0 | 0 | **不通过** P2-3 |
| `/auto-login` | 200 | 386 | 1 | 0 | 0 | 0 | **不通过** P3-1 |
| `/holding` | 200 | 81 | 1 | 0 | 0 | 0 | 通过（空态页，字数少属预期） |
| `/blocked` | 200 | 324 | 1 | 2 | 0 | 0 | **不通过** P2-2 |
| `/about` | 200 | 2984 | 1 | 0 | 0 | 0 | 通过 |
| `/faq` | 200 | 3787 | 1 | 0 | 0 | 0 | 通过 |
| `/contact` | 200 | 1413 | 1 | 0 | 0 | 0 | 通过 |
| `/community-guidelines` | 200 | 1399 | 1 | 0 | 0 | 0 | 通过 |
| `/safety-tips` | 200 | 2307 | 1 | 0 | 0 | 0 | 通过 |
| `/cookies` | 200 | 5094 | 1 | 0 | 0 | 0 | 通过 |
| `/press` | 200 | 1454 | 1 | 0 | 0 | 0 | 通过 |
| `/terms` | 200 | 8764 | 1 | 0 | 0 | 0 | 通过 |
| `/privacy` | 200 | 8371 | 1 | 0 | 0 | 0 | 通过 |
| `/refunds` | 200 | 3934 | 1 | 0 | 0 | 0 | 通过（sitemap 缺） |
| `/support` | 200 | 1141 | 1 | 0 | 0 | 0 | 通过（sitemap 缺） |
| `/careers` | 200 | 1387 | 1 | 0 | 0 | 0 | 通过（sitemap 缺） |
| `/dmca` | 200 | 2914 | 1 | 0 | 0 | 0 | **不通过** P2-1 |
| `/hlua` | 200 | 865 | 1 | 0 | 0 | 0 | 通过 |
| `/18-usc-2257` | 200 | 1002 | 1 | 0 | 0 | 0 | 通过（title 与下一行重复） |
| `/cancellations-policy` | 200 | 3926 | 1 | 0 | 0 | 0 | **不通过** P2-1 |
| `/content-removal-appeals-policy` | 200 | 3590 | 1 | 0 | 0 | 0 | **不通过** P2-1 |
| `/fan-creator-agreement` | 200 | 992 | 1 | 0 | 0 | 0 | 通过 |
| `/product` | 200 | 430 | 1 | 0 | 0 | 0 | 通过（封存页，见注） |
| `/solutions` | 200 | 430 | 1 | 0 | 0 | 0 | 通过（封存页） |
| `/stories` | 200 | 430 | 1 | 0 | 0 | 0 | 通过（封存页） |
| `/how-it-works` | 200 | 430 | 1 | 0 | 0 | 0 | 通过（封存页） |
| `/help` | 200 | 430 | 1 | 0 | 0 | 0 | 通过（封存页） |
| `/checkout/success` | 200 | 577 | 1 | 2 | 0 | 0 | **不通过** P1-3 |
| `/invitations/accept` | 200 | 46 | 0 | 0 | 0 | 0 | **不通过** P3-3 |

### 五页封存复核

`/product` `/solutions` `/stories` `/how-it-works` `/help` 五页均为 200，`<h1>` 为「该页面正在最终审核」，响应头带 `x-robots-tag: noindex, nofollow`、`cache-control: max-age=0, must-revalidate`，`<meta name="robots" content="noindex, nofollow">` 同时在位。**但 `<title>` 仍是 `Product | LokFeel` / `Help center | LokFeel`**，说明页面 metadata 未随渲染层封存一起改。不影响索引（有 noindex），属一致性瑕疵。

---

## 四、受保护与动态路由（47 条）

全部按预期行为，无一是“假 200”：

| 分组 | 条数 | 行为 | 判定 |
| --- | --- | --- | --- |
| `/workspace` | 1 | 307 → `/login?callbackUrl=%2Fworkspace` | 通过 |
| `/console*`（7 条） | 7 | 307 → `/login?callbackUrl=%2Fconsole` | 通过 |
| `/dashboard*`（11 条） | 11 | 307 → `/login?callbackUrl=%2Fdashboard` | 通过 |
| `/admin*`（13 条） | 13 | 307 → `/admin-login` | 通过 |
| `/debug/google-oauth`、`/admin-test` | 2 | 307 → `/admin-login`（生产不暴露调试面） | 通过 |
| `/m/{token}` 系列（4 条，伪 token） | 4 | **404**（未知令牌不渲染空壳） | 通过 |
| `/dashboard/chats|profile/{id}`（伪 id） | 2 | 307 → 登录 | 通过 |
| `/dashboard/matches/{id}` | 1 | 308 → `/dashboard/connections`（旧路径永久重定向） | 通过 |
| `/console/missions/{id}`、`/admin/users/{id}` | 2 | 307 → 登录 | 通过 |
| `/dashboard/users/{id}` | 1 | **200 空白页** | **不通过** P2-4 |
| `/reset-password` 无 token | 1 | 307 → `/forgot-password`（有 token 才出表单） | 通过 |
| `/this-route-does-not-exist-xyz`、`/pricing/nope` | 2 | 404 + 404 渲染 + h1 | 通过（CTA 见 P3-4） |

---

## 五、站内链接

29 条唯一内部链接（从 17 个页面提取，已排除 `_next`/`api`/静态资源）：**28 条 200、1 条 307（受保护页）、0 条 ≥400**。
`manifest.json`、`/.well-known/agent-card.json` 均可访问（前者被本报告排除在页面检查外，但 HTTP 正常）。

---

## 六、明确排除的“不是缺陷”

| 现象 | 判定依据 |
| --- | --- |
| `/login` 移动端 `background-mobile-720p.mp4` 报 `net::ERR_ABORTED` | 同一 URL 另有一次 206 成功；`video.readyState=4`（可播放）、`paused=false`、宽度 437px 正常渲染。是浏览器对重复 range 请求的主动中断，非资源缺失 |
| `/videos/background-1080p.mp4` 我初次探测得到 404 | 文件名写错。实际文件为 `background-desktop-1080p.mp4`，实测 200 / 3.18MB；`webm` 版 200 / 1.19MB |
| `/holding` 仅 81 字、`/invitations/accept` 仅 46 字 | 前者是空态审核页，属设计；后者见 P3-3 |
| `/reset-password` 直接 307 | 服务端要求 `token`+`email` 同时存在，缺则回 `/forgot-password`，是正确防线 |
| `/admin`、`/console` 等 307 而非 403 | 未登录场景下跳登录页是对的；登录后 403/503 的场景需账户态，本次未覆盖（见第七节） |

---

## 七、本次未覆盖（需账户态或外部条件）

以下无法用匿名请求判定，报告**不对其做通过/不通过结论**：

1. **登录后的页面**：`/workspace`、`/console/*`、`/dashboard/*`、`/admin/*` 的真实渲染、数据正确性、权限边界（需 QA 账号会话）。
2. **支付闭环后的页面**：`/checkout/success` 在有真实会话与 `session_id` 时的内容、`/dashboard/subscription/*` 的订阅状态一致性（需真实或沙箱扣款）。
3. **`/m/{token}` 有效令牌**：需真实邀请令牌。
4. **多语言**：全站未见语言切换，未测 i18n 分支。

---

## 八、修复优先级建议

| 序 | 缺陷 | 影响面 | 改动量 | 是否阻塞对外营业 |
| --- | --- | --- | --- | --- |
| 1 | P1-1 canonical 全站指向首页 | 全部子页索引 | 1 行 + 1 条断言 | 不阻塞收款，阻塞获客 |
| 2 | P1-2 导航旧品牌 `LokFee!` | 34 页抬头 | 1 处组件 | 是（对外品牌不一致） |
| 3 | P1-3 `/checkout/success` 1.5:1 | 付款后首屏 | 1 个 class | 是（付完钱看不清下一步） |
| 4 | P2-1 三页法人主体 | DMCA 法律效力 | 3 页文案 | 是（合规） |
| 5 | P2-2 `/blocked` 旧产品文案 | 地区拦截首屏 | 1 页 | 是 |
| 6 | P2-3 `/admin-login` 对比度 | 内部页 | 4 处色值 | 否 |
| 7 | P2-4 `/dashboard/users/[id]` 空 200 | legacy 线 | 路由守卫 | 否 |
| 8 | P3-1…P3-5 | 体验/索引完整性 | 各自独立小改 | 否 |

---

## 九、复现命令

```bash
# HTTP 全路由（82 条）
env -u NODE_OPTIONS node <sweep.mjs>            # 数据已归档 http-sweep.json

# 浏览器全页（35 页 × 2 视口，含 axe）
env -u NODE_OPTIONS node <pageaudit.mjs>        # 数据已归档 browser-audit.json

# 站内链接（29 条）
env -u NODE_OPTIONS node <links.mjs>            # 数据已归档 link-crawl.json
```

脚本为本次一次性审计用，未入库（仓库 lint 棘轮会拒收未加 selftest 的 `scripts/qa/*`）。原始 JSON 已随本报告归档，可离线复算全部数字。
