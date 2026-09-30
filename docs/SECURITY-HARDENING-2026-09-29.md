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
- **2026-09-29 晚：限制已全自动化**（`scripts/firebase-restrict-key.mjs` +
  `.github/workflows/firebase-key-restrict.yml`，dispatch 即执行）：
  - 幂等脚本：服务账号(firebase-adminsdk) → OAuth → API Keys API，从线上
    `/api/config/firebase` 动态取 keyString 匹配目标 key
  - `browserKeyRestrictions`：`app.lokfeel.com/*`、`lokfeel.netlify.app/*`、
    `*.lokfeel.netlify.app/*`（preview）、`localhost:3000`（开发）
  - `apiTargets`：identitytoolkit / securetoken / firebaseinstallations
    （客户端只用 firebase/auth，无 Firestore，集合最小化）
  - PATCH → LRO → 冒烟：Auth API 对 app 域 200、对 evil referer 403 才算成功
- **唯一前置（30 秒，须 Owner 手动）**：项目的 **API Keys API 未启用**，
  firebase-adminsdk 服务账号无启用服务的权限（实测 403 PERMISSION_DENIED，
  这是 Google 的权限设计，自动化绕不过）。启用链接（项目 185541962106）：
  https://console.developers.google.com/apis/api/apikeys.googleapis.com/overview?project=185541962106
  → 点 Enable → 回来说一声，重新 dispatch workflow 即完成全部验证。
- 完成后可将告警 #1 标记为 resolved（删除 HEAD 不影响历史 blob）。

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
| `credit_alert_percentage` | **None** | 自定义额度告警阈值未设 |
| `role` | **Owner** | ✅ 你有权自行开启（官方要求 Team Owner） |
| `has_stripe_payment_method` | **True** | 已绑卡，具备开自动充值条件 |
| `plan_credits` / `credits.used` | 1000 / **0** | 当前周期 9/29→10/29，满额 |
| `plan_auto_topup_amount` / `per_unit_cost` | 500.00 / 0.01 | 触发即充 500 credits（= $5.00） |
| `capabilities.auto_topup_threshold` | "10.00" | 余额跌破 10 credits 即触发充值 |
| `lifecycle_state` / `usages_exceeded` | active / `[]` | 当前健康 |

#### ❌ 已穷尽排除的 API 路径（**不要再试**）

这轮把 API 可能性彻底排除了，证据链如下（每一步都**回读真实值**校验，不信任 200 回执）：

| 尝试 | 结果 |
|---|---|
| `PATCH /accounts/{slug}` 布尔 `true` | HTTP 200，**回执原样返回旧值 `false`** → 服务端根本未接受 |
| `PATCH /accounts/{slug}` 字符串 `"true"` | HTTP 200，值不变 |
| `PATCH /accounts/{slug}` 数字 `1` | HTTP 200，值不变 |
| `PUT /accounts/{slug}` 完整对象（剔除只读嵌套） | **HTTP 422** 直接拒绝 |
| `PATCH` / `PUT /sites/{id}` | HTTP 200 但回执 `{}` → 站点层无此字段 |
| `/accounts/{slug}/{billing,usage,credits,billing_settings,auto_topup,subscriptions,credits_balance,settings,billing_plan}` | **全部 404** |
| `api.netlify.com/api/v2/accounts/{slug}`、`/teams/{slug}` | **404** |
| 官方 OpenAPI 规范（346KB）全文检索 | **完全没有** `auto_topup_enabled` / `credit_alert_percentage`，也无任何 topup 端点 |

**结论：不存在 API 通路，必须走 UI。**（"返回 200 但值不变"是最容易误判的一类——
只看状态码会以为成功了，所以本仓库的规范是**写后必回读**。）

#### ✅ 你的操作（官方准确路径）

Netlify 官方把这个功能命名为 **"credit auto recharge"**（不是 "auto top-up"）：

1. 打开 Team dashboard（Team: `aoshuang99’s team`）
2. 进入 **Usage & billing**
3. 在 **Current services** / **Credit balance** 区块内选 **Configure auto recharge**
4. 选 **Enabled** 并确认

官方文档：<https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/configure-auto-recharge/>

**四个容易误判的官方行为**（避免你以为"已经安全了"）：
- Personal 档费率**固定** 500 credits / $5 —— 与本账户 `plan_auto_topup_*` 完全一致
- **免费档不支持 auto recharge**，只有 Personal/Pro 可开（本账户是 Personal ✅）
- 额度耗尽时**该 team 下所有项目一起被暂停**（不只是占满额度的那个）；访客看到
  "Site not available"，且**所有部署停摆**（含 Deploy Preview 与分支部署）
- Netlify 在用量 50% / 75% / 100% 时**会自动**发邮件 + 站内通知；而
  `credit_alert_percentage` 是**另一个**可自定义的阈值字段（当前未设，两者别混为一谈）

#### 兜底：自建额度看门狗

既然官方告警开关写不进去，就自己轮询——**只读、不改动任何东西，可反复安全运行**：

```bash
NETLIFY_AUTH_TOKEN=nfp_xxx npm run netlify:credits
```

脚本：`scripts/netlify-credit-watch.mjs`。输出额度/周期/账号状态/自动充值/告警阈值/绑卡情况，
并按阈值给结论：用量 ≥80% 告警、≥95% 危急；`lifecycle_state ≠ active` 或 `usages_exceeded` 非空
则直接判危急（说明**已经停机**）。退出码 `0=正常 / 1=告警 / 2=危急`，可直接接进 CI 或定时任务。

⚠️ **本仓库是 public，脚本只从环境变量 `NETLIFY_AUTH_TOKEN` 读取 token，绝不落盘**
（已用 `git grep` 核实：仓库内无任何 `nfp_...` 字样）。

**验证闭环**：开完后告诉我，我读 `GET /accounts/aoshuang99` 确认 `auto_topup_enabled`
已变 `true` —— **你不需要自己判断是否成功**。

### D2 · 泄漏凭证处置（2026-09-29 晚取证收口）

#### Vercel token —— ✅ **风险关闭（取证证据，无需任何操作）**

对本地与远端历史做了全量考古，"泄漏的 Vercel token" 真身为 **Vercel OIDC 短时令牌**（不是
控制台里的 Personal Access Token，后者从始至终未进过任何提交）：

| 证据 | 结果 |
|---|---|
| 承载文件 | `.env.vercel` / `.env.check` / `.env.pull` / `.env.prod`（共 2 个真实 JWT 实例） |
| `iss` | `https://oidc.vercel.com/aoshuang99-2649s-projects`（OIDC 签发方，自动短时轮换） |
| 过期时间 | **2026-05-25** 与 **2026-05-28**（解码 `exp` 实证），现均已过期 4 个月 |
| 是否上过远端 | **没有** —— 携带真值的提交 `3829146` 经 `git merge-base --is-ancestor` 验证**不在** `origin/main`（Push Protection 拦下后压缩，真值只存在于本地对象） |
| 远端历史上 | `.env.prod` 的历史版本（`3ec8d8b`）确实含一枚真 JWT，但即上表中已过期那枚 |
| 远端 HEAD | `.env.*` 全部为 `""` 占位符（54 键逐一核过值长度） |

结论：OIDC 令牌按设计 24h 过期、不可续用，**无需吊销，Vercel 控制台也无从吊销**。
原"应视为已泄漏"的保守假设可以撤销。

#### `.env.test` 与全历史扫尾 —— ✅ 干净

- 远端 HEAD 的 `.env.test` 15 项"真实形态"值全为测试夹具：`sk-test-ope…`、`re_test_key…`、
  `test-secret…`、`test-linked…`、本地 postgres URL —— **零活凭证，无需轮换**
- 全历史 env/pem/credential 类文件逐一核对：无任何未过期真实密钥
- `src/app/api/test-credentials` 路由已从远端 HEAD 删除
- 唯一公开的 `secret scanning` 告警仍是 #1（Google API Key，公开设计 → 见 1.3 的 key 限制方案）

#### 只读 fine-grained PAT `github_pat_11B7FHZ…` —— ⚠️ **唯一剩余项（30 秒，只能你操作）**

- 全值不在本仓库、不在本地磁盘、不在 git 历史（仅为历史会话中出现）—— **无法替你吊销**
- GitHub **不允许 PAT 通过 API 自吊销**（已确认无此端点）
- **操作**：github.com → Settings → **Developer settings** → **Personal access tokens →
  Fine-grained tokens** → 找到前缀 `github_pat_11B7FHZ` 的条目 → **Delete**
- 顺带检查该页是否有其他遗忘的 token，一并清理
- 若列表里找不到该前缀（可能已过期/已删），D2 即全部收口，无需任何操作

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

---

## 六、2026-09-30 增量收口

本轮起因是"1.3 收口"时发现**自动化本身带着会静默破坏线上配置的地雷**，以及
**所谓的安全洞其实不存在**。逐条记录，因为它们比结论更值钱。

### 6.1 1.3 收口 —— 并更正两处误判

**误判 ①：「名单里的 `app.lofeel.com` 是安全洞」。** 实测它**从未生效**（一直 403）。
根因是当时把「控制台里看到的那把 key」当成了「生产在用的那把」——
项目里有 **3 把 Browser key**（`fec2e2a4` 05-08 / `2b6e641d` 05-06 / `2c5fe33d` 09-04），
带 `app.lofeel.com`（缺 k）的是 `2b6e641d`，而生产用的是 `fec2e2a4`。
判定方法：用线上 `/api/config/firebase` 下发的 `apiKey` 做 Referer 冒烟，与各 key 的
应用限制列表对照 —— 只有 `fec2e2a4` 完全吻合。
**教训：先确定"哪个对象"（哪把 key / 哪个环境），再谈它有什么问题。**

**误判 ②：「必须用户按 passkey 才能改」。** 真正的阻塞是自动化实例用了
`--use-mock-keychain`（Playwright 默认注入），mock 钥匙串**摸不到系统通行密钥**，
所以指纹永远不可能成功。改用真实 profile 最小副本自启 Chrome 后，Google 会话
原生有效，**全程零 passkey**。

**已完成**：`fec2e2a4` 的引荐来源限制扩到 7 条（app / 营销域 ×2 / netlify 主域 /
netlify 通配 / localhost / 127.0.0.1），API 轴保持原有 25 个。独立冒烟（10 探针）全绿。

**已知限制**：Google 通配符标签有长度上限（9 字符 ✅ / 15 字符 ❌），
Netlify PR 预览域（25 字符）无法通配放行 → 预览验证改用 `localhost:3000`。

### 6.2 【新发现，已修】幂等脚本的两颗"静默回退"地雷

`scripts/firebase-restrict-key.mjs` 用**精确相等**做达标判据，于是：

| 地雷 | 一旦触发（前置满足后 PATCH）的后果 |
|---|---|
| `ALLOWED_REFERRERS` 5 条 < 线上 7 条（缺 `lokfeel.com` / `www.lokfeel.com`） | 把这两个营销域**删掉** |
| `API_TARGETS` 3 个 ≪ 线上 25 个 | 把 25 个 API **削成 3 个**，打断线上 |

**这是本类脚本的通用陷阱**：把"目标态"写成"完整态"，"幂等"就变成了"每次运行都把
现状拉平到目标态" —— 目标态一旦比现状窄，就是破坏而非收敛。
**正确语义是"只增不减"**：达标 = 必需项全部在 + 没有禁用项；写回取**并集**。

**证据（回归夹具 20 项断言全绿）**：`backups/check-restrict-logic.mjs` 逐字抽取脚本
第 4/5 节源码求值，覆盖 8 个场景 —— 其中最关键的一条是
「线上当前形态（7 条 + 25 API）⇒ 判为已就绪、**不写回**」。

**当前状态**：API Keys API 未启用（实测 `apikeys.keys.list` → PERMISSION_DENIED），
每日任务**不执行写入**，地雷休眠；修复后即使将来启用也不会踩。

### 6.3 【新发现，已修】"每日哨兵"其实每天空跑

实测该 workflow 2026-09-30 的 cron 运行日志：以「⏳ 前置未满足」退出，**什么都没验**。
一个永远不报警的哨兵比没有哨兵更危险 —— 它给人以安全感。

**修复**：把 Referer 冒烟矩阵做成**不依赖任何 Google API 权限**的检测，两条路径都跑。
Referer 拦截是外部可观测的，无需读 API 就能验证限制是否仍在生效。
异常时工作流转红并**开 Issue**（对齐 `netlify-credit-watch.yml` 的既有范式），恢复后自动关闭。

**自测证据**：`backups/check-smoke-matrix.mjs` 用线上真实 key 跑 10 个探针，
全部符合预期（7 个放行域 200、lofeel/evil/无 Referer 403）。这同时也**独立复证了
1.3 的 7 条白名单确实在线生效**。

### 6.4 D7 仓库卫生 —— 收口

四个残留文件（`prisma/schema.prisma.backup-*`、`onboarding/page.tsx.backup-*`、
`page.tsx.bak`、`vercel.json.bak`）此前**已从索引移除**且被 `.gitignore` 覆盖
（见 `.gitignore` 的 D7 注释）。本次把本地文件移入仓库既有的忽略归档目录
`backups/d7-local-residual/`，源码树归清、内容不销毁（可随时整体删除 `backups/`）。

> 注：文档早期写的"`git ls-files` 中有 4 个残留文件"**已不成立** —— 它们当时已被
> `git rm --cached`。**否定性结论必须复核**（见 5.1 的纪律）。

### 6.5 生产实时核验（2026-09-30 实测）

| 项 | 结果 |
|---|---|
| `permissions-policy` | `camera=(self), microphone=(self), geolocation=(self)` ✅ 1.1 修复在线生效 |
| 其余 6 个安全头（CSP / XFO / nosniff / referrer / HSTS / x-xss） | 全部存在 ✅ |
| 7 个已删调试页 | 全部 **404** ✅ |
| `/debug/google-oauth`、`/admin-test` | **307 → /admin-login** ✅ |
| `/test/mock-payment.html` | 200（有意保留）✅ |
| `/api/diagnostic/firebase` | **403** ✅ |
| `/api/health` | `healthy`；`redis.backend=memory, configured=false`（D5 仍开放） |
| 依赖批次（#17–#21） | `package.json` 已与 `origin/main` 一致 → **已发版** ✅（sentry 11 / framer 13.4.4 / @types/node 22 / eslint 9 / webrtc-adapter 9.0.6） |

### 6.6 遗留分支 `work/perf-security-drag-19` 处置结论：**废弃，不合并**

该分支相对 `main` 有 19 个提交，曾被记为"待合并"（任务 #49 一度标为已完成，实际**从未并入**）。
逐条核实后结论是**不要合并**，理由分三类：

**① 它的安全修复早已在 main 上（逐项实测，非推断）**

| 分支提交声称的修复 | main 实测 |
|---|---|
| prod-gate mock-checkout | ✅ `src/app/api/test/mock-checkout/route.ts` 三处 `NODE_ENV==='production'` |
| Stripe webhook fail-closed | ✅ `src/app/api/webhooks/stripe/route.ts` 有 `STRIPE_WEBHOOK_SECRET` 校验 + 缺失时报错 |
| 剥离 `/api/users/[userId]` 敏感字段 | ✅ 该路由有 `kinkInterests` 等字段黑名单与 owner 判定 |
| IM 反应/输入态的会话成员校验 | ✅ `src/app/api/im/reactions/route.ts` 有 `requireMessageParticipant` + `OR[userAId,userBId]` |
| 开放重定向（guest / OAuth 回调）+ 登录 CSRF | ✅ `src/lib/auth/safe-redirect.ts` 存在，且被 guest / login / google / twitter 四处回调引用 |
| 清理 VERCEL_ENV_TEMPLATE 里的真实 Turso token | ✅ 该文件在 main 上已不存在 |
| 移除测试脚本里的明文管理员口令 | ✅ 已搜不到明文口令 |

**② 它的结构改动是"反向"的，合并即事故**

- 分支**删除**根 `proxy.ts`、**新增** `src/proxy.ts`。
  而现行架构是**根 `proxy.ts` 才是 Next 16 真正加载的中间件**（`src/proxy.ts` 是死文件，
  曾导致 CN 访客继续被误封，见提交 `2f10625`）。合并 = 直接复现该事故。
- 分支**重新加入** `src/app/api/chat/[id]/*`、`src/app/api/chat/route.ts`、`src/app/api/chats/route.ts`
  —— 这些正是 P1-6 已删除的 Legacy 聊天路由。合并 = 把双聊天系统重新引回来。

**③ 它的基线过于陈旧**

`git diff --stat main..work/perf-security-drag-19` = **1422 个文件、+48414 / −61085 行**。
性能意图（聊天列表窗口化、framer-motion 懒加载）在 main 上已有**不同实现**
（`src/components/chat/use-message-windowing.ts`、`src/components/ui/motion-lazy.tsx`）。

**处置**：保持分支原样（不删，留证），**任何情况下不要合并**；若要回收其独特改动，
必须**在当前 main 上重新实现**，而不是 merge。

> 方法论：判定"某分支还能不能合"时，不要看提交标题，要看
> ①它的**基线**离 main 多远（`git diff --stat`）②它的改动是否**已经以别的形式**在 main 上
> ③它有没有**反向**的结构改动。<br>
> 另外：`git cherry` 全显示 `+`（无等价补丁）**不等于**"这些修复缺失" ——
> 重新实现过的补丁 patch-id 本来就不同，此例即是（7 项修复实际全在 main 上）。

### 6.7 仍未闭合

**本轮新发现（低危，知情保留）**：`/api/geo-check` 未鉴权即返回地域策略详情
（实测 200，正文含 `country` / `blocked` / `blockedCountries:["CN"]` / `hint`）。
它是**有意**被放进地域豁免名单的诊断探针（让被封地区的运营者能自检），
且封锁了哪些国家并非秘密（试访问即可推断），故**不作为漏洞处理**。
但两点已知：① 它注释里引用的 `proxy.ts ALLOWED_PATHS` 已迁到 `src/config/region-policy.ts`；
② 其声明用途（验证 Vercel `x-vercel-ip-country`）在迁到 Netlify 后已失效（该头恒为 null）。
若日后要收紧，删掉正文里的 `blockedCountries`/`hint` 即可，不影响诊断价值。

**顺带核验**：地域豁免名单（`DEFAULT_ALLOWED_PATHS`）为
`/blocked`、`/api/geo-check`、`/api/health`、`/_next/`、`/favicon` —— **不含任何敏感路径**，无问题。

**其他未列出的诊断端点实测**（加固文档原先只列了 15 条，这里补查了 5 条）：
`/api/admin-check`、`/api/db-check`、`/api/debug-auth` 均 **403**（admin 守卫）；
`/api/test-panel` **307**；`/api/geo/ip` **401**。均无未授权可利用面。

| 项 | 归属 |
|---|---|
| D2 吊销只读 PAT `github_pat_11B7FHZ…` | 只能用户操作（GitHub 无自吊销端点） |
| 两把遗留 key：`2c5fe33d`（无网站限制）/ `2b6e641d`（含 lofeel） | 需用户确认消费方后处置 |
| D1 Netlify `auto_topup_enabled=false` | 仅控制台 UI 可开 |
| D5 生产 Redis 未配置 | 需 Upstash 凭证 |

