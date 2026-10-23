# PROJECT_LEDGER · 项目事实台账

> **这是"是什么"的唯一入口，不是"做完了什么"。** 进度看 `MASTER_BACKLOG.md`，
> 验收看 `ACCEPTANCE_LEDGER.md`，风险看 `RISK_AND_DECISIONS.md`。
>
> 规则：本文件只写**可复现的事实**。取不到的数据写 `UNKNOWN` 并附取证命令，不写估计值。
> 每条事实后面跟一条能当场跑的命令 —— 与 `07_EVIDENCE_LENS.md` 同一套纪律。

**最后核对**：2026-10-23（V18.3 发布前门禁 · 08:10Z 复核）· 仓库 `nexus-app/` · 分支 `main`

---

## 1. 产品事实

| 项 | 事实 | 取证 |
|---|---|---|
| 主产品 | **LokFeel Connection OS** —— 一句话目标 → `WorkspaceSpec` → Living Workspace（Now/Studio/Field/Consent/Outcomes/Agents 六屏）+ `/console/*` 组织态七屏 | `ls src/app/workspace src/app/console` |
| 主链路 | 目标 → WorkspaceSpec → Mission → Agent → Consent → Action → Verified Outcome | `docs/implementation/FEATURE_INVENTORY.md` |
| 机器面 | `/api/mcp`（Streamable HTTP，5 工具）+ `/api/v1/a2a/tasks`，共用 `src/lib/interop/tools.ts` | `ls src/app/api/mcp src/app/api/v1/a2a` |
| legacy 线 | `/dashboard/*` 交友面 + 匹配引擎 + 3500 bot —— **共用底座，非主线**，不得混入 SaaS 收费 | `ls src/app/dashboard` |
| 另一条产品线 | **Hlua Pass**（streaming / H-Points 会员），`public/pay.html` 即其页面，CTA 指向 Gumroad | `node -e "console.log(require('fs').readFileSync('public/pay.html','utf8').match(/<title>[^<]*/)[0])"` |

> 🔴 **两条产品线在生产上仍是串的**（2026-10-22 15:05Z 实测）：
> `GET https://app.lokfeel.com/pricing` → **307 → /pay.html**（Hlua），`/hlua` → **404**。
> **但 HEAD 已经修好**：`src/app/(public)/pricing/page.tsx` 里没有 `redirect()`，
> `/hlua` 页面存在，`npm run check:products` 5 条规则全过（R5「/pricing 是真实页面」）。
> 也就是说这不是待修的缺陷，而是**待发布的修复** —— 生产停在 `dc102cd`（见 §2）。
> 细节见 `18_COMMERCIAL_CONTRACT.md`。

---

## 2. 代码与部署基线

| 项 | 事实 | 取证 |
|---|---|---|
| 仓库 | `github.com/aoshuang99-netizen/lokfeel.com`（public） | `git remote -v` |
| 分支 | `main`（单人开发，无 PR 流程） | `git branch --show-current` |
| 基线 commit | `bba8c36`（V18.3 发布候选）· 上一基线 `3046f2b` | `git rev-parse HEAD` |
| CI 现状 | `bba8c36` = **17 项检查：15 成功 / 2 跳过 / 0 失败**（跳过项=Perf 手动、DCO）；另有 CodeQL run `39920104205` success。E2E 共 **85 条（结构枚举）**：公开 12 + 认证 18 + `/workspace` 页签 12 + legacy 四视口 27 + 缓存头 10 + 冒烟 6 | `curl -s "https://api.github.com/repos/aoshuang99-netizen/lokfeel.com/commits/bba8c36/check-runs?per_page=100"` |
| 生产实际部署 | **`dc102cd`**（2026-10-21T06:41Z，`state=ready`，部署 ID `6ad85eb3122dcb59f86a64c3`）—— 比 HEAD 少 **47 个提交 / 110 个文件 / +16,262 −487**，其中 `prisma/` 与迁移脚本差异为 **0 行**（⇒ 这次发布不需要 DB 迁移） | `curl -s -H "Authorization: Bearer $NF_TOKEN" https://api.netlify.com/api/v1/sites/lokfeel.netlify.app/deploys?per_page=5` · `git diff --stat dc102cd..HEAD -- prisma/ \| wc -l` |
| 本地 vs 远端 | **一致**（`ls-remote` 同 SHA） | `git -c http.proxy=http://127.0.0.1:10808 ls-remote origin refs/heads/main` |
| 栈 | Next 16.4.2（App Router / Turbopack）· React 19.3 · Prisma 7.10.1（libSQL/Turso）· NextAuth v5 beta | `node -e "const p=require('./package.json');console.log(p.dependencies.next,p.dependencies.react,p.dependencies.prisma)"` |
| 中间件 | 仓库根 `proxy.ts`（Next 16 要求，不用 `middleware.ts`） | `ls proxy.ts` |
| 托管 | Netlify 免费计划 + Cloudflare DNS（`app.lokfeel.com` CNAME → `lokfeel.netlify.app`） | `dig +short app.lokfeel.com` |
| 生产版本可见性 | 🔴 生产 `/api/health` 仍是 `{"status":"healthy","version":"unknown"}`，**没有 commit 字段** ⇒ 线上跑哪个 commit 不可查。**HEAD 已修**：`src/lib/build-info.ts` + `next.config.ts` 构建期内联 `commit/builtAt/version/commitSource`，healthy 与 unhealthy 两个分支都带 ⇒ 发版后一条 `curl` 可证。**未发布前这条能力不存在** | `curl -s https://app.lokfeel.com/api/health`（现状）· `node -e "console.log(require('fs').readFileSync('src/lib/build-info.ts','utf8').length)"` |

> `version: unknown` 不是小瑕疵：V18 要求"当前 HEAD 与生产一致"，而现在**只能靠 Netlify
> 部署日志间接推断**。已登记为 `MASTER_BACKLOG.md` 的 OPS 项。

---

## 3. 生产实测（2026-10-22 07:27Z，暖机，非冷启动）

| 端点 | 状态 | TTFB | 说明 |
|---|---|---|---|
| `/` | 200 | 1.90s | 落地页 |
| `/api/health` | 200 | 1.65s | `status: healthy`，`dbLatency: 240ms` |
| `/pricing` | **307** → `/pay.html` | 2.15s | 🔴 卖的是 Hlua，不是 Connection OS |
| `/pay.html` | 200 | 1.24s | Hlua Pass 付款页 |
| `/refunds` | 200 | 1.11s | 退款政策页 |
| `/workspace` | **307** → `/login?callbackUrl=%2Fworkspace` | 1.99s | 未登录被守卫拦下（正确行为） |

**组件状态**（`/api/health` 原样）：

| 组件 | 状态 |
|---|---|
| DB（Turso/libSQL） | `dbLatency 240ms`，healthy |
| Redis（Upstash） | `configured: true`，`degraded: false` |
| Firebase Admin | `configured: true`，`initialized: true` |
| Bot 模块 | `enabled: true`（legacy 线，不影响 SaaS 主线） |
| **支付** | `configured: false`，`charging: false`，缺 4 键：`CREEM_API_KEY` / `CREEM_WEBHOOK_SECRET` / `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` |
| 缓存 | `hitRate: 0` —— **0 命中 / 0 未命中，是假指标**，不参与任何判定 |

> 冷启动另计：V17 `08` 实测移动端 4G 首访 LCP **6284ms**、暖机 3388ms；桌面冷启动
> `/api/health` TTFB 曾达 13.20s（Netlify 免费计划休眠）。本表是**暖机值**，两者不可混用。

### 3.1 复测（2026-10-22 08:4xZ，经本机代理，含跨境链路）

| 端点 | 状态 | 说明 |
|---|---|---|
| `/` | 200 | 落地页 |
| `/pricing` | **307 → `/pay.html`** | 🔴 **仍是上线前行为** |
| `/hlua` | **404** | 🔴 新页尚未部署 |
| `/pay.html` | 200 | Hlua 付款页（不动） |
| `/workspace` | 307 → `/login?callbackUrl=%2Fworkspace` | 守卫正常 |
| `/api/health` | 200 | `status: healthy` · `version: unknown` · `payments.configured: false`（缺同 4 键） |

🔴 **本轮全部改动都没有上线**：提交信息统一带 `[skip netlify]`（V18 只批准到"可发布"，
不批准正式发布）。因此 `/pricing` 仍是 307、`/hlua` 仍 404 ——
**代码级证据 ≠ 生产事实**，报告里两者必须分开写。

---

## 4. CI 事实

| 项 | 事实 | 取证 |
|---|---|---|
| `6b24701`（本轮 HEAD） | **CI workflow：13 成功 / 2 跳过 / 0 失败**；全部 check-runs：**18 = 16 成功 / 2 跳过 / 0 失败** | `.../actions/runs/39747005219/jobs` · `.../commits/6b24701/check-runs` |
| `656954b`（同一轮的中间提交） | CI workflow：**13 成功 / 2 跳过 / 0 失败** | `.../actions/runs/39746527223` |
| `f62f342` 的 check-runs | 23 项 = 21 成功 / 2 跳过 / 0 失败 | `curl -s .../commits/f62f342/check-runs` |
| 跳过项 | `Perf 基线实跑（手动）`、`DCO sign-off check` | 同上 |
| 口径提示 | 「CI workflow 的 job 数」与「commit 的 check-runs 数」不是一回事（后者还含 CodeQL / Firebase key restrict / 存活探针 cron） | 两处 API 对比 |
| 本轮新增能力 | **行为级隔离取证**（`CTRL-1/2` + `SEC-01..07` 真实 HTTP + 真实库），SEC-08 仍 BLOCKED | e2e job 的「双组织隔离取证」步骤绿 |
| 必需 job | Typecheck · Lint · Build · Test(Jest) · E2E · Migration · Secret scan · Dependency audit · 租户作用域审计 · 支付凭据自证 · 上线预检口径 · 存活探针（cron） | `.github/workflows/ci.yml` |
| 判读入口 | job logs 的 REST 需 admin（403）⇒ 失败先看 `check-runs/{id}/annotations`（公开可读） | 见 `docs/implementation/v17/07` §5 |

> ⚠️ V18 原文引用的"15 成功 / 2 跳过"是**当时**的值；存活探针 cron 后来又跑了 5 轮，
> 总数变成 23。**报告里的 CI 数字会过期，必须每次复测。**

---

## 5. 本地开发环境事实（影响"能不能本地验证"）

| 项 | 事实 | 影响 |
|---|---|---|
| `node_modules` | 不完整：有 `typescript` / `jest` / `next` / `playwright`，**缺 `ts-jest`、`@libsql/client`** | 本地跑不了 jest、连不了库 |
| 因此 | 本地只能跑**纯 Node 门禁**（审计/一致性/自证类）；DB 相关一律靠 CI | 见 `07` §4 |
| `npx` | 被沙箱拦截（SIGTERM/137） | 用 `node node_modules/.../bin/...` 直调 |
| 代理 | `127.0.0.1:10808`（无自启），推送/查 GitHub 必须带 `-c http.proxy=...` | `lsof -ti :10808` |

---

## 6. 商业事实（截至 2026-10-22）

| 项 | 事实 | 取证 |
|---|---|---|
| 支付接入 | **未接入**。7 个入口统一 503 + `PAYMENT_NOT_CONFIGURED`（按端点实测：公共端点匿名 503 / 需登录 401 / `GET checkout` 405） | `npm run verify:payment:off` |
| 真实交易 | **0 笔**（从未发生） | Stripe/Creem 后台 |
| 真实客户 | **0 个** | 同上 + DB |
| 取消订阅入口 | ✅ **站内已有**（V18 补）：`GET/POST /api/payments/cancel` + `/dashboard/subscription#manage-subscription`；Hlua 明确写"由 Gumroad 收款、在 Gumroad 取消"。⚠️ 生产仍是旧代码（`/api/payments/cancel` 实测 404）⇒ 待发布生效 | `grep -rn "payments/cancel" src` · `curl -s -o /dev/null -w "%{http_code}" https://app.lokfeel.com/api/payments/cancel` |
| 对外价格 | **两套互不相干**：`src/config/plans.ts` $19.99/月·$149.99/年 vs `public/pay.html` $12.99/$99.99/$32.99 | `npm run check:pricing` |
| 退款承诺 | `/refunds` 写 **14 天**；`pay.html:167` 写 **7 天** —— 待人工裁决（`RISK_AND_DECISIONS.md` D-01） | `grep -n "天" public/pay.html` |
| 法律主体 | **未确定**（数据控制者是谁尚无答案） | — |

---

## 7. 数据与隐私事实

| 项 | 事实 |
|---|---|
| 主库 | Turso（libSQL），远程；本地无法直连（缺 `@libsql/client`） |
| 备份 | `npm run qa:db:snapshot`（只读快照） |
| 删除链路 | 应用级 `ERASURE_ACTIONS` + `ERASED_STATUS`；**未做过真实删除演练**（OPS-04 的 PASS 是代码级） |
| 第三方处理者 | 10 家，逐家"删除时是否同步"见 `v17/04_PRIVACY_REFUND_SOP.md` |
| 日志/备份残留 | 物理上限已写明，无法承诺"彻底删除"（`04` §6） |
| 测试数据隔离 | ✅ **V18 已建成**：CI 里 `file:` 本地库 + 双组织夹具（`v18-isolation-proof.mjs`，7 条行为级断言），以及可登录账号夹具（`seed-authed-e2e-user.mjs`，跑完即删）；两个脚本都自带闸门**拒绝远程库**。不复用生产 URL/Token | `node scripts/qa/v18-isolation-proof.mjs --self-test` |

---

## 8. 不可协商的不变量

1. **不改 schema**：`git diff <base>..HEAD -- prisma/` 必须为空（除非该轮任务明确批准）。
2. **不删测试变绿**：`--diff-filter=D` 为空、新增 `it.skip` 为 0。
3. **不造假单 / 不把 Mock 当客户数据**：`MOCK_PASS` ≠ `SANDBOX_PASS` ≠ `LIVE_PAYMENT_PASS`。
4. **BLOCKED 不许给命令**：给一条"会绿"的命令证明不了它（`check:evidence` 强制）。
5. **判定只能由证据升级**：新增文档、新增测试文件一律不解锁验收。
6. **变异测试不得改真实源码**（本仓被 SIGKILL 污染过三次）。

---

_本文件随事实变化更新；改了别人的结论，就要改这里的取证命令。_
