# 生产暴露面收敛与运维风险处置方案

> 2026-09-29 · 基线 `f629aeed` → 本文所记改动分两批发版
> 所有结论均来自**实测**（HTTP 探测 / Playwright 页面上下文探测 / GitHub & Netlify API / git），
> 凡是被实测推翻过的判断都已标注「❌ 曾误判」并保留，供后人避坑。

---

## 一、本轮已修

### 1.1 【P0】`Permissions-Policy` 把 WebRTC 与定位整体禁掉了

**这是本轮最有价值的发现，且此前无人察觉。**

`next.config.ts` 里的响应头写的是：

```
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

空允许列表 `()` 的语义是 **「对所有来源一律禁用」**，**不是**「不做限制」——这是该头部最常见的误用。

**实测证据**（Playwright 在生产页面上下文执行；已 `permissions:['camera','microphone','geolocation']` 预授权 +
`--use-fake-device-for-media-stream` 提供合成摄像头，因此排除了用户授权与硬件缺失两种干扰）：

| 页面 | `allowsFeature('camera')` | `getUserMedia({video,audio})` |
|---|---|---|
| **`app.lokfeel.com`（生产）** | **false**（mic / geolocation 同为 false） | **`NotAllowedError: Permission denied`** |
| `example.com`（对照） | true / true / true | `OK tracks=audio+video` |

**影响面**：WebRTC 视频通话（视频 + 音频）与基于定位的功能**在线上完全不可用**。
这是产品核心能力之一，而非边角功能。

**修复**：改为 `camera=(self), microphone=(self), geolocation=(self)`
（仅本域可用，跨域嵌入方仍被拒绝，安全语义不倒退）。

**修复已获本地实证**（同一份 HTML，仅切换该响应头，其余完全一致）：

| 写法 | allowsFeature | getUserMedia |
|---|---|---|
| `camera=(), microphone=(), geolocation=()` | 全 false | `NotAllowedError` |
| `camera=(self), microphone=(self), geolocation=(self)` | 全 true | `OK tracks=audio+video` |

> 顺带记录：`X-XSS-Protection: 1; mode=block` 已是被弃用且被主流浏览器移除的头部，
> 保留它无收益（个别老浏览器上它本身可引入 XSS）。**本次不动**，留作独立小改。

### 1.2 生产环境 10 个调试/测试页裸奔

扫描方式：`public/**` 静态资源 + `src/app/**` 路由页，逐个用 grep 查引用，再对线上发 HTTP 请求确认。

| 路径 | 线上 | 代码引用 | 处置 |
|---|---|---|---|
| `/firebase-diagnostic.html` | 200 | 0 | 删除（内含硬编码 Google API Key） |
| `/auth-diagnostic.html` | 200 | 0 | 删除 |
| `/gis-diagnostic.html` | 200 | 0 | 删除 |
| `/oauth-debug.html` | 200 | 0 | 删除 |
| `/test-apis.html` | 200 | 0 | 删除 |
| `/admin-test-panel.html` | 200 | 0 | 删除（"Admin Dashboard V3 功能测试面板"） |
| `/test/e2e-panel.html` | 200 | 0 | 删除（Creem 全流程测试面板） |
| `/test/mock-payment.html` | 200 | 1 | **保留**（见下） |
| `/debug/google-oauth` | 200 | 0 | **加服务端 admin 守卫** |
| `/admin-test` | 200 | 0 | **加服务端 admin 守卫** |

**为什么保留 `mock-payment.html`**：`src/app/api/test/mock-checkout/route.ts:101` 会生成
`${appUrl}/test/mock-payment?session_id=…`，是本地 mock 支付的一环；且线上**惰性**：
mock-checkout 的 POST/GET/PATCH **三者都有** `NODE_ENV==="production"` 守卫（线上实测 404），
`/api/webhooks/creem` 的 mock 旁路也被 `allowMock = !isProd && !webhookSecret` 关死（`route.ts:37-41`）。

**为什么对 `/debug` 与 `/admin-test` 用守卫而非删除**：仓库已有现成范式
`src/app/(admin)/layout.tsx`。新增的 `src/app/debug/layout.tsx` 与 `src/app/admin-test/layout.tsx`
**逐行复用**该逻辑（`getAdminSession()` → `auth()` 回退 → `redirect("/admin-login")`），
未引入任何新鉴权机制，既封住公网访问又保留运维能力（`/admin-login` 线上实测 200）。
上线后实测 **307 → /admin-login**。

### 1.3 GitHub 密钥告警 #1

- 位置：`public/firebase-diagnostic.html:85`（提交 `e7986495`），`secret_type=google_api_key`，
  `publicly_leaked=true`，自 **2026-05-09** 挂至今日未处理。
- **关键判断**：该 key 本来就是**公开的** —— `/api/config/firebase`（未鉴权，实测 200）
  主动把同一份 `apiKey/authDomain/projectId/appId` 下发给浏览器。重点不是"撤 key"，而是**给 key 加限制**。
- 已做：删除仓库中该文件（唯一的硬编码副本）。
- 待用户操作：Google Cloud Console 中为该 key 加 **API 限制**（Identity Toolkit、Token Service 等）
  + **HTTP referrer 限制**（`https://app.lokfeel.com/*`、`https://lokfeel.com/*`）。
  完成后可将告警 #1 标记为 resolved（删除 HEAD 不影响历史 blob）。

### 1.4 "git push 全败"是误判 —— 真因是**本地代理挂了**，绕过即解决

这个结论本轮被**推翻并升级过两次**，最终证据如下（按时间顺序）：

**第一版（错误）**：认为 CN 网络对 GitHub 间歇性干扰。依据是 `GIT_CURL_VERBOSE` 显示
CONNECT 隧道 200、TLS 1.3 握手成功、请求已发出，然后 79 秒后 `Empty reply from server`；
同 URL 两轮探测一轮 `000`、一轮 `200`。

**第二版（仍不完整）**：认为"间歇性、重试即可"。但当重试循环跑到 **10/10 全败**、
且错误从 `Empty reply from server` 稳定变成 `CONNECT tunnel failed, response 502` 时，
"间歇"这个解释已经不成立了 —— 间歇不会连续 10 次同向失败。

**第三版（定论）**：**把"经代理"与"绕过代理"两条路分开测**，差别是决定性的：

| 路径 | 结果 |
|---|---|
| `curl https://github.com`（走沙箱代理 `127.0.0.1:54407`） | **HTTP 000**（10s 超时，从未成功） |
| `curl https://github.com`（`env -u *_PROXY`，直连） | **HTTP 200，5.06s** |
| `env -u *_PROXY … git push origin HEAD:main` | ✅ **一次成功**：`80e21a4..82d68b4 HEAD -> main` |

即：**`HTTPS_PROXY` 指向的沙箱代理进程当时是坏的**，而网络本身通畅。
Git 默认尊重 `HTTP(S)_PROXY` 环境变量，所以所有 git 操作都被导向了这条死路；
`502 CONNECT tunnel failed` 正是**代理侧**的报错，与 GitHub 无关。

**正确处置**：

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy git push origin HEAD:main
```

**判据（下次直接照做，别再走弯路）**：一旦 git 报 `CONNECT tunnel failed` 或
`Empty reply from server`，**先做一次 A/B**：`curl -s -o /dev/null -w '%{http_code}' https://github.com`
分别**带**和**不带** `*_PROXY` 各跑一次。
- 带代理失败 / 直连成功 → **代理问题，`env -u` 绕过**（本次即此类）
- 两者都失败 → 才是网络问题，此时才轮到重试

**同时修正的两条早期结论**：
1. 之前"CN 网络干扰 GitHub"的判断**证据不足** —— 当时没有做 A/B，无法区分代理与网络。
   这条现已降级为"未证实"。
2. 为绕开该问题曾改走 Git Data API 推送，代价是 GitHub 规范化时区（`+0800`→`+0000`）
   并去掉消息尾换行，导致本地/远端 **sha 分叉（树一致）**。该兜底路径**废弃** ——
   根因既非网络也不是 GitHub，用 API 是治错了病。

---

## 二、依赖批次（dependabot 5 个 PR 一次性攒批）

| PR | 变更 | 结论与依据 |
|---|---|---|
| #17 | eslint 9 → 10.11.0 | ❌ **拒绝，维持 ^9**。peer 范围看似兼容（`typescript-eslint@8.58.2` 已含 `^10.0.0`、`eslint-config-next@16.3.6` 为 `>=9.0.0`），但**实际跑 `npm run lint` 直接崩**：ESLint 10 移除了 `context.getFilename()`，而 `eslint-config-next` 内嵌的 `eslint-plugin-react@7.x` 仍在调用它 → `TypeError: contextOrFilename.getFilename is not a function`。实测**任何文件**都崩（含 `.ts` 非 React 文件），lint 彻底报废。**tsc 完全看不到这个问题**。已在 dependabot.yml 加 major ignore |
| #18 | framer-motion 12 → **13.4.5** | ✅ 通过（**已从"需人工回归"降为"可判定安全"**，见 2.3）。此 PR 有 swipe/drag 回归史，本轮**没有靠"看着像没事"，而是去读了官方升级指南**定论 |
| #19 | @types/node 20 → **22.20.4** | ⚠️ **改版本**。dependabot 提的是 26.x，但构建/运行环境是 **Node 22**（`netlify.toml` / `.nvmrc` / CI 三处已对齐）。装 26.x 会让 TS 认为可用 Node 24/26 才有的 API：**编译期通过、运行期才炸**。已在 `.github/dependabot.yml` 为 `@types/node` 加 major ignore 防复发 |
| #20 | @sentry/nextjs 10 → **11.1.0** | ✅ 通过（需 1 处代码适配，见下）。v11 要求 Node ≥20.19 ✅、已移除 Next.js 13 支持（本仓 Next 16 ✅） |
| #21 | webrtc-adapter 8 → **9.0.6** | ⚠️ 保留了版本升级，但**这个依赖是死的**，见下 |

### 2.1 @sentry/nextjs 11 的真实破坏点：`withSentryConfig` 换了入口

`withSentryConfig` 从包根迁移到 `"@sentry/nextjs/config"`（sentry-javascript #23628）。
`next.config.ts` 原本 `import { withSentryConfig } from '@sentry/nextjs'` → `tsc` 报
`TS2305: Module '"@sentry/nextjs"' has no exported member 'withSentryConfig'`。
已改为从 `'@sentry/nextjs/config'` 导入（v11 的 `exports` 映射中确有 `./config`，已核对）。

v11 其余的破坏性变更**均未命中本仓库**：构建配置项移除、orchestrion 自动接线、
middleware tunnel 等都没用到。接线只经由 `instrumentation.ts` /
`instrumentation-client.ts` / `sentry.{server,edge}.config.ts`。

### 2.2 两个"声明了但从未导入"的依赖

| 依赖 | 现状 | 处置 |
|---|---|---|
| `webrtc-adapter` | 全仓（含 `public/`、脚本、配置）**零 import**，只出现在 `package.json` / `package-lock.json` / 文档。WebRTC 实现（`src/utils/webrtc.ts`、`src/hooks/useWebRTC.ts`）直接用原生 API | 本次**保守地只升级版本**（行为零变化）。**但这可能是一个未完成的集成**：该包正是用来抹平 Safari/iOS 的 WebRTC 差异，若目标用户在 iOS Safari，现在等于**没有 shim**。要不要 `import 'webrtc-adapter'` 需真机验证后决定；若确认不需要，应连同 `@types/webrtc`（同为废弃 stub）一起删除 |
| `@sentry/nextjs` | **有**使用（见 2.1）—— 曾因 grep 假阴性误判为"零引用"，见第五节 | 正常升级 |

### 2.3 framer-motion 13：唯一破坏性变更与"回归史"的分离

这个 PR 有真实的回归背景（该仓库出过"explore 卡片 swipe drag 失灵"，根因是
`domAnimation` 特性包不含 drag），所以不能用"tsc 过了"结案 —— tsc 只证明**类型**在，
证明不了**手势运行时**。本轮改为去读官方升级指南，得到可判定的结论：

**Motion 13.0 的唯一破坏性变更是移除可选依赖 `@emotion/is-prop-valid`，改为显式注入；
官方原文明确其影响面是 "CSS-in-JS libraries Styled Components and Emotion" 的使用者。**

据此逐条核对本仓库：

| 检查项 | 结果 |
|---|---|
| 是否使用 Emotion / Styled Components / goober / stitches | ✅ **全无**（`dependencies` + `devDependencies` 均已扫描）→ 该破坏性变更**不适用** |
| v13 是否改动 drag / swipe / `PanInfo` / `AnimatePresence` 的 API | ✅ **未改动**。13.4.x 变更日志中与手势相关的条目全是 **Fixed/Improved**（`useDragControls` snapToCursor 原点漂移、`drag` pointerend 时序、`AnimatePresence` reentry 滞留），性质是修 bug，不是改语义 |
| peer 范围是否容纳本仓库 React | ✅ `react: ^18.0.0 \|\| ^19.0.0`，实际 React **19.3.0** |
| 所用法全部导出仍在 | ✅ 全仓 30 个文件只用 `motion` / `m` / `AnimatePresence` / `LazyMotion` / `domAnimation` / `PanInfo`（这些同时被 tsc 0 错误佐证） |

**方法论要点**：13.4.4 的 `domAnimation` 相关条目是 "AnimatePresence: Ensure children don't
stick during reentry"，仍然保留该特性包；并无"把 drag 移出 domAnimation"这类变更。
即历史事故的**触发条件在 v13 中未被改动**，不是"这次运气好"。

> 仍需真机/端到端确认的残余项：swipe 手势在真实触摸设备上的**手感**（位移阈值、惯性），
> 这不属于 API 破坏，属于行为调优，不作为发版阻断项。

---

## 三、待决策事项

### D1 · Netlify 额度兜底（最高优先，且**只能由你在 UI 完成**）

| 证据字段 | 实测值 | 含义 |
|---|---|---|
| `auto_topup_enabled` | **False** | 额度耗尽仍会**整站 503**（2026-09-29 真实事故的根因，**尚未消除**） |
| `credit_alert_percentage` | **None** | 无额度告警 |
| `plan_credits` / `credits.used` | 1000 / **0** | 当前周期 9/29→10/29，满额 |
| `has_stripe_payment_method` | **True** | 已绑支付方式，具备开自动充值条件 |
| `plan_auto_topup_amount` / `per_unit_cost` | 500.00 / 0.01 | 触发即充 500 credits（≈$5） |
| `lifecycle_state` / `usages_exceeded` | active / `[]` | 当前健康 |

**❌ 已尝试并排除的路径（不要重试）**：Netlify **公开 API 不支持**这两个字段。
`PATCH` 与 `PUT /accounts/{id}` 带 `auto_topup_enabled` / `credit_alert_percentage` 均被**静默忽略**
（返回 200 但值不变）；官方 OpenAPI 规范（346KB）里完全没有这两个字段，也没有任何 topup/credit
设置端点；`/accounts/{id}/billing|usage|credits|credit-settings|auto-topup` 全部 404。
**结论：必须走 UI。**

**你的操作**：Netlify 控制台 → Team `aoshuang99` 的 **Billing / Usage & billing** 页 →
找到 **Credits / auto-recharge** 区块 → 打开自动充值 + 设使用量告警。
（对应 API 上的 `auto_topup_enabled: true`、`credit_alert_percentage: 80`。）
**验证闭环**：开完后告诉我，我读 `GET /accounts/69f8632e05fab5f2becc5407` 确认字段已变——你不需要自己判断。

### D2 · 泄漏凭证吊销（只能由你操作）

- **Vercel token** —— 合并 `drag-19` 时被 GitHub Push Protection 拦下的那个（提交 `3829146`，
  已随压缩提交从历史移除，但 token 本身应视为已泄漏）
- **只读 fine-grained PAT** —— `github_pat_11B7FHZ…`（已验证只读、无法推送，但仍在流通）

### D3 · 安全响应头 —— ❌ 曾误判，实际情况相反

**文档上一版写的"生产无任何安全响应头"是错的**（错误来源见第五节）。生产实测：

```
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline' …
x-frame-options: DENY
x-content-type-options: nosniff
referrer-policy: strict-origin-when-cross-origin
strict-transport-security: max-age=63072000; includeSubDomains; preload
x-xss-protection: 1; mode=block
permissions-policy: camera=(), microphone=(), geolocation=()   ← 唯一的问题，见 1.1
```

`next.config.ts` 的 `headers()` 已覆盖全部安全头。因此**不引入 Netlify `public/_headers` 的安全头**——
那会形成第二个、值还可能不一致的头源（例如 `X-Frame-Options` 一边 DENY 一边 SAMEORIGIN）。
曾短暂加过一版，**已回滚**，`public/_headers` 恢复为只保留 `_next/static` 缓存规则。

> 唯一真实的小缺口：**由 Netlify CDN 直接吐出的静态文件**（`/avatars/*`、`/videos/*`、
> `/test/mock-payment.html` 等）不经过 Next.js，因此拿不到 CSP / X-Frame-Options / nosniff
> （实测这些路径只有 cache-control 与 HSTS）。属低危；若日后要补，应**只针对静态路径**，
> 且值必须与 `next.config.ts` 保持一致。

### D5 · 生产 Redis 未配置

`/api/health` → `redis: { backend: "memory", configured: false }`。
多实例下速率限制与缓存不共享。需 Upstash 凭证；`check:redis` 17 项门禁已就绪。

### D6 · 生产残留 debug/test API（15 条）—— 已核实，当前无未授权可利用项

| 路由 | 守卫 |
|---|---|
| `/api/test/mock-checkout`（POST/GET/PATCH） | `NODE_ENV==='production'` → 404 |
| `/api/test/run-e2e` | `CRON_SECRET`（实测 401） |
| `/api/admin/generate-test-users` | `withPermission` |
| `/api/diagnostic/firebase` | `requireAdminAuth`（实测 403） |
| `/api/debug/*`（9 条） | `requireAdminAuth`（实测 403） |

可选加固：Netlify `_redirects` 在生产屏蔽 `/api/debug/*`、`/api/test/*`（dev 不走 `_redirects`，不影响本地）。
**但 `/api/diagnostic/firebase` 建议保留** —— 它是排障探针。

### D7 · 仓库卫生残留

`git ls-files` 中有 4 个残留文件（非编译目标，属惰性但应清）：

```
prisma/schema.prisma.backup-20260412-165324
src/app/(dashboard)/dashboard/onboarding/page.tsx.backup-20260510-211326
src/app/(dashboard)/dashboard/onboarding/page.tsx.bak
vercel.json.bak
```

---

## 四、验证基线

| 检查 | 结果 |
|---|---|
| `tsc --noEmit`（依赖升级后） | 先 1 错（sentry 导入）→ 修复后 **0 错误** |
| `chat:invariants` / `chat:refs` / `verify:bot` / `verify:geo` / `check:redis` | 全绿 |
| 7 个已删页面 | **404** |
| `/debug/google-oauth`、`/admin-test` | **307 → /admin-login** |
| `/test/mock-payment.html` | 200（有意保留） |
| 主链路 | `/` 200、`/api/health` healthy、`/api/matches` 401、`/api/diagnostic/firebase` 403、`/api/config/firebase` 200 |
| **`allowsFeature('camera')`（生产）** | 修复前 **false** → 修复后应为 **true**（见 1.1） |

---

## 五、方法论教训（比结论更值钱）

### 5.1 本仓库里 `grep` 会给出**假阴性**，且已造成三次误判

本轮有三处结论被"grep 返回空"带偏，全部是**假阴性**（文件里明明有，grep 说没有）：

| 误判 | 真相 | 根因 |
|---|---|---|
| "`@sentry/nextjs` 零引用" | 接在**仓库根** `instrumentation.ts` + `sentry.*.config.ts`，不在 `src/` 下 | 检索范围限定在 `src/` |
| "`next.config.ts` 未引用 Sentry" | 第 3 行就有 `withSentryConfig` | shell `grep` 的引号/转义处理 |
| "全仓无 CSP、生产无安全响应头" | `next.config.ts` 有完整的 `CSP_VALUE` + 7 条安全头 | shell `grep` 的引号/转义处理 |

**纪律**：判定"某符号不存在"时，**不要只依赖一次 grep**。
改用 Grep 工具（ripgrep）或 Python 遍历，并用 `git ls-files` 交叉确认检索范围；
关键**否定性结论**必须用第二种独立手段复核（直接读文件头、或线上实测响应头）。
"文件里没有该字符串"这类结论成本最高、最该复核。

### 5.2 声明了依赖 ≠ 接好了依赖

`webrtc-adapter` 被写进 `package.json` 并记入 `CODE-SUMMARY-WebRTC-VideoCall.md` 的"已完成"，
但**从未被 import**。审计依赖时必须回答"它在哪儿被 import"，而不是看它在不在清单里。

### 5.3 安全头部的语义陷阱：不报错、不告警、测试全绿

`camera=()` **不等于**"不限制"，而是"谁都不许"。这类头部写错时
**不会报错、不会告警、类型检查与单测也全绿**（因为都在浏览器策略层，编译期碰不到），
只能靠**在真实页面上下文里探测**发现：
`document.featurePolicy.allowsFeature(name)` + 带 `--use-fake-device-for-media-stream` 的真实
`getUserMedia`，并用一个无该头部的对照站点证明测试方法本身能区分两种情况。

**纪律**：任何 `Permissions-Policy` / CSP 改动，发版后都要补这一步页面级探测。

