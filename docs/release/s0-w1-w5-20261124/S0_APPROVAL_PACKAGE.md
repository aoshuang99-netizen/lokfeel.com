# S0 — 生产收费安全止损：审批包（Fresh Evidence 2026-11-24）

## 0. 一句话结论

基于**经验证的真实生产 SHA `b50e53e`** 的、零迁移、零配置依赖的 fail-closed 最小热修复候选已就绪并**当场复验通过**（4 suites / 14 tests PASS）。**未部署生产**，等 Owner 对精确 SHA 批准。生产当前仍是旧版 `b50e53e`，收费门 `charging=true`、`checkoutReady=true`、公开价 `$89/$199/$449` —— 止损**尚未生效**。

## 1. 基线（以实测生产运行版本为准，非 main、非 RC）

| 项 | 值 | 来源 |
| --- | --- | --- |
| 生产运行 SHA | `b50e53e48a9cc5b91ba2196654ea0ec69aead22b` | `curl https://app.lokfeel.com/api/health` 实测 2026-11-24，commitSource=env |
| 生产构建时间 | `2026-11-14T08:38:05.985Z` | 同上 |
| 远端 main | `cad717e92542395e4346e49d388f09be78ec1557` | `git ls-remote origin refs/heads/main` |
| RC（含迁移，非本补丁基线） | `9c6b7415b64b865de9db129b0b60735d15d089f1` | git |
| 生产 `pricing-gate.ts` | **不存在**（`git cat-file -e b50e53e:src/config/pricing-gate.ts` = ABSENT） | 实测 ⇒ 旧版无 Owner 开关，**仅改环境变量不能关收费** |
| 生产 `/api/payments/dodo/plans` | `checkoutReady=true`、公开 `$89/$199/$449` | 只读 GET 实测（GA02 证据 + 本轮复核 health） |

## 2. 热修复候选（精确 SHA）

- 候选分支：`hotfix/v25.6-checkout-fail-closed`（local + origin）
- 候选 HEAD：`77bbb222b117537249777f4c5f2e6a5277cfc5ad`
- 审批引用 SHA：`230a21b9c035b89e371024df0697887125128658`（与 HEAD 之间**仅 1 个 docs 文件差异，代码零差异**，已 `git diff --name-only` 验证）
- 相对生产 `b50e53e`：**10 个文件，零数据库迁移，零配置变更**（`git diff --name-status` 验证；`prisma|migration|schema` 命中 = 0）

10 个文件：
```
src/config/pricing-gate.ts                         (新增：PRICING_APPROVED=false 代码常量)
src/lib/payments/commercial-gate.ts                (商业门 = 开关 ∧ 目录APPROVED ∧ approvalRef)
src/app/api/payments/dodo/plans/route.ts           (plans API fail-closed)
src/app/(public)/pricing/page.tsx                  (定价页 fail-closed)
tests/billing/commercial-gate.test.ts              (改)
tests/api/v22-pricing-json-gate.test.ts            (新增)
tests/billing/hotfix-provider-zero.test.ts         (新增：Provider create=0 负例)
tests/billing/p0-02-rc-checkout-gate.test.ts       (改)
tests/e2e-ci/smoke.spec.ts                         (改)
docs/v25.6/ga-closure/evidence/GA02_HOTFIX_CANDIDATE.json
```

## 3. S0 验收项逐条核对

| 验收项 | 状态 | 证据 |
| --- | --- | --- |
| 定价页不展示未批准价格/购买承诺 | PASS（代码层） | `pricing/page.tsx` + `pricing-gate.ts`：`PRICING_APPROVED=false` 时不渲染金额/CTA；`v22-pricing-json-gate.test.ts` 覆盖 |
| `GET /api/payments/dodo/plans` 不披露未批准金额，`pricingPublished=false` | PASS | `plans/route.ts` 早退返回 `{pricingPublished:false, plans:[], reason:'pricing_approval_pending'}`；`v22-pricing-json-gate.test.ts` 覆盖 |
| 已登录有购买权限用户无法创建新结账会话，Provider 创建调用 = 0 | PASS | `hotfix-provider-zero.test.ts`：**本轮 fresh 运行**，断言 `res.status=503`、`body.code=PRICING_NOT_APPROVED`、`createCheckoutSession not called`。dodo checkout 在创建 Provider 会话前 `readCheckoutGate()` 拦截 |
| 原有订阅/权益/合法 webhook 不误关 | PASS（静态 + 测试） | 补丁未改订阅/权益/webhook 路由；`commercial-gate.test.ts` 保留正向门语义。运行态生产回归仍属 Owner 批准后验证项 |
| 独立 Reviewer 确认 | **PARTIAL** | 独立 Agent 干净 worktree 复核确认商业 fail-closed 与 Provider 零创建语义；**人类 GitHub Reviewer 未分配**（无 gh CLI / 无 API token / 无已绑定 Connector） |
| CI 安全检查通过 | **FAIL（存量 CVE 时间漂移）** | 见 §4 |
| 精确 SHA 获 Owner 批准 | **NO_GO（待批）** | 见 §6 |
| 生产只验证安全、0 扣款、Provider 侧无新增结账 | 符合边界 | 全程未向生产发送 checkout POST |

### Fresh 测试证据（本轮 2026-11-24 重跑，非复用旧报告）

```
命令：cd /private/tmp/lokfeel-hotfix-b50e53e (HEAD=77bbb222) && \
  env -u NODE_OPTIONS node_modules/.bin/jest \
  tests/billing/commercial-gate.test.ts \
  tests/api/v22-pricing-json-gate.test.ts \
  tests/billing/hotfix-provider-zero.test.ts \
  tests/billing/p0-02-rc-checkout-gate.test.ts --runInBand
结果：Test Suites: 4 passed, 4 total / Tests: 14 passed, 14 total / exit 0
```
RED 侧证明：`b50e53e` 中 `src/config/pricing-gate.ts` ABSENT ⇒ 旧代码无法表达 Owner 开关，新测试在基线树必然 RED。

## 4. CI 状态（诚实披露）

- CI run `44875441463`（SHA `230a21b`）：conclusion = **failure**。
- 失败 job **唯一**：`Dependency audit（生产可达 · 棘轮）`。其余 Typecheck / Lint / Jest / Build / Migration / E2E 冒烟 / gitleaks / 凭据灌注 / 租户作用域 / cron 一致性全绿；`Perf 基线实跑（手动）`、`DCO sign-off check` = skipped。
- 根因：effect ReDoS `GHSA-7589-6fvf-x4pw`（影响 ≤3.22.0，锁定 3.20.0）。`cad717e`（main）与 `b50e53e`（生产）的 `package-lock.json` 为同一 blob ⇒ **存量时间漂移，非本热修复引入**。
- 处置：**不擅自豁免、不混入依赖变更**。同大版本 override effect→3.22.5 可消除 CVE，但本地 `npm install --package-lock-only` 受环境 exit137 限制未提交。作为独立供应链项交 Owner 决策。此项不阻塞 S0 的安全语义，但阻塞「CI 全绿 + 自动发布门禁」——故本包不宣称可自动发布。

## 5. 回滚方案（区分应用回滚与数据库回滚）

- 热修复**零迁移** ⇒ 数据库无需回滚。
- 应用回滚目标 `b50e53e` **不可接受**：该祖先已实测 `checkoutReady=true`/`live_mode`，回退即重新开放收费。
- 安全回滚：若已部署更新的 P/P1 波，回滚到本热修复 SHA；若热修复本身失败，先在 Netlify 摘除 `DODO_PAYMENTS_API_KEY` 使通道关闭，修复后重部署，**不得回到 b50e53e**。

## 6. Owner 需要批准的精确项

- 部署 SHA：`230a21b9c035b89e371024df0697887125128658`（= 分支头 `77bbb222` 代码，纯 docs 差异）
- 迁移：**无**
- 配置：**无**（`PRICING_APPROVED` 为代码常量 false，不依赖环境变量）
- 发布范围：仅商业 fail-closed；不含 UI 新版、AI、数据库新表
- 并行决策：Dependency audit CVE 时间漂移是否接受带条件发布或先做 effect override；人类 Reviewer 指派。
- 当前 verdict：**NO_GO，待 Owner 精确 SHA 批准**。批准后按真实托管平台（Netlify Node origin `app.lokfeel.com`）受控部署，并在生产域名做只读安全复验（plans `pricingPublished=false`、定价页无金额、Provider 0 新增结账），不做真实扣款。

## 7. 本包未做（边界）

未部署生产、未迁移生产 DB、未改 Netlify 环境变量、未调用生产 checkout POST、未创建 Provider 会话、未扣款。本包是**审批材料**，不是发布动作。
