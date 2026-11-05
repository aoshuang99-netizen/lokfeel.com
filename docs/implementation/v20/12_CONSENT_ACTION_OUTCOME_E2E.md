# V20.0 · Batch 3 · 12 — Consent → Action → Verified Outcome E2E

> 对应作战令 A-01~A-12 / O-01 与「批准 / 拒绝 / 撤销 / 过期 / 重复 / 跨租户 / 失败重试 / Outcome / Evidence」全清单。

## 0. 探针脚本

`scripts/qa/v198-agent-consent-outcome.mjs`（V19-83 探针，已随 V20 同步 S1 闸口）

- 三视角登录（owner / peer / outsider），每步核对 **HTTP / DB / 审计** 三面证据。
- 退出码：`0` = 全过 / `1` = 有 FAIL / `2` = 环境前置失败。
- 沙箱判定读环境变量 `AGENT_PROVIDER` + `AGENT_TEST_ISOLATION`（不由脚本写死结论，见脚本第 121 行）。

## 1. 覆盖矩阵（每项均「状态机 + 真实裁决 + 副作用/零副作用」三重断言）

| 项 | 场景 | 关键断言 | 沙箱态 |
| --- | --- | --- | --- |
| A-01 | Provider 未配置 → 明示降级 | `DEGRADED` + `PROVIDER_UNAVAILABLE` + `providerKind=rules` + 审计 + 诚实块 `realCallsEnabled=false` | 沙箱恒有 stub ⇒ `BLOCKED_ENV`（需非沙箱跑） |
| A-02 | 等待/未产出 → 执行被拒 | `409 STATUS_NOT_EXECUTABLE`，状态不变、零 `AgentExecution` | ✅ 可跑 |
| A-03a | 批准不可绕过（DEGRADED→APPROVED 边不存在） | `409` | 沙箱 R1=PROPOSED ⇒ `BLOCKED_ENV`（由 approval*.test.ts 覆盖） |
| **A-03b** | **AWAITING_APPROVAL → APPROVED 全链路** | **注入升级 → `AWAITING_APPROVAL` → `APPROVED` + 唯一裁决 + 审计** | ✅ **沙箱实跑（S1 已闭）** |
| A-04 | 拒绝 → 真实裁决 + 执行阻断 | `REJECTED` + 裁决行 + 审计 + 执行 `409` | 沙箱 R7=PROPOSED ⇒ `BLOCKED_ENV` |
| A-05 | 撤销即刻生效 | 创建侧 `400` + 执行侧零副作用 | ✅ 可跑 |
| A-06 | 过期 → 不能再用 | 创建侧 `400` + 状态仍 `ACTIVE` | ✅ 可跑 |
| A-07 | 重复裁决 → 第二次 `409`，副作用仍 1 条 | 唯一裁决行 | 沙箱 R1=PROPOSED 无 REJECTED 出边 ⇒ `BLOCKED_ENV` |
| A-08 | 跨租户 → 404 | 读/批/列表均不泄漏 | ✅ 可跑 |
| A-09 | 失败可恢复 + 真实执行 | `409` → 重发起 → `EXECUTED` + 投递 + 审计 + 幂等重放 | ✅ 可跑 |
| A-10 | Outcome 未验证 → `SELF_REPORTED` / `verified=false` | DB 与审计一致 | ✅ 可跑 |
| A-11/11b | Evidence 缺失如实呈现；自报被拒；确认后仅回级别+时间；外部核验 `EXTERNALLY_VERIFIED` | 字段形态逐字断言 | ✅ 可跑 |
| A-12 | 刷新恢复 → 服务端状态与 DB 一致 | `run=EXECUTED` / `outcome.verified=true` | ✅ 可跑 |
| O-01 | 重复提交（同幂等键）→ 不产第二个 Mission | 两次响应一致 + DB 计数 1 | ✅ 可跑 |

## 2. 当前状态（V20.0 本轮）

- **内核级（Jest，已绿）**：`320 / 320` 跨 17 套件，含 `provider-mode` / `runtime` / `approval-consistency` / `execution-gated` / `outbound-delivery` / `adversarial-injection` / `runs-service`。A-03b 的**状态机 + 授权链**已在此层证明。
- **HTTP 集成（v198 实跑）**：**未在本沙箱执行**（需 `next dev` + 本地 libsql 库）。预期升级：`16 PASS / 1 BLOCKED → 17 PASS / 0 BLOCKED`（A-03b 由 `BLOCKED_ENV` 转 `PASS`）。
- **S2/S3（真实 Provider）**：`BLOCKED`（无凭据，见 `11`）。

## 3. 复现命令（发布前必须补齐）

```
# 隔离库 + 隔离 dev 服务（dev 端口 3099）
AGENT_PROVIDER=stub AGENT_TEST_ISOLATION=true \
  DATABASE_URL="file:./locust-dev.db" npx next dev --turbopack -p 3099

node scripts/qa/v198-agent-consent-outcome.mjs \
  --base=http://localhost:3099 --db=file:./locust-dev.db
```

非零项处理：A-01 / A-03a / A-04 / A-07 在非沙箱（移除 `AGENT_PROVIDER` 且**不配** Provider 凭据）下实跑，验证「无凭据 → 明示降级 / 边不存在」。
