# E2E 深度检查 · 修复与回归报告

| 项 | 值 |
| --- | --- |
| 承接 | `20_E2E_FULL_REPORT.md`（2026-11-14 全量 E2E 深度检查） |
| 触发 | 用户「继续执行任务」 + 「dashboard 没有更新到最新的版本」 |
| 生产版本 | **`53f6a21`**（`/api/health` `commit=53f6a21`、`status=healthy`） |
| 关键提交 | `c1571c8`（canonical / 对比度 / 用例幂等 / 登录退避）→ `4f82325`（默认落点切主线）→ `53f6a21`（`__Secure-` 会话 cookie 补齐） |
| 部署 | Netlify `production` 三次 deploy 全部 `ready`，最后 `4f82325` 与 `53f6a21` 由 webhook 自动触发 |
| 证据目录 | `evidence/e2e-fix-2026-11-14/` |

---

## 一、先更正一处错误结论（诚信优先）

`20` 号报告初版把「**E2E 根本没有进 CI**」列为最严重缺陷。**这是误判，已撤销。**

`.github/workflows/ci.yml:352` 起就有完整的 `e2e` job，一条不缺：
一次性 `file:` 库 + 双迁移 → `npm run build` → `next start` → payment-off / V18 隔离 / V196 运行链 / V198 工作区探针 →
认证面与聊天夹具 seed → `npx playwright test --config=playwright.ci.config.ts` → axe 四视口棘轮 →
`if: always()` 双夹具清理；浏览器安装带缓存和 8 分钟硬上限；runner 是 `ubuntu-latest`。

**误判原因**：只看了 `.github/workflows/` 的**文件名列表**（确实没有独立的 `e2e.yml`），
没有读 `ci.yml` 内部就下了全称否定。这正是本报告自己强调的「集合断言先证前置非空」反例：
**空结果既可能是"真没有"，也可能是"搜错了地方"**，不做正面对照就不能判。

连带修正两处口径：
- N-1（用例不幂等）：CI 每轮 `prisma db push` 新建库 + 重新 seed，前置天然干净，
  所以**不会让 CI 每天红**；它只影响复用本地库连跑/复验。
- N-4（mac13 装不了 Chromium）：CI 本来就是 `ubuntu-latest`，只影响本地取证。

`20` 号报告已就地加勘误块，N-5 改标为 C-1，建议动作表与继承缺陷表同步更新。

---

## 二、实际修复了什么

### 1. P1-1 · 全站 canonical 指向首页

- **根布局**（`src/app/layout.tsx`）删掉写死的 `canonical: 'https://app.lokfeel.com'`
  与 `openGraph.url`；子页不再继承"正本是首页"的错误声明。
- **sitemap**（`src/app/sitemap.ts`）补进 6 个站内可点、返回 200 却未收录的页：
  `/refunds` `/support` `/careers` `/dmca` `/cancellations-policy` `/content-removal-appeals-policy`。
  过滤后从 13 条 → **19 条**，冻结页仍被正确排除。
- **回归守卫**（`tests/e2e-ci/smoke.spec.ts` ⑦）：逐页读取 canonical，**若存在必须等于自身 URL**；
  末尾注入一个指向首页的错误 canonical 做负向对照，证明检测器不是恒绿摆设。
  旧检查只断言"存在"，正是它放过了这个 P1。

### 2. P1-3 · `/checkout/success` 主按钮 1.5:1

- 把 `text-white` 换成 `text-primary-foreground`；顺手把全站 **8 处** `bg-primary` + `text-white`
  共现节点一次清干净（checkout/success、tabs、location-picker ×2、admin-header、erp/panels、
  paywall、analytics-report）。保留 `bg-white/20 text-white`（半透明白底，不属此问题）。
- 实测：`rgb(11,14,17)` on `rgb(163,230,53)` = **12.83:1**；axe `color-contrast` **0 违规**。

### 3. N-1 · 用例连跑第二次必然红 / N-3 · 登录前置零退避

- `auth-dialogs.spec.ts` 新增 `resetReportPair()`，每轮 `beforeAll` 只删 **本夹具**
  （`reporterId = e2e_user_chat_a`）的 `UserReport`；只对本地 `file:` 库动手，远程库跳过，
  失败不吞掉（由 ⑦ 自己的前置断言如实报红）。⑦ 落库断言改为**前后 +1 对比**，
  与同文件 ⑨ 已有的正确范式一致。
- `global-setup.ts` 重试加 1s / 2s 退避，并把 `net::ERR_FAILED` 与断言失败分层标注。
- **验证方式**：两轮全量之间**不清理夹具、不重新 seed**，两轮都 114/114 绿 ⇒ 幂等成立。

### 4. 用户反馈「dashboard 没有更新到最新版本」

**先定性，不是部署问题**：当时线上 `/api/health` 已是 `c1571c8`、Netlify deploy `ready`。
真实登录后落点 `/dashboard/explore` 是**旧 B2C 约会线**：
`Discover people / No more profiles / Unlock all features / © 2026 LokFee! Inc.`，
导航是 Explore / Connections / Chats / Notifications，而主线是 `/workspace`（个人态六屏）
+ `/console`（组织态七屏）。

**根因**：`next.config.ts:175` 的已登录重定向把 `/dashboard` 送到 `/dashboard/explore`。
所有写死 `callbackUrl=/dashboard` 的登录入口（邮箱口令、OAuth、快速登录、注册完成）
因此登录后第一屏都是旧线。

**修复（两步，第二步来自产线实测）**：

1. `4f82325`：destination 改为 `/workspace`。`/workspace` 的守卫只要求登录、不要求组织，
   对任何账号都安全；**刻意保留 `/dashboard/*` 子页可直达**，legacy 线仍被 27 条移动端 E2E 覆盖。
   同时把 dashboard 页脚的 `LokFee! Inc.` / 旧约会 slogan 换成 `BRAND.name` / `BRAND.tagline`
   （真实法律主体未核验前不声称 "Inc."）。
   新增 `authed-mobile.spec.ts` 守卫：已登录访问 `/dashboard` 必须落到 `/workspace`，
   且正文含 `My Workspace`、不含 `No more profiles`。

2. `53f6a21`：**产线实测抓到的坑** —— 生产 HTTPS 下 NextAuth cookie 名是
   `__Secure-authjs.session-token`，而 `has: [{type:'cookie', key:'authjs.session-token'}]`
   只做精确键匹配。第一版上线后实测：

   | 请求 | 4f82325 产线 |
   | --- | --- |
   | `Cookie: authjs.session-token=…` | `307 → /workspace` ✅ |
   | `Cookie: __Secure-authjs.session-token=…` | `307 → /login?callbackUrl=/dashboard` ❌ |
   | 无 cookie | `307 → /login?callbackUrl=/dashboard`（原行为） |

   也就是说**真实登录用户在产线仍会落到旧页**。补一条等价 OR 规则
   （Next 依次匹配 `has`），两条都不命中时仍由 `(dashboard)/layout.tsx` 负责回登录页，
   未登录行为完全不变。

---

## 三、回归矩阵（全部真实运行）

| 轮次 | 对象 | 范围 | 结果 |
| --- | --- | --- | --- |
| R1 | 本地新构建 3212（`c1571c8` 代码树） | 全量 9 spec | **114/114** PASS，0 skip 0 flaky，608s |
| R2 | 同上，**不清理夹具、不 reseed** | 全量 9 spec | **114/114** PASS，531s ⇒ 幂等成立 |
| R3 | 本地 3212（含 `4f82325` 默认落点改动） | 全量 9 spec | **115/115** PASS，556s |
| R4 | 本地 3213（含 `53f6a21` 双 cookie 规则） | smoke 7 + authed-mobile 19 | **26/26** PASS，1.6m |
| R4b | 本地 3213 | `probe-authed-nav` 纯 HTTP 3 轮 | 每轮 `/dashboard → /console → /workspace` 全 200 |
| 生产 | `https://app.lokfeel.com`（`53f6a21`） | smoke 7 + cache-headers 10 | **17/17** PASS，59s |

静态门禁：`npx tsc --noEmit` 三轮全通过；ESLint 对全部改动文件逐文件×逐规则比对冻结基线，
**零新增债**。

### 产线复验（部署 ready 之后）

| 检查 | 结果 |
| --- | --- |
| `/api/health` | `commit=53f6a21`、`status=healthy` |
| `/dashboard` + `authjs.session-token` | `307 → /workspace` ✅ |
| `/dashboard` + `__Secure-authjs.session-token` | `307 → /workspace` ✅（第一版这里是 `/login`） |
| `/dashboard` 无 cookie | `307 → /login?callbackUrl=/dashboard`（原行为不变） |
| canonical（`/`、`/pricing`、`/terms`、`/faq`、`/checkout/success`） | 全部不再输出错误声明 |
| `sitemap.xml` | 19 条，新增 6 页全部在，冻结页仍排除 |
| `/checkout/success` 主按钮 | 12.83:1，axe `color-contrast` 0 违规 |
| 生产只读 E2E | 17/17 |

---

## 四、还没有做的（不粉饰）

1. **N-2 仍未闭合**：本地/CI 都没有 `WORKBUDDY_LLM_*`，`A-01 / C-01` 运行终态
   `runStatus=FAILED`，导致「批准 → APPROVED」「驳回 → REJECTED」「执行 → 真实终态」
   三条最高风险链只能记 BLOCKED。需要给现有 `e2e` job 注入三键 + 自带契约骨架的提示词夹具。
2. **P1-2 公开页 logo**：26 个公开内页导航仍含旧品牌 `LokFee!`；本轮只清了
   dashboard 页脚。仓库里还有 30+ 处 `LokFee!` 字面量（含 Stripe 支付描述、
   webhook 账单文案）—— 动这些会影响发票与对账，不宜在未经确认时批量替换。
3. **P2-1 法人主体**：`/dmca` 等三页仍写 `LokFeel Inc. Wilmington, Delaware`，
   需要真实法律主体与通信地址，未擅自改。
4. **P2-2 `/blocked`**：整页旧约会文案与 2.69:1 对比度，去留需产品决定。
5. **真实扣款 0 次**：支付面只验证"未接入时正确失败"（18/18）。SCALE 年付仍受
   $3,000 单笔上限阻塞。没有真实邮件投递、没有并发/长稳压测、没有人工读屏验收。
6. **SEC-08**（Consent 撤销后继续执行被拒）仍缺跨 4 表夹具，属未测而非通过。

---

## 五、证据索引

`docs/release/lokfeel-v20.7-ga/evidence/e2e-fix-2026-11-14/`

| 文件 | 内容 |
| --- | --- |
| `round1.json` / `round1.log` | R1 全量 114/114 |
| `round2.json` / `round2.log` | R2 全量 114/114（未清理夹具） |
| `dashboard-round1.json` / `.log` | R3 全量 115/115 |
| `dashboard-round2-subset.log` | R4 子集 26/26 + 导航探针 3 轮 |
| `prod-readonly-final.json` / `.log` | 生产只读 17/17 |
| `contrast-check.log` | 本地 12.83:1 + axe 0 违规 |
| `prod-contrast.log` | 产线 12.83:1 + axe 0 违规 |

`evidence/e2e-2026-11-14/` 为 20 号报告的原始证据（113/113 本地、16/16 生产只读、5 个探针）。
