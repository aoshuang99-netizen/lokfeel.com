# V21 状态页

## 🔴 第二批更新（2026-11-15）—— 唯一权威在 `batch2/RC_APPROVAL_PACKAGE.md`

**结论仍为 NO-GO（未发布、未推送、未部署）**。第二批在本地分支 `v21/batch2` 完成了
「意图理解 → 方案字段级编辑/版本 → 带 `sourceRunId` 创建任务 → 批准/执行 → 真实回执 →
第二人独立成果核验」的**真实 HTTP + DB + Audit + 阶段事件四重证据闭环**，
并按用户三条反向验收做了可复现竞态测试、列表信封非空契约测试、独立红队真实复现。

- 门禁逐条状态（G01–G20）、发布候选 SHA、Preview/回滚、9 项 Owner 授权需求：
  **`docs/v21/batch2/RC_APPROVAL_PACKAGE.md`**（本批唯一状态页）。
- 变更总表与 D1–D5 缺陷闭环：`docs/v21/batch2/BATCH2_CHANGES.md`；
  基线与四条契约硬边界：`docs/v21/batch2/C00_R_BASELINE.md`；
  可重放命令：`docs/v21/batch2/TEST_COMMANDS.md`。
- **重大发布差异**：本批**含 Prisma 变更**（3 张新表 + 2 个可选列 + `src/generated`），
  发布铁律改为 **先迁移后发版**；CI 不重跑 `prisma generate`。
- **诚实边界**：现有 execute 的真实效果只有 IN_APP 站内回执（RECEIPT），
  **未执行外部动作**；因此 G09 只能 PARTIAL。G02 Figma BLOCKED、G04 真人 UNTESTED、
  G20 外部独立复核未做，整体 NO-GO。
- **G15 性能实测不达标**：`batch2/PERF_ANALYSIS.md` + `batch2/perf-trace.json`，
  Chrome Trace 9 页 ×3 轮 **9/9 MISS、0 ALL_MEET**（TBT 522–2712ms 全超 200ms）；
  脚本退出码 0 只代表采集成功。历史 TBT 债维持 P1，不放水、不以「本地 lab ≠ 生产」改判 PASS。
- **发布候选 SHA**：`dbb95a7182256ed693e12066f630885f3082fa1d`（`dbb95a7`），见 `batch2/RELEASE_CANDIDATE.md`；**本地提交，未推送、未部署**，生产仍 `b50e53e`、远端 main 仍 `cad717e`。

下方「首批交付后」的表格为**历史快照**（2026-11-14），保留供追溯，不再作为当前状态。

---

## 历史快照：首批（2026-11-14）

**结论：NO-GO（未发布）**。本批完成了 C02 + C03 + C05 的**代码与本地真实证据**，
但 20 项门禁中**没有任何一项**达到"独立复核 + Owner 批准"的最终形态。
下面逐条写清：证据在哪、还差什么。**不把本地绿当发布绿。**

## 版本

| 项 | 值 |
|---|---|
| 代码基线 | `cad717e`（main） |
| 本批变更 | 工作树未提交 → 本批结束时本地提交（**未推送**） |
| 生产 | 仍为 `b50e53e`，`/workspace` 行为未变 |
| 运行环境（证据） | 本地 `next start` 127.0.0.1:3214 + 隔离 `file:./ci-e2e.db` |

## 门禁状态（逐条）

| ID | 门禁 | 状态 | 证据 / 缺口 |
|---|---|---|---|
| G01 | 环境/截图/候选/生产 SHA 对应 | **PARTIAL** | `docs/v21/CODE_BASELINE.md`、`route_coverage.csv`；缺口：候选未部署，生产 SHA 未变（需 Owner 批准后才有"候选=生产"的对应） |
| G02 | Figma 可编辑设计与 Tokens 对齐 | **BLOCKED** | 本环境无 Figma 写入凭据 / MCP 连通；未伪造设计帧。UI 以 `03_UI_DESIGN_CONTRACT` 为规范落地 |
| G03 | Now 首屏主操作与空态五视口 | **LOCAL_EVIDENCE** | `evidence/codex/c02/now-initial-*.png`（6 视口）+ `now-result-*.png`；`overflowPx=0`；缺口：独立视觉评审（W01）未做 |
| G04 | 首屏测试用户理解（10 人 ≥8） | **UNTESTED** | 无真人测试，不编造 |
| G05 | 真实 AI/规则来源与 stream 协议 | **LOCAL_EVIDENCE** | `evidence/codex/c03/intent-gateway-ai.json`（`providerKind=workbuddy`、`status=PROPOSED`、proposal v1.2）+ `intent-gateway-degraded.log`（`DEGRADED/rules`，原因原样）；缺口：**流式逐事件展示**未做（当前是诚实 pending 态，不是假流式） |
| G06 | WorkspaceSpec schema 与可编辑计划 | **PARTIAL** | 服务端 + 客户端**双重** zod 校验（`intent-gateway.ts` 再校验 proposal）；缺口：字段级编辑（改期限/对价/负责人）未做，只能重述目标再理解 |
| G07 | 真实任务创建、读取、状态连续 | **LOCAL_EVIDENCE** | `evidence/codex/c05/mission-loop.json`：201 创建 → 列表可见（3 条）→ 详情一致 → publish ACTIVE → close CLOSED；UI 任务屏截图同轮 |
| G08 | 幂等与重复事件去重 | **LOCAL_EVIDENCE** | 两处重放：agent run 同键同体 → 同 runId；mission 同键同体 → `Idempotent-Replayed:true` + 同 id |
| G09 | Agent 执行的 server 证据、零伪成功 | **UNTESTED** | 本批只到"运行创建 + 待批"，未走 `approve/execute`；不把"创建成功"当"执行成功" |
| G10 | 审批、撤销与跨租户隔离 | **PARTIAL** | 代码与既有契约在；本批未做新的审批/撤销/跨租户红队取证 |
| G11 | 7 屏路由、返回刷新、任务连续 | **PARTIAL** | 七项导航全部 `ready:true`；`workspace-tabs` 390/360 × 7 屏通过；缺口：刷新/前进后退的专项断言（旧用例在，未逐一复核） |
| G12 | API 错误与 0/null 区分 | **PARTIAL** | gateway 对 401/400 明示报错、403/429/5xx 兜底并写原因（8 条单测）；`evidence.ts` null≠0 未改；缺口：429/离线专项 E2E |
| G13 | 首屏无工程噪声、证据按需展开 | **LOCAL_EVIDENCE** | e2e 断言可见文本无 `/api/`；Inspector 默认收起（`living-shell.tsx`），顶栏一键展开；`workspace-now` 5 条全绿 |
| G14 | 无障碍与键盘/缩放 | **PARTIAL** | axe（WCAG 2.x AA）在 390/1280 两档 `/workspace`：**0 violations**；缺口：键盘全流程、200% 缩放、读屏人工测试 |
| G15 | 真实浏览器性能与可用状态 | **UNTESTED** | 本批未采 Trace / LCP / INP；历史 TBT 债未清 |
| G16 | 多模态真伪标记与权限 | **PARTIAL** | 现状：未接通的多模态入口**不显示**（符合"未接通不显示可用图标"）；缺口：显式断言 + 能力开关 |
| G17 | 注入/HTML/XSS/错误 JSON 负例 | **PARTIAL** | 服务端 `guard` + `injectionSignals` 存在，UI 如实提示；缺口：本轮未跑红队负例集 |
| G18 | 能力开关 / i18n / 降级真实 | **PARTIAL** | 降级真实（无凭据 → 规则 + 原因）；缺口：i18n 与开关审计 |
| G19 | 旧 GA 门禁不回归、唯一 SHA | **PARTIAL** | jest 2777/2777、e2e-ci 123/123、tsc 0；缺口：旧 GA 发布门禁未在生产候选上复跑 |
| G20 | WorkBuddy 独立 RC 与 Owner 批准 | **NO_GO** | 未推送、未部署；本报告**不构成发布批准** |

## 本批明确没做的事

1. 没有推送 main、没有触发部署、没有改生产配置或数据库。
2. 没有把"本地 123/123"写成"生产验收通过"。
3. 没有为了通过而放宽任何断言/阈值（唯一改动是 F1 的定位器写法与 F5 的期望拆分，理由见 `FAILURE_CLASSIFICATION.md`）。
4. 没有伪造 Figma 帧、用户测试、性能数据。

## 下一批建议顺序（按"能力真实 > 交互完整 > 视觉"）

1. **C06/C09**：把 `approve → execute → 回执` 真正接到任务详情（当前只到"待批"），拿 G09 的 server 证据。
2. **C04 字段级编辑**：Spec 卡直接改期限/对价/判据，版本 diff，不覆盖已执行任务（G06）。
3. **C03 流式**：把服务端编排的阶段性事件（理解→补充→成稿）以 SSE 推给 UI（G05 的 stream 部分）。
4. **W02/G04**：5 秒可用性测试；**W07**：Trace + INP（G15）。
5. **Figma（G02）**：需 Owner 提供 Figma 授权，否则该门禁保持 BLOCKED。
