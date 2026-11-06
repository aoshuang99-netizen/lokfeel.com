# V20.3 · 40 — 设计权威源事实盘点与唯一事实矩阵

> **判定口径**：只用 `PASS / FAIL / BLOCKED / NOT_TESTED`。每项附真实路径、Git SHA 或实测证据。
> **盘点日期** 2026-11-06 · **仓库** `/Users/frankzhao/WorkBuddy/20260402202519/nexus-app`
> **HEAD** `064cfe8e4eee85d4ac70f902220d76f2b5f1c08d`（分支 `t4/v199-visual` = `origin/main`）

## 0. 结论先行

- 作战令点名的 8 项权威源**全部真实存在**，无一项需要虚构替代文件。
- **Figma 可编辑节点：`BLOCKED`**——账号连通 ≠ 写入能力。实测证据见 `42_V203_FIGMA_NODE_TRACEABILITY.md`。
- **登录性能：`FAIL`（`PERF_TARGET_NOT_MET`）**——继承 `v19/20_LOGIN_PERFORMANCE.md`，冷态 LCP 6544ms，禁止宣称达标。
- **六屏/七屏真实业务态生产证据：`BLOCKED`**——继承 `v19/16_REAL_UI_AUDIT.md`（D-06 无可登录 QA 账号）。
- 本轮**纠正了上一轮交付的两处事实错误**（详见 §5），并落地一处可验证的代码修复（见 `43`）。

## 1. 权威源存在性核验（全部真实读取）

| 作战令指名 | 真实路径 | 状态 | 证据 |
|---|---|---|---|
| Concept C 视觉方案 | `design/v19/concept-c-adaptive-dual-world.html` | PASS | 285 行，`<title>V19 Concept C — Adaptive Dual World`；4 阶段 Intent/Workspace/Consent/Outcome |
| `06` 设计 Token 归一映射 | `docs/implementation/v19/06_DESIGN_SYSTEM.md` | PASS | §3 明载「原型 21 色不进代码」裁决 |
| `07` Living Workspace 六屏 | `docs/implementation/v19/07_WORKSPACE_SPEC.md` | PASS | §1 六屏表 + §2 `Figma Node ID = N/A (HTML source)` |
| `08` Console 七屏 | `docs/implementation/v19/08_CONSOLE_SPEC.md` | PASS | §1 七屏表 + 第八条详情路由 |
| `16_REAL_UI_AUDIT.md` | `docs/implementation/v19/16_REAL_UI_AUDIT.md` | PASS | 32 次真实 Chromium 导航原始报告 |
| `19_FIGMA_CODE_TRACEABILITY.md` | `docs/implementation/v19/19_FIGMA_CODE_TRACEABILITY.md` | PASS | 状态 `BLOCKED_FIGMA_CONNECTOR` |
| `20_LOGIN_PERFORMANCE.md` | `docs/implementation/v19/20_LOGIN_PERFORMANCE.md` | PASS | 状态 `PERF_TARGET_NOT_MET` |
| V19.9 T-4 截图 | `docs/implementation/v19/screenshots/production-dc102cd/` | PASS | 真实 PNG（1440×900 / 390×844 双视口） |
| V20.0 矩阵 | `docs/implementation/v20/01_V200_PAGE_API_STATE_MATRIX.md` | PASS | 13 屏逐屏 Page→API→DB→State→Evidence |
| V20.1 CF 审计 | `docs/implementation/v20/24_CF_INFRASTRUCTURE_AUDIT.md` | PASS | 存在 |
| 真实 `--lf-*` 令牌 | `src/app/globals.css` L1709–L1880 | PASS | 21 个 token，Deep Field / Living Paper 双 mode |
| 真实后端枚举 | `prisma/schema/{agent,connection,core,outcome}.prisma` | PASS | 见 `44_V203_INTERACTION_STATE_MATRIX.md` |
| 真实 API 路由 | `src/app/api/v1/**/route.ts` | PASS | 48 条 route.ts |
| 真实 E2E | `tests/e2e-ci/*.spec.ts`（9）+ `tests/e2e/*.spec.ts`（13） | PASS | 见 `43` §4 |
| 性能脚本 | `scripts/qa/perf-baseline.mjs` | PASS | 存在 |

## 2. 唯一事实矩阵

链路：`历史需求 → 设计资产 → Figma Node → 页面 → 组件 → API → 数据源 → 测试 → 生产证据`

| # | 链路项 | 分类 | 真实路径 / SHA | 证据 |
|---|---|---|---|---|
| 1 | Concept C 视觉方案 | IMPLEMENTED_VERIFIED（结构）/ DESIGN_ONLY（色板） | `design/v19/concept-c-adaptive-dual-world.html` | `06` §3 裁决色板不进代码 |
| 2 | 设计 Token 归一 | IMPLEMENTED_VERIFIED | `src/app/globals.css` L1709+、`v19/06_DESIGN_SYSTEM.md` | `npm run verify:contrast` WCAG AA 全组合通过（`06` §1） |
| 3 | Deep Field / Paper 双世界 | IMPLEMENTED_VERIFIED | `globals.css` L1771–L1831 `[data-lf-dual='1']` | canvas 恒深 / inspector 恒浅；paper 阅读模式 |
| 4 | **Figma 可编辑 Node** | **BLOCKED_ACCESS** | `v19/07` §2 / `08` §2 / `19` §1 | Node ID = `N/A (HTML source)`；本轮实测见 `42` |
| 5 | Workspace 六屏 | IMPLEMENTED_VERIFIED（代码）/ BLOCKED（生产业务态） | `src/app/workspace/living-workspace.tsx` | `16` §2：认证面 302→/login，无业务态生产证据（D-06） |
| 6 | Console 七屏 | IMPLEMENTED_VERIFIED（代码）/ BLOCKED（生产业务态） | `src/app/console/**/page.tsx`（8 个路由文件） | 同上 |
| 7 | 逐屏 API / DB 契约 | IMPLEMENTED_VERIFIED | `v20/01_V200_PAGE_API_STATE_MATRIX.md` | 13 屏 100% 有真实代码引用 |
| 8 | Evidence 真相链 | IMPLEMENTED_VERIFIED | `v20/13_EVIDENCE_TRUTH_MATRIX.md` | UI「已批准/已验证」钉到唯一服务端字段 |
| 9 | Agent S1 隔离沙箱 | IMPLEMENTED_VERIFIED | `v20/36_V202_AGENT_REAL_E2E.md` | 708/708（39 套件）本地实跑 |
| 10 | Agent S2 真实 Provider | **BLOCKED** | `v20/36` / `35_V202_BACKEND_RUNTIME_ACCEPTANCE.md` | 缺 `WORKBUDDY_LLM_*` / `OPENAI_API_KEY` Secrets |
| 11 | Agent S3 生产业务验证 | **BLOCKED** | `v20/36` | 缺 D-10 授权与真实用户授权 |
| 12 | 后端运行时验收 | **BLOCKED** | `v20/35` | DB/Auth/Cache OAuth 全缺凭据，不伪造「可用」 |
| 13 | 六屏深链接 / 刷新恢复 | **MISSING → 本轮 IMPLEMENTED_VERIFIED** | `src/lib/living/workspace-view.ts` + `living-workspace.tsx` | 新增 14/14 单测 + tsc 0 + eslint 0，见 `43` §5 |
| 14 | Workspace·Missions 列表区 | **MISSING（诚实禁用）** | `living-workspace.tsx` NAV `ready:false` | `MISSIONS_REASON` 明写「未接线」；`v20/02` G-01 |
| 15 | 登录性能目标 | **BROKEN / FAIL** | `v19/20_LOGIN_PERFORMANCE.md` | 冷 LCP 6544ms / 目标 ≤2500ms；`PERF_TARGET_NOT_MET` |
| 16 | Cloudflare Preview 部署 | IMPLEMENTED_VERIFIED | run `42151427907` → worker `lokfeel-preview` | CF API `modified_on=2026-11-06T02:40:32Z` |
| 17 | Cloudflare 生产部署 | IMPLEMENTED_VERIFIED | worker `lokfeel-app` | CF API `modified_on=2026-11-06T03:26:46Z`，version `0e4cceba-3e34-4b7c-b307-bd311f8b8bef` |
| 18 | 受管生产流水线官方 run | **BLOCKED** | `.github/workflows/cloudflare-production.yml` | PAT 无 `Workflows:Write`；`Production` Environment 无审批人 |
| 19 | 视觉回归 / 无障碍 / 性能新测 | **NOT_TESTED** | 本轮未跑浏览器 | 复跑命令见 `46` / `47` |
| 20 | Figma-to-Code 差异记录 | **BLOCKED**（缺 Node ID） | `v19/16_REAL_UI_AUDIT.md` | 无设计节点可比对 |

分类统计：IMPLEMENTED_VERIFIED 9 · IMPLEMENTED_VERIFIED/BLOCKED 并行 2 · BLOCKED 6 · NOT_TESTED 1 · FAIL 1 · 本轮新增 1。

## 3. 参考图定位（不得当作仓库已有实现）

用户提供的两张图（Deep Field 深场星云紫蓝 / Paper 白底高可读数据溯源）在作战令中已明确标注为
**「视觉方向参考，不是仓库中已有的设计示例图或已实现页面」**。本轮按此处理：
- 它们是**方向**，不是可落地色板；`06` §3 已裁决原型 21 个 teal/blue 自由色不进代码。
- 真实落地色板以 `globals.css` 的 `--lf-*`（Warm Signal `#d7ac78` / Deep Field `#0b0e11` / Living Paper `#f7f5f0`）为唯一事实源。
- 最终验收须使用仓库原型、Figma 实际节点与真实浏览器截图（后者本轮 NOT_TESTED）。

## 4. 屏幕结构（真实，来自 07/08 与源码）

- **Workspace 六屏**（`07` §1 + `living-workspace.tsx` NAV L120–128）：
  `Now` / `Studio` / `Field` / `Consent` / `Outcomes` / `Agents`。
  第 7 项 `Missions` 为 `ready:false` 未接线，**不伪装可用**。
- **Console 七屏**（`08` §1）：总览 `/console`、智能体 `agents`、连接 `connections`、成员 `members`、
  连接任务 `missions`（+ `/[missionId]` 第八条路由）、成果 `outcomes`、设置 `settings`。
- 作战令 §4.1 的 `Intent/Workspace/Mission/Agent/Consent/Outcome` 是**体验模块**，与真实六屏
  **不是一一对应**；按作战令要求「保留原屏幕结构，并在映射表中说明对应关系」——映射见 `43` §2。

## 5. 🔴 本轮纠正的既有事实错误（上一轮交付）

| # | 上一轮 HTML 规格的错误 | 权威源事实 | 处置 |
|---|---|---|---|
| 1 | 六屏写成 `WS-1 Overview / Connections / Studio …`；七屏写成含 `Billing / Consent` | `07`/`08` 真实清单见 §4 | 本文件 §4 与 `43` 全部改用真实屏名，未新建虚构路由 |
| 2 | 色板用 `#4F46E5` 靛紫 + `#FB7185` 粉，另建 Token 体系 | `06` §3 明令「另建不兼容体系」是红线；唯一体系为 `--lf-*` | `41` 全量列出真实 21 个 token，删除虚构色板 |
| 3 | 把「账号连通」表述为可交付 Figma 设计 | `19` 明载 `BLOCKED_FIGMA_CONNECTOR`；本轮 PAT 实测无写入端点 | `42` 标 `BLOCKED_FIGMA_WRITE`，不虚构 Node ID |

> 上一轮的 `/tmp/lokfeel-uiux-design-spec.html` **不构成 V20.3 交付物**，仅作过程记录，不作为验收依据。

## 6. 本轮本地门禁最终结果（2026-11-06 实跑，全部 `env -u NODE_OPTIONS`）

| 门禁 | 命令 | 结果 |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | **PASS 0** |
| 新增单测 | `npx jest tests/living/workspace-view.test.ts --ci` | **PASS 14/14** |
| Living 回归 | `npx jest tests/living --ci --silent` | **PASS 869/869（34 套件）** ⚠️ 见下方口径说明 |
| 改动文件 lint | `npx eslint <5 文件>` | **PASS 0** |
| UI 不变量 | `npm run check:ui-invariants` | **PASS（R1–R11 全通过）** |
| Lint 棘轮 | `npm run lint:gate` | **PASS（零新增；债务下降 5、清零 17）** |
| 全量 Jest（CI 命令，修正口径后） | `TZ=UTC npm test -- --ci --reporters=default --silent` | **PASS 128 套件 / 2493 测试**（见 `51`） |
| `next build` | — | **NOT_TESTED**（本轮未跑） |

> 🔴 **869/869 的口径说明（不虚报）**：jest 的 `testMatch` 是 `**/tests/**/*.test.ts`，
> 会把构建产物里的同名副本也扫进来。34 套件中约 21 个来自 `.next/standalone/` 与
> `.open-next/server-functions/default/`，是**同一批源码测试的副本**，不是独立覆盖。
> 真实源码套件为 `tests/living/` 下 13 个（均 PASS）。此处如实记录，不把副本数当作覆盖率。
>
> ✅ **2026-11-06 后续修正（详见 `51`）**：`jest.config.js` 的 `testPathIgnorePatterns`
> 已补 `<rootDir>/.next/` 与 `<rootDir>/.open-next/`。原配置只有 `<rootDir>/tests/e2e/`
> 这类绝对前缀，覆盖不到构建产物里的副本，导致本地 build 后跑 `npm test` 会扫进
> 254 个测试副本与 Playwright 用例（40 个假 FAIL）。修正后本地与 CI 干净 checkout
> 口径一致：**全量 128 套件 / 2493 测试全 PASS**。上表 869/869 为修正前历史记录，保留不改写。

### 本轮额外修复的两处既有红灯（均非本轮引入，判定有据）

| # | 红灯 | 归属证据 | 修复 | 复验 |
|---|---|---|---|---|
| 1 | `check:ui-invariants` R9：`consent-gate.tsx:567` 的 `**不在**` 星号会原样渲染到生产界面 | `git diff` 空 + `git show HEAD:` 逐字相同 | 改 `<strong>不在</strong>`（纯渲染修正，语义不变，未触碰 `07` §4 裁决保留的文案） | R1–R11 全通过 |
| 2 | `lint:gate` +3064 条「新增债务」，全部来自 `test-results/ci-r2/html/trace/*.js` | 新增列表 19 项全在 `test-results/`；本轮 3 文件 `npx eslint` = 0；`src/` 反而债务下降 | `eslint.config.mjs` 的 `BUILD_ARTIFACTS` 补 `test-results/**`（该目录已在 `.gitignore:50`），**不降级任何规则** | 零新增 |

## 7. 复跑命令

```bash
cd /Users/frankzhao/WorkBuddy/20260402202519/nexus-app
git log --oneline -1                                   # 固定 SHA
env -u NODE_OPTIONS npx tsc --noEmit                  # 0
env -u NODE_OPTIONS npx jest tests/living/workspace-view.test.ts --ci   # 14/14
env -u NODE_OPTIONS npx eslint src/lib/living/workspace-view.ts tests/living/workspace-view.test.ts src/app/workspace/living-workspace.tsx  # 0
env -u NODE_OPTIONS npm run check:ui-invariants                 # R1–R11 全通过
env -u NODE_OPTIONS npm run lint:gate                          # 零新增
node scripts/qa/v19-real-ui-audit.mjs                  # 16 号审计复跑（需生产可达）
node scripts/qa/perf-baseline.mjs                     # 性能复跑（同环境冷热各 5 样本）
```
