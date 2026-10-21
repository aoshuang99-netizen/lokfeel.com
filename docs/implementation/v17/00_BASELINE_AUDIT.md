# 00 基线审计（WB17-00）

**执行时间**：2026-10-21 15:20–15:25（GMT+8）
**执行人**：WorkBuddy（单人 + AI 模式）
**工作分支**：`work/v17-hardening`（从 `5b1a75f` 切出）
**V17 文档承诺基线**：`dc102cd`（2026-10-21 14:50 交接书）

---

## 1. 结论

| 项 | 期望 | 实际 | 判定 |
|---|---|---|---|
| 仓库在承诺基线上 | `dc102cd` | `5b1a75f` = dc102cd + 2 个纯文档提交 | **PASS（有差异，已记录，不回退）** |
| 工作树干净 | 无未提交内容 | 2 个文件仅权限位变化（644→755），无内容差异 | **PASS（未触碰）** |
| 本地 = 远端 | 一致 | `5b1a75f` 双向一致 | **PASS** |
| CI | 必需 job 全绿 | 14 success / 2 skipped / 0 failure | **PASS（跳过项已解释）** |
| 生产部署 | 与 HEAD 对应 | `dc102cd ready`（后两次提交带 `[skip netlify]`，属预期） | **PASS** |
| 生产健康 | 200 + 真实状态 | 200，`payments.configured=false`，缺 4 键 | **PASS（如实反映未接入）** |
| 本地工具链可跑测试 | tsc/jest/eslint/next 可用 | **全部不可用**（node_modules 仅 33 项） | **FAIL（限制，判定权移交 CI）** |

V17 可以在本基线开工。唯一的执行环境缺陷是本地依赖树不完整——这不是交付被卡，而是"本地无法自证"，所有构建/测试判定必须由 CI 与生产实测承担。

---

## 2. 基线与差异

```
$ git rev-parse HEAD
5b1a75f234f8bde453ab67f7afd6f07b683ae000

$ git log --oneline -3
5b1a75f docs: 交接书补纯文本版粘贴指令 [skip netlify]
ae3c422 docs: 给外部分析模型的上线决策交接书 [skip netlify]
dc102cd fix(build): 合并重复 redirects（5151513 Duplicate identifier）

$ git diff --stat dc102cd..HEAD
 docs/implementation/GPT-NEXT-STEPS-BRIEF.md | 173 +++++++++++++
 docs/implementation/GPT-PASTE-PROMPT.txt    |  27 +++
 2 files changed, 200 insertions(+)
```

差异**只有文档**，零代码改动。因此 V17 的执行基线等价于 `dc102cd`，不需要回退（回退会让已推送的文档消失，且违反"不强制回退"条款）。

### 未提交改动（非本次产生）

```
$ git diff --stat
 deploy/selfhost/test-tunnel.sh | 0
 deploy/selfhost/tunnel-once.sh | 0
 2 files changed, 0 insertions(+), 0 deletions(-)

$ git diff deploy/selfhost/test-tunnel.sh
-old mode 100644
+new mode 100755
```

**仅权限位**（`chmod +x`），零内容改动。按"不得覆盖未提交代码"条款，本次**未 checkout、未 add、未 stash**，原样保留。它们不会影响构建，也不会进入本次提交。

---

## 3. 代码规模（实测）

| 指标 | 值 | 命令 |
|---|---|---|
| 页面（`page.tsx`） | **78** | `find src/app -name 'page.tsx' \| wc -l` |
| API 路由（`route.ts`） | **201** | `find src/app/api -name 'route.ts' \| wc -l` |
| Prisma 模型 | **62** | 遍历 `prisma/schema/*.prisma` 统计 `^model ` |

与交接书一致（78 / 201 / 62），无漂移。

---

## 4. CI 状态（`5b1a75f`）

```
success (14): Cloudflare Pages | Lint (ESLint · 棘轮) | cron 方法一致性 | Perf SLO 对账 |
              Typecheck (tsc --noEmit) | Dependency audit（生产可达 · 棘轮）|
              Secret scan (gitleaks) | Test (Jest) | 上线预检汇总口径自证 |
              支付凭据灌注自证 | Build (next build) | Migration ... | DCO? | ...
skipped (2):  DCO sign-off check · Perf 基线实跑（手动）
```

**更正交接书一处数字**：交接书 §2 写"13 项全绿 / 2 跳过"，实测为 **14 success / 2 skipped / 0 failure**（共 16 个 check-run）。差异来自交接书按"任务种类"计数、GitHub 按 check-run 计数。后续 V17 报告统一采用 GitHub 口径（14/2/0）。

两个 skipped 的正当性：

| 跳过项 | 原因 | 是否属于本次发布必需门禁 |
|---|---|---|
| DCO sign-off check | 单人仓库、提交均无 co-author 签署需求 | 否（治理项，非质量项） |
| Perf 基线实跑（手动） | 设计为 `workflow_dispatch` 手动触发，避免每 PR 跑 Lighthouse 消耗额度 | **是**（OPS-05 需要，将在 WB17-08 手动执行并留证） |

第二条按 V17 §6.2「禁止用 SKIPPED 代替 PASS」处理：它在 WB17-08 转为 **手动执行 + 证据留存**，不当作通过。

---

## 5. 生产状态（实测）

### 5.1 健康端点

```
GET https://app.lokfeel.com/api/health → 200
{
  "status": "healthy",
  "dbLatency": 4853,          ← 首次调用（冷启动）
  "redis":   { "backend": "upstash", "configured": true, "degraded": false },
  "firebaseAdmin": { "configured": true, "initialized": true },
  "payments": {
    "configured": false,
    "charging": false,
    "channels": { "creem.checkout": false, "creem.webhook": false,
                  "stripe.card": false, "stripe.refund": false, "stripe.webhook": false },
    "missing": [ "CREEM_API_KEY", "CREEM_WEBHOOK_SECRET",
                 "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET" ]
  }
}
```

**新增观察（交接书未记录）**：连续 4 次调用 `dbLatency` 为 **4853 → 260 → 58 → 16 ms**。首次调用是冷启动（Turso 连接建立），4.8 秒对健康探针是危险值——若探针超时阈值设在 3s，冷启动会被误判为宕机，引发误告警。已记入 WB17-05 的探针阈值设计输入。

### 5.2 部署

```
dc102cd ready 2026-10-21T06:41:55Z   ← 当前对外版本
5151513 error 2026-10-21T06:35:56Z   ← Duplicate identifier（已修）
912e684 ready 2026-10-21T06:23:59Z
```

`5b1a75f` 未触发部署（提交信息含 `[skip netlify]`），与 HEAD 的差异仅是文档，生产内容正确。

---

## 6. 本地工具链（关键限制）

```
$ ls node_modules | wc -l
33

typescript/bin/tsc        ✗
eslint/bin/eslint.js      ✗
jest/bin/jest.js          ✗
next/dist/bin/next        ✗
@playwright/test          ✗（package.json 声明 ^1.64.0）
playwright                ✗（package.json 声明 ^1.59.1）
@axe-core/playwright      ✗（未声明）
web-vitals                ✗（未声明）
@sentry/nextjs            ✓（声明 ^11.7.0）
```

这是本仓长期存在的环境限制（沙箱拒绝 unlink + 安装命令约 20 分钟被掐断），**不是代码缺陷**。后果与对策：

| 后果 | 对策 |
|---|---|
| 本地不能跑 `tsc --noEmit` / `jest` / `next build` / Playwright | 判定权移交 CI（14 项）+ 生产实测；本地只做静态审查与纯 `node` 脚本 |
| 新增代码的类型错误只能靠 CI 反馈 | 小步提交、单提交单目的，出错可精确定位 |
| 不能本地跑 13 屏截图审计 | 复用仓内 `scripts/qa/v16-ux-audit.mjs`（依赖 Playwright）→ WB17-06 需确认其运行时来源 |

WB17-06/08 依赖 Playwright 实际执行。若本地确实无法安装，按 V17 原则标记 **BLOCKED（执行环境）**，不得用"脚本存在"冒充"截图已产出"。

### 依赖清单现状（`package.json`，与 V17 §4.1 对照）

| 组件 | 声明 | 本地可执行 | V17 处理 |
|---|---|---|---|
| `@playwright/test` | ^1.64.0 | ✗ | 已声明，CI e2e 在用；本地缺装 |
| `playwright` | ^1.59.1 | ✗ | 同上 |
| `@axe-core/playwright` | 未声明 | ✗ | WB17-06 无障碍检查需要 → 待评估 |
| `web-vitals` | 未声明 | ✗ | WB17-08 真实 P75 需要 |
| `lighthouse` / `@lhci/cli` | 未声明 | ✗ | 用 Chrome 无头 + 手工指标替代，或 CI 内跑 |
| `@sentry/nextjs` | ^11.7.0 | ✓ | 已装，但**是否有 DSN 未知**（WB17-05 核查） |

**V17 §4.2 的安装指令未直接执行**，理由：

1. 本地 `node_modules` 残缺，`npm install` 会触发全量重装，历史上有 20 分钟被掐断的记录；
2. `npx skills` 在本环境是否存在未知，且 V17 要求"先审查再固定版本"，不能 `@latest`；
3. 本章节要求的是"审计现有依赖之后执行，不要直接全部覆盖安装"——审计结论是：**除 `web-vitals` 与 axe 外，测试所需能力已由 CI 的 e2e job 覆盖**。

因此安装动作收敛为最小集，见 §7。

---

## 7. 本阶段实际执行的命令（可复现）

```bash
cd nexus-app
git rev-parse HEAD && git log --oneline -3 && git status --porcelain
git diff --stat && git diff dc102cd..HEAD
git checkout -b work/v17-hardening
find src/app -name 'page.tsx' | wc -l
find src/app/api -name 'route.ts' | wc -l
node -e "…统计 prisma model…"
gh api repos/…/commits/5b1a75f/check-runs        # 实为 curl + 代理
curl https://app.lokfeel.com/api/health          # ×4 测冷启动
curl https://api.netlify.com/api/v1/sites/…/deploys
```

未执行：`npm install` / `npx skills add` / `playwright install`（理由见 §6）。

---

## 8. 风险与移交

| 风险 | 影响 | 移交 |
|---|---|---|
| 本地无法自证构建 | 错误延迟到 CI 暴露（约 5–8 分钟/轮） | 全程按"小步提交"执行 |
| 健康端点冷启动 4.8s | 探针误判宕机 | WB17-05：阈值 + 连续失败次数 |
| 交接书 CI 计数口径偏差（13 vs 14） | 报告数字不一致 | 本文件已更正，后续统一 GitHub 口径 |

---

## 9. 回滚

```bash
git checkout main
git branch -D work/v17-hardening
```

本阶段未修改任何业务文件、未写生产、未触碰未提交改动，回滚零成本。

---

## 10. 状态

**PASS**

- 有证据：git 输出、CI check-runs、health JSON、Netlify deploys、依赖实检。
- 有偏差：基线 commit 比承诺晚 2 个纯文档提交（已记录，不回退）；CI 计数与交接书不一致（已更正）。
- 有限制：本地工具链不可执行，已明确移交 CI 判定，未用任何"脚本存在"冒充证据。
