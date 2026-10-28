# V19-18 · Agent / Consent / Outcome 解释性 UX（WB19-42）

> **状态：已核（2026-10-23）。** 结论：三区的**状态语义层**（服务端 `statusLabel` / 常量）保持不动 —— 这正确且不可由前端改；本报告按任务书要求的七个"用户是否知道"逐条核验，并给出**四向核验表**（前端显示 → API 状态 → 服务端常量 → 测试断言）。

## 1. 七个"用户是否知道"逐条核验

| # | 问题 | 现状 | 证据位置 | 判定 |
|---|---|---|---|---|
| 1 | Agent 正在做什么 | RunCard 显示 skillLabel 徽章 + goal 全文 + 调用次数/成本/provider | `agent-board.tsx` L232–264 | ✅ |
| 2 | 下一步由谁执行 | 每卡写明「服务端会在裁决时重新判定…返回 409 并给出原因」；Inspector 显示「能否执行（服务端判据）」 | `agent-board.tsx` L294–296、L415–419 | ✅ |
| 3 | 为什么需要 Consent | 三列并置的逐字段披露投影（谁/哪些字段/给谁看），不重算 | `consent-gate.tsx` 头注释 ①② | ✅ |
| 4 | 批准后的实际影响 | 「批准不等于执行 —— 批准只把状态写到已批准，不会自动发出任何消息」 | `agent-board.tsx` L118–123 | ✅ |
| 5 | 如何拒绝/撤销 | 批准/驳回按钮常渲染（禁用态写明原因）+ 动作只按服务端 `actions` 下发渲染 | `agent-board.tsx` L274–296、`consent-gate.tsx` | ✅ |
| 6 | 区分"完成"与"已验证" | 「自报不算验证成功」加粗在屏；已验证/未验证（仅自报）双色标 | `outcome-observatory.tsx` L128–132、L236–241 | ✅ |
| 7 | 证据缺失意味着什么 | 「—该端点尚未返回，因此不显示数字」「4 条未获引用授权——仅显示数量」式文案 | `stages.ts` L150、`outcome-observatory.tsx` | ✅ |

## 2. 四向核验表（关键标签）

| 标签 | 前端显示 | API 状态 | 服务端常量 | 测试断言 |
|---|---|---|---|---|
| 运行状态 | `run.statusLabel` | `GET /api/v1/agents/runs` → `assembleAgentBoard` | `LIVING_AGENT_*`（`lib/living/agents`） | CI E2E（`/workspace` 页签）+ 纯函数单测（stages） |
| 阶段计数 | `stage.count`（null≠0） | proposals/runs/outcomes 三端点折算 | `OS_STAGE_KEYS` 同名流水线 | **变异把守的单测**（"—"≠0，V16 交付） |
| 披露三列 | 直接渲染下发值 | `/intents/[id]/disclosure` | `CONSENT_EXTERNAL_AUDIENCE_*` | 代码级复核（AC18/AC19 E2E 在 CI：`verify-ac18-console-e2e` / `verify-ac19-bridge-e2e`） |
| 执行可用性 | `execution.available + reason` 原样 | 同 runs 端点 | 服务端 `decideAgentRun` 判定 | 409 行为在 API 测试层（AC10 lifecycle：`verify-ac10-lifecycle`） |

**缺口（如实）**：浏览器级的真实授权/拒绝/撤销点击流仍缺（`17` BLOCKED）；上表第 4 列的 CI 证据在 `main`（`c3213fd`）成立，分支未重跑完整 CI。

## 3. 允许新增的解释性文案

本轮**未新增**任何辅助文案：现有解释密度已足够（且每条都对应真实服务端行为）。后续新增一律走 `05` §3 审查清单 + 四向核验。
