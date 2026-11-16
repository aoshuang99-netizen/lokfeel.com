# V22 · 验收矩阵与统一字段汇报（本批唯一状态页）

> 生成：2026-11-16 · 分支 `v22/strategy-recovery` · **未推送、未部署、未改生产**
> 阶段定义（不可跳级）：`TODO → CODE_COMPLETE → TESTED → INDEPENDENTLY_VERIFIED → PRODUCTION_VERIFIED`
> 本批最高到达 **TESTED**（本地）；`INDEPENDENTLY_VERIFIED` 与 `PRODUCTION_VERIFIED` 一律未达，不冒充。
> 证据分级：`LIVE` / `SOURCE` / `REPORT` / `NOT_TESTED`（定义见 `W02_LIVE_AUDIT.md`）。

## 0. 版本事实（R0 冻结）

| 项 | 值 |
|---|---|
| 基线 tag | `baseline/20261116` → `de6b3b9`（V21 末态工作树固化） |
| V22 分支 | `v22/strategy-recovery`（从 `de6b3b9` 切出，未推 main） |
| origin/main | `cad717e92542395e4346e49d388f09be78ec1557` |
| Preview SHA | **NOT_AVAILABLE**（未获授权推送） |
| Production | `b50e53e` / `commitSource=env` / healthy（本批未动） |
| 作战包哈希 | 见 `docs/v22/spec/` 四文件，`STRATEGY_LOCK.md §0` 记录 SHA256 |

## 1. 统一字段任务板

字段：`TASK_ID / STAGE / SOURCE_SHA / REAL_URL / EVIDENCE_LEVEL / CODE_FILES / CLAIM_ID / TEST_COMMAND / EXIT_CODE / NEGATIVE_CONTROL / SCREENSHOT / HAR / USER_RESULT / VERDICT / BLOCKER / NEXT_EXECUTABLE_ACTION`

### W01 · 产品战略重审 — `CODE_COMPLETE`
| 字段 | 值 |
|---|---|
| SOURCE_SHA | `de6b3b9` |
| REAL_URL / EVIDENCE_LEVEL | `https://app.lokfeel.com/` · LIVE（首页）；其余 SOURCE |
| CODE_FILES | `docs/v22/STRATEGY_LOCK.md`、`capabilities.yaml`、`claim_register.csv`、`spec/` 四原件 |
| CLAIM_ID | CLM-001 ~ CLM-024 |
| TEST_COMMAND / EXIT_CODE | `node scripts/qa/v22-claim-gate.mjs --self-test` → **0 / PASS** |
| NEGATIVE_CONTROL | 9 违规串判 FAIL、6 合规串判 PASS、4 类注释剥离、空集断言 FAIL LOUDLY |
| SCREENSHOT / HAR | `evidence/screenshots/root.png` / `evidence/capture-*.har` |
| USER_RESULT | **NOT_TESTED**（10 人真人测试未组织） |
| VERDICT | **DRAFT** — 战略已冻结成文，但 **§7 待业务 Owner 签字**，不得当已批准 |
| BLOCKER | Owner 未对一级使命 / Hero 文案 / 三个 Job Stories 签字 |
| NEXT_EXECUTABLE_ACTION | Owner 签字；未签字前禁止宣布 G00 PASS |

### W02 · 全站真实体验审计 — `TESTED`
| 字段 | 值 |
|---|---|
| SOURCE_SHA | `de6b3b9` |
| REAL_URL / EVIDENCE_LEVEL | `https://app.lokfeel.com` 24 路由 · **17 LIVE / 7 REDIRECT_NO_AUTH（= 本轮 NOT_TESTED）** |
| CODE_FILES | `scripts/qa/v22-live-capture.mjs`、`docs/v22/W02_LIVE_AUDIT.md`、`evidence/live-*.json` |
| TEST_COMMAND / EXIT_CODE | `PW_CHANNEL=chrome node scripts/qa/v22-live-capture.mjs` → **0**（`CAPTURE_EXIT=0`） |
| NEGATIVE_CONTROL | 无登录态 ⇒ 工作区 7 屏全被重定向 ⇒ 单列 `REDIRECT_NO_AUTH` 并注明不得计 LIVE；未用 200 冒充页面取证 |
| SCREENSHOT / HAR | 24 张 PNG / 1614 entries HAR（敏感头 0） |
| VERDICT | **PARTIAL** — 公开页 LIVE 完成；工作区七屏 **NOT_TESTED** |
| BLOCKER | 无生产登录态 / 无 QA 账号授权 |
| NEXT_EXECUTABLE_ACTION | Owner 提供只读登录态后补 7 屏 LIVE 取证与交互录像 |

### W03/DEV01 · 首页重写 — `TESTED`
| 字段 | 值 |
|---|---|
| SOURCE_SHA | `de6b3b9` → V22 工作树 |
| CODE_FILES | `src/app/(landing)/page.tsx`（742 → 约 350 行，整体重写） |
| CLAIM_ID | CLM-001~012、023、024 |
| TEST_COMMAND / EXIT_CODE | `npx tsc --noEmit` 0 · 定向 eslint 0 · `claim-gate` 首页命中 **8 → 0** |
| NEGATIVE_CONTROL | claim gate 禁止词/verified/中文/金额/旧品牌全部不命中；`--self-test` 证明规则未放宽 |
| VERDICT | **CODE COMPLETE + 本地 TESTED**；`INDEPENDENTLY_VERIFIED` 未达 |
| BLOCKER | 无外部 Reviewer；生产 `b50e53e` 仍是旧首页 |
| NEXT_EXECUTABLE_ACTION | 外部 Reviewer 复跑；Owner 授权后 Preview SHA 对应取证 |

### W03/DEV03 · 工作台导航 4 主任务 + 7 内部 key — `TESTED`
| 字段 | 值 |
|---|---|
| CODE_FILES | `src/app/workspace/living-workspace.tsx`、`src/components/living/living-shell.tsx` |
| TEST_COMMAND / EXIT_CODE | `npx jest tests/living --runInBand` → **0 / 20 suites / 389 tests**；tsc 0；eslint 0 |
| NEGATIVE_CONTROL | 7 个 `?view=` key 逐个深链不 404、不倒退 Now；「更多」Esc / 焦点恢复；`READY_VIEW_KEYS` 未缩水 |
| VERDICT | **本地 TESTED**；真浏览器刷新/前进后退 **NOT_TESTED**（缺登录态） |
| BLOCKER | 生产登录态；外部 Reviewer |
| NEXT_EXECUTABLE_ACTION | 有登录态后跑 `workspace-tabs.spec.ts`（已按新 IA 更新，16 用例） |

### W03/DEV02 · 六个公开页 + 目标草稿接力 — `TESTED`
| 字段 | 值 |
|---|---|
| CODE_FILES | `(public)/{product,solutions,how-it-works,stories,about,contact}/page.tsx`、`(auth)/register/page.tsx`、`(landing)/page.tsx` 数行、`living-workspace.tsx` 预填、`src/lib/goal-draft.ts`（新）、2 个 e2e 夹具 |
| TEST_COMMAND / EXIT_CODE | tsc 0 · `tests/living` 389 · `goal-draft` smoke 15/15 · 真浏览器公开链路 **10/10**（`BROWSER_ALL_OK`）· `playwright --list` 两夹具 35 用例 |
| NEGATIVE_CONTROL | `<b>/<script>` 不可信 goal 被转义为纯文本；清空 URL 后仍从 storage 恢复；刷新不丢草稿 |
| VERDICT | **本地 TESTED**（公开链路）；「注册→验证→工作区」完整链路 **NOT_TESTED**（需邮箱验证码 + DB + 有效会话） |
| BLOCKER | `proxy.ts` 冻结门默认仍挡 4 页（**有意保留**，见 §3）；生产 D1/D8 未批 |
| NEXT_EXECUTABLE_ACTION | Owner 批准 D1/D8 后设 `PUBLIC_SURFACE_FROZEN=false` 出 Preview；补完整注册链路 |

### W04/DEV07 · 定价 fail-closed（页面 + JSON） — `TESTED`
| 字段 | 值 |
|---|---|
| CODE_FILES | `src/config/pricing-gate.ts`（新，`PRICING_APPROVED=false`）、`(public)/pricing/page.tsx`、`src/app/api/payments/dodo/plans/route.ts`、`tests/api/v22-pricing-json-gate.test.ts`（新） |
| TEST_COMMAND / EXIT_CODE | `npx jest tests/api/v22-pricing-json-gate.test.ts --runInBand` → **0 / 3 tests**；tsc 0；eslint 0 |
| NEGATIVE_CONTROL | 断言响应体不含 `$数字` / `amountCents` / `trialDays` / `89|199|449` / 套餐名；前置非空检查防空集假绿；`PRICING_APPROVED===false` 防误翻 |
| SCREENSHOT / HAR | 生产 `pricing.png` 显示旧价格（**整改前**证据） |
| VERDICT | **本地 TESTED**；生产 `b50e53e` 仍显示 `$89/$199/$449`，本批**未改生产** |
| BLOCKER | Owner 未授权发布；`src/config/products.ts` / `subscription-plans.ts` 仍标 `APPROVED`（既有自填值，改它涉及支付门禁语义，需单独批次） |
| NEXT_EXECUTABLE_ACTION | 单独批次统一商业真值源；授权后发布并复验 JSON 与 SSR |

### W05/DEV09 · claim gate — `TESTED`
| 字段 | 值 |
|---|---|
| CODE_FILES | `scripts/qa/v22-claim-gate.mjs`（新）、`docs/v22/claim_register.csv`（只读） |
| TEST_COMMAND / EXIT_CODE | `--self-test` → **0 / PASS**；主扫描 → **1 / FAIL（42 → 29 命中）** |
| NEGATIVE_CONTROL | 规则未删、未加全局 allowlist；allowlist 仅 `product/page.tsx` 的 `For developers` 折叠区行区间，只豁免 `BANNED_WORD` |
| VERDICT | **工具 PASS，全站门禁 FAIL（如实）** |
| BLOCKER | 剩余 29 命中属隔离范围：`hlua` 中文 15（旧业务线）、`checkout/success` 中文 11（旧支付回跳）、`terms` 3（法律正文，需法务批准） |
| NEXT_EXECUTABLE_ACTION | Owner/法务裁决旧业务线是否独立中文站；裁决前 G02 维持 FAIL |

### W06 · 独立验收与受控发布 — `TODO`
| 字段 | 值 |
|---|---|
| VERDICT | **BLOCKED / NOT_TESTED** |
| BLOCKER | 外部 Codex Reviewer 未介入；`gh` CLI / admin PAT 无；main `protected=false`；无 Preview；无 Figma 凭据；无 10 名真人样本；生产发布未授权 |
| NEXT_EXECUTABLE_ACTION | 逐项见 §4 |

## 2. 13 个 V22 发布硬门（逐条裁决）

| Gate | 标准 | 本批裁决 | 依据 |
|---|---|---|---|
| G00 战略符合 | Owner 通过定位 + 3 Job Stories + 每 Claim 有证据 | **PENDING** | `STRATEGY_LOCK.md §7` 未签字 |
| G01 生产真实审计 | 官网 + 12 公开页 + 7 工作区 key + 登录注册 + 旧业务隔离 | **PARTIAL / NOT_TESTED** | 17 LIVE；7 工作区屏重定向 |
| G02 文字与 i18n | 语言一致率 100%、未批准能力声明 0 | **FAIL** | claim gate 29 隔离命中；法务/旧业务线待裁决 |
| G03 业务主线 | Goal→编辑→授权→行动→可核验结果各步有真实 ID | **PARTIAL** | 外部动作与 Provider 回执仍 `planned` |
| G04 产品可用性 | 10 真人 ≥8 看懂 / ≥8 完成核心任务 | **NOT_TESTED** | 无真人样本，Owner 未组织 |
| G05 设计一致性 | Figma Node ID ↔ 7 screen + 营销页 1:1 | **BLOCKED** | 无 Figma 凭据/连接器 |
| G06 视觉/响应式 | 7 viewport × 关键状态，overflow=0 | **PARTIAL** | 本批 1440 桌面 + 生产 24 页截图；未做 7 视口全覆盖 |
| G07 无障碍 | AA 零严重、键盘/200% zoom/读屏/reduced motion 实测 | **NOT_TESTED** | 本批只做代码级 44px / focus / Esc；未跑 axe 与人工检查 |
| G08 性能 | 9/9 TBT≤200ms、LCP≤2.5s、CLS≤0.1 | **FAIL**（沿用 V21 实测） | 9/9 MISS，TBT 1743–3828ms；首页重写后未重跑 G15，不宣称改善 |
| G09 安全 | 租户/Consent/R1/注入/越权负例全过 | **PARTIAL** | R1 本地 HTTP 6/6（V21 第三批），本批未重跑安全套件 |
| G10 商业真实性 | D1/D8 未批不露价格与法务假承诺 | **FAIL（生产） / 本地已修** | 生产 pricing 仍显示三档价格；本地页面+JSON 已 fail-closed |
| G11 CI 与独立复核 | 独立 reviewer + required CI 全绿 + Preview SHA 对应 | **BLOCKED** | 无 reviewer、无 Preview、main 无保护 |
| G12 发布准备 | 迁移/回滚/monitor/owner 批准/manifest | **BLOCKED** | 迁移 18/18 本地 PASS（V21），但生产迁移未授权 |
| G13 生产验收 | deploy SHA=候选、端到端复验、48h 观察 | **NOT_TESTED** | 未发布 |

**任何一个 `BLOCKED/PARTIAL/NOT_TESTED/FAIL` 都不能宣称发布完成 ⇒ 整体 `NO-GO`。**

## 3. 27 项逐路由矩阵回填

| Route | 矩阵级别 | 本轮 LIVE | 本地代码状态 | 备注 |
|---|---|---|---|---|
| `/` | LIVE | ✅ | DEV01 重写 | claim gate 0 命中 |
| `/workspace?view=studio` | LIVE(用户浏览器) | ⛔ 重定向 | DEV03 保留 key + 二级「更多」 | 本轮 NOT_TESTED |
| `/workspace?view=now` | SCREENSHOT | ⛔ 重定向 | DEV03 收敛异常条 + DEV02 预填 | 本轮 NOT_TESTED |
| `/product` | SOURCE | ✅ 占位页 | DEV02 重写 + `For developers` 折叠 | 生产仍冻结 |
| `/solutions` | SOURCE | ✅ 占位页 | DEV02 重写三类 Job Story | 生产仍冻结 |
| `/how-it-works` | SOURCE | ✅ 占位页 | DEV02 三步主流程 | 生产仍冻结 |
| `/stories` | SOURCE | ✅ 占位页 | DEV02 无真实成果 + DEMO 同级标注 | 生产仍冻结 |
| `/pricing` | SOURCE | ✅ 显示未批价格 | DEV07 页面+JSON fail-closed | 生产仍泄价 |
| `/help` | SOURCE | ✅ | claim-cleanup 去禁用词 | 仍冻结 |
| `/about` | SOURCE | ✅ | DEV02 重写使命，不露主体 | — |
| `/contact` | SOURCE | ✅ | DEV02 去 SLA + 去主体占位 | — |
| `/terms` `/privacy` `/refunds` | SOURCE | ✅ | terms 3 命中待法务批 | D8 未核实 |
| `/login` `/register` `/dashboard/onboarding` | SOURCE | ✅ | 注册草稿接力已接通 | 完整链路 NOT_TESTED |
| `/support` `/faq` | SOURCE | ✅ | 未逐页重写 | 重复路由待 canonical |
| `missions/consent/agents/outcomes/field` 五屏 | SOURCE | ⛔ 重定向 | DEV03 7 key 全保留 | 本轮 NOT_TESTED |
| `CI/Netlify` | REPORT | — | C07 治理载荷已备（V21） | 需 `gh`/admin PAT |
| `G15 9 页` | REPORT | — | 未重跑 | 沿用 FAIL |
| `public i18n` | REPORT | ✅ 混语复现 | claim gate 主线 0 命中 | 隔离页待裁决 |

> **关于冻结门**：`proxy.ts` 的 `isPublicSurfaceFrozen()` 是 2026-11-12 事故后有意加的 fail-closed 保护（防未批准定价与未核实主体外泄）。总令 §C.5「原商业审批门不可逆打开」，故本批**不打开它**；四页新内容保持本地候选，解冻需 Owner 批准 D1/D8 后设 `PUBLIC_SURFACE_FROZEN=false`。这解释了「本地已改、线上仍占位」，且不构成跳过发布纪律。

## 4. 明确外部依赖（BLOCKED，登记而非停工借口）

| 依赖 | 谁给 | 卡住什么 |
|---|---|---|
| 业务 Owner 签字（使命/Hero/Job Stories） | Owner | G00 |
| 生产只读登录态 / QA 账号 | Owner | G01 七屏 LIVE、G06 交互录像 |
| 10 名真实目标用户 | Owner 组织 | G04 |
| Figma 可编辑凭据 + NodeId | Owner | G05 |
| `gh` CLI 或 admin PAT | Owner | G11 分支保护 / required checks / PR |
| 外部 Codex / 第三方 Reviewer | Owner | G11 独立复核（本批子代理**不算**独立主体） |
| D1 定价批准 / D8 法律主体核实 | Owner + Legal | G10、公开面解冻、法务正文 |
| 外部动作 Provider + 沙箱授权 | Owner | G03 真实 Provider Receipt |
| 生产发布与迁移的明确授权 | Owner | G12/G13 |
| 首屏 RSC 化批次授权 | Owner | G08 性能达标（当前 227KB gzip、`(program)` 50–63%） |

## 5. 回归读数（本批实跑，`SOURCE_SHA` = V22 工作树）

| 命令 | EXIT | 读数 |
|---|---|---|
| `npx tsc --noEmit`（改前/改后各一次） | **0 / 0** | 0 诊断 |
| `npx eslint`（V22 改动文件定向） | **0** | 0 error / 0 warning（register 的 15 条为既有债，HEAD 基线逐字相同，本轮新增 0） |
| `npx jest --runInBand --silent`（全量） | **0** | **162 suites / 2925 tests**（V21 基线 160/2915 ⇒ +2 suites / +10 tests） |
| `npx jest tests/living --runInBand` | **0** | 20 suites / 389 tests（导航改动后无回归，未删用例/未 skip/未放宽） |
| `npx jest tests/api/v22-pricing-json-gate.test.ts` | **0** | 3/3（含 `PRICING_APPROVED===false` 防误翻与响应体禁词负例） |
| `npm run build`（两次，第二次含水合修复） | **0 / 0** | 第二次 `.next/BUILD_ID` 更新；`tsconfig.json` 未被重写 |
| `node scripts/qa/v22-claim-gate.mjs --self-test` | **0** | PASS（9 违规 / 6 合规 / 4 注释形态 / 4 可见形态 / 窄 allowlist / 空集负控） |
| `node scripts/qa/v22-claim-gate.mjs` | **1** | **FAIL（如实）**：42 → **29** 命中，主线页面 **0**；剩余全在 `hlua`(15) / `checkout/success`(11) / `terms`(3) 隔离范围，规则未放宽、未加全局 allowlist |
| `PW_CHANNEL=chrome node scripts/qa/v22-live-capture.mjs` | **0** | 生产 24 路由：**17 LIVE / 7 REDIRECT_NO_AUTH / 0 非 200 / 0 浏览器错误**；24 截图 + 1614 entries HAR（敏感头 0） |
| `PW_CHANNEL=chrome node scripts/qa/v22-preview-shots.mjs`（修复前） | **0** | 12 用例、`failedChecks=[]`、GOAL_RELAY PASS，**但 `/pricing` 1 个 React #418 水合错误** → 记为 RED 证据 |
| 同上（修复后复跑） | **0** | **12 用例 / 0 浏览器错误 / 0 failedChecks / GOAL_RELAY PASS(5 步)** ⇒ #418 消除，PRE→GREEN 闭环 |
| `goal-draft` 运行时 smoke + 真浏览器公开链路 | **0** | 15/15 + 10/10（`BROWSER_ALL_OK`），含 `<img onerror>` XSS 负例与刷新恢复 |
| `npx playwright test --list`（两个更新后的 e2e 夹具） | **0** | 35 用例收集正常（workspace-tabs 16 / authed-mobile 19），**未跑完整 CI** |

**明确未跑（一律 `NOT_TESTED`，不得用 V21 的 PASS 冒充）**：`e2e-ci` 全量、axe 自动扫描与人工键盘/读屏/200% zoom、7 视口 × 全部关键状态覆盖、G15 9 页性能复测、视觉回归脚本、闭环脚本、红队脚本、完整「注册→验证→工作区」浏览器链路（需邮箱验证码 + 有效会话）。

### 5.1 RED → GREEN 实录（本批真实修掉的三个问题）

1. **React #418（`/pricing`）**：根因 = `Navbar` 是 client component 却自行调用 `isPublicSurfaceFrozen()`，而 `PUBLIC_SURFACE_FROZEN` 非 `NEXT_PUBLIC_*`、不会内联到浏览器 ⇒ 服务端解冻 / 客户端仍冻结 ⇒ 导航链接数不一致。修法：`(public)/layout.tsx` 服务端计算一次并以 prop 传给 Navbar 与 Footer。复验 `pagesWithErrors: 1 → 0`。
2. **旧品牌 `LokFee!` + 心跳渐变 Logo** 出现在 V22 公开页头部：换成与首页一致的简约 `LOKFEEL` 字标，旧 B2C 视觉不再领衔 ONE 产品面。
3. **Hero 移动端连读** `Stay in control.See what...`：`<br>` 在移动端隐藏导致文本无空格，补 `{" "}` 后朗读与视觉都正确。

### 5.2 每页证据索引（原始问题截图 ↔ 修改后截图）

| Route | 原始（生产 LIVE，`evidence/screenshots/`） | 修改后（本地 Preview，`evidence/preview/`） | CLAIM_ID |
|---|---|---|---|
| `/` | `root.png` | `home-desktop.png` / `home-tablet.png` / `home-mobile.png` | CLM-001~012, 023, 024 |
| `/product` | `product.png`（中文占位 + `LokFee!`） | `product-desktop.png` | CLM-013 |
| `/solutions` | `solutions.png` | `solutions-desktop.png` | CLM-014 |
| `/how-it-works` | `how_it_works.png` | `how-it-works-desktop.png` | CLM-015 |
| `/stories` | `stories.png` | `stories-desktop.png` | CLM-016 |
| `/pricing` | `pricing.png`（未批三档价格） | `pricing-desktop.png` | CLM-017 |
| `/about` | `about.png` | `about-desktop.png` | CLM-018 |
| `/contact` | `contact.png` | `contact-desktop.png` | CLM-019 |
| `/login` | `login.png` | `login-desktop.png` / `login-mobile.png` | CLM-022 |
| `/register` | `register.png` | 目标接力见 `evidence/preview-*.json` 的 `relay.steps` | CLM-022 |
| 工作区 7 key | `workspace_view_*.png`（均为登录重定向页，**非工作区证据**） | **NOT_TESTED**（无登录态） | CLM-020/021 |
| 其余公开/法务页 | 见 `evidence/screenshots/*.png` 与 `live-*.json` | 未逐页重写，状态见 §3 | — |

> 证据等级声明：`preview/*.png` 是 **LOCAL_PREVIEW**，不等于生产 LIVE；生产取证来自 `v22-live-capture.mjs`。二者不混用。

## 6. 最终裁决

**V22 本批：`NO-GO`（未完成发布验收），但已完成战略归零的第一批可执行工程。**

真实推进：生产 LIVE 取证 24 路由 → 战略事实源三份 → 首页推倒重写 → 工作台 4+7 导航 → 六公开页重写 → 目标草稿接力闭环 → 定价页面与 JSON 双 fail-closed → claim gate（42→29，主线 0 命中）→ 定价 JSON 红绿测试。

未做也不冒充：生产发布、main 保护、独立 Reviewer、10 人真人、Figma、7 视口视觉、axe、G15 性能复测。
