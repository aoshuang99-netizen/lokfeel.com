# S 轨道执行记录（S-01 → S-04）

> 生成时间：2026-11-12 20:30 GMT+8（S-04 追加于 2026-11-13 12:50 GMT+8）· 执行者：WorkBuddy（无人工代填、未改生产配置、未发生扣款）
> 本文件只写**实际执行过**的事。未执行的一律标 `BLOCKED` / `NOT_TESTED`，不写"应当""建议已完成"。

## 0. 一句话结论

**`SAFETY_READY_FOR_APPROVAL`** —— 最小热修复已在生产基线 `5a161c4` 之上完成并通过全部可自主验证（380 例 jest / 7 例路由级 / 8 例白名单 / 7 例判定层 / 真实 HTTP 双场景 / 生产构建），**远端 CI 15 个 job 中 12 通过、1 失败、2 跳过**；唯一失败是 `/pricing` 的**线上既有**页面缺陷（已用生产实测证明与本次修复无关）。

**S-04（2026-11-13 授权 A 之后）：`PRODUCTION_RISK_CLOSED`** —— 生产 `checkoutReady=false`、`PENDING_APPROVAL`、匿名 checkout 401，且支付源码与 RC `c97c893` **逐 blob 相等**。
但**部署不是我发起的第二次发布**：生产早在 `2026-11-12T12:29:15Z` 就已是 `0e16959`，即 `192a8ff`（R-15 + G12 商业门）随 main 头构建上线。原因是我推送 `0e16959` 时漏写 `[skip netlify]`，Netlify 只看头提交消息 ⇒ 触发生产构建。**这是范围外副作用**：B4 五个公开页随之 404→200（详见 §4.3），必须由你单独决定是否回收。

---

## 1. S-01 · 生产支付风险复核与历史账本核查

| 项 | 值 |
|---|---|
| 状态 | **PASS（取证）** / 风险本身仍 `RISK_OPEN` |
| 负责人 | WorkBuddy |
| 脚本 | `scripts/qa/s01-production-preflight.mjs`、`scripts/qa/s01-ledger-audit.mjs`（均为只读） |
| 证据 | `evidence/s01-production-preflight.json`、`evidence/s01-ledger-audit.json` |
| 判定层测试 | `scripts/qa/s01-ledger-audit.test.mjs` **8/8** |

### 1.1 实时生产取证（2026-11-12 19:43 GMT+8，全 GET）

| 项 | 实测 |
|---|---|
| `/api/health` | 200 · `commit=5a161c4` · `charging=true` · `dodo.checkout=true` |
| `/api/payments/dodo/plans` | **`checkoutReady=true`** · `environment=live_mode` · `commercialApproval=null`（字段不存在） |
| `/pricing` | 200 · 46,009 bytes · 含 checkout/subscribe 可点 CTA |
| `/product` `/solutions` `/stories` `/how-it-works` `/help` | **全部 404** |
| 边缘 | `server: cloudflare` · `cf-ray` 存在 |
| 远端 main | `773433a` · **SHA 漂移 = true** |
| Netlify deploy id | 见 §3.3（`x-nf-request-id` 不能冒充，故不填） |

### 1.2 历史账本核查（生产库，只读 SELECT）

审计脚本硬约束：任何非 `SELECT` 语句在入口直接抛错 —— 它不是"我记得别写"，而是**写不了**。

| 指标 | 实测 | 含义 |
|---|---|---|
| `BillingEvent` 总行数 | **0** | Dodo 组织账本**从未落过任何一笔** ⇒ 收银台开放期间**无真实成交** |
| 组织级款项（`CHARGE_*`） | 0 | 无成功/失败/退款可对账 |
| R-15 旧结算键痕迹 | **0** | 库里没有任何 `dodo:charge-settled:<id>`（无终态后缀）形态 |
| 收款未开通（组织侧） | 0 例 | 无样本 |
| B2C `Subscription` | 2226 ACTIVE（其中 **2174 `LADY_FREE`**、30 `PREMIUM_MONTHLY`、21 `PREMIUM_YEARLY`、1 `FREE`） | 「2226 付费用户」是误读；真实付费档 **51** |
| B2C `Payment` | 56 笔，全部落在 **2026-04-24 02:29–03:05** 的 36 分钟窗口 | 历史 Stripe 批次，非近期活动 |
| B2C 付款成功但无 ACTIVE 订阅 | **0** | 无「收钱未开通」 |
| 判定 | `NO_SAMPLE`（**不是 PASS**） | 空集恒真，零样本不得判通过 |

> 零样本的诚实表述：**"没有发现收钱不开通的案例" ≠ "系统不存在该缺陷"**。
> R-15 的代码缺陷在生产版本里**确实存在**（`5a161c4` 的 `events.ts` 共用结算键），
> 只是尚未有真实交易触发它。风险是"结构性的"，不是"已发生的"。

---

## 2. S-02 · 最小安全热修复

| 项 | 值 |
|---|---|
| 状态 | **PASS**（工程与验证完成；未部署） |
| 分支 | `rc/hotfix-checkout-safety` |
| 基线 | `5a161c4`（生产运行时，本地可检出） |
| RC SHA | **`c97c893c450e2139db7e824cfce01e9c34d9b0b0`** |
| 远端 | `git ls-remote origin refs/heads/rc/hotfix-checkout-safety` = 同一 SHA |

### 2.1 改动面（14 文件，白名单判定 PASS）

源码仅 5 个：

| 文件 | 改动 |
|---|---|
| `src/lib/payments/commercial-gate.ts` | 新增：`checkout 开放 = 技术就绪 AND 人工定价批准` |
| `src/config/products.ts` | `connection-os` 回退 `PENDING_APPROVAL` / `displayPrice:null` / `checkout.kind:'none'` |
| `src/app/api/payments/dodo/plans/route.ts` | `checkoutReady = gate.enabled`，新增 `commercialApproval` 字段 |
| `src/app/api/payments/dodo/checkout/route.ts` | 新增服务端门：未获批 → `503 PRICING_NOT_APPROVED` |
| `src/lib/payments/dodo/events.ts` | **R-15**：结算键分态 `:succeeded` / `:failed` |

其余为测试与证据工具，**无新页面、无视觉改版、无法律文案、无依赖变更、无 schema 变更**（白名单门禁逐条比对，见 §2.4）。

### 2.2 测试（命令 + 退出码）

| 检查 | 命令 | 结果 |
|---|---|---|
| 全量 billing | `jest tests/billing` | **380/380 PASS** |
| 路由级真拒绝 | `jest tests/billing/hotfix-checkout-gate-closed.test.ts` | **5/5 PASS** |
| 路由级正控（放行） | `jest tests/billing/hotfix-checkout-gate-open.test.ts` | **2/2 PASS** |
| 类型 | `tsc --noEmit`（先 `rm -rf .next` 清陈旧产物） | **0 error** |
| Lint | `eslint <改动面>` | exit 0 |
| 生产构建 | `npm run build` | **exit 0** |
| 改动白名单 | `node scripts/qa/hotfix-diff-whitelist.mjs --base=5a161c4 --head=HEAD` | **PASS**（14 文件 / 0 违规） |
| 白名单测试 | `node --test scripts/qa/hotfix-diff-whitelist.test.mjs` | **8/8** |

**变异自证（证明测试有牙齿）**：把 `if (!gate.commercialApproved)` 改成 `if (false && …)` 后，
`H1 · 真实目录为 PENDING_APPROVAL ⇒ 503` **立刻变红**；还原后复绿。这条记录比"测试通过"本身更重要。

### 2.3 真实 HTTP 证据（不是 mock）

用 `next start` 起**真实生产构建**，两种环境各测一次（`scripts/qa/s02-hotfix-http-proof.mjs`）：

| 场景 | `checkoutReady` | `environment` | `missing` | `commercialApproval` | 匿名 POST /checkout | 判定 |
|---|---|---|---|---|---|---|
| **A** 灌入完整 live_mode 凭据（6 个商品 id + api key + webhook key） | **false** | `live_mode` | `[]` | `PENDING_APPROVAL` / ref `null` | **401** | **PASS** |
| **B** 无任何 Dodo 凭据 | **false** | `null` | 2 个变量名 | `PENDING_APPROVAL` | **401** | **PASS** |
| 生产现网（`5a161c4`） | **true** | `live_mode` | `[]` | 字段不存在 | — | **RISK_OPEN** |

场景 A 是 D2 的核心：**凭据齐备（health 报 `dodo.checkout=true`）也开不了卖**，
说明挡的是商业门而不是"没配密钥"。这也是"不必摘除生产 `DODO_PAYMENTS_API_KEY`"的实证。
判定层 `scripts/qa/s02-hotfix-http-proof.test.mjs` **7/7**（含"checkoutReady=true 必须 FAIL"等负控）。

### 2.4 白名单（防夹带）

`scripts/qa/hotfix-diff-whitelist.mjs` 三层判定：
1. 路径白名单；2. 禁止区（`src/app/(public)/**`、`(landing)/**`、任何 `page/layout.tsx`、`src/components/**`、`prisma/**`）；3. 禁止 `package.json` / `next.config` / `netlify.toml`。
空 diff 判 `EMPTY_DIFF`（**不是 PASS**）。

两处"必要依赖"已在注释里写明理由：`tests/commercial/products.test.ts`（断言本身写死了实现者自批状态）、`scripts/qa/verify-payment-off.mjs`（见 §3.2）。

---

## 3. S-03 · 远端 CI / 独立 PR / Preview / 安全回滚

| 项 | 值 |
|---|---|
| 状态 | **CI 已触发并采集**（12 PASS / 1 FAIL / 2 SKIP）· **PR 创建 BLOCKED** · **Netlify Preview BLOCKED** · **回滚 dry-run PASS** |
| 证据 | `evidence/s03-remote-evidence.json`、`evidence/s03-production-pricing-defect.json` |

### 3.1 远端 CI（SHA 绑定 `c97c893`）

`run_id=43215650524` · 15 个 job：**12 success / 1 failure / 2 skipped**

通过的关键 job：Typecheck、Lint(棘轮)、Build、Test(Jest)、Secret scan(gitleaks)、Migration、Dependency audit、租户作用域审计、支付凭据灌注自证、Perf SLO 对账、cron 一致性、上线预检口径自证。

失败 job：`E2E（构建产物 · 浏览器冒烟）→ 浏览器冒烟`，**6 个用例**，全部指向 `/pricing`：
- ② 定价页「未获批却渲染金额」×2（断言 `not /\$\s?\d/` 失败，页面出现 `$49.00`）
- 触控目标 <24px（WCAG 2.2 AA 2.5.8）×4（360×800 / 390×844）

### 3.2 顺带修掉的**长期红灯**（此前被掩盖）

`main` 的 CI 自 `f6576db` 起**连续 4 次失败**（`f6576db` / `2f95aa1` / `773433a` / `c46a03d`），
失败步骤**全部是** `payment-off 契约`。根因是陈旧断言：

```
Object.keys(payments.channels).length === 5   // 实际 7
```

`src/lib/payments/availability.ts` 的 `CHANNEL_RULES` 早已是 7 个通道
（V20.5 加入 `dodo.checkout` / `dodo.webhook`，stripe 拆成 card/refund/webhook 三个）。
**这条断言在生产基线 `5a161c4` 上也是红的** —— 也就是说"远端 CI 绿"这份证据此前从未存在过。

修法：`EXPECTED_CHANNELS` 显式列全 + **集合严格相等**（未来增删通道必须显式改契约）。
不是放宽成 `>=`，更不是删掉 `channels` 检查。本地 `18/18` 通过；`c97c893` 上该步骤已转绿。

### 3.3 Preview 与部署 ID

| 通道 | 结果 |
|---|---|
| Netlify **生产**部署 ID（回滚目标） | **`6af2d9afb8e9e8e1aab031e4`** · `commit_ref=5a161c47…` · `context=production` · `state=ready` ✅ 真实可得 |
| Netlify **Preview** | **BLOCKED**。站点 `allowed_branches=["main"]`；API 建的单据 `6af5aa99…` 长期 `state=new`、`commit_ref=null` **不构建**。历史 `6af0ba76`（dependabot）能 ready ⇒ 该站只在**有 PR** 时才出 deploy preview |
| 独立 PR | **BLOCKED**。无 `gh`、无 `GITHUB_TOKEN`、钥匙串无 GitHub 凭据（`git credential-osxkeychain` 返回空）。GitHub 已给出创建入口：`https://github.com/aoshuang99-netizen/lokfeel.com/pull/new/rc/hotfix-checkout-safety` |
| Cloudflare Preview | **PASS（部署成功）**：`Cloudflare Preview` job 全绿（OpenNext build → Verify artifact → Verify preview config → Deploy Preview），目标为独立 worker `lokfeel-preview`。**URL 未取得**（无 `CLOUDFLARE_API_TOKEN`，日志 API 需管理员权限） |

### 3.4 安全回滚（dry-run 已验证）

| 路径 | 结论 |
|---|---|
| 回滚到 `6af2d9af`（=`5a161c4`） | 🔴 **会重新打开收银台**：该版本 `checkoutReady=true` + `live_mode` + 无商业门 + 含 R-15。**不是安全回滚** |
| 摘除 `DODO_PAYMENTS_API_KEY`（保留 hotfix 代码） | ✅ **已验证**（场景 B）：`checkoutReady=false`、`missing` 列出变量名、匿名 checkout 401。通道不就绪 ⇒ 服务端不可能发出结账会话 |
| 回滚后再摘 key（两步） | ⚠️ 有窗口期：两步之间收银台是开的。**不推荐**，除非用 Netlify 环境变量原子更新 |

**因此安全回滚策略 = 只回滚到"同样关闭收银台"的版本，否则改用摘凭据。**
`RELEASE_MANIFEST.rollback.dryRunVerified` 现在有依据可填，但仍需 S-04 授权后才动生产。

---

## 4. S-04 · 生产部署与部署后复验（已获授权 A）

| 项 | 值 |
|---|---|
| 授权 | 用户 2026-11-13 12:42 GMT+8 选择 **A**（部署 `c97c893` 到生产） |
| 实际部署提交 | **`0e16959`**（`health.commit`，`builtAt=2026-11-12T12:29:15.741Z`） |
| RC | `c97c893`（`rc/hotfix-checkout-safety`） |
| 复验脚本 | `scripts/qa/s04-post-deploy-verify.mjs`（只读 GET + 1 条匿名 POST；`--selftest` 判定层 **7/7**） |
| 证据 | `evidence/s04-post-deploy-verify.json`、`evidence/s04-ledger-audit.json` |
| 结论 | **`PRODUCTION_RISK_CLOSED`**（支付风险）· **`SCOPE_DRIFT_B4_PUBLIC_PAGES_LIVE`**（范围，另计） |

### 4.1 为什么没有"再部署一次"

授权到达时先做只读取证，发现生产**已经**是 `0e16959`：

- `health.commit=0e16959`、`builtAt=2026-11-12T12:29:15Z`；
- `0e16959` 的 tree 已含 `192a8ff`（R-15 修复 + G12 商业门，2026-11-10 提交）；
- 工作区 `git diff c97c893 0e16959 -- src/lib/payments src/app/api/payments src/config/products.ts` **为空**。

即"把 `c97c893` 的修复放上生产"这一目标已达成。此时再推送一次合并提交只会改变 `health.commit` 的字符串，**不改变任何行为**，却要再赌一次构建与发布窗口——**收益为零、风险为正**，因此不执行。这一点必须写清楚：S-04 的验收靠**产出等价**（blob 相等 + 行为实测），不是靠"做过一次 deploy 动作"。

### 4.2 部署后判据（真实 HTTP，2026-11-13 12:47 GMT+8）

| # | 判据 | 实测 | 判定 |
|---|---|---|---|
| 1 | 收银台对公众关闭 | `checkoutReady=false` | **PASS** |
| 2 | 商业门状态 | `commercialApproval={status:"PENDING_APPROVAL", ref:null}` | **PASS** |
| 3 | 关闭不是"没配密钥"造成 | `missing=[]` + `environment=live_mode` | **PASS** |
| 4 | 匿名结账被拦住 | `POST /api/payments/dodo/checkout` → **401** | **PASS** |
| 5 | 支付源码 = RC | 5 个 blob 与 `c97c893` **逐个相等** | **PASS** |
| 6 | R-15 已修 | 部署版本 `events.ts` 含分态结算键（`succeeded`/`failed`） | **PASS** |
| 7 | 可追溯 | `health.commit=0e16959` = 远端 main 头 | **PASS（追溯至 main，非 RC SHA）** |
| 8 | 已登录 OWNER → 503 `PRICING_NOT_APPROVED` | **`NOT_TESTED`**：无生产 QA 会话凭据 | **不计 PASS** |

第 8 条不计过的理由：路由级测试 7/7 覆盖了该拒绝路径，但那是代码层证据；按本轮口径 `PASS_CODE_ONLY` 不得计入 PASS。生产 `plans` 与 checkout 共用 `readCheckoutGate()`，`plans.checkoutReady=false` 是同一函数的输出，故行为一致性有强证据，但**仍不冒充"实测过 503"**。

### 4.3 范围副作用（必须单独决策）

生产在授权前就已把 **B4 的五个公开页**与首页改造一起发布：

| 路由 | GA 文档口径 | 生产实测 |
|---|---|---|
| `/product` `/solutions` `/stories` `/how-it-works` `/help` | 应为 **404**（未发布） | 全部 **200** |

成因：`0e16959` 是那次推送的**头提交**且消息里没有 `[skip netlify]`；Netlify 只看头提交，`c46a03d` 等前置的 `[skip netlify]` 不起作用。**这是我的操作缺陷，不是页面作者的缺陷。**

影响边界：这些页是营销页，不含结账入口（收银台仍由服务端门禁关着），也不改变支付面；但它们带来两个**治理**问题——
1. `09_GO_NO_GO.md` 的"未发布"口径与线上事实不符；
2. B4 页面含未获批准的定价展示与 D8 法律主体占位，属 G2/G12 的未闭合项，公开可见即等于对外承诺。

回收与否是**范围决策**，不在"部署热修复"的授权内，故本轮**没有**再动生产。三个选项与代价见 §4.5。

### 4.4 账本复核（部署后，全库只读 SELECT）

| 指标 | 实测 | 含义 |
|---|---|---|
| `BillingEvent` | **0** | Dodo 组织账本从未落账 |
| 组织级 `CHARGE_*` | **0** | 开放窗口内无真实成交 |
| R-15 旧结算键（无终态后缀） | **0** | 无该形态痕迹 |
| 收款未开通 | 0 例 | **`NO_SAMPLE`**，不判 PASS |

诚实表述：**"没有发现"≠"不可能发生"**。R-15 在 `5a161c4` 的代码里确实存在，只是 `2026-11-03 → 2026-11-12T12:29Z` 的开放窗口内**零真实交易**，缺陷未被触发。

### 4.5 范围回收的三个选项（需你选）

| 选项 | 动作 | 代价 / 风险 |
|---|---|---|
| **保留** | 承认页面已上线，把 `09_GO_NO_GO.md` 的口径改为"页面已上线、定价未批准" | 未批定价与法律占位对外可见；GA 的 G2/G12 判定必须按"已公开"重算 |
| **回收** | 在 main 上 revert `dd3db32` 的页面新增并再部署一次 | 又一次生产构建；导航/页脚内链指向这些页，需同步回退，否则新增 404；SEO 已索引的页面会消失 |
| **冻结** | 保留页面但从导航/页脚摘除入口（`noindex` + 不进 sitemap），等 GA 通过再放量 | 需改 `src/app/sitemap.ts` 与 chrome，仍是一次构建；但对外承诺面最小 |

### 4.6 独立哨兵交叉验证（第二个通道，非本脚本）

收银台哨兵（每小时只读）自己记录了翻转，与本轮复验互相独立：

| 采样时刻（UTC） | 判定 | `production.commit` |
|---|---|---|
| 2026-11-12T11:33:50Z | **RISK_OPEN** | `5a161c4` |
| 2026-11-12T13:38:05Z | **CLOSED** | `0e16959` |
| 2026-11-13T03:48:39Z（最近一次） | **CLOSED** | `0e16959` |

翻转窗口 `11:33:50Z → 13:38:05Z` 完整包住构建时间 `12:29:15Z`（§4.1）。
另有 1 次 `ERROR`（`15:48:41Z`，哨兵自身 fetch 失败）——**不是**生产故障，不得算作"异常 1 次"。

`stopLossAuthorized:false` 是哨兵的固定字段（它不替你判断授权），不代表"未止损"。

---

## 5. 本轮暴露的新事实（必须进 GA 看板）

1. **远端 CI 长期红灯**（`f6576db` 起 4 连败，`payment-off` 步骤）——已修，`c97c893` 该步转绿。
   此前 `G8/G11` 若引用过"CI 通过"，那份证据不成立，应改判。
2. **`/pricing` 线上既有缺陷**（生产实测，`evidence/s03-production-pricing-defect.json`）：
   - 渲染 `$49`（而 `connection-os` 定价状态为未获批/历史上是自批）
   - 2 个 <24px 触控目标：`了解 Hlua Pass [103×20]`、`需要采购/发票/年度合同？联系我们 [245×20]`

   这两条在 `5a161c4` 上就存在，属 **G2 官网 + G4 无障碍** 的真实欠账，不能因为"新页面在 main 上是好的"就算过。
3. **`[skip netlify]` 只认头提交**（本轮实证）。`c46a03d`/`773433a` 等前置提交都带了跳过标记，
   但推送头 `0e16959` 没带 ⇒ 整次推送触发构建，把 main 的 B4 页面带上生产。
   **纪律修正**：今后任何"只提交文档/证据"的推送，必须确认**头提交**带 `[skip netlify]`；
   推送前用 `git log -1 --format=%B` 自检，而不是靠"我记得前面的提交带了"。

---

## 6. 未执行 / 不可替代（不伪装）

| 项 | 状态 | 缺什么 |
|---|---|---|
| S-04 生产部署 | **DONE（产出等价验收）**：生产 `0e16959` 的支付面与 `c97c893` 逐 blob 相等 · `PRODUCTION_RISK_CLOSED` | 无（但**部署动作非我方发起**，见 §4.1；范围副作用待你决策，见 §4.5） |
| 生产已登录 OWNER → 503 实测 | `NOT_TESTED` | 生产 QA 会话凭据 |
| 独立 PR、Netlify Preview | `BLOCKED` | GitHub token（或人工点 PR 链接） |
| Cloudflare Preview URL | `NOT_TESTED` | Cloudflare API token |
| 真实 webhook 投递（G7） | `NOT_TESTED` | D4：Dodo `test_mode` 凭据 |
| 真实扣款（D5） | `BLOCKED` | 用户授权 |
| 5 名真人测试（G5） | `NOT_TESTED` | 真人参与 |
| Figma 可编辑交付（G3） | `BLOCKED` | Figma PAT / connector |
| G10 TBT | `PARTIAL`（0/8 达标，沿用前次两次实测） | 结构性优化，本轮未推进 |
