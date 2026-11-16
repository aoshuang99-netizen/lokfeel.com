# V22 · W02 生产真实页面逐路由审计（LIVE 取证）

> 取证时间：2026-11-16 11:35 CST · 工具：`scripts/qa/v22-live-capture.mjs`（Playwright / 系统 Chrome）
> 目标：`https://app.lokfeel.com` · 只读，**未改生产、未登录、未触发任何付费或写操作**
> 原始证据：`docs/v22/evidence/live-2026-11-16T03-35-32-256Z.json`
> 截图：`docs/v22/evidence/screenshots/*.png`（24 张）
> HAR：`docs/v22/evidence/capture-2026-11-16T03-35-32-256Z.har`（1614 entries，`content: omit`；已核验敏感头 0 条：`cookie` / `authorization` / `set-cookie` / `x-api-key` 均无）

## 1. 取证口径

| 等级 | 含义 | 本轮数量 |
|---|---|---|
| `LIVE` | 真浏览器成功访问该路由并取到正文（HTTP 200） | **17** |
| `REDIRECT_NO_AUTH` | 被重定向到登录页，**不算该工作区路由的 LIVE 证据** | **7** |
| `NOT_TESTED` | 未取到页面 | 0（但见下方诚实边界） |

**诚实边界**：7 个 `/workspace?view=*` 在本轮全部 `REDIRECT_NO_AUTH`（无生产登录态），按总令 §J V22-G01「未访问页面标 NOT_TESTED」，这七屏**本轮均未获得 LIVE 工作区证据**；脚本用独立等级 `REDIRECT_NO_AUTH` 记录重定向事实，并在每条 `note` 明确「本轮 NOT_TESTED，不得计为 LIVE」。生产 Studio 的真实画面证据来自用户浏览器（总令标 LIVE）与截图（SCREENSHOT），本轮未独立复现。

浏览器错误：24 页 **console error 0 / pageerror 0 / 非 200 为 0**。所有 24 页均有截图。

## 2. 四 SHA 与部署事实

| 项 | 值 |
|---|---|
| WORKTREE | `de6b3b941f39068ec249562ff33f5bc21e9e21cb`（取证时 HEAD；V22 后续提交另计） |
| origin/main | `cad717e92542395e4346e49d388f09be78ec1557` |
| Preview SHA | **NOT_AVAILABLE**（未获授权推送，无 Preview 部署；不拿 production commit 冒充） |
| Production commit | `b50e53e`（`commitSource=env`, `version=0.1.0`, `status=healthy`, `dbLatency=194ms`） |
| Netlify deploy ID | **NOT_AVAILABLE**；响应头 `x-nf-request-id=01M7H6KAF4X0N84QKRDRDP02HW` 是**请求 ID**，按 §C.1 不冒充 deploy ID |
| Cloudflare | `server: cloudflare` · `cf-cache-status: DYNAMIC` · `cf-ray: a5b36d7bacedf5db-AMS` · `age: 154410` |
| main.protected | `false` / rulesets `[]`（**Owner 通过 GitHub connector 实测**，本机无 `gh`，标 REPORT） |

**三者不一致**：worktree ≠ origin/main ≠ production。这是 S-09 的可复现证据。

## 3. 逐路由结果（矩阵 27 项中 17 个可匿名访问路由 + 7 个内部 key）

| Route | 级别 | HTTP | 关键 LIVE 事实 |
|---|---|---|---|
| `/` | LIVE | 200 | 见 §4.1，定位与技术术语全部复现 |
| `/product` | LIVE | 200 | **中文「该页面正在最终审核」占位页** + 旧品牌 `LokFee!` + 旧 B2C 页脚 |
| `/solutions` | LIVE | 200 | 同上占位页 |
| `/how-it-works` | LIVE | 200 | 同上占位页 |
| `/stories` | LIVE | 200 | 同上占位页 |
| `/pricing` | LIVE | 200 | **显示未批准的 `$89.00 / $199.00 / $449.00` 与「支持在线开通」**，见 §4.2 |
| `/help` | LIVE | 200 | 冻结占位（本地源码已在本批整改） |
| `/about` | LIVE | 200 | `AGENT-NATIVE CONNECTION OS`、`An agent-native workspace for teams and communities`，见 §4.3 |
| `/contact` | LIVE | 200 | `Response time: Within 48 hours / 24 hours` 未验证 SLA + 多个邮箱 |
| `/terms` | LIVE | 200 | 法务正文含 compiler / A2A 等技术定义 |
| `/privacy` | LIVE | 200 | 旧业务线与新授权混用风险 |
| `/refunds` | LIVE | 200 | 历史条款与新产品可能冲突 |
| `/login` | LIVE | 200 | `Welcome Back` / `Continue as Guest` 旧版登录，见 §4.4 |
| `/register` | LIVE | 200 | 旧版注册流程 |
| `/dashboard/onboarding` | LIVE | 200 | 组织门槛需核对 |
| `/support` | LIVE | 200 | 与 `/help` 重复路由 |
| `/faq` | LIVE | 200 | 与 `/help` 内容一致性待核 |
| `/workspace?view={7 keys}` | REDIRECT_NO_AUTH | 200 | 全部重定向到登录页；七屏本轮 **NOT_TESTED** |

> 矩阵中 `CI/Netlify`、`G15 9 页`、`public i18n` 三项不是可访问路由，不计入上表，另在 `V22_ACCEPTANCE_MATRIX.md` 的门禁区处理。

## 4. 四条最关键的 LIVE 发现（原文摘录，未改写）

### 4.1 首页定位与技术术语（复现 S-01 / S-02 / S-05）

```
LokFeel — Connection OS for AI-native teams
CONNECTION OS · FOR TEAMS AND THEIR AGENTS
Your goal, compiled. One sentence in, a runnable workspace out:
  who proposes, who has to agree, which agent drafts, and what counts as done.
5 MCP TOOLS · 50 REST ROUTES · 3 AGENT SKILLS · FAIL-CLOSED CONSENT
INTENT_EXTRACTION ✓ 412 tok
Outcome · verified
Consent · per-field
WHAT IT DOES / Compile goals, not slides / Agents with guardrails
The model compiles. The contract decides.
Mission studio demo · runs in your browser
Connect our climate-tech founders with 20 qualified manufacturing partners in 30 days
MCP · A2A · REST v1   (footer)
```

→ 与总令 S-01/S-02/S-05 完全吻合：企业 Agent SaaS 定位、技术指标上首屏、演示数字带 `verified` 语义。

### 4.2 定价页正在展示未批准金额（复现并升级 S-07，触发 V22-G10）

```
LokFeel Connection OS
把你的目标编译成一个可运行的工作区：目标 → WorkspaceSpec → Mission → Agent → Consent → Verified Outcome。
订阅起价 From $89/mo · 支持在线开通
Starter   $89.00 / 月
Growth    $199.00 / 月  最受欢迎
Scale     $449.00 / 月
订阅 Starter / 订阅 Growth / 订阅 Scale
年付省 17% · 全部套餐含 14 天试用
```

→ 总令 §C.5「原商业审批门不可逆打开」、§J V22-G10「D1/D8 未批不能有价格」在生产上**已被违反**。本批已在本地把 `/pricing` 页面与 `/api/payments/dodo/plans` JSON 双双 fail-closed；**生产仍显示价格，需 Owner 授权发布后才能消除**，不把本地绿写成线上已修。

### 4.3 公开页占位与品牌断裂（本轮新发现，比 SOURCE 判断更严重）

`/product` `/solutions` `/how-it-works` `/stories` 生产实际渲染的是：

```
LokFee!                       ← 旧品牌，不是 LokFeel
该页面正在最终审核
为了避免对外传递尚未确认的信息，这个页面暂时不展示内容。
审核完成后会自动恢复，不需要你做任何操作。
PRODUCT / COMPANY / SUPPORT / LEGAL / FOLLOW   ← 旧 B2C 页脚结构
```

→ 中文占位 + 英文旧品牌 + 中英混语，**四页对用户完全不可用**。根因是 `proxy.ts` 的公开面冻结门（2026-11-12 事故后的 fail-closed 保护）：`isPublicSurfaceFrozen()` 为真时 rewrite 到 `/holding`。本批**保留该门不打开**（打开会绕开 D1/D8 商业审批），只在本地源码重写这四页；解冻需 Owner 批准 D1/D8 后设 `PUBLIC_SURFACE_FROZEN=false`。

### 4.4 登录页发布断层（复现 S-03 / S-09）

```
LokFeel Welcome Back
Log in to continue your journey
Continue with Google / Continue with X / Continue as Guest
```

→ 本地 `de6b3b9` 已是「生成式登录」双栏改版，生产仍是旧版。与工作台导航（`de6b3b9` 已是中文 7 key 全 ready，生产仍英文 + Missions「暂未提供」）共同构成**发布断层**：本地工程从未转化为线上体验。

## 5. 本轮结论

- 生产现状 **NO-GO**，与总令裁决一致；四个直接证据中三个本轮 LIVE 复现，第四个（Studio 首屏）因无登录态本轮 NOT_TESTED，不冒充复现。
- 新增两条比总令 SOURCE 判断更严重的 LIVE 事实：四页中文占位 + 旧品牌；定价页展示未批准金额。
- 取证本身可信：24 页全 200、零浏览器错误、HAR 无敏感头、四 SHA 分别记录、Preview 未伪造。
- 下一步见 `V22_ACCEPTANCE_MATRIX.md`。
