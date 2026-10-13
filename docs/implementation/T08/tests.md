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
| **合计** | **59** | 3 套 |

---

## 2. 复跑命令

```bash
# 只跑 T08（离线，秒级）
npx jest tests/outcome

# 只看汇总
npx jest tests/outcome 2>&1 | grep -E '^(Tests|Test Suites):'
```

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

---

## 4. 三条"负向判据"（本文件的重点）

测试里最有价值的不是"成功路径能跑通"，而是**下面三条"改了就会红"的护栏**：

1. **`isVerified('SELF_REPORTED') === false`** —— 这一条是 AC-15 的**定义本身**。
   若有人为了"让指标好看"把它改成 `true`，指标会立刻变绿，而 AC-15 已死。
2. **`OPERATOR → 403` 且 `outcomeFindFirst` 未被调用** —— 防 `outcome.verify` 被
   "顺手"加进 `SELF_SERVICE` 或 `OPERATOR_EXTRA`。同时断言**先拒绝再查**，
   避免"查了但没写"造成"其实放行过"的错觉。
3. **`where.verificationLevel` 等于 `{ in: [...VERIFIED_LEVELS] }`** —— 防
   `verifiedOnly` 过滤被写成硬编码字面量（那会在新增第四级时静默漏算）。

---

## 5. 尚未覆盖（诚实列出）

| 项 | 为什么没有 | 何时补 |
|---|---|---|
| E2E（Playwright）覆盖成果屏 | Slice 1 的目标是 AC-15 的服务端判据与界面可达；E2E 需要先把七屏收紧（AC-18 的 Slice 4） | T07 Slice 4 / T08 Slice 4 |
| 真实数据库上的迁移验证 | 本切片**不动生产**（带跳过标记），C4 只在 `plan` 阶段预览过 SQL | **发版时**按 `probe → plan → apply C4 → verify → 发布提交` 顺序做 |
| AC-16（指标可复算） | 属 Slice 2，需要 `outcome-reconcile.mjs` 对账脚本 | Slice 2 |
| AC-21（账单一致性） | 属 Slice 3；且真实扣款部分**永久 BLOCKED**（无 Creem 凭据） | Slice 3（沙箱部分） |
| 成果屏的视觉回归 | 项目无视觉回归设施 | — |

---

## 6. 与 AC-16/21 的接口（为后续切片预留的判据形状）

Slice 2/3 的证据形式在 `plan.md` §7 已定：

- **AC-16「可复算」** = 一条 SQL 对账脚本，用**原始表**独立算出与 API 相同的数字，
  `exit 0` 表示一致。**不接受**"人工核对过"这种证据。
- **AC-21「状态一致」** = 事件溯源 + **非法迁移被拒**的用例（例如
  `REFUNDED → SUCCEEDED` 必须失败），以及用量复算。
  真实扣款/退款 = `BLOCKED`，**不得**用沙箱用例冒充。
