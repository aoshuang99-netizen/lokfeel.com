# V20.0 — Real Agent Execution & Outcome Intelligence（执行计划）

> 阶段定位：V19.9 T-4（三屏视觉升级）已生产部署，进入**发布后观察期**。
> V20.0 的目标是让「真实用户提交目标 → Agent 在合法授权范围内完成实际动作 → 用户看到经验证的结果」成为可量化、可观测、可追责的闭环。
> 本文件同时记录对 T-4 生产声明的**独立核验结论**。

---

## §0 独立核验结论（T-4 生产真相，2026-11-04 实测）

用户提示：「我尚未独立核对 GitHub 和 Netlify 的原始记录」。以下为 WorkBuddy 直接拉取的原始事实，**非自报摘要**：

| 核验项 | 方法 | 结果 |
| --- | --- | --- |
| GitHub `main` HEAD | `git ls-remote` | `d4ad0d4`（T-4 台账回填的 `[skip netlify]` 提交） |
| 部署提交 `79459d6` 是否祖先 | `git merge-base --is-ancestor` | ✅ 是 `origin/main` 的祖先 |
| 线上实际运行提交 | `GET /api/health` → `commit` 字段 | `79459d6` ✅ |
| 线上健康 | `GET /api/health` | `status: healthy`，`dbLatency: 252ms`，`redis.backend: upstash / configured: true`，`botModule.enabled: true`，含 `payments` / `firebaseAdmin` 字段 |
| 工作树 | `git status` | 干净（无未提交改动） |

**结论**：T-4 生产声明（代码 `79459d6` · Netlify `6ae96193f9`）在「部署提交 + 线上健康」两层均被独立证实。

**诚实保留项（仍属自报，未独立复现）**：
- `prod-smoke 15/15`、`public-origin 13/13`、`payment-off 18/18` 三组为 WorkBuddy 自有脚本输出，本次未重跑；
- Netlify 构建 API 未直接查询（无令牌）；部署 ID `6ae96193f9` 来自自报记录，线上 `/api/health.commit` 已证 `79459d6` 与之一致。
- 如需补证：可显式 `--base=https://app.lokfeel.com` 重跑 `verify-payment-off` 与 `v198-agent-consent-outcome`，并查询 Netlify build hook。

---

## §1 阶段判断对齐（采纳用户三项判断）

1. **T-4 进入发布后观察期**：不再大改 Agents / Consent / Outcomes 三屏视觉。先观测真实用户路径、生产错误、性能与结果状态，避免「测试全绿但用户实际无法完成任务」。
2. **下一轮优先解决 AI 真实执行闭环**：当前 `16 PASS / 1 BLOCKED`，BLOCKED 即 A-03b（无真实 Provider 时批准正向执行未验证）。核心竞争力在 Agent 能否真正完成被授权动作并生成可信 Outcome，而非仪表盘。
3. **T-5 不整体冻结**：支付凭据 / 退款政策 / 法律主体需人工决策，但支付沙箱测试设计、举报去重方案评估、草稿恢复原型和凭据风险清单可由 WorkBuddy 自主完成。

---

## §2 V20.0 优先级 → 顺序化执行计划

| 序 | 优先级 | 工作 | 目标 | 自主性 |
| --- | --- | --- | --- | --- |
| 1 | **P0** | 真实 Agent 执行闭环（关 A-03b） | `Consent → APPROVED → EXECUTED → Verified Outcome` 端到端真跑 | 自主（见 §3 设计） |
| 2 | **P0** | 生产持续观测基线 | 错误率、任务成功率（AgentRun 状态分布）、延迟、审计日志抽样 | 自主 |
| 3 | **P0** | 跨租户与安全补证 | 关闭 SEC-08 等真实测试缺口（A-08 已覆盖，需补隔离租户的执行/Outcome 路径） | 自主（部分需批准凭据） |
| 4 | **P1** | Outcome 证据可视化 | 可追溯来源、时间、执行者、验证状态 | 自主 |
| 5 | **P1** | 任务失败恢复 | 重试、撤销、超时、幂等、人工接管 | 自主 |
| 6 | **P2** | T-5 决策准备 | 支付沙箱设计 / 举报去重评估 / 草稿恢复原型 / 凭据风险清单 | 自主（决策需人） |

**不启动**：新一轮三屏视觉重构（已在 §1.1 冻结）。

---

## §3 关 A-03b 的设计（诚实优先）

### 现状根因
`src/lib/agent/runtime.ts:runSkill()` 仅在「Provider 真实成功 + 技能 `requiresApproval`」时返回 `AWAITING_APPROVAL`。本地/CI 无 Provider 凭据 → 返回 `DEGRADED` → 永远到不了待批态 → A-03b 标 `BLOCKED_ENV`。`approval.ts` 状态机中 `AWAITING_APPROVAL → EXECUTED` 边本就不存在（AC-08 结构性保证：注入不能绕过审批）。

### 方案：声明式模拟 Provider（即「Agent 沙箱」）
复用既有 `provider.ts:createStubProvider`（测试专用、显式注入），新增**显式沙箱解析分支**：

- 仅当 `AGENT_PROVIDER=stub` 显式设置时，解析为 `stub` Provider（默认 responder 返回通过 zod 校验的确定性 JSON）。
- 生产解析顺序：`WORKBUDDY_LLM_*` / `OPENAI_API_KEY` 存在 → 真实 Provider；缺失 → `unavailable` → 明示降级。**绝不**因缺失而回退到 stub（守住「无凭据即明示不可用」红线）。
- DB 中 `providerKind` 记 `stub`，清晰标记为「非真实模型产出」，与 `rules` 降级区分。
- `v198-agent-consent-outcome.mjs` 新增 A-03b 实跑分支：以 `stub` 模式发起 `INTRO_DRAFT`（→ `AWAITING_APPROVAL`）→ 调真实 `approve` → 调真实 `execute`（走 `planExecution` 状态机 + `planOutboundDelivery` 披露闸门）→ 断言 `EXECUTED` + 投递 + 审计 + 对手方确认 Outcome。
- 结果：把 `16 PASS / 1 BLOCKED` 变为 `17 PASS / 0 BLOCKED`，且验证的是**真实 HTTP + 真实状态机 + 真实投递 + 真实审计**四面证据，仅 Provider 输出为确定性模拟。

### 诚实边界（不可破）
- 模拟 Provider **只在显式 `AGENT_PROVIDER=stub` 时启用**，不进生产默认路径。
- 模拟产出**仍须通过技能 `outputSchema` zod 校验**（与真实路径同一道关），不绕过「未校验文本不得进渲染层」。
- 不把 `stub` 伪装成 `openai`/`workbuddy`：DB `providerKind` 如实留 `stub`。

---

## §4 门禁与诚实红线（沿用 T-4 标准）

- `tsc` 0 error · `eslint` 0 条（逐文件×逐规则）· 视觉审计（本次不增视觉改动，跳过）
- 端到端：`v198-agent-consent-outcome` 目标 `17 PASS / 0 BLOCKED / 0 FAIL`
- 集合断言先证前置非空；源码断言先剥注释；「A⇒B」须有人测 not A
- 任何新 Provider 模式不得让「无凭据」静默变为「假成功」

---

## §5 本轮已启动的自主项

- **D-09 凭据风险清单**：扫描当前工作树中形似凭据的前缀（`sk_(test|live)_`、`whsec_`、`wbpk_`、`pk_(test|live)_`、`creem` 等），产出脱敏风险登记，供轮换评审（详见同名交付物）。
- 本计划文档本身（对齐与顺序化）。

> 下一步待确认：A-03b 的模拟 Provider 是否按 §3 的「`AGENT_PROVIDER=stub` 显式沙箱」实现；确认后即进入实现 + 重跑。
