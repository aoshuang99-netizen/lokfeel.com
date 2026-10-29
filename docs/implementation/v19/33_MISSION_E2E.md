# 33 · MISSION E2E（WB19-62 · V19.6）

日期：2026-10-29　分支：`v19/design-exploration`

## 1. 交付物

`scripts/qa/v196-mission-flow.mjs` —— Mission 真实闭环探针：**真实 HTTP + 真实库，
不 mock 任何结果**。已接入 CI e2e job（`next start` 之后的探针序列，v18-isolation-proof 同位）。

## 2. 覆盖（18 条断言）

| 组 | 断言 | 结果（本地实测 2026-10-29） |
|---|---|---|
| CTRL | 两个身份会话被识别（防"登录坏 ⇒ 全绿"假绿） | 2 PASS |
| M | Mission 创建 201 + ACTIVE + shareToken；同键重放 `Idempotent-Replayed:true` + 同 id + 列表不翻倍 | 2 PASS |
| N-01 | MEMBER 创建 Mission → 403 | PASS |
| J | MEMBER 经 `shareToken` 真实加入 | PASS |
| I | MEMBER Intent 201；同键重放 Replayed；二次 Intent（新键）→ 409 一人一意图 | 3 PASS |
| A | OWNER 发起 INTENT_EXTRACTION 201；同键重放同一 run id + `replayed` 标注 | 2 PASS |
| N-03 | MEMBER 发起 Agent 运行 → 403 | PASS |
| C | OWNER 发起 INTRO_DRAFT（高风险）；MEMBER 批准 → 403 | 2 PASS |
| C-03/C-04/E-01 | 批准/驳回/执行链 | **3 BLOCKED**（见 §3） |
| O-01 | GET /api/v1/outcomes → 200 | PASS |

**汇总：15 PASS / 3 BLOCKED / 0 FAIL（exit 0）。**

## 3. 为什么是 3 BLOCKED（不是 FAIL，也不是伪造的 PASS）

本地与 CI 环境都**没有配置 LLM Provider**（`WORKBUDDY_LLM_*` 缺失）。真实读数：

```
runStatus=FAILED  reason="未配置 WORKBUDDY_LLM ..."
```

Agent 运行在**进入审批阶段之前**就 FAILED（Provider 判定先行）。因此
「批准 → APPROVED」「驳回 → REJECTED → 再执行 409」「执行 → EXECUTED/DEGRADED」
三条链没有可裁决的前置状态 —— 按 V19.6 Phase 3 的口径记为 BLOCKED，
**绝不** mock 一个 PROPOSED/AWAITING_APPROVAL 来凑数。

解除条件：在具备真实 Provider（或带 LLM 键的隔离环境）复跑本探针；
`INTRO_DRAFT` 产出 PROPOSED/AWAITING_APPROVAL 后，C-03/C-04/E-01 自动启用。
状态机本身的正确性（EXECUTED 不可由 PROPOSED 直达）由 `approval.ts` 的
迁移表断言 + `assertTransition` 把守，且本探针的 409 读数（对 FAILED 运行
批准/执行被 409 拒绝）从行为侧补证了状态机在拒答。

## 4. 实测过程中的真发现

1. **runs 端点与 missions 端点的幂等重放标注不一致**：missions 用响应头
   `Idempotent-Replayed: true`，runs 用 body 的 `replayed` 字段。
   契约内部不一致（P2）；探针按各自真实口径断言。
2. 对 FAILED 运行做 approve / reject / execute 均返回 **409**（状态机不允许）——
   与 `assertTransition` 的设计一致，行为侧证据。

## 5. 诚实状态验收（Phase 3 口径的落实）

- `FAILED`（Provider 缺位）按**真实状态**验收，不判红、不判绿于"成功"；
- 探针从不假设 EXECUTED；若未来 Provider 就绪，EXECUTED/DEGRADED 都是合法读数
  （DEGRADED 会显式标注"规则式兜底，属诚实降级"）。

## 6. 环境闸门（与 v18 同口径）

- 库必须 `file:` 本地库（turso/libsql → 拒绝）；目标必须 localhost（否则 `--allow-remote-base`）；
- 夹具 `v196_` 前缀，脚本先清旧再种新（可重跑），`--cleanup` 兜底删除（CI `if: always()` 由
  脚本自身结束时清理，异常路径 `--keep` 可保留取证）。
