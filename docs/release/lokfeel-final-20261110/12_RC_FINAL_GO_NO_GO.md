# LOKFEEL RC FINAL GO/NO-GO — Evidence Based

> 交付时间：2026-11-12 · 依据：V20.7 `B6 + G13 上线作战包`（ZIP 内 9 个文件已全部读取并落地）
> **总状态：`NO_GO`** —— 未达 `READY_FOR_APPROVAL`；未发布、未切流、未改任何生产配置、未发生真实扣款。
> 状态词只用 `PASS / FAIL / PARTIAL / BLOCKED / NOT_TESTED / N/A`；后三者一律不计完成。

| 基线 | 值 | 取证 |
|---|---|---|
| 生产运行时 commit | `5a161c4`（builtAt 2026-11-10 08:45Z） | `evidence/p0-01-production-risk.json` |
| 远端 main（本轮开工时） | `f6576db` | `git ls-remote origin refs/heads/main` |
| **唯一 RC SHA** | **`2b52ce04480dc8df53d260ec43fbe81f917e3650`** | `git ls-remote origin refs/heads/main` 已复核；后续纯文档补提交不改变运行时代码；见 `RELEASE_MANIFEST.json` |
| 生产边缘 | `server: cloudflare` + CF anycast + DNS 代理 | 同上，响应头实证 |
| SHA 漂移 | `true`（生产 ≠ 远端） | `evidence/p0-01-production-risk.json` |

**本文件不是建议书**：以下每一项都已实际执行并留下可复跑证据；未执行的项明确标注 `NOT_TESTED` / `BLOCKED`，不伪造。

---

## 1. D2 · 唯一需要你优先单独表态的一项（线上实时风险）

用户要求「D2 优先单独处理，不能让每小时告警长期代替解决问题」。本轮把该决策所需的证据全部补齐，**但止损动作本身仍属于生产变更，必须你一句话授权**；哨兵告警 ≠ 止损。

### 1.1 实时证据（2026-11-12 16:10 GMT+8 重新获取，非复用旧报告）

作战包原脚本 `scripts/release-preflight.mjs` 与仓库增强脚本 `scripts/qa/p0-01-production-risk.mjs` 两次独立只读取证，结论一致：**`RISK_OPEN`（exit 2）**

| 字段 | 生产实测 |
|---|---|
| `/api/health` | HTTP 200 · `commit=5a161c4` · `payments.charging=true` · `channels["dodo.checkout"]=true` |
| `/api/payments/dodo/plans` | HTTP 200 · **`checkoutReady=true`** · `environment=live_mode` · `catalogVersion=2026-11-10.1` · `approvedAt=2026-11-10` |
| `commercialApproval` 字段 | **不存在**（旧版 plans route 没有商业门） |
| `/pricing` | HTTP 200 · 46 KB · 页面含 `checkout` / `subscribe` CTA |
| 边缘 | `server: cloudflare` · `cf-ray=...-AMS` · `x-nf-request-id=...`（这是 request id，**不是** deploy id） |

即：**线上收银台可点，且该部署含 R-15 缺陷（同 payment_id 先失败后成功 ⇒ 收钱不开通且无告警）。**

### 1.2 本轮新增的因果链实证（决定了 D2 该选哪一项）

`evidence/d2-candidate-gate-proof.json`：用**候选代码的真实生产构建**启动两个实例，分别注入/不注入完整 `live_mode` Dodo 凭据，GET plans API：

| 实例 | 技术门 | 商业门 | `checkoutReady` |
|---|---|---|---|
| 生产 `5a161c4` | 通（Dodo 凭据齐备） | **不存在** | **true** |
| 候选 + 注入完整 live 凭据（`missing=[]`、`environment=live_mode`） | 通 | `PENDING_APPROVAL` / `ref=null` | **false** |
| 候选 + 无凭据 | 不通 | `PENDING_APPROVAL` | false |

**结论**：`checkoutReady = readCheckoutGate().enabled = 技术就绪 AND 人工定价批准`。即使生产 Dodo 凭据原封不动，部署候选后商业门也会单独把收银台关掉，同时 R-15 修复上线 —— **无需摘除 `DODO_PAYMENTS_API_KEY`，Webhook 验签、已有订阅与账本不受影响**。这正好满足 P0-01 的验收标准。

### 1.3 请你二选一（回一个字母即可执行）

| 选项 | 动作 | 效果 | 代价 / 边界 |
|---|---|---|---|
| **A（推荐）** | 授权对唯一 RC SHA 执行一次受控 B6 发布 | 一次同时：关收银台 + 修 R-15 + 上线生产 5 个 404 页面 + 商业门生效 | 属于生产发布，须在 §3 签字单里对**该 SHA** 明确授权；发布后须跑 G13 全绿 |
| **B** | 授权在 Netlify 临时摘除 `DODO_PAYMENTS_API_KEY` | 入口立即 503，止损最快 | 只关入口，**不修 R-15**、五个页面仍 404；可能影响 webhook 验签，需你确认对已有订阅的影响；我没有 Netlify API 凭据，须你提供或自行操作 |

> 若你只回「A」，我仍不会在你补齐 §3 签字单之前擅自发布 —— A 本身就是 B6 发布授权的一部分，必须绑定具体 RC SHA。
> 若你只回「B」，请同时确认 webhook 影响，并提供 Netlify 操作通道（本机 `netlify` CLI 与 API token 均不存在）。
> **在 D2 表态前，继续建议暂不对外宣传付费入口。**

---

## 2. 本轮 P0-01 → P0-10 实际执行结果（不是计划）

| ID | 状态 | 本轮做了什么 | 证据 |
|---|---|---|---|
| **P0-01** 生产风险取证 | **PASS（取证）/ FAIL（风险仍在）** | 重新获取实时证据；作战包 3 个脚本原样落地（sha 与 ZIP 一致，6/6 测试通过，空 manifest 按预期 exit 1）；新增完整取证脚本 TDD 8/8（含「200+空 body 必须 ERROR」负控） | `evidence/p0-01-production-risk.json`、`release-preflight-2026-11-12.json` |
| **P0-02** 支付账本与权益 | **PASS（代码层）** | 补 11 例端到端「翻译→去重→内核折叠」测试：R-15 失败后成功不静默、旧结算键注入必须复现吞单（负控）、新 payment_id 重试合法、R-14 成对事件只记一笔、逆序不回退、重放幂等、乱序稳定；D2 因果链单测 4 例 | `tests/billing/p0-02-*.test.ts`、jest 145 套 2730 例 |
| **P0-03** 官网八问与 CTA | **PASS（候选）/ ERROR（生产）** | 新增 12 页真实 HTML 审计（TDD 5/5）：候选 12/12 页 200、八问 8/8 有可见证据；**生产 5 个核心页 404** | `evidence/p0-03-public-surface-{candidate,production}.json` |
| **P0-04** Figma / Token | **BLOCKED（G3）** | 第五轮凭据复核四类来源全空；补齐作战包指定的 `--lf-*` 权威系统（33 token / 3 systems），资产校验加硬规则 + F4 负控 4/4 | `figma-import-kit/`、`03_FIGMA_IMPLEMENTATION_MAP.md` |
| **P0-05** 全矩阵重跑 | **PASS** | UI 改动后重跑 29 路由×4 视口 = 116 格：**112 PASS / 0 FAIL / 4 NA / 0 ERROR**，`rulesEvaluatedMin=33`、`zeroScanCells=0`、`scannedCells=112`、`subset=null` | `evidence/g4-public-matrix.json`、`g4-screens-manifest.txt`（112 张 sha256） |
| **P0-06** 性能 | **PARTIAL / 未达标** | 落地页 OrbitGraph 改为 idle 启动 + 30fps 限流 + 隐藏页跳过计算（真实首屏优化，非调阈值）；两次 8 页×5 轮实测 **TBT 0/8 达标**（1022–2338ms / 1173–2732ms） | `evidence/vitals-p0-*-2026-11-12.json`、`g10-perf-2026-11-12.log` |
| **P0-07** 安全 | **PARTIAL** | secrets 2427 文件 0 命中；产物 sha256 留档；跨租户 403/404、重放幂等等负例在 jest 全量内；**gitleaks 本机未安装，不伪称已跑** | `evidence/gates-p0-2026-11-12.log` |
| **P0-08** 主体 / C-31 | **PARTIAL（D8 阻断）** | `blog.lokfeel.com` DNS 无记录（确认死链）已从全站页脚移除；社媒 3 条本环境网络阻断记 NOT_TESTED；**10 文件 16 行 `LokFeel Inc.`/Delaware 声明未核实，产出 D8 占位清单，不代填** | `11_D8_LEGAL_ENTITY_PLACEHOLDERS.md` |
| **P0-09** G5 真人测试准备 | **NOT_TESTED** | 新增统计门禁 TDD 7/7（钉死「少于 5 人不放行」「4/5 阈值不可下调」「缺知情同意 ERROR」）；CLI 空记录如实 `NOT_TESTED` + exit 2 | `scripts/qa/g5-user-test-score.mjs`、`evidence/g5-user-test-score.json` |
| **P0-10** RC 独立评审 | **PARTIAL** | 本地门禁全绿；空模板负控成立；**`gh` 未安装 ⇒ 独立 RC PR 无法创建**；**无 Netlify API token/site id/CLI ⇒ 可回滚 deploy ID 不可得** | `RELEASE_MANIFEST.json`、`GATES.csv`、`STATUS.json` |

---

## 3. 七问逐条回答（作战包 §8，禁止空泛"完成"）

**Q1 · 为什么生产允许 `checkoutReady=true`？谁批准了 D1，证据何在？**
生产 `5a161c4` 是 2026-11-10 08:45Z 的旧部署，其 plans route **没有 commercial-gate**（响应里 `commercialApproval` 字段不存在），`checkoutReady` 只看技术就绪，而 Dodo 凭据是齐的（`charging=true`、`dodo.checkout=true`）。**D1 从未获任何人批准**：候选 `src/config/products.ts` 已回退为 `PENDING_APPROVAL`、`displayPrice=null`、无 `approvalRef`。生产响应里的 `approvedAt=2026-11-10` 是 `PRICING_APPROVAL` 目录版本常量（与 `catalogVersion=2026-11-10.1` 同源），**不是商业批准记录**。R-15 与 G12 在生产**均未生效**。

**Q2 · 候选与生产的功能差异？**
本轮只读实测给出硬差异：生产 `/product`、`/solutions`、`/stories`、`/how-it-works`、`/help` **全部 404**（B2 五新页从未部署）；生产定价页 46 KB 且含可点 checkout CTA，候选定价页 64 KB 且 `checkoutReady=false`；候选额外含 R-15 分态幂等键、商业门、`--lf-*` 资产规格、C-31 死链清理与动画性能改动。G13 复验必须逐项验证这些差异消失。

**Q3 · Dodo 真实事件有没有投递到正确 Webhook？provider event ID / HTTP / 数据库行 / 权益状态？**
**没有。** 全仓检索无任何 provider event ID、投递回执或 sandbox 记录，`evidence/` 下无 G7 证据文件。当前 G7 只有代码层证明（幂等/状态机/签名测试全绿）。D4 沙箱凭据未提供，官方真实投递未发生 ⇒ `NOT_TESTED`。不得用「观察窗口内 0 笔交易」宣称对账通过。

**Q4 · G10 TBT 八页原始样本在哪里，是否都 ≤200ms？**
原始样本：`evidence/vitals-b4*.json`（11-11 基线）与 `evidence/vitals-p0-2026-11-12.json`、`evidence/vitals-p0-clean-2026-11-12.json`（本轮两次 8 页×5 轮，原始 JSON 全部留档）。**否，0/8 达标**：两次实测 TBT 分别为 **1022–2338ms** 与 **1173–2732ms**，均 8/8 FAIL；停掉第二个服务后的清洁复测同量级，排除宿主机负载噪声。历史基线 487–1972ms，本轮除首页外多数页面更高，**不做选择性报告**。首页动画优化有局部改善（1972 → 1228/1359ms），但不足以达标。LCP/CLS/TTFB/JS 达标（pricing 的 LCP 为 WARN），TBT 维持 `PARTIAL`（强制项实为 FAIL），**不放水、不改判 PASS**。

**Q5 · 首页访客能否独立说明 LokFeel 是什么？G5 五人证据在哪？**
**不能证明。** 本轮 P0-03 只证「八问对应文案在真实可见 HTML 中存在」，这**不等于访客理解**。G5 无真人参与，`evidence/g5-user-test-score.json` 明确 `NOT_TESTED`。协议/招募/脚本/问卷见 `08_G5_USER_TEST_PROTOCOL.md`，统计门禁已就绪，等 D7。

**Q6 · Figma 文件与 Node ID 是否真实创建；否则为什么 G3 仍 BLOCKED？**
**未创建。** 第五轮复核四类来源（进程 env / 8 个 `.env*` / `mcp.json` / `list_installed_plugins` = No connectors installed）全部无写入通道。`figma-import-kit/` 是可导入规格（33 token / 20 帧 / 9 组件，全部带真实 `code_path`），**不是**可编辑 Figma 文件；ZIP 里的 HTML 是概念稿，也不是 Figma node。G3 保持 `BLOCKED`，恢复路径见 `03_...md` §3。

**Q7 · 唯一 RC SHA 是多少？对照哪份可即时回滚的 Netlify deploy？**
运行时 RC = **`2b52ce04480dc8df53d260ec43fbe81f917e3650`**（`RELEASE_MANIFEST.json` 的 `rcSha`，`git ls-remote origin refs/heads/main` 已复核）；后续纯文档提交不改变运行时代码。作战包 fail-closed 检查器对该 manifest 返回 `NO_GO` 并列出 21 个缺口（`evidence/release-manifest-gaps.json`）。**可回滚 deploy ID 目前不可得**：本机无 `netlify` CLI、无 Netlify API token / site id，`/tmp/nl-env.json` 的 44 个键里也没有任何部署凭据；`x-nf-request-id` 只是请求 ID。因此**回滚目标未验证**，这是 G13/发布前必须补齐的阻断项，不能拿 request id 冒充 deploy id。

---

## 4. 最终签字单（本轮唯一一次集中提交，请一次性批复）

| 发布判据 | 必须达到 | 当前实测 | 谁给 |
|---|---|---|---|
| P0 / 阻断性 P1 | 0 | **≥1（D2 线上收银台风险未处置）** | 你：§1 的 A 或 B |
| G0 基线 | 四类 SHA 可追溯 | PASS（生产/远端/候选/产物哈希齐） | 已给 |
| G1 八问 / G4 矩阵 | 全 PASS | PASS / PASS（112 有效格全绿） | 已给 |
| G2 页面 / 法律 | 全 PASS | **PARTIAL**（D8 主体未批；候选 12/12 页 200） | 你：D8 |
| G3 Figma | 可编辑设计真实交付 | **BLOCKED** | 你：PAT + Team/File 或 connector |
| G5 真人 | ≥5 名、4/5 达标 | **NOT_TESTED** | 你：D7 招募 |
| G6 / G7 | 生产 E2E + 沙箱真实投递 | G6 PASS（候选）；G7 **仅代码层**，真实投递 NOT_TESTED | 你：D4 |
| G8 安全 | 生产产物复扫 0 P0/P1 | PARTIAL（源码/产物 0 命中；部署产物复扫留 G13；gitleaks 未跑） | 发布后 |
| G9 架构 | 与上线一致 | PARTIAL（生产本就 CF 代理；建议方案 A 维持现状） | 你：D6 |
| G10 性能 | **TBT 8/8 ≤200ms** | **0/8 达标，FAIL** | 我：独立结构性迭代（按路由拆包 + 延迟水合） |
| G11 同 RC 门禁 | 全绿 | PASS（本地）：tsc 0 · eslint 0 · 棘轮零新增 · jest 145/2730 · build 0 · brand 27 · products 5/5 · secrets 2427/0 · 判定层 37+7 全绿 | 已给；GitHub PR 因 `gh` 缺失未建 |
| G12 定价 | `APPROVED + approvalRef` 可查 | **BLOCKED**（`PENDING_APPROVAL`） | 你：D1 |
| D1–D8 | 真实决策/输入/授权齐全 | **8 项全部未批** | 你：一次回复 |
| 生产发布 | 仅对该 RC SHA 明确授权后执行 | **未授权、未执行** | 你：绑定 rcSha |
| G13 | 生产真实验证全绿 | **N/A（未发布）** | 发布后 |
| 观察期 | 48h 监控与异常对账启动 | **N/A（未发布）** | 发布后 |

**严格完成率**：13 门禁中 6 PASS（G0/G1/G4/G6/G7/G11，G7 仅代码层）· 4 PARTIAL（G2/G8/G9/G10）· 2 BLOCKED（G3/G12）· 1 NOT_TESTED（G5）· G13 N/A。`PARTIAL/BLOCKED/NOT_TESTED` 不计完成 ⇒ **未达 100%，不得进入 B6**。

### 需要你一次性给出的输入（可只回字母 + 选择）

- **D1** 定价批准（Starter $49 / Growth $149 / Scale $399 月费及对应年付，或改价）并给出 `approvalRef`
- **D2** `A` 或 `B`（见 §1.3）——**最紧急，可先单独回复**
- **D3** SCALE 年付（提额 ≥$4,000 / 降价 ≤$2,999 / 年付下架）
- **D4** Dodo `test_mode` 沙箱凭据（受控密钥通道，不要聊天明文）
- **D5** 真实扣款授权（金额 / 账户 / 用途）
- **D6** CF 范围（建议 A：维持 CF 代理 → Netlify 源站）
- **D7** ≥5 名真人测试招募方式
- **D8** 法律主体 8 个字段（见 `11_D8_LEGAL_ENTITY_PLACEHOLDERS.md`）
- **B6** 对 `RELEASE_MANIFEST.json` 里那个 RC SHA 的明确发布授权 + 执行时间 + 可回滚 deploy ID 的获取通道

---

## 5. 最短关键路径（按依赖排序，不含已完成的工程）

1. **D2 表态**（A 或 B）→ 消除唯一的线上实时风险；A 同时修 R-15 与五个 404 页。
2. **D1 + D8 + D3** → 解开 G12/G2 与定价展示；**D8 必须替换 10 个文件 16 行未核实主体声明后复验**，批复本身不等于页面已改。
3. **D4 → G7 沙箱真实投递**、**D7 → G5 五人实测** → 两项不可替代实测。
4. **G10 TBT 结构性迭代** → 按路由拆包 + 延迟水合，8/8 ≤200ms 才算 PASS；不塞进本发布批次但它是签字单的强制项。
5. **G3 凭据 / 可回滚 deploy ID / 独立 RC PR 通道** → 三个当前环境缺口。
6. 上述齐备后：**冻结唯一 RC SHA → G11 按该 SHA 复跑 → 一次受控发布 → G13 全绿 → 48h 观察**。

> 在拿到完整验收数据之前，结论仍是 `NO_GO`，不是「已进入发布窗口」。
> 本轮已把**所有可自主执行、可逆、零风险**的工程任务做完；剩余全部需要你的决定、真人参与或外部凭据。
