# 05 · Agent → Consent → Action → Outcome（Batch 4）

> 结论先行：**成果核验的正例阶梯 15/15 全过**（`SELF_REPORTED → COUNTERPARTY_CONFIRMED →
> EXTERNALLY_VERIFIED`），且"不得仅凭自述标为已验证"被拆成**四条可失败的负例**逐条打穿：
> 请求体塞 `verificationLevel` 无效、summary 写满"已验证"无效、上报者不能自己确认、
> 管理员不能冒充当事方"确认"（只能"核验"）。
>
> 同时必须说清一条**没做成的事**：`v198-agent-consent-outcome.mjs`（A01–A12，覆盖
> Agent 执行/审批/降级/跨租户的**完整 HTTP 链**）本轮**没有跑** —— 它按设计拒绝远程库，
> 需要一个本地 file 库 + `next dev` + stub provider 的隔离环境。本轮的链路证据来自
> **231 条 Agent 集成测试**，不是端到端。两者的差别写在 §4，不混为一谈。

---

## 0. 基线与口径

| 项 | 值 |
| --- | --- |
| 代码 SHA | `ee24dfb`（Batch 3 提交）+ 本轮改动（见 §6） |
| 运行形态 | `next build` 产物 + `next start -p 3111`（生产构建） |
| 数据库 | 生产 Turso（夹具 `v205b4_*`，**跑完即删**，含审计与通知行） |
| 脚本 | `scripts/qa/v205-outcome-verify.mjs` → `npm run verify:outcome:verify` |
| 原始日志 | `evidence/2026-11-07_outcome-verify_local.log` |

```
$ node scripts/qa/v205-outcome-verify.mjs --base=http://localhost:3111
15 PASS / 0 FAIL / 0 SKIP / 0 NOT_TESTED
```

---

## 1. 为什么正例路径值得单独立一条线

`v198` 里关于成果只有两条：A-10「未验证 → `SELF_REPORTED`」与 A-11「对手方确认」。
也就是说 —— **从来没有任何一条断言走过 `EXTERNALLY_VERIFIED`**。

这很危险，因为 AC-15 是一个**方向性**的约束："自报不算验证成功"。
只测下限（确实停在 SELF_REPORTED）而不测上限（确实能升到 EXTERNALLY_VERIFIED），
最坏的结果是把功能做成**永远无法验证**——而所有断言仍然是绿的。
一个"永远停在自报"的成果系统，和"自报即验证"的系统一样没用，只是失败方向相反。

所以这一轮测的是**阶梯本身**：能不能一级一级往上走，每一级由谁触发、留下什么记录、
重复触发是否幂等、跨租户是否越界。

---

## 2. 15 条断言

| ID | 断言 | 判据 | 结果 | 证据 |
| --- | --- | --- | --- | --- |
| P01 | 自报 → 201 / 仅自报 | `verificationLevel=SELF_REPORTED` + `verified=false` | PASS | `status=201 level=SELF_REPORTED verified=false` |
| P02 | 列表口径分离 | `?verified=1` **不含**它；`unverifiedCount ≥ 1` | PASS | `含它=false 全量含它=true unverifiedCount=1` |
| P03 | 请求体指定级别**被忽略** | 传 `verificationLevel=EXTERNALLY_VERIFIED` → DB 仍 `SELF_REPORTED`，核验记录 **0** 条 | PASS | `DB=SELF_REPORTED 核验记录=0` |
| P04 | 自述文本**不参与派生** | summary 写满「已验证 / EXTERNALLY_VERIFIED」→ 级别不变 | PASS | `level=SELF_REPORTED verified=false` |
| P05 | 上报者不能确认自己 | 400（不是"能确认"） | PASS | `status=400 code=VALIDATION_ERROR` |
| P06 | 非当事方不能"确认" | ADMIN 但既非 reporter 也非 counterparty → 403 | PASS | `status=403 code=PERMISSION_DENIED` |
| P07 | 对手方确认 → 升级 | `COUNTERPARTY_CONFIRMED` + `verified=true` + `created=true` | PASS | `level=COUNTERPARTY_CONFIRMED verified=true` |
| P08 | 重复确认幂等 | `created=false` 且记录数仍 **1** | PASS | `第二次 created=false，记录=1 条` |
| P09 | 外部核验（**正例**） | `EXTERNALLY_VERIFIED` + `verified=true` | PASS | `status=200 level=EXTERNALLY_VERIFIED` |
| P10 | 证据落库但**不外发** | DB 有 evidence；响应体无 evidence 字段、无证据内容 | PASS | `DB 有 evidence（94 字符）；响应体出现 evidence 字段=false` |
| P11 | 重复核验幂等 | `created=false` 且记录数仍 1 | PASS | `EXTERNALLY_VERIFIED 记录=1 条` |
| P12 | 跨租户核验 → 404 | 另一租户 ADMIN 核验本租户成果 | PASS | `status=404 code=NOT_FOUND` |
| P13 | 审计三类事件齐备 | `reported` / `confirmed` / `externally_verified` 各 ≥1 | PASS | `{"outcome.confirmed":1,"outcome.externally_verified":1,"outcome.reported":1}` |
| P14 | 快照 == 记录集派生值 | `Outcome.verificationLevel` 与 `deriveVerificationLevel()` 一致 | PASS | `派生=EXTERNALLY_VERIFIED；快照=EXTERNALLY_VERIFIED` |
| P15 | 级别只前进 | 再上报一次 → 409，级别不回退 | PASS | `重复上报=409，级别仍=EXTERNALLY_VERIFIED` |

### 2.1 这四条负例才是"不得仅凭自述"的真正落点

| 想蒙混的方式 | 被谁挡住 | 断言 |
| --- | --- | --- |
| 客户端在请求体里直接写 `verificationLevel` / `level` | 服务层**根本不读**这两个字段（DTO 里没有、写入时也不取） | P03 |
| 把"已验证"写进正文，指望展示层/统计层读文本 | 级别只由 `OutcomeVerification` 记录集派生 | P04 |
| 自己给自己盖章 | `role === 'REPORTER'` → 400 | P05 |
| 换个有 `outcome.verify` 能力的管理员冒充"当事方确认" | 确认要求 `COUNTERPARTY`，否则 403；管理员只能走"核验"（另一种事件、另一个级别） | P06 |

P06 值得单独说一句：**"确认"与"核验"是两条不同的路径**，不是一个接口的两种称呼。
前者要求你是当事方，后者要求你有 `outcome.verify`（ADMIN+）。把两者合并，
就等于允许运营替当事人说"这事真的发生了" —— 那会直接毁掉"对手方确认"的意义。

---

## 3. 判据写错的一条（留档）

首跑 **14 PASS / 1 FAIL**，红的是 P13：

```
✗ P13 审计={"outcome.confirmed":1,"outcome.externally_verified":1,"outcome.reported":1}
```

我用直觉写了 `outcome.verified`，而真实事件名是 **`outcome.externally_verified`**。
事件名是产品契约的一部分（会进审计检索与告警规则），不能凭手感写。
改成同时断三个真实事件后转绿 —— 这不是"放宽断言"，而是把猜的名字换成代码里的名字
（`src/lib/outcome/outcomes.ts` 的 `eventType`）。

同一个毛病在这一轮出现了两次（Batch 3 的 `member.invite` 那次也是）：
**凡是我"觉得应该是"的标识符，都必须回代码里核一遍再写进断言。**

---

## 4. Agent → Consent → Action 这一段：测了什么、没测什么

### 4.1 已测（真实、可复跑）

`npx jest tests/agents` → **231 passed / 231**（12 个套件），其中与本段直接相关的是：

| 套件 | 承载的约束 |
| --- | --- |
| `execution-gated.test.ts` | 未批准不得执行；批准与执行是两次判定（纵深防御） |
| `outbound-delivery.test.ts` | 撤销 / 过期 / 范围收窄在**执行侧**二次校验（"双方同意"到"真正出街"之间提案可能失效） |
| `approval-consistency.test.ts` | 批准状态机一致性，不可绕过 `AWAITING_APPROVAL` |
| `adversarial-injection.test.ts` | 注入文本不得把"待批准"降级成"可执行" |
| `budget.test.ts` / `org-quota.test.ts` | 额度在**调用前**判定，失败也入账 |
| `provider-mode.test.ts` / `connectivity.test.ts` | Provider 未配置时**明示降级**，不伪装成功 |

这些是**逻辑层**的证据（真实代码路径 + 内存/伪造 DB），足以证明"闸门存在且生效"，
但**不等于**"整条 HTTP 链路今天在线上走得通"。

### 4.2 没测（`NOT_TESTED`，并给出去跑的方法）

| 项 | 状态 | 原因 | 怎么补 |
| --- | --- | --- | --- |
| 完整 HTTP 链 A01–A12 / O-01 | `NOT_TESTED` | `v198-agent-consent-outcome.mjs` **按设计拒绝远程库**（`if (!DB_ARG \|\| DB_ARG.includes('libsql://')) process.exit(2)`），需要「本地 file 库 + `next dev`（生产模式下守卫会抛错）+ `AGENT_PROVIDER=stub` + `AGENT_TEST_ISOLATION=true`」四件套 | 见下方命令 |

```bash
npx prisma db push --url="file:./.tmp-b4.sqlite" --accept-data-loss
DATABASE_URL="file:./.tmp-b4.sqlite" AGENT_PROVIDER=stub AGENT_TEST_ISOLATION=true \
  npx next dev -p 3122
# 另一个终端：
node scripts/qa/v198-agent-consent-outcome.mjs --base=http://localhost:3122 --db=./.tmp-b4.sqlite
```

本轮**没有**把它跑完，是因为还需要 `seed-t02-e2e.mjs` 先播种 `v198_org` / `v198_user`
（v198 只自建 peer 与 outsider 两个账号），串起来是三步环境前置。
时间花在这里的收益低于先把 Batch 5/6/7 的证据补齐 —— 所以如实记 `NOT_TESTED`，
并把命令写进文档，任何人 10 分钟内可以复现。

> 上一次完整绿的是 V19.8 的跑批（16 PASS / 1 `BLOCKED_ENV`）。它**不能**当作本轮证据：
> 那之后 `resolve.ts`（`resolveActiveTenant`）、`api-response.ts`（details 透传）、
> `tx.ts`（事务预算）都改过，跨版本引用旧跑批正是"看起来做完了"的典型形态。

---

## 5. 与 Batch 1/3 的交叉验证（同一个成果系统，三条独立证据）

| 视角 | 证据 | 说明 |
| --- | --- | --- |
| 能力矩阵 | `S19/S20`（Batch 3） | 降级后 `outcome.read/report` 保留、`outcome.verify` 本就只给 ADMIN+ |
| 核验阶梯 | 本文件 P01–P15 | 三级派生、幂等、跨租户 |
| 审计 | P13 | `reported/confirmed/externally_verified` 三类事件都真的落库 |

三条不冲突，也不互相"代证"：能力矩阵管"能不能点"，阶梯管"点了会发生什么"，
审计管"事后能不能查"。

---

## 6. 提交与残留

| 类型 | 文件 |
| --- | --- |
| 新增（验证） | `scripts/qa/v205-outcome-verify.mjs`（P01–P15） |
| 新增（证据） | `evidence/2026-11-07_outcome-verify_local.log` |
| npm | `verify:outcome:verify` |

无 prisma 变更 ⇒ 不需要迁移。

**残留**

| ID | 项 | 状态 | 说明 |
| --- | --- | --- | --- |
| B-1 | 完整 HTTP 链 A01–A12 | `NOT_TESTED` | 需本地隔离环境（§4.2 有命令） |
| B-2 | 真实 Provider 产出（非 stub/非降级） | 未在本轮覆盖 | 生产 `verify:agent:connectivity:server` 覆盖连通性，不覆盖"产出质量" |
| B-3 | 成果"外部证据"的真伪 | 结构上无法判定 | 系统只保证"谁在什么时候以什么级别核验过"，不保证证据本身真实 —— 这是人审的边界，不该伪装成技术能力 |
