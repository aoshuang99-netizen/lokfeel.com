# 52 · NEXT CYCLE DIRECTIVE — V19.9 下一周期重点任务与验收说明

> **生成于**：2026-11-01 · 依据：Batch 4–7 收口后的真实基线（非旧汇报数字）
> **定位**：给下一个执行周期（WorkBuddy 自主推进 + 人工决策点）的任务卡。
> 规则沿用：**没有解除条件的 BLOCKED 等于永远不做**；工程不替产品做产品决策。

---

## 0 · 基线快照（2026-11-01 实测）

| 项 | 值 | 取证 |
|---|---|---|
| `origin/main` | `c3213fd` | `git ls-remote` |
| `v19/design-exploration` 本地 | `a6fa140`（V19.8 Batch 0–7 完结，RELEASE_CANDIDATE=YES 代码侧） | `git log` |
| `v19/design-exploration` 远端 | **`3968f8f`（落后，BLOCKED_GITHUB_AUTH）** | `git ls-remote` |
| `fix/p2-soft-delete-aggregate` | `a758736`（**11 个 B-5~B-20 修复**：cron 软删清理 / bot-tick 门控 / 退款对账 / Stripe checkout 三连 / 订阅状态 fail-open / Creem 套餐幂等 / Prisma Client 重生成 / 软删 aggregate 漏包；提交自带测试证据 364 tests 绿） | `git log c3213fd..a758736` |
| 生产 | `dc102cd`（旧；`prisma/` 与 HEAD 0 差异 ⇒ 发布无需 DB 迁移） | Netlify API |
| 本地推送通道 | ❌ `gh` 未安装、`credential.helper=osxkeychain` 被沙箱拒 ⇒ **push 全阻断** | `gh auth status` |

> ⚠️ 两条线**从 main 分叉**（merge-base = `c3213fd`）：v19 线 36 提交、fix 线 11 提交，互不包含。收敛顺序见 T-2。

---

## T-1 · P0 —— 解锁推送（H-1），一切远端验收的前提

**任务**：把 `v19/design-exploration`（`a6fa140`）与 `fix/p2-soft-delete-aggregate`（`a758736`）推上 GitHub。

**途径（三选一，按自主程度排序）**：
1. **GitHub 连接器（推荐）**：已在会话中出推荐卡，从左下角「+」菜单启用并授权后，WorkBuddy 可自主完成 push / 开 PR / 盯 CI 全流程；
2. **终端 `gh auth login`**（人工一次性，之后本地 git 可推）；
3. **用户本机自行执行** `git push origin v19/design-exploration fix/p2-soft-delete-aggregate`（若弹 keychain 授权请允许）。

**验收（全部满足才算解锁）**：
- [ ] `git ls-remote origin` 显示 `refs/heads/v19/design-exploration` = `a6fa140`
- [ ] `refs/heads/fix/p2-soft-delete-aggregate` = `a758736`
- [ ] 推送过的提交**禁止 `--amend`**（既有铁律）

---

## T-2 · P0 —— 分支收敛：两条线合一 + CI 全绿

**任务**：推送完成后，按以下顺序收敛（每步 CI 绿再走下一步）：
1. 两条分支各自 CI 跑绿（基线：本地 Jest 2349 / E2E 113 / axe 0 新增 / lint 棘轮 0 新增）；
2. `fix/p2-soft-delete-aggregate` → `v19/design-exploration` 合并（预期小冲突点：`src/lib/prisma-soft-delete.ts`、`package.json` overrides；合并后**必须本地复跑全套门禁**，不得只信合并提交）；
3. 合并分支 → `main`（走 PR，即使单人开发——让 CI 成为合并闸门）。

**验收**：
- [ ] 合并 HEAD 上：Typecheck 0 error / lint 棘轮零新增 / Jest 全绿 / Playwright 全绿 / `check:acceptance` 一致
- [ ] CI（远端）合并分支 **0 失败**
- [ ] `46–51` 号交付文档的数字与本轮重跑结果一致（防 R-16 文档漂移）

---

## T-3 · P1 —— D-10 发布 + 生产复验（需人工批准）

**前置**：T-1 + T-2 完成、人工批准 D-10。
**任务**：发布 → 生产复验（runbook：`docs/implementation/v18/22_RELEASE_RUNBOOK.md`）。
**验收**：
- [ ] `/api/health` 返回 `commit` = 发布 SHA（R-05 关闭证据）
- [ ] `/pricing` 200（不再 307→/pay.html）、`/hlua` 200（两条产品线解开）
- [ ] `verify-public-origin.mjs` 13/0、`verify-payment-off` 18/18
- [ ] Netlify deploy `state=ready`，`prisma/` 零迁移

---

## T-4 · P1 —— V19.9 三屏视觉升级（三张参考图落地）

> 参考图语义映射（**只做视觉/信息层级升级，不改已验收的契约与状态机**）：

| 参考图 | 对应屏 | 借鉴要点 |
|---|---|---|
| ① Agent Command Center（roster 表 + Active Operations + Cost Breakdown + Needs Attention） | `/console/agents` | Agent 花名册表（runs / avg score / trend / cost / last active 列）、运行中操作卡、按 agent 成本条形分解、"needs attention" 聚合卡 |
| ② Autopilot 人审流（Status 卡 + Latest actions 勾选清单 + **Human approval required: Approve/Decline** + Audit log 时间线） | `/workspace` Consent 屏 | 审批横幅前置、动作清单逐步打勾、审计时间线侧栏 —— 与既有 `AWAITING_APPROVAL → APPROVED/REJECTED` 状态机一一对应 |
| ③ 现场作业验证流（Photo/Notes/Audio 证据 → Submit for Review → **Verified** → Approve & Close） | `/workspace` Outcomes 屏 | 证据三分栏（照片/文字/音频）、"证据齐 → 待验证 → 已验证" 四步流程条 —— 呼应 Outcome 三不变量（自报不算验证） |

**硬约束**：沿用 `--lf-*` 令牌 + 双世界作用域（不给组件传 theme）；Server-owned status labels 不动；禁止大规模重构已验收组件；每改动记录 Before/After 截图 + axe + E2E。

**验收**：
- [ ] 104 格视觉审计（`v198-visual-audit.mjs`）仍 **0 FAIL**
- [ ] axe 棘轮 **0 新增**；360/390 触控 <24px = 0
- [ ] 全量 Playwright 113 条全过；`46_AGENT_CONSENT_OUTCOME.mjs` 16 PASS 不回退
- [ ] 新增改动逐项有 Before/After + Commit SHA（沿用 48 号格式，追加 `52a` 节）

---

## T-5 · P2 —— 人工决策清单（工程不代劳）

| ID | 事项 | 卡住谁 |
|---|---|---|
| H-1/T-1 | 推送授权（连接器 / gh / 自行 push） | 一切远端验收 |
| D-10 | 发布批准 | T-3 |
| D-01 | 退款期限口径（7/14/按产品） | BIZ-07 |
| D-02 | SaaS 定价展示方式 | 商业化 |
| H-4 | 支付 4 凭据（Creem×2 / Stripe×2） | AC-25 / 真实扣款 |
| H-3 | 举报去重口径拍板 | ⑦ 用例夹具纪律 |
| D-09/R-15 | git 历史中 55 处形似凭据**是否仍有效、是否轮换** | 安全 |

---

## 自主推进机制（WorkBuddy 循环任务建议）

启用 GitHub 连接器后，可对 WorkBuddy 下达循环指令：
> "继续执行 52 号指令中未完成的任务；推送后每 30 分钟检查一次两分支 CI，红了就按 annotation 修复并重推；全绿后停在 T-3 等人工批准 D-10。"

**停止点（工程不得越过的三条线）**：D-10 发布批准 / 真实扣款 / 历史凭据轮换 —— 全部等人工。
