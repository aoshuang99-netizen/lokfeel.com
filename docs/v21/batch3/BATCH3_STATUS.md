# V21 第三批 · 状态页（Batch 3）

**总裁决：NO-GO。** 本批按「性能 → 审批安全 → 外部执行/成果 → 迁移 → 独立审计与 CI → RC」排序推进，**未推送、未部署、未改生产**。生产仍 `b50e53e`，远端 main 仍 `cad717e`。

| 项 | 值 |
|---|---|
| 基线候选（第二批代码树） | `dbb95a7182256ed693e12066f630885f3082fa1d` |
| 基线审批包 HEAD | `1b73a2c` |
| 第三批工作分支 | `v21/batch2`（本地，未推送） |
| 生产 | `b50e53e` / healthy / `commitSource=env` |
| 远端 main | `cad717e92542395e4346e49d388f09be78ec1557` |

## 任务板（按用户要求的统一字段）

| TASK_ID | OWNER | STATUS | SOURCE_SHA | CHANGED_FILES | TEST_COMMAND | EXIT_CODE | NEGATIVE_CONTROL | EVIDENCE | BLOCKER | NEXT_ACTION |
|---|---|---|---|---|---|---|---|---|---|---|
| C00 事实固定 | 主代理 | **DONE** | `dbb95a7`/`1b73a2c` | 0（只读） | `git diff --stat dbb95a7 1b73a2c` | 0 | 两提交间仅 5 个 `.md`，44+/3−；代码差异为空 | 本文件 §C00 | 无 | — |
| C01 G15 性能 | 主代理 | **FAIL** | 见提交 | `layout.tsx`、`use-api.ts`、`living-workspace.tsx`、perf 脚本 | `node scripts/qa/v21-batch2-perf.mjs --base=http://127.0.0.1:3214 --runs=3` | 0（采集）／**9/9 MISS** | `--only` 单页复现；`cpuProfile` 归因；未改阈值；未跳过最差页 | `docs/v21/batch3/C01_PERF.md` §3.2、`docs/v21/batch2/perf-trace.json` | 227KB gzip JS 解析（`(program)` 50–63%）；TBT 最差 3828ms、LCP 最差 10176ms、CLS 最差 0.685 | 首屏 RSC 化（需新批次/Owner 决策） |
| C02 R1 职责分离 | 主代理 + 测试夹具子代理 | **LOCAL VERIFIED** | 见提交 | `src/lib/agents/{policy,runs,executor}.ts`、`tests/agents/v21-batch3-approval-separation.test.ts`、`scripts/qa/v21-batch3-r1-http.mjs`、6 个既有测试夹具 | `npx jest tests/agents --runInBand` + `node scripts/qa/v21-batch3-r1-http.mjs` | 0（14 suites / 254 tests）／0（HTTP 6 PASS） | 自批 403 且**零副作用**；旧自批执行 403；过期 409；跨租户 404；MEMBER 403；正向控制 201/200 | `docs/v21/batch3/C02_APPROVAL.md`、`docs/v21/batch3/evidence/c02-r1-http-*.json` | 仍需外部审查主体复跑（C06）；run 行为本地隔离库预置 | 外部 Reviewer 复跑同一脚本 |
| C03 外部执行器 | — | **BLOCKED** | — | 0 | — | — | — | 本文件 §C03 | 无经 Owner 授权、可安全验证的外部动作 Provider 与凭据 | Owner 指定 Provider 并授权沙箱 |
| C04 Outcome 五证据 | — | **PARTIAL** | — | 0 | 复用 `closure.json` | — | 模型输出被 `400 MODEL_OUTPUT_NOT_EVIDENCE` 拒 | `docs/v21/batch2/closure.json` | 缺 `OutcomeEvidence`（业务结果）持久化；现有只到「回执 + 第二人确认」 | 新增 OutcomeEvidence 表与其迁移 |
| C05 迁移完整性 | 子代理 | **PASS** | 见提交 | `prisma/migrations/20261115120000_…/{migration.sql,down.sql}`、`migration_lock.toml`、`scripts/qa/v21-batch3-migration-compat.mjs`、`docs/v21/batch3/C05_MIGRATION.md` | `node scripts/qa/v21-batch3-migration-compat.mjs` | 0（18/18 PASS） | 干净库 + 旧库副本双跑；唯一键重复插入被拒；旧行新列为 NULL | `docs/v21/batch3/migration-report.json`（45KB，含真实 PRAGMA） | SQLite 无法安全 DROP COLUMN（回滚走备份） | 生产迁移需 Owner 单独授权 |
| C06 独立审查 | 同会话子代理 | **PARTIAL** | — | 0（只改测试） | `npx jest tests/agents` | 0 | 子代理独立复跑并逐文件报告夹具改法 | 见子代理回报 | **不是外部审查主体**；未做完整安全红队复跑 | 外部 Codex / 第三方 Reviewer |
| C07 发布治理 | — | **BLOCKED** | — | 0 | `gh api …/branches/main/protection` | 127（`gh: command not found`） | — | 本文件 §C07 | 无 `gh` CLI / 无 admin PAT；未推送故无法配 required checks | Owner 提供 PAT 或安装 gh；批准推送后建 PR |
| C08 Figma / 真人 | — | **BLOCKED / UNTESTED** | — | 0 | — | — | — | `docs/v21/batch2/{FIGMA_MAPPING,G04_USABILITY_PROTOCOL}.md` | 无 Figma 凭据；无真人样本 | Owner 授权 + 组织 10 人 |
| C09 RC 冻结 | — | **NO_GO** | — | — | — | — | — | `docs/v21/batch2/RC_APPROVAL_PACKAGE.md` | G15 FAIL、G09 PARTIAL、G02/G04/G20 未闭环 | 待上述门禁 |

## §C00 事实固定（可复核）

- `git diff --stat dbb95a7 1b73a2c` → **5 files, 44 insertions(+), 3 deletions(-)**，全部 `.md`；`git diff dbb95a7 1b73a2c -- '*.ts' '*.tsx' '*.mjs' '*.prisma' '*.json'` 为空。
- 第二批 114 个变更文件分类：**docs/evidence 71、source 22、tests 9、generated 6、qa-scripts 4、prisma 2**。
- 生成客户端差异来源已核对：`src/generated/schema.prisma` 新增 `MissionSpecRevision`、`ExecutionVerification`、`AgentRunStageEvent` 三个 model，以及 `Mission.sourceRunId String?`、`IdempotencyRecord.actorId String?` 两个可选列；无无关改动。
- **迁移缺口已补**：`prisma/migrations/` 原先最后一个是 `20261011170000_t05_connection_consent`，V21 第二批的 3 表 2 列**没有任何迁移文件**（真实缺陷）。本批新增 `20261115120000_v21_batch2_execution_loop`，并补 `migration_lock.toml`（原本缺失，Prisma CLI 无法识别 provider）。
- 独立运行：`npx tsc --noEmit` → 0；`npm run build` → 0（`.next/BUILD_ID` 已更新）；`npx jest tests/agents tests/connection` → 0；全量 jest 与 e2e 见文末。

## §回归读数（本批实际跑过的，分开列）

| 命令 | 结果 |
|---|---|
| `npx tsc --noEmit` | **0** |
| `npm run build` | **0**（3m36s，dynamic 回滚后重建） |
| `npx jest tests/agents --runInBand` | **0** · 14 suites / **254** tests |
| `npx jest tests/living --runInBand` | **0** · 20 suites / **389** tests |
| `node scripts/qa/v21-batch3-migration-compat.mjs` | **0** · 18/18 PASS |
| `node scripts/qa/v21-batch2-perf.mjs --runs=3` | **0**（采集完成）· **9/9 MISS** |
| `node scripts/qa/v21-batch3-r1-http.mjs` | **0** · 6 PASS / 0 FAIL |

**未跑**（不得当作通过）：全量 `npx jest --runInBand`（其余 100+ suites）、`e2e-ci` 全量、视觉脚本、闭环脚本、`v21-batch2-redteam.mjs`（其审批链用例仍是单账号夹具，已被 `v21-batch3-r1-http.mjs` 取代）。

## §C03 为什么是 BLOCKED（不是「已有接口」）

仓库里现有的外部能力只有三类：模型 API（`WORKBUDDY_LLM_*`，属**生成**不是**动作**）、支付（Dodo，真实扣款被发布纪律禁止）、邮件（需 `RESEND_API_KEY`，当前未配置）。**没有**任何一个「被 Owner 授权、可在沙箱安全验证、返回不可伪造执行 ID」的外部动作 Provider。

按用户纪律「无授权或凭据时保留 BLOCKED，不冒充已执行」，本批**不写半成品执行器**、不把站内回执改名叫外部执行。`EXECUTION_KINDS` 仍是 `['RECEIPT']`，`EXECUTION_CHANNELS` 仍是 `['IN_APP']` —— 代码层面的诚实边界保持不变。

## §C07 发布治理事实

- `gh` CLI **未安装**（`gh: command not found`），无法读取或写入分支保护；用户侧已确认 `main.protected=false`、rulesets 为空。
- 仓库 CI 已有 jobs：`typecheck`、`lint`、`test`、`build`、`migration`、`e2e`、`secret-scan`、`dependency-audit`、`dco`、`slo-check`、`perf-baseline`（后者仅 `workflow_dispatch` 手动触发，且是压测 SLO，**不是**浏览器 TBT/LCP/CLS 门槛）。
- ⇒ 即使推送，当前也没有「未经审核的 push 不能进 main」的规则，也没有 G15 的 required check。这两件事都需要**仓库管理员权限**，属明确外部依赖。

## 本批未做（不假绿）

- 未推送、未建 PR、未跑远端 CI、未部署 Preview、未做生产迁移、未执行任何外部动作或扣款。
- 未做 10 人真人测试、未连 Figma、未做外部 Codex 独立审查。
- 全量 e2e 未在本轮重跑（自批规则 + dynamic 切分改变了客户端树，需单独回归窗口）；因此 **G11/G19 维持第二批结论**，不宣称本批通过。
