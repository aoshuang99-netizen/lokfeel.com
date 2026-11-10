# 05 · 账本与安全评审（R-15 修复 / R-14 处置 / Dodo 事件矩阵）

> 范围：2026-11-10 总令 §8.1/§8.2 的账本一致性与 webhook 部分。环境：候选代码（见 RELEASE_STATUS §2）。

## 1. R-15（发布阻断）：失败吞成功 —— 已修复

**缺陷**：`CHARGE_FAILED` 与 `CHARGE_SUCCEEDED` 曾共用 `dodo:charge-settled:${paymentId}`。同 id 先失败后成功时，成功事件两条命令键均被占用 → 全被判 `replayed` 静默跳过 → **账本停在 FAILED，钱已收，且无告警**。探针实测确认（`scripts/qa/_probe-charge-settle-key.ts`，修复前输出"重叠的 dedupeKey=[created, settled]"）。

**修复设计（不止加后缀，三段合成一条不破坏链路）**：

1. **分态键**：`dodo:charge-settled:${paymentId}:succeeded` / `:failed` —— 失败不再吞成功。
2. **内核终态语义（既有设计，本轮补测钉死）**：`CHARGE_TRANSITIONS.FAILED = []` 不变——"失败不可改判成功，重试必须新 payment_id ⇒ 新款项"。"失败后同 id 成功"分态后由内核**显式拒绝**（`ILLEGAL_TRANSITION`），`appendBillingEvent` 校验失败不写库。
3. **显式隔离**：webhook 路由既有 catch 把内核拒绝转为 `200 + deferred + LEDGER REJECT console.error`（Dodo 不重投循环，人能看到）。

**不变量对照（总令 §8.1 逐条）**：

| 总令要求 | 落点 | 证据 |
|---|---|---|
| 同一经济交易最多记一笔成功 | `charge-settled:${id}:succeeded` 唯一 + 内核拒绝重复终态 | subscription 负控「FAILED 重复结算 ⇒ 拒绝」 |
| 失败不能吞掉后续合法成功 | 分态键 | dodo-events「失败不得吞成功」 |
| 旧失败不能把成功回退 | `SUCCEEDED: ['REFUNDED']` | 负控「先 SUCCEEDED 后 FAILED ⇒ 拒绝」 |
| 单纯后到事件不得覆盖已确认成功 | 同上 + 幂等键 `:succeeded` 唯一 | 同上 |
| 重放不重复开通/记账 | `sub-start`/`charge-created` 键不变 | 既有成对幂等测试（R-14 正向） |
| 正确形态：失败后换新 id 成功 ⇒ 合法入账 | 对偶正例测试 | subscription 负控组第 5 例 |

**历史数据**：生产库当前 0 条真实支付事件（真实扣款从未发生），**无受影响记录需要扫描/补偿**。若未来发现旧键格式记录，迁移原则：不清空重跑，按事件时间戳逐条补写分态键并保留原行。

## 2. R-14：renewed 与 payment.succeeded 的关联 —— 假设显式化（非代码缺陷）

- **Dodo 官方语义**（其文档明说）：两事件**成对到达**，`payment.succeeded` 可能晚 2–10 分钟。
- **代码假设**：两者携带**同一 payment_id**。同 id ⇒ 键完全相同 ⇒ 后到者 replayed（正确，同一笔钱不双记）。已有正向测试钉住。
- **异 id 情形**：若真实投递中发现两事件 id 不同，会记两笔——但按总令"缺少关联事实时隔离对账，禁止猜测关联"，不同 id 在无账期字段佐证时**就是两笔独立交易**的正确处理。验证义务移交**真实投递观察**：首笔真实续费后核对账本 `CHARGE_SUCCEEDED` 笔数 == Dodo 收款笔数（写入 07 矩阵 R-14 行）。

## 3. Dodo 事件矩阵（总令 §8.2 要求产出）

代码支持 13 类事件（`events.ts` switch）；生产端点当前显式订阅 9 类（实测 `GET /webhooks`）。

| 事件 | 端点已订阅 | 代码处理 | 业务动作 | 不处理/未订阅理由 | 重放行为 |
|---|---|---|---|---|---|
| payment.succeeded | ✓ | apply | 首单补开通→建款→成功；续费建款→成功 | — | 全 replayed（键含 payment_id） |
| payment.failed | ✓ | apply | 建款→失败（reason 必填） | — | 全 replayed |
| subscription.active | ✓ | apply | 未开通→STARTED；已开通→PLAN_CHANGED | — | replayed |
| subscription.renewed | ✓ | apply | 建款→成功（与 payment.succeeded 同键） | — | 后到者 replayed |
| subscription.plan_changed | ✓ | apply | PLAN_CHANGED | — | replayed |
| subscription.cancelled | ✓ | apply | SUBSCRIPTION_CANCELED | — | replayed |
| subscription.expired | ✓ | apply | SUBSCRIPTION_CANCELED（原因=到期） | — | replayed |
| subscription.on_hold / past_due | ✓ | apply | 账本不动（订阅状态机无对应迁移），翻译为 ignore | 原因见 events.ts 注释 | 幂等 |
| subscription.updated / paused / unpaused / update_payment_method / failed | ✗ 未订阅 | 代码侧 ignore | 无 | **待评审项 R-04**：若 Dodo 用 updated 表达降级/暂停，状态会漏更新；补订需真实投递确认语义后再做 | — |

## 4. 仍未验证（诚实边界）

- **Webhook 密钥一致性 `NOT_TESTED`**（自签自验不构成证据；`GET /webhooks` 不返回 secret；无 test API）——需官方沙箱真实投递（待 D4）。
- **真实扣款→开通闭环 `NOT_TESTED`**——需 D5 授权。
- 端点 URL/9 事件/未禁用：实测 PASS（`https://app.lokfeel.com/api/webhooks/dodo`）。
