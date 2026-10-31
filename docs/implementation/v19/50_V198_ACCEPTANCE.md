# 50 · V19.8 验收台账（V19-86 · Batch 7）

- 日期：2026-10-31
- HEAD：`5c96f2c`（分支 `v19/design-exploration`；远端仍 `3968f8f` —— 推送 BLOCKED_GITHUB_AUTH 未解除）
- 状态口径：**LOCAL_PASS / REMOTE_CI_PASS / BLOCKED / FAIL / NOT_TESTED** 五档，不混用。
- 本轮会话内提交链：`d130e4d`（Batch 4）→ `048c90f`（Batch 5）→ `c31e247`（Batch 6）→ `5c96f2c`（Batch 7 前哨修复）

## 1. 门禁矩阵

| # | 门禁 | 状态 | 命令 / 说明 | 证据 |
|---|---|---|---|---|
| 1 | Typecheck | **LOCAL_PASS** | `node node_modules/typescript/bin/tsc --noEmit` → exit 0 | `/tmp/tsc-final.log` |
| 2 | Lint（ESLint + 棘轮） | **LOCAL_PASS** | 棘轮：**零新增**；债务下降 4 处、清零 15 处 | `/tmp/lint-final.log` |
| 3 | Build（next build） | **LOCAL_PASS** | `.next-v205`，`BUILD_ID=ThGipKCkWd6UAgNkQA0cRP`，exit 0 | `/tmp/build-v205.log` |
| 4 | Jest 全量 | **LOCAL_PASS** | **117 套件 / 2349 tests 全过**（跑于 c31e247 树；HEAD 仅多 footer 颜色与 e2e 测试文件改动，无 jest 覆盖面变化） | `/tmp/jest-full.log` |
| 5 | Playwright E2E（CI 配置） | **LOCAL_PASS** | **113 passed / 0 failed**（5.5min，PW_CHANNEL=chrome + v205 产物） | `/tmp/pw-ci7.log` |
| 6 | axe 四视口棘轮（24 格） | **LOCAL_PASS** | 首跑抓到 `/login` color-contrast ×4 视口（真实回归）→ 修复后**零新增** | `/tmp/axe-gate2.log` |
| 7 | Console 七屏 axe（Batch 5） | **LOCAL_PASS** | 49 格 wcag2a+2aa 0 违规 | 47 号文档 |
| 8 | 视觉回归（104 格） | **LOCAL_PASS** | Before/After 各 104 PASS / 0 FAIL，触控<24 由 10 → 0 | `/tmp/v198-visual-{before,after}/` |
| 9 | payment-off 契约 | **LOCAL_PASS** | `verify-payment-off.mjs` 对 v205 产物 | `/tmp/e2e-verify-payment-off.mjs.log` |
| 10 | 双组织隔离取证 | **LOCAL_PASS** | 9 PASS / 0 FAIL / 1 BLOCKED（SEC-08 需跨 4 表夹具，与 CI 同口径） | `/tmp/e2e-isolation.log` |
| 11 | Mission 真实闭环 | **LOCAL_PASS** | `v196-mission-flow` exit 0 | `/tmp/e2e-mission.log` |
| 12 | Workspace 真实闭环 | **LOCAL_PASS** | **12 PASS / 0 FAIL**（含 W-08 创建/W-09 刷新恢复） | `/tmp/e2e-wsloop.log` |
| 13 | 认证面导航探针 | **LOCAL_PASS** | 3 轮全 200 | `/tmp/e2e-nav.log` |
| 14 | 验收台账对账 | **LOCAL_PASS** | 42 条 = 29 PASS / 0 FAIL / 13 BLOCKED | `/tmp/g7-gen-acceptance-ledger.mjs.log` |
| 15 | 定价一致性 / 产品目录 / 证据透镜 / WSDrift | **LOCAL_PASS** | 四项全过（含变异自证） | `/tmp/g7-*.log` |
| 16 | 退款协议层端到端 | **LOCAL_PASS** | `refund-e2e.mjs`（5 场景 19 断言） | `/tmp/g7-refund-e2e.mjs.log` |
| 17 | 租户范围审计（strict） | **LOCAL_PASS** | `audit:tenancy` | `/tmp/gate-audit:tenancy.log` |
| 18 | 对比度令牌门禁 | **LOCAL_PASS** | `verify:contrast`（5 板块×15 组 WCAG） | `/tmp/gate-verify:contrast.log` |
| 19 | 依赖棘轮 / 迁移漂移 | **LOCAL_PASS** | `verify:check:deps` / `verify:check:migration-drift` | `/tmp/gate-*.log` |
| 20 | SLO 对账 + 自证 | **LOCAL_PASS** | `slo-check.mjs --self-test` + 对账 | `/tmp/g7-slo.log` |
| 21 | 首屏采集器自证 | **BLOCKED** | 本机无 Playwright bundled chromium（自证硬编码 `chromium.launch()`）；CI e2e job 会装浏览器跑 | `/tmp/g7b-measure-vitals.mjs.log` |
| 22 | Secret scan（gitleaks） | **BLOCKED** | 代理对单文件下载截断 2.1MB，无法本地安装；**人工形状核查**（sk_/whsec_/AKIA/ghp_/PEM…8 类）对 `3968f8f..HEAD` 全部新增行 = **0 命中**（唯一命中为历史 wasm 二进制串，非凭据） | 本记录 |
| 23 | **REMOTE CI（全 job）** | **NOT_TESTED** | **BLOCKED_GITHUB_AUTH**：本地领先远端 10 提交，推送需用户授权（三选一：`gh auth login` / 注册 SSH 公钥 / 自行 push）。远端验收必须由 CI 在推送后完成 | — |

## 2. 本轮真实抓到并修复的缺陷（门禁有牙齿的证据）

| 缺陷 | 抓它的门禁 | 修复 |
|---|---|---|
| `/login` 页脚 `text-white/40` 对比度 3.77:1（4 视口 × 5 节点） | axe 四视口棘轮 | `white/60`（≈6.9:1），棘轮复跑零新增（`5c96f2c`） |
| E2E global-setup 水合前点击 → 原生 GET 提交，登录三连败 | Playwright（本地取证） | 等 `__reactFiber` 判据（global-setup.ts） |
| register / workspace-tabs spec 同款竞态（11 条失败） | Playwright | 统一 `lib/hydration.ts`，复跑 113/113 |
| lint 新增 2 处 no-unused-vars（探针脚本） | lint 棘轮 | 删冗余绑定，棘轮零新增 |
| Console overview/settings 加载态无 h1（Batch 6 D-1/D-2） | Batch 5 深审 | sr-only h1 |
| Consent/Outcomes/Agents 触控目标 20–23px | 视觉审计 104 格 | `min-h-6`（=24px），After 0 命中 |
| 对价抽取把「看情况可以给…」当承诺 | 执行令回归要求 | 模糊措辞守卫 + 4 条回归 |
| `MISSION_MIN` 手抄数字可漂移 | 执行令回归要求 | 派生自服务端 `LIMITS` + 3 条回归 |

## 3. 与执行令五条回归要求的对应（offer / Mission）

| 要求 | 结论 |
|---|---|
| 无 offer 不得自动生成虚假对价 | ✅ compile/assemble 单测（body 恒 null + 缺口说明） |
| 含模糊描述不得误判为明确 offer | ✅ 新增守卫 + 4 条回归（守卫不误伤明确承诺句） |
| 用户修改描述后可以重新编译 | ✅ before→after 回归（修改后 body 可用，非死路） |
| 前端与服务端校验规则一致 | ✅ `MISSION_MIN` 派生自 `LIMITS`（结构性不可能漂移）+ 边界回归 |
| 重复提交不产生第二个 Mission | ✅ 三层：按钮 disabled → 同 body 复用幂等键 → 服务端重放同 id（Batch 4 O-01）+ W-08/W-09 |

单测合计：`tests/workspace-spec/{compile,assemble}.test.ts` = 71/71；全量 Jest 117/2349。

## 4. 验收结论

- **代码侧必需本地门禁：全部 PASS**（2 项 BLOCKED 均为本地工具不可得，且有替代证据或 CI 兜底）。
- **P0_OPEN = 0；BLOCKING_P1 = 0。**
- **REMOTE CI = NOT_TESTED** —— 按执行令口径，**不能宣称远端验收完成**；RELEASE_CANDIDATE 裁定见 51 号文档。
