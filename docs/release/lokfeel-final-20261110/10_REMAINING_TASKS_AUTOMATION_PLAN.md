# 10 · 剩余未完成任务：自动化完成建议与任务说明（lokfeel-final-20261110）

> 生成时间：2026-11-12 14:30 GMT+8
> 依据：`RELEASE_STATUS.md`（唯一状态页）· `07_ACCEPTANCE_MATRIX.csv` · `09_GO_NO_GO.md` · `00_RELEASE_SCOPE.md` · `03/06/08` 号文档
> **本文档只是「建议 + 任务说明」：未注册任何定时任务、未修改任何生产配置、未发布、未切流、未发生真实扣款。**
> 当前结论仍为 **`NO_GO`**；候选代码 `8696c62`，远端 main 头 `9c9fab2`（纯文档提交），生产仍 `5a161c4`。

---

## 0. 结论先行

**关键判断：剩余任务无法仅靠自动化达成 `RELEASED_AND_VERIFIED`。** 原因是未完成项里有四类「不可替代的外部输入」：产品所有者的定价批准（D1/G12）、≥5 名真人测试（D7/G5）、真实扣款授权与受控账户（D5）、真实经营主体信息（D8）。自动化既不能代填批准，也不能把「材料齐备」改判成「测试已发生」。

自动化真正能做的是三件事，且价值很高：

1. **把风险盯住** —— 线上收银台仍可点（D2 未处置），无人值守哨兵可在 1 小时内发现状态变化并告警（只读，不自动改生产）。
2. **把人工放行后的执行压缩成一次触发** —— D1–D8 批复后，B6 发布 → G13 生产复验 → 状态页/矩阵回填 → 回滚判定，全部可流水线化，避免发布窗口期的人手遗漏。
3. **把每项批复后的补齐动作标准化** —— 8 个 D 项各对应一个「人工输入 → 自动化补齐 + 证据留档」任务卡，输入一到即可执行，不需要重新设计方案。

**建议的自动化分层**：L1 巡检（可立即注册，零风险）→ L2 发布流水线（默认暂停，需显式授权才触发）→ L3 批复后补齐（逐项触发）→ L4 观察期（发布后 48h）。

**最紧急的仍是一件事**：线上 `5a161c4` 的 `/api/payments/dodo/plans` 仍返回 `checkoutReady=true` / `live_mode`，且该代码含 R-15 缺陷（同一 payment_id 先失败后成功 ⇒ 收钱不开通且无告警）。哨兵只告警，止损二选一仍需你表态（§3.8 / 状态页 §3）。

---

## 1. 剩余任务全景（截至 2026-11-12）

### 1.1 门禁未完成项（严格口径：`PARTIAL` / `BLOCKED` / `NOT_TESTED` 均不计完成）

| 门禁 | 状态 | 未完成的具体内容 | 归类 |
|---|---|---|---|
| G2 页面/法律闭环 | PARTIAL | 法律主体（D8）；页脚 FOLLOW 社媒链接可达性 C-31 未实测 | 人工输入 + 自动巡检 |
| G3 Figma 可编辑交付 | BLOCKED | 四类来源无写入凭据；规格已交付，建稿未发生 | 凭据到位后自动化建稿 |
| G5 ≥5 人真实用户测试 | NOT_TESTED | 协议/脚本/问卷齐备，真人未参与 | **不可替代人工** |
| G7 幂等/权益 | PASS（代码层） | 官方沙箱真实投递未证（缺 D4 test_mode key） | 凭据到位后自动补证 |
| G8 凭据/产物安全 | PARTIAL | Netlify 部署产物复扫留 G13 | 发布后自动复扫 |
| G9 CF 目标架构 | PARTIAL | 全量迁移 B/C 待 D6 拍板（建议 A 维持现状） | 人工决策（A 为零操作） |
| G10 性能预算 | PARTIAL | TBT 0/8 达标（487–1063ms > 200ms）结构性 P1 债 | 独立迭代，非发布批次 |
| G12 商业审批 | BLOCKED | 三档定价从未逐项批准（D1） | **不可替代人工** |
| G11 同一 RC 门禁 | PASS（本地） | 未绑定发布 SHA，发布前须按 RC SHA 复跑 | 发布流水线自动复跑 |
| G6 生产出口复验 | 待 G13 | 候选实测 28/28，生产出口未复验 | 发布后自动复跑 |
| G13 发布后生产复验 | N/A | 未发布，全部关键路径待验 | 发布流水线主体 |

### 1.2 D1–D8（不可替代的决策/输入）

| # | 决定 | 自动化边界 |
|---|---|---|
| D1 | 定价批准（三档 / 年付口径） | 只能由你批准；批准后回填 `APPROVED + approvalRef` 可自动化 |
| D2 | 线上止损方式（发布候选 / 摘除 `DODO_PAYMENTS_API_KEY`） | 涉及生产变更，必须你明确授权 |
| D3 | SCALE 年付超 Dodo $3,000 单笔上限 | 提额/降价/下架三选一由你定；改造与校验可自动化 |
| D4 | Dodo test_mode 沙箱凭据 | 凭据由你提供；投递测试与对账可自动化 |
| D5 | 真实扣款授权 + 受控测试账户 | **人工在场**，自动化只做对账与留痕 |
| D6 | CF 迁移范围（A/B/C） | 架构决策；建议 A（零操作），B 演练 Runbook 已备 |
| D7 | ≥5 名用户测试招募（a/b/c） | 真人不可替代；材料分发/结果汇总/证据可自动化 |
| D8 | 公司/法律主体与联系方式 | 信息由你提供；三页文案替换 + 复验可自动化 |

### 1.3 B6 发布批次（未启动）

`D1–D8 批复 → READY_FOR_APPROVAL → 生成 08_RELEASE_MANIFEST.json（含回滚点）→ 按 RC SHA 复跑 G11 → 单次发布 → 等待部署 → G13 全关键路径复验 → 回填状态页/矩阵 → RELEASED_AND_VERIFIED 或回滚`。其中「单次发布」是唯一不可逆动作，必须显式授权。

### 1.4 未闭合历史债（不因发布消失，建议独立迭代）

D-01 退款口径 · D-02 定价展示 · D-03 法律主体（同 D8）· D-09 历史 55 处形似凭据轮换 · H-3 举报去重 · H-5 草稿刷新恢复 · G10 TBT · 两套公开面视觉语言统一（需方向拍板）。

### 1.5 已完成、无需再自动化复做

B1 内容层 · B2 五新页与共享 chrome · B3 R-15/G12 修复与候选重跑 · B4 G4 全矩阵（112/112，判定层已防假绿）/G9 探针/G10 实测/G5 协议/G3 规格 · B5 矩阵与 GO/NO-GO 填实。**不要重复跑全量 116 格矩阵作为日常巡检**（约 9m31s，且需要生产构建 + 本地服务），日常用子集即可。

---

## 2. 自动化分层建议

| 层 | 目标 | 能否无人值守 | 触发 | 失败动作 | 风险 |
|---|---|---|---|---|---|
| **L0 护栏** | 禁止自动化越权（代填批准、真实扣款、改生产 env、切流） | — | 每个任务前置检查 | 立即 `SKIPPED/NO_GO` 并停止 | 零 |
| **L1 巡检** | 收银台风险哨兵、SHA 漂移、门禁日检 | ✅ 可 | 定时 | 只告警 + 写日志，**不自动修复** | 只读，零 |
| **L2 发布** | manifest → RC 门禁 → 单次发布 → G13 复验 → 状态回填 | ⚠️ 需显式授权 | 一次性、用户指定时间 | 自动停机 + 给出回滚点 | 高，须 L0 全绿 |
| **L3 补齐** | 8 个 D 项批复后的回填/补证/复验 | 部分 | 人工输入到达后逐项触发 | 保持原状态、不伪装 PASS | 低-中 |
| **L4 观察期** | 发布后 48h 健康、付款闭环、幂等对账巡检 | ✅ 可 | 定时（有效期限制） | 告警 + 触发人工回滚判定 | 只读，零 |

**编排原则**：所有任务必须先读 `RELEASE_STATUS.md` 判定当前状态词；只要不是 `READY_FOR_APPROVAL` 或 `RELEASED_AND_VERIFIED`，L2 一律不得启动。禁止用「定时任务到了时间」代替用户授权。

---

## 3. 任务说明（任务卡 · 可直接复制给自动化代理执行）

> 每个任务卡的 **前置** 是硬门：未满足时必须输出 `SKIPPED` 或 `NO_GO` 并立即停止，不得跳过、不得自行补条件。
> 所有命令均在 `env -u NODE_OPTIONS` 下执行；仓库绝对路径 `/Users/frankzhao/WorkBuddy/20260402202519/nexus-app`。

### A-01 · 生产收银台风险哨兵（L1 · AUTO）

- **前置**：无（可立即注册）。只读，不需要任何凭据。
- **输入**：`https://app.lokfeel.com/api/payments/dodo/plans`、`/api/health`、响应头 `server` / `cf-ray`。
- **步骤**：① `curl -s --max-time 12` 取 plans JSON；② 提取 `checkoutReady` / `live_mode` / `approvedAt` / `catalogVersion` 与 `git ls-remote origin refs/heads/main`；③ 与状态页 §3 的期望值（`checkoutReady=false` 或已获 D2 授权）比对；④ 追加一行到 `evidence/checkout-sentinel-YYYY-MM-DD.log`（时间、字段、结论、远端 SHA）；⑤ 若 `checkoutReady=true` 且 D2 未授权 ⇒ 输出 `⚠️ 线上收银台仍开放 · R-15 风险未止损`，并列出两个止损选项。
- **判据**：请求成功且有明确结论 = PASS；超时/字段缺失 = `ERROR`（**不得判 PASS**）。
- **证据**：`evidence/checkout-sentinel-*.log`。
- **失败处理**：连续 3 次 `ERROR` ⇒ 升级告警「生产不可达」，仍不修改生产。
- **禁止**：自动删除/改名 `DODO_PAYMENTS_API_KEY`、自动触发发布、把告警写成「已止损」。
- **建议调度**：`FREQ=HOURLY;INTERVAL=1`（仅建议，未创建）。

### A-02 · 候选/生产 SHA 漂移与远端一致性巡检（L1 · AUTO）

- **前置**：无。
- **步骤**：① `git -C <repo> rev-parse HEAD`；② `git ls-remote origin refs/heads/main`（**唯一可信判据，不认 push 脚本退出码**）；③ `curl -s https://app.lokfeel.com/api/health` 取 commit/deploy 字段；④ 记录三者关系（本地 / 远端 / 生产），与 `00_RELEASE_SCOPE.md` 的基线事实比对；⑤ 出现「远端头非纯文档提交」或「生产 SHA 变化」⇒ 告警并记录，供人工判断是否发生了未授权发布。
- **判据**：三者可陈述且无意外变化 = PASS；任一不可读 = `ERROR`。
- **证据**：`evidence/sha-drift-YYYY-MM-DD.log`。
- **建议调度**：`FREQ=DAILY;BYHOUR=9;BYMINUTE=10`。

### A-03 · 门禁日检（L1 · AUTO，轻量子集）

- **前置**：工作树无未提交改动（有则只报告不清理）；不触碰 `.next` 生产产物目录以外的内容。
- **步骤**：`env -u NODE_OPTIONS` 下依次跑 `npx tsc --noEmit`、`npm run lint:gate`、`npm test -- --silent`、`npm run verify:brand-scan`、`npm run check:products`、`npm run check:secrets`、`node --test scripts/qa/b4-g4-verdict.test.mjs`；**G4 只跑 4 路由子集**（需本地生产服务 + `PW_EXECUTABLE` 指向 ms-playwright 缓存的 Chrome for Testing）。
- **判据**：全部 exit 0 且子集 `zeroScanCells=0`、`rulesEvaluatedMin>0` = PASS；任一非零 = FAIL 并保留原始输出。
- **证据**：`evidence/gates-daily-YYYY-MM-DD.log`。
- **失败处理**：FAIL 时**不自动修代码**，只输出「新增债定位 + 建议动作」；禁止把失败写进 lint 基线来「转绿」。
- **禁止**：日常巡检跑全量 116 格矩阵；用 `check:secrets` 以外的规则把测试夹具误判为真凭据。
- **建议调度**：`FREQ=DAILY;BYHOUR=9;BYMINUTE=20`。

### A-04 · 生成发布清单 `08_RELEASE_MANIFEST.json`（L2 · AUTO）

- **前置**：状态页 = `READY_FOR_APPROVAL`；D1–D8 全部有批复记录；G11 已按 RC SHA 复跑通过。
- **步骤**：按 `00_RELEASE_SCOPE.md` §回滚点定义生成 manifest：候选 SHA、发布前生产 SHA（回滚点）、部署 ID、审批引用（D1 的 `approvalRef`）、门禁证据清单、发布时间窗口、发布后复验命令清单、回滚命令。
- **判据**：文件可解析、字段非空、回滚点 SHA 与 `curl /api/health` 实测一致 = PASS；字段缺失 = FAIL 并中止 L2。
- **证据**：`docs/release/lokfeel-final-20261110/08_RELEASE_MANIFEST.json`。
- **禁止**：用推测值填 SHA；用未经人工批准的 `approvalRef`。

### A-05 · B6 单次发布（L2 · GATE，唯一不可逆动作）

- **前置（全部硬门）**：① 状态页 `READY_FOR_APPROVAL`；② D1–D8 有用户明确批复；③ `08_RELEASE_MANIFEST.json` 已生成且校验通过；④ 按 RC SHA 复跑 G11 全绿；⑤ **用户对本次发布的一次性显式授权**（定时触发不算授权）；⑥ 确认发布不含 prisma 变更（本批次无，无需迁移；若将来有则「先迁移后发版」）。
- **步骤**：① 记录发布前状态快照；② 触发一次 Netlify 生产构建（远端 main 上一个**不带 `[skip netlify]`** 的提交；禁止 `--amend` 已推送的提交）；③ `npm run verify:release:wait` 或等价轮询等待部署就绪；④ 用 `git ls-remote` + `/api/health` 双向确认生产 SHA == 候选运行时代码；⑤ 交给 A-06。
- **判据**：生产 commit 与 manifest 的候选一致 = 发布成功；不一致/部署失败 = FAIL ⇒ 输出回滚点到 `5a161c4` 的操作建议并停止，**不自动回滚**。
- **禁止**：在 D2 未授权时借「发布」之名顺手改生产环境变量；无人值守自动切流；跳过窗口期 cookie 风险检查（见 §5 纪律）。
- **建议调度**：`once`，`scheduledAt` 由你指定（示例 `2026-11-13T10:00`，**仅为示例，未创建**）；建议先 PAUSED，批复后再 ACTIVE。

### A-06 · G13 发布后生产复验（L2 · AUTO，发布成功后自动接棒）

- **前置**：A-05 发布成功且生产 SHA 已确认。
- **步骤**（全部必须显式指定生产 BASE，**默认值 127.0.0.1:3000 会打本机造成假绿**）：
  1. `node scripts/qa/prod-smoke.mjs --base=https://app.lokfeel.com`
  2. `npm run verify:payment-off -- --base=https://app.lokfeel.com`
  3. `QA_BASE_URL=https://app.lokfeel.com node scripts/qa/verify-public-origin.mjs`
  4. `node scripts/qa/verify-released-surface.mjs --base=https://app.lokfeel.com`
  5. `curl -s https://app.lokfeel.com/api/health` + `curl -sI` 取 `server` / `cf-ray`
  6. G6 生产出口复验（`verify:agent:connectivity:server` 对应的生产口径）
  7. G8 Netlify 部署产物密钥复扫（生产 40 键真实值反查 + 客户端 bundle 形态）
  8. G4 生产抽样子集（4 路由 × 4 视口，`zeroScanCells=0`）
- **判据**：全部 PASS 且 commit 一致、plans API 符合已批准的定价状态 = G13 PASS；任一 FAIL = `RELEASED_NOT_VERIFIED`，立即给出回滚点，不修改状态为 `RELEASED_AND_VERIFIED`。
- **证据**：`evidence/g13-post-release-YYYY-MM-DD.log` + 各脚本原始输出。
- **禁止**：用本地 3000/3112 的结果冒充生产；把 404 的 `/checkout` 当 FAIL（商业门禁关闭时是预期 NA）。

### A-07 · 结论页回填与推送（L2 · AUTO）

- **前置**：A-06 的 G13 结论明确（PASS 或 FAIL）。
- **步骤**：更新 `RELEASE_STATUS.md`（唯一状态页）、`07_ACCEPTANCE_MATRIX.csv`（G13 行 + 发布 SHA 绑定）、`09_GO_NO_GO.md`、`evidence/g13-*.log`；CSV 校验 15 列一致；`git add -A && git commit -m "... [skip netlify]"` → push → `git ls-remote` 复核。
- **判据**：三份结论文档数字一致、CSV 列数一致、远端 SHA 与本地一致 = PASS。
- **禁止**：在 G13 FAIL 时写 `RELEASED_AND_VERIFIED`；把 `PARTIAL` 改写成 `PASS`。

### A-08 · 观察期巡检（L4 · AUTO）

- **前置**：状态 = `RELEASED_AND_VERIFIED`。有效期建议 48h（`validFrom` / `validUntil`）。
- **步骤**：每小时跑 health + plans + prod-commit-drift + uptime-probe；每日跑一次 `billing:reconcile` 只读对账（关注同一 payment_id 结算键分态、无「收钱不开通」）；异常写入 `evidence/observation-*.log` 并告警。
- **判据**：连续全绿且账本对账零差异 = 观察期通过；出现 R-15 形态事件 ⇒ 立即告警并给出回滚点。
- **禁止**：自动执行退款、自动改数据库、自动改生产 env。

### B-01 · D1 定价批准后的回填与解锁（L3 · HYBRID）

- **前置**：用户明确批准三档价格并给出可引用的批准记录（消息/文档/时间）。
- **步骤**：把 `src/config/products.ts` 的 connection-os 块从 `PENDING_APPROVAL` 填回 `APPROVED + approvalRef`（引用真实批准，不代填）；更新 `PRICING_APPROVAL` 版本；跑 `npm run check:products` + `npm run check:pricing` + `tests/billing/commercial-gate.test.ts` + `verify:payment-off`（本地）；确认 `readCheckoutGate()` 解锁逻辑与 D1 口径一致。
- **判据**：`check:products` 5/5、门禁 5 例全绿、plans API 反映已批准目录 = PASS。
- **禁止**：在没有批准记录时把 `APPROVED` 写回去（这正是 G12 代填已回退的教训）。

### B-02 · D3 SCALE 年付（L3 · HYBRID）

- **前置**：D3 三选一（提额 ≥$4,000 / 降价 ≤$2,999 / 年付下架）已定。
- **步骤**：按选择改 `subscription-plans.ts` 与定价展示；加一条「单笔金额 ≤ Dodo 上限」的自动化断言（含 $2,998 过 / $3,001 拒的负控）；复跑 `check:pricing` / `check:products` / billing 测试。
- **判据**：断言红→绿 + 目录一致 = PASS；提额路线需 Dodo 侧确认后才可判 PASS（未确认记 `BLOCKED`）。

### B-03 · D4 沙箱真实投递（补 G7 · L3 · HYBRID）

- **前置**：Dodo test_mode API key + webhook secret 已提供并写入环境（不在聊天明文留存）。
- **步骤**：在 test_mode 下真实投递 `CHARGE_FAILED` → 同 payment_id `CHARGE_SUCCEEDED` / `payment.succeeded` / `renewed` 序列；核对 `BillingEvent` 归约、`state.charges`、订阅权益、dedupeKey 唯一约束；跑 `billing:reconcile` 对账。
- **判据**：失败不改判成功、已成功不回退、同键重复被拦 = G7 由「代码层」升级为「实投层 PASS」。
- **禁止**：把 live 凭据当沙箱用；把单元测试绿当成「真实投递已证」。

### B-04 · D5 真实扣款与对账（L3 · GATE）

- **前置**：用户单独授权 + 受控测试账户 + 人工在场确认金额。
- **步骤**：自动化只做「扣款前快照 → 人工执行扣款 → 扣款后账本/订阅/发票对账 → 退款（若授权）→ 证据留档」；测试夹具用运行时拼接字面量，源码不留 `sk_test_` / `whsec_` 形态（gitleaks 会把夹具判真凭据）。
- **判据**：金额、订阅状态、BillingEvent 三者一致且可回滚 = PASS。
- **禁止**：自动化主动发起扣款；索要或记录聊天明文卡号。

### B-05 · D6 CF 范围（L3 · HYBRID）

- **前置**：A / B / C 已批复。
- **步骤**：**A（建议）= 零操作**，只需把「维持 CF 代理 → Netlify 运行时」写入状态页并将 G9 判为 PASS（方案 A 口径，已有生产实证）；**B** 按 `06_G9_CF_MIGRATION_REHEARSAL.md` §3 六步 Runbook 在 preview 环境演练（不动生产 DNS），完成判据全绿才允许灰度；**C** 需先补 cookie 跨域设计评审。
- **判据**：A = 文档回填 + 生产 head 复核；B = preview 上 G4/G6/G11 全绿 + 账本对账零差异 + webhook 同键幂等实证。
- **禁止**：KV 替代强一致账本；未演练直接切 DNS。

### B-06 · D7 用户测试（补 G5 · L3 · GATE）

- **前置**：D7 选项 a/b/c 已批复；若选 c（延后）⇒ G5 保持 `NOT_TESTED`，**不得改判**（只能由你承担风险并写入 GO/NO-GO）。
- **步骤**（仅 a/b）：按 `08_G5_USER_TEST_PROTOCOL.md` 分发招募文案/主持脚本/观察表/8 问问卷；汇总到 `evidence/g5-user-test-YYYY-MM-DD.csv`；按先行判据（≥5 人、4/5 两道关键题答对、30 分钟无提示完成）判定；缺陷走 `01_CONTENT_AND_CLAIMS.csv` 的 C-xx 登记 → 回修 → 复测。
- **判据**：判据全满足 = G5 PASS；缺一人/一题 = 保持 NOT_TESTED 或 FAIL。
- **禁止**：内部同事计入 5 人；未完成者算通过；由自动化「模拟用户回答」充当真人。

### B-07 · D8 法律主体补齐（补 G2 · L3 · HYBRID）

- **前置**：真实经营主体名称、注册地址/联系方式、适用司法辖区已提供。
- **步骤**：批量替换 `/about` `/terms` `/privacy` `/refunds` `/contact` 的占位主体与团队段；`npm run verify:brand-scan` + 五页 200 + axe 子集 + 链接可达性；登记 C-xx。
- **判据**：无占位符、三页法务信息一致、可达性通过 = G2 由 PARTIAL 转 PASS（社媒 C-31 另计）。

### B-08 · D2 线上止损执行（L3 · GATE）

- **前置**：D2 二选一已明确授权。
- **步骤**：**选① 发布候选** ⇒ 转入 A-04~A-07；**选② 立即止损** ⇒ 在 Netlify 删除/改名 `DODO_PAYMENTS_API_KEY` 后立即复测 plans API（`checkoutReady=false` / checkout 503），并在 `evidence/d2-stoploss-*.log` 记录改动前后与操作者授权引用。
- **判据**：入口不可结账且其余功能不受影响（prod-smoke 子集）= PASS。
- **禁止**：无授权自动改生产环境变量；把「哨兵告警」当成「已止损」。

### C-01 · G3 Figma 建稿（L3 · HYBRID）

- **前置**：Figma PAT + 目标 Team/File，或已安装并授权 Figma connector（当前 `list_installed_plugins` = No connectors installed）。
- **步骤**：按 `03_FIGMA_IMPLEMENTATION_MAP.md` §3 五步建稿（Foundations 两套 token → Components → 10 页 × 1440/390 帧 → Prototype CTA 流 → 每帧标注代码文件）；回填文件 URL + node 映射到 03 文档与验收矩阵。
- **判据**：可编辑文件 URL 可访问 + node 映射齐全 = G3 PASS；凭据不到 ⇒ 保持 `BLOCKED`，不伪称。

### C-02 · C-31 社媒链接可达性（L1 · AUTO）

- **步骤**：对页脚 FOLLOW 栏 4 个链接（blog / twitter / instagram / facebook @lokfeel）做 HTTP 可达性与归属核验；不可达/非官方 ⇒ 登记 C-31 并给出「下线或更正」建议。
- **判据**：4/4 有明确结论 = PASS（结论可以是「不存在，需下线」，但要如实记录，不是自动判绿）。

### C-03 · G10 TBT 优化（独立迭代 · AUTO）

- **说明**：按路由拆包 + 延迟水合，8 页 × 5 轮中位数复测，阈值 TBT ≤ 200ms。**这是结构性改造，禁止塞进发布批次、禁止靠放宽阈值转 PASS**。完成后才把 G10 从 PARTIAL 改判 PASS。

---

## 4. 建议注册的自动化配置（草稿 · **未创建**）

> 下列 `prompt` 只描述任务本身（自包含、不含调度词）；调度与工作目录走配置字段。若你确认，我再用自动化工具按此注册，并可先设为 `PAUSED`。

### 4.1 `lokfeel-收银台风险哨兵`

- `scheduleType`: `recurring` · `rrule`: `FREQ=HOURLY;INTERVAL=1` · `status`: `ACTIVE`
- `cwds`: `/Users/frankzhao/WorkBuddy/20260402202519/nexus-app`
- `prompt`:
  > 在仓库 `/Users/frankzhao/WorkBuddy/20260402202519/nexus-app` 中，只读复核生产 `https://app.lokfeel.com/api/payments/dodo/plans` 与 `/api/health`：提取 `checkoutReady`、`live_mode`、`approvedAt`、`catalogVersion`、响应头 `server`/`cf-ray`，并用 `git ls-remote origin refs/heads/main` 记录远端 main 头（唯一可信判据，不认 push 脚本退出码）。与 `docs/release/lokfeel-final-20261110/RELEASE_STATUS.md` §3 的期望状态比对，把时间、字段、结论、远端 SHA 追加到 `docs/release/lokfeel-final-20261110/evidence/checkout-sentinel-<日期>.log`。若 `checkoutReady=true` 且 D2 未获用户授权，输出醒目告警「线上收银台仍开放 · R-15 风险未止损」并列出两个止损选项（发布候选 / 摘除 `DODO_PAYMENTS_API_KEY`）。超时或字段缺失记 `ERROR`，绝不判 PASS。**严禁**自动修改 Netlify 环境变量、自动触发发布、自动回滚，或把告警写成「已止损」。所有命令在 `env -u NODE_OPTIONS` 下执行。

### 4.2 `lokfeel-候选门禁日检`

- `scheduleType`: `recurring` · `rrule`: `FREQ=DAILY;BYHOUR=9;BYMINUTE=20` · `status`: `ACTIVE`
- `cwds`: 同上
- `prompt`:
  > 在仓库 `/Users/frankzhao/WorkBuddy/20260402202519/nexus-app` 中执行轻量门禁日检（`env -u NODE_OPTIONS`）：`npx tsc --noEmit`、`npm run lint:gate`、`npm test -- --silent`、`npm run verify:brand-scan`、`npm run check:products`、`npm run check:secrets`、`node --test scripts/qa/b4-g4-verdict.test.mjs`。不要跑全量 116 格 G4 矩阵（耗时长且需生产构建），需要页面验证时只跑 4 路由子集，并确认 `zeroScanCells=0` 且 `rulesEvaluatedMin>0`。把每项退出码与结论写入 `docs/release/lokfeel-final-20261110/evidence/gates-daily-<日期>.log`。任一失败记 FAIL 并输出新增债定位与建议动作；**严禁**自动修代码、更新 lint 基线、放宽阈值或把失败写成 PASS。若工作树有未提交改动，只报告不清理。

### 4.3 `lokfeel-B6发布与G13复验`

- `scheduleType`: `once` · `scheduledAt`: **由你指定**（示例 `2026-11-13T10:00`，未创建）· `status`: `PAUSED`（建议；D1–D8 批复后再启用）
- `cwds`: 同上
- `prompt`:
  > 在仓库 `/Users/frankzhao/WorkBuddy/20260402202519/nexus-app` 中，先读 `docs/release/lokfeel-final-20261110/RELEASE_STATUS.md`。若状态词不是 `READY_FOR_APPROVAL`，或 D1–D8 无用户明确批复记录，立即输出 `NO_GO` 并停止，**不得发布**。否则按 `10_REMAINING_TASKS_AUTOMATION_PLAN.md` 的 A-04 → A-05 → A-06 → A-07 顺序执行：生成并校验 `08_RELEASE_MANIFEST.json`（含回滚点）；按 RC SHA 复跑 G11 全量门禁（tsc / 改动面 eslint / lint 棘轮零新增 / jest 全量 / next build / brand / products / secrets）；触发一次不带 `[skip netlify]` 的生产构建提交并 push（禁止 `--amend` 已推送提交），用 `git ls-remote` 与 `/api/health` 双向确认生产 SHA；随后执行 G13 全套生产复验，所有命令必须显式 `--base=https://app.lokfeel.com` 或等价生产 BASE（默认 `127.0.0.1:3000` 会打本机造成假绿）：`prod-smoke.mjs`、`verify:payment-off`、`verify-public-origin.mjs`、`verify-released-surface.mjs`、health/响应头、G6 生产出口、G8 部署产物密钥复扫、G4 生产抽样子集。全部通过且 commit 一致才把 `RELEASE_STATUS.md`、`07_ACCEPTANCE_MATRIX.csv`、`09_GO_NO_GO.md` 更新为 `RELEASED_AND_VERIFIED` 并回填发布 SHA；任一失败写 `RELEASED_NOT_VERIFIED`，输出回滚点并停止，不自动回滚、不改生产 env。所有结论附证据到 `evidence/g13-post-release-<日期>.log`。`PARTIAL`/`BLOCKED`/`NOT_TESTED` 一律不计完成。所有命令在 `env -u NODE_OPTIONS` 下执行。

---

## 5. 通用执行纪律（所有自动化任务必须遵守）

1. `env -u NODE_OPTIONS` 必须显式加：注入 shim 会导致 eslint 大输出 EPIPE、Next 构建 safe-delete 误报。
2. 远端状态**只认 `git ls-remote`**；脚本/push 退出码不算（沙箱拒 keychain 可 exit≠0 但推送成功）。
3. 免构建提交必须带 `[skip netlify]`（Netlify 只看头提交）；**推送过的提交禁止 `--amend`**。
4. **先迁移后发版**；本批次无 prisma 变更，无需迁移；将来有变更须先迁移再发版。
5. 生产复验必须显式指定生产 BASE；默认 `127.0.0.1:3000` / `3112` 的结果是打本机的假绿。
6. 发布窗口期（Netlify 部署域名 ~20min）`request.url` 会丢 cookie ⇒ 走 `src/lib/http/public-origin.ts`，不要在这段时间下登录态结论。
7. **集合断言先证前置非空**：空集恒真是假绿；判定需带负控（注入违规必须 FAIL、axe 未运行必须 ERROR）。
8. 源码断言先剥注释；「A⇒B」必须有人测 not A；`PARTIAL`/`BLOCKED`/`NOT_TESTED` 不计完成。
9. gitleaks 会把 `sk_test_` / `whsec_`+16 位测试夹具判真凭据 ⇒ 运行时拼字面量，源码不留；**不要加 allowlist**。
10. 禁止自动化代填 `APPROVED`、禁止自动真实扣款、禁止自动改生产 env、禁止自动切流/回滚；这些是 L0 硬护栏，违反即视为任务失败。

---

## 6. 完成定义与计数口径

- 状态词只用 `PASS` / `FAIL` / `PARTIAL` / `BLOCKED` / `NOT_TESTED` / `N/A`。
- 「100% 达成」= 冻结后强制项**全实测 PASS** + 证据 100% 覆盖 + 阻断缺陷 0；`PARTIAL` / `BLOCKED` / `NOT_TESTED` 一律不计完成。
- 每个自动化任务 PASS 必须同时满足：前置硬门全部满足、执行日志完整、判据有负控或前置非空、证据文件落盘且可复核。
- 最终序列：`NO_GO`（当前）→ `READY_FOR_APPROVAL`（D1–D8 批复 + 不可替代实测闭合）→ `RELEASED_AND_VERIFIED`（B6 发布 + G13 全绿）。**中间任何一步都不能由定时任务自行推进状态词。**

---

## 7. 建议的行动顺序

| 顺序 | 动作 | 谁做 | 可否自动化 |
|---|---|---|---|
| 1 | **D2 表态**（发布候选 / 摘除 `DODO_PAYMENTS_API_KEY`）——线上收银台可点且含 R-15 缺陷 | 你 | ❌ 需授权 |
| 2 | ~~注册 A-01 哨兵~~ → **已注册并真实取证**（§8） | 已完成 | ✅ |
| 3 | 集中批复 D1–D8（可一次性回复八个字母 + 选择） | 你 | ❌ 不可替代 |
| 4 | 按 D 项逐条触发 L3 补齐（回填/补证/复验） | 我 | ✅ 输入到达后 |
| 5 | 触发 L2 一次：B6 发布 + G13 生产复验 + 结论回填 | 我（等你指定时间与发布授权） | ⚠️ 需显式授权 |
| 6 | L4 观察期 48h（health / 付款闭环 / 账本对账） | 我 | ✅ |
| 7 | G10 TBT、G3 Figma、视觉语言统一、历史债 | 部分已推进（§8），其余独立迭代 | 部分 |

> 我**不会**自动执行 1 / 3 / 5 中的不可逆或不可替代动作，也不会在未获批准时把任何 `BLOCKED` 改写成 `PASS`。
> 下一步仍可：① 把 4.3 建成 `PAUSED` 的一次性发布任务（需你指定时间 + 发布授权）；② 把 19 张任务卡导出成 CSV；③ 按 D1–D8 批复逐项触发 L3。

---

## 8. 本轮执行结果（2026-11-12 15:20 GMT+8）

**执行范围**：只做「可自主完成、可逆、只读或本地」的任务；未发布、未切流、未改生产配置、未发生真实扣款、未推进状态词（仍 `NO_GO`）。

| 项 | 结果 | 证据 |
|---|---|---|
| A-01 收银台哨兵 | **已落地并真实跑生产** | `scripts/qa/checkout-sentinel-verdict.mjs`（判定层）、`checkout-sentinel.mjs`（只读取证）、`checkout-sentinel-verdict.test.mjs` |
| TDD 垂直切片 | **6 个行为逐个 RED→GREEN，全绿 6/6**；另端到端负控「不可达 BASE ⇒ ERROR + exit 1」 | 行为 B1–B6；B6 是真实生产契约（`environment="live_mode"`，无 `live_mode` 键）逼出的第 6 条 |
| 生产实测（15:11） | **`RISK_OPEN`**：生产 commit `5a161c4`、远端 `eaf2ca1`、`environment=live_mode`、`checkoutReady=true` | `evidence/checkout-sentinel-2026-11-12.log`（2 行：正例 + 负控） |
| 4.1 / 4.2 自动化 | **已注册 ACTIVE**：`b88e8e97…`（每小时）、`be585b35…`（每天 9:20）；均只读告警，prompts 含 L0 护栏 | 自动化清单；创建时工具自动带入会话 expert 绑定，本轮已清除为 `null`；prompt 自包含，不依赖任何 expert 角色 |
| 4.3 发布任务 | **未注册**（须你指定时间 + 显式发布授权） | 本文档 §4.3 仍为草稿 |
| G3 / Figma | **第四轮复核仍 `BLOCKED`**（四类来源全空，`list_installed_plugins` = No connectors installed）；新增可导入资产包 | `figma-import-kit/`（4 文件）、`03_FIGMA_IMPLEMENTATION_MAP.md`、Figma 经验库 |
| Figma 资产校验 | TDD 3 行为全绿（完整包 PASS / 缺文件 FAIL / 编造 `code_path` FAIL）；CLI `ok=true`：20 帧 · 20 color tokens · 9 组件 · 2 套系统 | `scripts/qa/verify-figma-import-kit.mjs` + `.test.mjs` |
| 文档差异修正 | 03 §1.1 的 FAINT 由旧值 `#8a9298` 更正为源码真实值 `#626a70`；登记 globals.css 注释历史品牌名、sitemap 18 路由 vs 资产包 10 页 | `figma-import-kit/README.md` §4 |

**仍未闭合**：D1–D8 全部待批复 · D2 线上收银台仍开放且含 R-15 缺陷 · B6 未启动 · G5 真人测试 NOT_TESTED · G12 BLOCKED · G10 TBT PARTIAL · C-31 与其余历史债。

**未伪称**：资产包不是 Figma 文件、无文件 URL / node id；告警不是止损；`BLOCKED` / `NOT_TESTED` / `PARTIAL` 未改判为 `PASS`。
