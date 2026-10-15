# T10 · Community Bridge —— Slice 1 交付记录（纯内核）

> 计划见同目录 `plan.md` §3（数据模型）/ §4（目录边界）/ §6（切片）。
> 本文件只记录**已交付事实 + 证据 + 诚实修订**。
> 范围：`src/lib/bridge/{types,policy,index}.ts`、`tests/bridge/policy.test.ts`、
> `scripts/check-bridge-invariants.mjs`。
> **不发版**：提交带 `[skip netlify]`，仅在本地与隔离库验证。

## 1. 交付物

| 文件 | 职责 | 关键设计 |
|---|---|---|
| `src/lib/bridge/types.ts`（新） | 取值域与领域类型：`BRIDGE_STATUSES` / `BRIDGE_STATUS_VIEWS` / `BRIDGE_OPT_IN_STATUSES` / `BRIDGE_REFUSAL_CODES` / `BRIDGE_NARROW_REASONS` / `BRIDGE_NARROW_OWNER` / `BRIDGE_ACTIONS` / `BRIDGE_ACTION_REFUSALS` / `BridgeView` / `MemberOptInView` / `BridgeVisibilityPlan` | 🔴 `EXPIRED` **不落库**（派生值，与 T03 `IntentStatusView.EXPIRED` 同一取向）；🔴 **没有** `DRAFT`（创建即视为发起方已批准，留一个永不出现的状态只会制造死状态）；`BRIDGE_NARROW_OWNER` 把「该找谁」**写死在领域层**，不给 UI 各自猜一份的机会 |
| `src/lib/bridge/policy.ts`（新） | **唯一判定处**，全纯函数：`normalizeFieldKeys` / `bridgeUsableReason` / `bridgeStatusView` / `planBridgeTransition` / `planBridgeVisibility` / `planBridgeVisibilityBatch` | 三方交集（① 群主配置 ∩ ② 成员 opt-in ∩ ③ 成员披露档位）；归因取**最上游**被砍的那一环（上游不改，下游怎么改都没用）；`expiresAt` **不可解析一律视为已过期**（fail-closed） |
| `src/lib/bridge/index.ts`（新） | 内核出口 | `export * from './types'` + `./policy` |
| `tests/bridge/policy.test.ts`（新，**34 例**） | 内核全量单测（无 DB、无凭据） | 穷举 2⁴=16 组合的**单调性充要断言**、逐环归因、fail-closed 反向对照、批量与逐个一致 |
| `tests/bridge/schema-drift.test.ts`（新，**17 例**） | schema 漂移守卫（读**真实 .prisma 文本**） | `CommunityBridgeStatus` ↔ `BRIDGE_STATUSES`；`EXPIRED` 在**视图**里、**不在**落库枚举里（两条方向相反的断言同时成立）；`DRAFT` 不存在；`@@unique` 两条；软引用**零**关系 vs 真 FK **恰好两条** |
| `scripts/check-bridge-invariants.mjs`（新） | 门禁 B1–B5 + `--self-test` | 见 §3 |

### 目录边界（本模块最重要的一条约定）

```
src/lib/bridge/   （单数）= 无 IO、无网络的纯内核 —— 受 check-bridge-invariants 的 B1/B2/B3/B4/B5 约束
src/lib/bridges/  （复数）= 允许碰 DB 的服务层 —— 它 import 内核，反之不成立
```

🔴 **目录边界就是执法点**（与 T09 的 `agent` / `agents` 完全同构）。内核无 IO 使两件事
同时成立：① 交集判定可以在**无数据库、无凭据**的情况下被完整单测覆盖；
② 「**不得直接查询对方私有行**」这条 AC-19 铁律在内核里**写不出来**
（`prisma.socialIntent.findMany({ where: { organizationId: 对方 } })` 这种代码根本编译不过，
因为内核 import 不到 db）。把两件事混进一个目录，B1/B2 会**静默**失效。

## 2. 门禁证据（2026-10-15）

| 命令 | 结果 |
|---|---|
| `npx jest tests/bridge` | **2 套 / 51 用例全通过**（内核 34 · schema 漂移 17） |
| `npx tsc --noEmit` | **exit 0** |
| `node scripts/check-bridge-invariants.mjs`（基线） | **exit 0**，扫 3 文件，无 `[B0]` 残留 |
| `node scripts/check-bridge-invariants.mjs --self-test` | **exit 0**：B1–B5 **五条变异全部被捕获**（各 `exit=1` 且命中对应 `[Bn]`）；合法文件**未误报**且确实被扫到；临时文件清理后复验 exit 0 |

## 3. 门禁 B1–B5（文本级保证，**不**等于运行时不越权）

| 规则 | 内容 | 为什么 |
|---|---|---|
| B1 | 内核不得 import `@/lib/tenancy` | 授权不属于内核（同 T09 的 A1） |
| B2 | 内核不得 import `@/lib/db` / `@/lib/prisma` / `@prisma/*` | 内核无 IO（同 A2）——**这条同时是「不得直接查询对方私有行」的第一道结构性保证** |
| B3 | 不得 `dangerouslySetInnerHTML` / `eval` | 同 A3 |
| B4 | 不得 `setTimeout` / `setInterval` | 同 A4：防止"用定时器伪造生效" |
| B5 | 不得出现网络调用 | 同 A5 |

> **诚实声明**：门禁是**文本级**的。它保证的是"内核里**写不出**直查对方行的代码"，
> **不是**"运行时绝不会越权"。运行时的保证来自三方交集判定本身，
> 以及 **Slice 4** 的 E2E 反向对照（未 opt-in 不可见 / `PENDING` 不可见 / 收窄后不可见 /
> revoke 后立即不可见 / 越权读取失败）。

### `--self-test` 的自证方式（为什么它比"跑一遍是绿的"更有价值）

自证脚本在**被扫描目录内**注入单条违反 → 断言 `exit 1` **且**命中对应的 `[Bn]` 标记
→ 再写一份**合法**文件做负向对照（断言它不被误报）→ 清理后复验 `exit 0`。
只跑基线的话，"门禁绿"既可能是规则生效，也可能是**规则根本没扫到文件**
（本仓已有先例：`grep` 的假阴性与 `PRAGMA table_info` 返回空集）。

## 4. 🔴 未覆盖 / 诚实声明

1. **跨群介绍的执行**：本切片只让双方"可见"。**真正发起跨群介绍**复用 T05 的 proposal 流程
   —— 若 T05 的 proposal 模型假设同租户而无法直接复用，将降级为**仅可见 + 手动联系**，
   并在 Slice 4 文档中显式标注（plan.md §8.1）。
2. **`shareableMissionKinds` 是自由文本**：任务类型尚未收敛成枚举，因此只在服务层做
   **长度与非空**校验，并显式拒绝 `'*'`（`'*'` 恰好是"无范围限制"的同义词）
   —— 校验在 Slice 2 的 `requireMissionKinds()`。
3. **按用户取单条意图（而非并集）**：一名用户在对方组织里可能有多条意图。
   Slice 2 的 `loadDisclosureBasis()` **取最新创建的一条**，理由是"取单条 = 相对并集更保守，
   且规则唯一、可解释、无任意排序"。这是一个**刻意的保守选择**（plan.md §8）。
4. **跨境合规文本**不在代码范围（plan.md §8.4），标注为 T12 的风险项。
