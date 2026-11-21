# LokFeel｜2026-11-21 72 小时生产发布冲刺 · 执行回报（远端已打通）

> 依据：72 小时生产发布冲刺令 + `LOKFEEL_V25_6_GA_CLOSURE` 作战包（16 卡 / 19 门禁，ZIP SHA-256 全校验通过）。
> 状态口径：`CODE_COMPLETE / LOCAL_TESTED / REAL_BROWSER_TESTED / BLOCKED / PREVIEW_VERIFIED / PRODUCTION_VERIFIED` 不自评升级。
> **本轮已 push 独立分支与 rc 别名（未碰 main）、已触发真实远端 CI、已触发并成功部署 Cloudflare Preview；未部署生产、未迁移生产、未改密钥、未真实扣款、未对外发消息。**

## 一、冲刺令唯一允许的四项交付（直接回答）

### 1. 哪个唯一 RC SHA 已经形成？对应什么功能？

| 波次 | 精确 SHA | 远端可核验分支 | 真实功能 |
|---|---|---|---|
| **S 支付安全 Hotfix（源码）** | `230a21b9c035b89e371024df0697887125128658` | `hotfix/v25.6-checkout-fail-closed`、`rc/hotfix-v25.6-checkout-fail-closed` | 商业 fail-closed：`PRICING_APPROVED=false`、plans JSON/定价页不下发价格与 CTA、已登录 checkout 在创建 Provider 会话前 503；契约测试对齐 D1 开关语义 |
| **S 审批证据包 HEAD** | `77bbb222b117537249777f4c5f2e6a5277cfc5ad` | 同上（两分支均指向此 HEAD） | `GA02_HOTFIX_CANDIDATE.json` 已对齐 HEAD、CI Run ID、独立复核与存量 CVE 漂移；Owner 应对此精确 SHA 批准（纯文档提交，源码等于 `230a21b`） |
| **W Personal/Hotfix 主线候选（源码）** | `5fd54d24b9beb4c1f253dd3f2de2f11ae891ac09` | `release/v25.6-ga-sprint-20261121`、`rc/v25.6-ga-sprint-20261121` | 服务端签发/查库校验的 `AIProcessingConsent`（含迁移与生成客户端）、注册存储严格白名单与旧缓存物理擦除、首页保守文案与真实 Chats CTA、聊天空状态去旧导流、AI 不可用诚实态、20 消息双浏览器 E2E 与 CI 接线 |
| **W 审批包 HEAD** | `9469a77ff924087bdf7f1bf1ed2b0bf78e41f7bd` | 同上（两分支均指向此 HEAD） | 两分支 HEAD 相等；源码候选仍为 `5fd54d2`，其后为纯文档锚点提交 |

`git ls-remote --heads origin` 权威复核：`main` 仍为 `cad717e92542395e4346e49d388f09be78ec1557`（未受污染）。四个候选分支为新push 的独立分支，未覆盖 main。

### 2. 哪条注册→聊天→AI 建议→用户确认→对方收到流程实际通过？

- **已实际通过（真实浏览器，本地隔离环境）**：登录 A/B → 真实聊天页水合 → 两独立 BrowserContext 交替输入 20 条消息 → `/api/im/send` 鉴权落库 → 对方页面 seq 增量轮询真实收到；20/20 双向可达，91/86 次网络扰动，20 次幂等重放均 duplicate，3 个越权负例全拒，双端录屏与 DB 全量对账一致。证据 `docs/v25.6/evidence/UX04_05_FULL/report.json`。
- **已实际通过（真实浏览器）**：注册页输入密码/DOB 后 localStorage/sessionStorage/URL 无明文；刷新后密码不复活；预置旧格式敏感缓存后刷新，原始明文密码被物理覆盖为 v2 白名单信封；14/14。证据 `GA20_BROWSER_STORAGE_AUDIT.json`。
- **未通过 / BLOCKED**：`输入原文 → 申请授权 → 真模型建议 → 用户确认 → 对方收到` 全链。本地无 `WORKBUDDY_LLM_*` 凭据，真实模型为 `BLOCKED`；UI 明确显示 `AI writing isn't available right now`，不用静态话术冒充 AI。服务端 Consent 的 43 单测/9 场景只是授权门证据，不是模型质量证据。

### 3. 哪些安全负例由独立 Reviewer 验证？仍有什么阻断？

- **独立复核（Agent，干净 worktree，异于实现者上下文）已完成**：商业 fail-closed 语义与 Provider 零创建由独立复核确认；复核发现并促成修正了审批证据 SHA 落后问题（已在 `77bbb22` 修正）。Verdict：`PARTIAL`。**这不等于人类 Reviewer**——GitHub Reviewer 因无 `gh` CLI / API token / 已绑定 Connector 未分配。
- **远端 CI 已真实执行并复现的安全负例**（run `44875441463`，Hotfix `230a21b`）：gitleaks 凭据扫描、支付凭据灌注自证、租户作用域审计、cron 方法一致性、E2E 浏览器冒烟（含双组织隔离、Mission 闭环、Workspace 探针）——均绿；Jest 商业/支付门禁全绿。
- **仍阻断**：① 依赖棘轮三项存量 high（`effect` ReDoS，时间漂移，非本补丁引入，详见 §3）；② 人类独立 Reviewer 与 GitHub required checks 设置；③ 真实 Preview 运行时验证（部署 job 成功，但 workers.dev 从本环境出网超时且缺 preview 绑定/密钥）；④ 真实模型隔离凭据；⑤ Owner 精确 SHA 批准；⑥ AI 新表迁移窗口；⑦ 真人 5/90/180 秒与 150 样本盲评；⑧ 性能 TBT 历史债；⑨ 生产收费止损部署授权。

### 4. 哪一波达到 PREVIEW_VERIFIED 或具备可批准的生产部署包？

- **PREVIEW_VERIFIED：0 波**。Cloudflare Preview 部署 job 已 success（见 §2），但运行时未验证、缺绑定/密钥，不升级为 PREVIEW_VERIFIED。
- **S 安全止损**：已具备“可批准的生产部署包”——源码 `230a21b`、审批证据 `77bbb22`、生产祖先探测、最小 diff（10 文件）、远端 CI run `44875441463`、回滚方案见 `GA02_HOTFIX_CANDIDATE.json`。唯一未过门禁是存量依赖棘轮（与商业补丁正交）。仍缺 Owner 精确 SHA 批准与人类 Reviewer。
- **W Web+Chat/Personal Alpha**：候选 `9469a77` 已形成并触发远端 CI；真实 AI 为 BLOCKED，不宣称 AI 可用。
- **B/O/GA**：`NOT_TESTED / NO_GO`。

## 二、真实远端证据（本轮新增，可独立核验）

| 项 | 命令 / 判据 | 实测值 |
|---|---|---|
| 远端 main 未变 | `git ls-remote --heads origin` | `main=cad717e92542395e4346e49d388f09be78ec1557`（未受污染） |
| Hotfix 候选已推送 | `git ls-remote --heads origin` | `hotfix/v25.6-checkout-fail-closed=77bbb22…`、`rc/hotfix-v25.6-checkout-fail-closed=77bbb22…` |
| W 候选已推送 | `git ls-remote --heads origin` | `release/v25.6-ga-sprint-20261121=9469a77…`、`rc/v25.6-ga-sprint-20261121=9469a77…` |
| 基线对照分支 | `git ls-remote --heads origin` | `rc/hotfix-baseline-b50e53e=b50e53e…`（用于证明依赖漂移非补丁引入） |
| Hotfix 远端 CI | GitHub Actions | Run `44875441463`（`230a21b`）：Typecheck/Lint/Jest/Build/Migration/E2E 浏览器冒烟/gitleaks/支付凭据/租户作用域/cron 一致性全绿；**仅 Dependency audit 失败** |
| Hotfix CI（首次，契约修复前） | GitHub Actions | Run `44874257342`（`eb8129b`）：Jest/E2E 因旧测试契约失败（已定位并修） |
| W 候选远端 CI | GitHub Actions | Run `44874726892`（`9469a77`）：Typecheck/Jest/Build/支付凭据/gitleaks/cron 全绿；Lint 棘轮（10 条新增债）、Dependency audit、Migration 漂移（`sourceRunId`/`actorId` 未登记）、租户审计（inbox-store 5 条）、E2E Workspace 探针对照失败 |
| Cloudflare Preview（Hotfix） | GitHub Actions | Run `44874257344` → **success**，目标 `lokfeel-preview.aoshuang99.workers.dev`（隔离 worker，未碰生产 `lokfeel-app`） |
| Cloudflare Preview（W） | GitHub Actions | Run `44874726920` → **success** |
| Preview 运行时 | `curl https://lokfeel-preview.aoshuang99.workers.dev/` | 本环境出网超时（exit 28）；历史上该 worker 缺绑定/密钥曾 500/502，需独立环境验证，**不宣称 PREVIEW_VERIFIED** |
| 生产只读探测 | `GET /api/health` | `200`，`commit=b50e53e`，`commitSource=env`；plans `checkoutReady=true`/`live_mode`/$89·$199·$449；未发 checkout POST |

## 三、唯一失败门禁的定性：依赖棘轮（必须在上线前修，但不由 Hotfix 引入）

- 失败项：`prisma` / `effect` / `@prisma/config` 三个 `high`。根因 `effect` ReDoS（GHSA-7589-6fvf-x4pw，影响 `<=3.22.0`，当前锁 `3.20.0`）。
- **非本补丁引入的证据**：`cad717e`（main，2026-11-14 CI **成功**）与 `b50e53e`（生产祖先）的 `package-lock.json` 是同一 blob `6f151957ca96d29e6f5f9f03bd5691d2167e39b1`，prisma 7.10.1 / effect 3.20.0 完全相同。同一份 lock 在 11-14 绿、11-21 红 ⇒ CVE 库在 11-14 后收录该 advisory 所致的时间漂移。基线对照 run（Hotfix 祖先 b50e53e）同样红，进一步排除 Hotfix 引入。
- **真实修复路径**：同大版本 override `effect→3.22.5`（已修复的 3.x）可消除 CVE；`npm audit` 建议的 `prisma 6.12.0` 是 major 降级，不可取。本地 `npm install --package-lock-only` 被环境 exit 137 终止，未提交任何依赖改动。
- **决策**：不擅自登记豁免、不把门禁变更混入商业 Hotfix；作为独立供应链修复项交 Owner 决策。此项与商业 fail-closed 正交，不阻塞 S 波安全语义验收，但阻塞 CI 全绿与自动发布门禁。

## 四、本轮硬证据汇总

| 检查 | 命令 / 判据 | 结果 |
|---|---|---|
| 作战包完整性 | `unzip -l` + `shasum -a 256 -c SHA256SUMS.txt` | 11/11 OK，exit 0 |
| 源码收口 | 4 个语义提交 → W 源码 `5fd54d2` / 审批包 `9469a77` | 原 29 类改动全部有去向；未 reset |
| Hotfix 最小 diff | `git diff --stat b50e53e 77bbb22` | 10 文件 / +341 −187；仅商业门 + 测试 + 证据，无新 UI/DB/AI |
| 祖先关系 | `git merge-base --is-ancestor b50e53e 77bbb22` | exit 0（生产祖先成立） |
| 类型检查 | `npm run typecheck` | exit 0 |
| 生产构建 | `npm run build` | exit 0 |
| 全量单测 | `npm test -- --runInBand` | 172 suites / 3154 tests PASS，exit 0 |
| Hotfix 门禁（本地，HEAD 230a21b） | `jest commercial-gate/p0-02/v22-pricing/hotfix-provider-zero` | 4 suites / 14 tests PASS，exit 0 |
| GA-20 浏览器审计 | `ga20-registration-storage-audit.mjs` | 14/14 PASS |
| 双浏览器满配 E2E | `v256-two-browser-chat-e2e-full.mjs` | 21/21 PASS，20 消息 / 91·86 扰动 / 双录屏 |
| 凭据扫描 | `npm run check:secrets` + 远端 gitleaks | PASS，无命中 |

## 五、下一步（按冲刺令，不再加测试/方案）

1. **Owner 立即决策两件事**：① S 波是否批准 `77bbb22`（源码 `230a21b`）用于生产部署；② 依赖棘轮是走独立供应链修复（override `effect→3.22.5`）还是接受带债发布。
2. 打通人类独立 Reviewer：需 Owner 在本会话连接 GitHub Connector（或提供 PAT），我即可创建 PR、分配 Reviewer、设置 required checks。
3. Preview 运行时验收：需在能访问 `*.workers.dev` 且具备 preview 绑定/密钥的环境重跑。
4. W/Personal Alpha：真实模型凭据就绪后再开 AI 全链；当前维持诚实不可用态。

**总体裁决：NO_GO（维持）。** 本地候选 → 远端 CI → Preview 部署链路已打通，产物是真实远端 SHA + CI Run ID + Preview 部署；生产部署与门槛清零仍待 Owner 精确 SHA 批准与上述阻断处置。

---

## 六、追加：前后台 UI/UX 真实整改（2026-11-21 晚 · 用户强制纠偏令）

用户独立审计指出"一半没发布、一半根本没改"。用 blob 哈希核实属实：`/dashboard`、`/console`、`/connections`、`/workspace` 与 main 完全相同。本轮据此做了真实整改，**唯一新增候选 SHA**：

| 项 | 值 |
|---|---|
| 整改分支 | `ui-remediation/20261121`（从 W 候选 `8de107c` 切出） |
| 代码提交 | `01c2cd0`（6 页面重写 + 租户审计 baseline 真修）|
| 唯一候选 SHA（审批对象） | **`dec246804c7ee31e55e33d8a5dcdd43932762f76`**（证据文档提交，源码等于 `01c2cd0`）|
| 远端别名 | `ui-remediation/20261121`、`rc/ui-remediation-20261121` 均 = `dec2468`（ls-remote 复核）|
| 远端 CI | Run `44880974280`：Build/Typecheck/Jest/gitleaks 全绿；**租户审计由红转绿**；失败 5→4，无新增失败 |
| Cloudflare Preview | Run `44880974284` → success（隔离 worker，运行时未独立验证，不升级 PREVIEW_VERIFIED）|

**关键事实**：已登录访问 `/dashboard` 会被 307 到 `/workspace`（`next.config.ts:184`）——这是"改了首页用户却看不到"的根因之一。因此用户真正看到的个人首页 `/workspace` Now 屏已落实四入口（Chats 带真实未读数 / People / Spaces / My AI 诚实不可用态），不是只改 legacy 的 `dashboard/page.tsx`。

**三类证据**（目录 `docs/v25.6/ga-closure/ui-remediation/`）：
1. 视觉差异：before/after 各 16 张同视口截图（PC 1440 + 移动 390），6 个页面 body/CTA 有实质差异，8 个页面相对 main blob 全部变化；
2. 功能差异：`api-proofs.json` 真实 API 回执 10/10 PASS（含匿名 401 权限负例）+ PC/移动双录屏（13/14 步 OK，唯一失败是移动端空态被布局隐藏的已知行为）；
3. 发布差异：blob 哈希对照 + 唯一 SHA + CI Run ID + Preview Run ID（见上）。

CI 五项失败的逐项根因/最小修复/原始日志见 `ui-remediation/CI_FAILURE_TRIAGE.md`：租户审计真修转绿；Migration（真实迁移未登记）、Dependency（CVE 时间漂移，拒绝豁免）、E2E（SEC-08 夹具缺失）、Lint（新增债需真修）四项保持红，**不用刷基线/改断言骗取绿色**。

**边界维持**：本地 REAL_BROWSER_TESTED ≠ PRODUCTION_VERIFIED；生产仍为旧版 `cad717e`，本轮 UI 整改未部署。投产仍须 Owner 对精确 SHA 批准 + 人类 Reviewer + Preview 运行时验收。
