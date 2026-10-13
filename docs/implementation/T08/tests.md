# T08 · tests — 测试与证据

> 基线 `95da9f1`。本文记**能复跑**的命令与判据。Slice 1 的全部测试都是**离线**的
> （mock Prisma），不需要数据库、不需要网络 —— 因此可在任何环境下复现。

---

## 1. 测试套件

| 文件 | 用例 | 覆盖 |
|---|---|---|
| `tests/outcome/verification.test.ts` | 22 | 纯函数内核：级别顺序 / `isVerified` 负向 / 派生穷举 3×3×3 / 未知值解析 / 角色判定 |
| `tests/outcome/outcomes.test.ts` | 22 | 服务层：前置与权限 / 自报不算验证 / 自我确认拒绝 / 幂等 / 阶段机接线 / 隐私边界 |
| `tests/outcome/outcomes-api.test.ts` | 15 | HTTP 层：401/403/400/201/200/500 全谱系 + 能力边界负向 |
| `tests/outcome/metrics.test.ts` | 19 | **指标内核**（Slice 2）：舍入确定性 / 分母为 0 / 四段比率分母正确 / 假设可注入的**变异自证** / `verifiedLevels` 不含 `SELF_REPORTED` |
| `tests/outcome/metrics-api.test.ts` | 15 | **指标端点**（Slice 2）：全员可读 / 8 条 count 全带 `organizationId` / 已介绍按 `introducedAt` 判 / 验证级别**下推** / 响应无 userId 泄漏 |
| **合计** | **93** | 5 套 |

---

## 2. 复跑命令

```bash
# 只跑 T08（离线，秒级）
npx jest tests/outcome

# 只看汇总
npx jest tests/outcome 2>&1 | grep -E '^(Tests|Test Suites):'
```

### 2.1 AC-16 的 SQL 对账（**需要数据库**，本地隔离库即可）

```bash
DB=/tmp/t08-metrics.db

# ① 建隔离库（按当前 schema 生成 DDL，含 C4 的 Outcome/OutcomeVerification）
E2E_DB_FILE=$DB E2E_DDL_FILE=/tmp/t08-metrics-ddl.sql \
  node scripts/qa/seed-t02-e2e.mjs --reset --regenerate

# ② 播种计数**完全已知**的夹具（含 REVOKED / SUCCEEDED / 第二条 Mission 的噪声行）
E2E_DB_FILE=$DB node scripts/qa/seed-t08-metrics.mjs

# ③ 产出"API 会下发的数字"（直调路由所用的同一服务函数）
METRICS_ORG_ID=org_e2e DATABASE_URL=file:$DB \
  npx tsx scripts/qa/emit-outcome-metrics.mts > /tmp/t08-api-all.json

# ④ 用原始表 SQL 独立复算并逐字段比对 → exit 0 = 一致
METRICS_ORG_ID=org_e2e DATABASE_URL=file:$DB \
  node scripts/qa/outcome-reconcile.mjs --api=/tmp/t08-api-all.json

# ⑤ 任务内收窄（证明 missionId 过滤真的生效，而不是"把表里所有行数了一遍"）
METRICS_ORG_ID=org_e2e METRICS_MISSION_ID=mission_t08_metrics DATABASE_URL=file:$DB \
  npx tsx scripts/qa/emit-outcome-metrics.mts > /tmp/t08-api-mission.json
METRICS_ORG_ID=org_e2e DATABASE_URL=file:$DB \
  node scripts/qa/outcome-reconcile.mjs --api=/tmp/t08-api-mission.json --mission-id=mission_t08_metrics
```

`npm run metrics:seed` / `metrics:emit` / `metrics:reconcile` 是上面三条的别名
（需自行给 `E2E_DB_FILE` / `DATABASE_URL` / `METRICS_ORG_ID` 环境变量）。

**实测结果（2026-10-13）**

| 场景 | 结果 |
|---|---|
| 全租户（`org_e2e`） | **14 通过 / 0 不一致**，exit 0（提案 9 / 待表态 3 / 同意 5 / 已介绍 4 / 成果 4 / 已验证 2 / 接管 1 / 死信 2；成本 3580 分） |
| 任务内（`mission_t08_metrics`） | **14 通过 / 0 不一致**，exit 0（7 / 2 / 4 / 3 / 3 / 1；成本 2640 分） |
| 🔴 **变异自证**（把 `funnel.proposals` 改成 999、把 `introduction` 单价改成 1） | **exit 1**，报出 4 处不一致，且 SQL 侧用**被篡改的假设**算出 1143 分 ≠ API 的 2640 分 —— 证明脚本真的在读响应里的假设，而不是自带常量 |
| 负向：`basis.verifiedLevels` 里塞进 `SELF_REPORTED` | **exit 1**，在"载荷自洽性"一步就拦下并停止 |
| 负向：不给 `--api` | **exit 1**，给出可操作的报错 |

---

## 3. AC ↔ 测试对照

| AC | 判据 | 钉住它的用例 |
|---|---|---|
| **AC-15** | 自报**不算**验证成功 | `verification.test.ts` › `isVerified('SELF_REPORTED') === false`；`VERIFIED_LEVELS` 不含 `SELF_REPORTED`；`outcomes.test.ts` › 上报后 `dto.verified === false`；**请求体塞 `verificationLevel` 无效** |
| **AC-15** | 自报与双方确认**分开** | `deriveVerificationLevel` 穷举（空集 → `SELF_REPORTED`）；confirm 后级别前进到 `COUNTERPARTY_CONFIRMED` |
| **AC-15** | 不把"系统猜测"计为已验证 | `outcomes.test.ts` › 上报只推进到 `ACTION_COMPLETED`，**不**直接落终态；**没有任何**自动置位的代码路径 |
| **AC-15** | 不得自我确认 | `confirmOutcome` › 上报人 → **400**；第三方 → **403**（API 层同样两条） |
| 能力边界 | `outcome.verify` 仅 ADMIN+ | `outcomes-api.test.ts` › **`OPERATOR → 403` 且不触碰 DB**（负向断言，防被放松） |
| 租户隔离 | 谓词不可省 | `outcomes.test.ts` › `listOutcomes` 的 `where.organizationId === ORG`；`confirm/verify` 用 `findFirst({ id, organizationId })` |
| 隐私边界 | DTO 不含 userId | `outcomes.test.ts` › `expect(dto).not.toHaveProperty('reporterId')` + 序列化全文不含 userId |
| 幂等 | 重复确认不报错、不重复写 | `outcomes.test.ts` › `created: false` + `verifCreate` 未被调用 + 阶段不再推进 |
| **AC-16** | 指标**可复算** | `scripts/qa/outcome-reconcile.mjs` 用**原始表 SQL** 独立算出全部 14 个可比字段并与 API 一致（exit 0）；**变异自证**：篡改任一数字 → exit 1 |
| **AC-16** | 指标是输入计数的**确定性函数** | `metrics.test.ts` › 同输入两次调用 `toEqual`；`round1/round2/percent` 的边界与舍入 |
| **AC-16** | 假设**真的被用上**（不是写死的摆设） | `metrics.test.ts` › 换 `minutesPerIntervention`/`unitCostsCents` 必须让工时与成本跟着变 |
| **AC-16** | 分母为 0 不产生 `NaN` | `metrics.test.ts` › 全 0 输入 → 四段比率全 0；`percent(5, 0) === 0` |
| **AC-16 / AC-15** | 指标里的"已验证"用同一判据 | `metrics.test.ts` › `basis.verifiedLevels` 不含 `SELF_REPORTED`；`metrics-api.test.ts` › `outcome.count` 的 where 是 `{ in: [...VERIFIED_LEVELS] }` |

---

## 4. 六条"负向判据"（本文件的重点）

测试里最有价值的不是"成功路径能跑通"，而是**下面六条"改了就会红"的护栏**：

1. **`isVerified('SELF_REPORTED') === false`** —— 这一条是 AC-15 的**定义本身**。
   若有人为了"让指标好看"把它改成 `true`，指标会立刻变绿，而 AC-15 已死。
2. **`OPERATOR → 403` 且 `outcomeFindFirst` 未被调用** —— 防 `outcome.verify` 被
   "顺手"加进 `SELF_SERVICE` 或 `OPERATOR_EXTRA`。同时断言**先拒绝再查**，
   避免"查了但没写"造成"其实放行过"的错觉。
3. **`where.verificationLevel` 等于 `{ in: [...VERIFIED_LEVELS] }`** —— 防
   `verifiedOnly` 过滤被写成硬编码字面量（那会在新增第四级时静默漏算）。
4. 🔴 **对账脚本的"变异自证"**（Slice 2）—— 篡改 API 载荷里的任一数字，
   对账必须 `exit 1`。没有这一条，"对账通过"可能只是**两边都空转**
   （例如脚本读错了字段名 → 两边都是 `undefined` → `Object.is` 相等）。
5. 🔴 **`basis.verifiedLevels` 不含 `SELF_REPORTED`**（Slice 2）—— 若有人把
   `SELF_REPORTED` 混进"已验证"，指标里的"已验证成果数"会立刻虚高，
   而 **AC-15 已死**。对账脚本在"载荷自洽性"一步就拦下。
6. 🔴 **8 条 `count()` 全带 `organizationId`**（Slice 2）—— 指标是**聚合**，
   漏一处谓词就是"跨租户把别人的数算进我的报表"，而且**看起来完全正常**。

---

## 5. 尚未覆盖（诚实列出）

| 项 | 为什么没有 | 何时补 |
|---|---|---|
| E2E（Playwright）覆盖成果屏 | Slice 1 的目标是 AC-15 的服务端判据与界面可达；E2E 需要先把七屏收紧（AC-18 的 Slice 4） | T07 Slice 4 / T08 Slice 4 |
| ~~AC-16（指标可复算）~~ | ✅ **Slice 2 已落地**：内核 + 端点 + `outcome-reconcile.mjs` 对账（全租户 / 任务内 / 变异自证均已实跑） | 已完成 |
| 真实数据库上的迁移验证 | 本切片**不动生产**（带跳过标记），C4 只在 `plan` 阶段预览过 SQL | **发版时**按 `probe → plan → apply C4 → verify → 发布提交` 顺序做 |
| 指标屏（把数字画出来） | Slice 2 只做**数据面**（端点 + 对账）；界面与 E2E 属 Slice 4 | T08 Slice 4 |
| AC-21（账单一致性） | 属 Slice 3；且真实扣款部分**永久 BLOCKED**（无 Creem 凭据） | Slice 3（沙箱部分） |
| 成果屏的视觉回归 | 项目无视觉回归设施 | — |

---

## 6. AC-16 / AC-21 的证据形式

`plan.md` §7 定的形式，以及**目前落地到哪一步**：

- **AC-16「可复算」** = 一条 SQL 对账脚本，用**原始表**独立算出与 API 相同的数字，
  `exit 0` 表示一致。**不接受**"人工核对过"这种证据。
  → ✅ **已落地**：`scripts/qa/outcome-reconcile.mjs`（14 项比对 + 变异自证）。
- **AC-21「状态一致」** = 事件溯源 + **非法迁移被拒**的用例（例如
  `REFUNDED → SUCCEEDED` 必须失败），以及用量复算。
  真实扣款/退款 = `BLOCKED`，**不得**用沙箱用例冒充。
