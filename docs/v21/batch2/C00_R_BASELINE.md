# V21 第二批 · C00-R 基线复核（只读核实，不采信「已通过」自述）

复核时间：2026-11-15 ｜ 执行：主代理 + 四条独立只读盘点（Agency Agents：Backend Architect / Frontend Developer / Reality Checker / Security Engineer）

## 0. 任务书来源（如实标注）

- 用户消息给出《LOKFEEL_V21_BATCH2_WORKBUDDY_ORDER.md》正文（长文引用）与「下载完整任务书 MD」字样。
- **完整 MD 文件未随消息落盘**：已在 `~/Downloads`、`/tmp`、会话工作区查找，未发现 `*BATCH2*` / `*V21_BATCH*` 文件。
- 本批以用户消息正文为执行依据；凡正文与仓库事实冲突处，以**仓库代码 + 真实 HTTP 实测**为准并在此记录。

## 1. 版本与发布状态（C00-R）

| 项 | 实测值 | 取证方式 |
|---|---|---|
| 首批本地提交 | `f666564` | `git log --oneline -3` |
| 本地分支 | `v21/batch2`（本批新建，从 `f666564` 切出） | `git branch --show-current` |
| 远端 main | `cad717e`（与首批一致，**未推送**） | `git ls-remote origin refs/heads/main` |
| 生产 | `b50e53e`（`/api/health` `commitSource=env`，`status=healthy`） | `curl https://app.lokfeel.com/api/health` |
| 本批发布候选（工程完成后回填） | `dbb95a7182256ed693e12066f630885f3082fa1d`（`dbb95a7`） | `git log -1 --format=%H` on `v21/batch2`；详见 `RELEASE_CANDIDATE.md` |
| 结论 | **首批 `f666564` 未上线**；生产仍是 `b50e53e`；本批全程未推送 / 未部署 / 未改生产 | — |

## 2. 四条只读盘点结论（推翻/修正了任务书的部分预设）

### 2.1 C06/C09 —— 「审批/执行已存在」但「外部执行能力不存在」
- 现成且真实：`POST /api/v1/agents/runs`（真模型 HTTP）、`[runId]/approve`（ADMIN+）、`reject`、`execute`（OPERATOR+）、`GET [runId]`；`AgentApproval` / `AgentExecution` / `TenantAuditEvent` 落库；`planExecution()` 要求真实 APPROVED 裁决行。
- **硬边界**：`execute` 的唯一副作用是 `db.notification.create` + `notificationDelivery.upsert`（`Kind=RECEIPT`、`Channel=IN_APP`），源码自述「不是对外送达」；`EXECUTION_PLANS` 三个技能全部指向 RECEIPT。`Outcome` 只挂 `proposalId` / `missionId`，与 `AgentRun` **零字段关联**；**无 Trace 模型**；无 SSE 端点。
- 因此本批做「真实内部执行链路 + 可核验回执 + 第二人独立核验」，**并如实标注：未执行外部高风险动作**（发布纪律明令禁止），不把回执写成成果达成。

### 2.2 C04 —— spec 版本/并发保护全部不存在
- `WorkspaceSpec v1.2` 是纯前端 zod 契约（`src/lib/workspace-spec/schema.ts`），**不落库**；`Mission` 无 spec / version / revision / snapshot 列。
- `updateMission()`（`src/lib/connection/missions.ts`）`where:{id}` 无乐观锁；全仓无 `If-Match` / `ETag` / `expectedVersion`；仅 `CLOSED` 拒绝 PATCH。
- `intent.data` 里期限=`expiresAt`、对价=`offer`、判据=`successCriteria`、约束=`constraints`；**没有负责人字段**（本批如实显示「v1.2 暂无」，不伪造输入框）。
- 服务端持久化结构化 spec 的唯一位置是 `AgentRun.proposalJson`，与 Mission 无外键 ⇒ 本批新增 `Mission.sourceRunId` 作为真实关联锚点。

### 2.3 C03 —— 服务端零流式，且 `stream:true` 不是客户端流
- `src/app/api/**/route.ts` 全量无 `text/event-stream` / `ReadableStream` / `EventSource`；`/api/mcp` 明确声明不提供 SSE；A2A `streaming:false`。
- `provider-workbuddy.ts` 的 `stream:true` 是**服务端→上游模型**的请求参数，流在 provider 内用 `for await` 累积成单个字符串后返回 `ModelResult`；中间帧不落库、不推送。
- 因此本批新增的是**服务端编排阶段事件**（QUOTA_CHECK / MODEL_CALL / SCHEMA_VALIDATE / PERSISTED / DEGRADED）+ SSE 与 `Last-Event-ID` 续传，**并显式声明「不是模型 token 流」**（响应头 `X-Stage-Semantics: orchestration-stages-not-token-stream` + 每帧 note）。

### 2.4 反向验收①：异步串台的定性（按用户要求「不预先认定为缺陷」）
- 数据层：`runIntent` 无条件 `setOutcome(await ...)`，无 attempt 序号 / 无 AbortController / 无超时；`intent-gateway` 与 `useApiGet` 的 fetch 均无 signal。
- UI 层：`disabled={resolving}` 串行化，使「A、B 各点一次」在纯点击路径**当前不可达** ⇒ 不预判为已存在的用户可见缺陷。
- 结论：**只要两个请求并发，旧 A 必然覆盖 B**。本批按用户要求写可复现竞态测试（E2E 显式绕过 disabled），再以「最新提交获胜」控制器修复，并固定「A 挂起期间按钮禁用」不被误删。

### 2.5 反向验收②：列表信封混用两种形状（首批 F2 的真实缺陷）
- `paginated()` → `{success,data:<数组>,meta}`（missions / intents / members / mission intents）；`success({items,...})` → 对象 data（agents/runs / outcomes / pipeline）；还有 `{proposals}` / `{jobs}` 等命名键。
- 本批新增 `parseListEnvelope` 双形状兼容 + 四态（ok/empty/error/unexpected）+ `assertNonEmpty` 前置非空断言；**权限错误绝不映射成空列表**；独立红队用真实 HTTP 验证 missions 8 条 / runs 23 条非空。

### 2.6 反向验收③：开发与审计独立
- 本批开发由主代理 + 4 个实现子代理完成；**独立 QA 由另一个子代理单独执行真实 HTTP 负例**（不读 PASS 报告、不改产品代码），证据在 `docs/v21/evidence/independent/`。
- 该 QA 实测抓到 2 个真实缺陷（R3 幂等键跨用户串台、中文注入漏检）并复现 R1 制度性风险，均已闭环或如实标注（见 `BATCH2_CHANGES.md`）。
- 局限声明：独立 QA 与开发同属一个 WorkBuddy 会话，不是外部 Codex 独立评审；**G20 / 最终发布仍需 Owner 组织外部独立复核**。

## 3. 环境事实

- 本地生产构建服务 `http://127.0.0.1:3214`，隔离库 `DATABASE_URL=file:./ci-e2e.db`，`AUTH_SECRET` 随机；模型三键从 Netlify env 拉取后**只注入服务器进程环境**，不落仓库。
- 沙箱要点：`bash /tmp/nr.sh '<cmd>'` 包装（Bash 工作目录每次重置）、`env -u NODE_OPTIONS`、curl 必须 `--noproxy '*'`、`PW_CHANNEL=chrome`。
- CI 不重跑 `prisma generate` ⇒ `src/generated` 生成产物必须随提交（本批已重新生成）。
