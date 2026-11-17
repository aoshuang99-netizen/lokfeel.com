# V25.3 · T05（V25-11/12/15/16）关系与记忆私密域 — 策略层证据与边界

**状态：CODE_COMPLETE → LOCAL_TESTED（策略层）；存储/迁移层未实现。** 不声称产品记忆功能上线。

## 1. 交付内容

新增纯逻辑策略引擎 `src/lib/memory/domain-policy.ts`（零 IO、零 Prisma，与 `lib/tenancy/capabilities.ts` 同构：查表+比较，不让 LLM 做权限判决）：

- 五域严格分离：`personal / dyad / group / organization / research`；
- 三种来源分离：`USER_STATED / MUTUAL_CONFIRMED / MODEL_INFERRED`（"用户说过 / 双方确认 / 模型推断"）；
- 五种操作：`read / write / infer / search / delete`；
- 三种权限状态：`valid / invalid / revoked`；
- 撤销优先：revoked 状态下 read/infer/search 恒拒绝（"撤回后下一次推理/搜索不得使用已撤回数据"）。

## 2. 硬负例（spec 点名，均已测）

| 负例 | 结果 |
|------|------|
| 组织管理员读个人 Vault | DENY `ORG_ADMIN_NO_PERSONAL` |
| 撤销后下一次推理使用已撤回数据 | DENY `REVOKED` |
| 撤销后下一次搜索使用已撤回数据 | DENY `REVOKED` |
| research 默认不贡献（无 opt-in） | DENY `RESEARCH_OPT_IN_REQUIRED` |
| 模型推断当作"用户说过"事实读取 | DENY `INFERRED_NOT_FACT` |
| 跨域读取（dyad 记录被群成员读） | DENY `CROSS_DOMAIN` |
| 本人对 personal Vault 完全控制 | ALLOW `OWNER`（含 delete） |
| 撤销态下本人仍可删除自己的副本 | ALLOW；但 infer DENY |

## 3. 验证

- `tests/memory/domain-policy.test.ts`：**86 tests PASS** = 75 条参数化矩阵（5 域 × 5 操作 × 3 状态）+ 11 条硬负例/正控。
  - 正控存在（valid+正确成员身份可放行），避免"全拒绝"假绿。
- 定向 eslint / 全量 `tsc --noEmit`：EXIT 0。
- 全量 Jest：166 suites / 3061 tests PASS。

## 4. 改动文件与 SHA256

| 文件 | SHA256 |
|------|--------|
| src/lib/memory/domain-policy.ts | `08f23ea517dbd7adf2fae3133da3d10db218c5078e31a923359e39ffa28c5f96` |
| tests/memory/domain-policy.test.ts | `ab27a23f67c36f6b2497797978196ca4ed4ca107a590880220eb191dc6ee1d87` |

## 5. 诚实边界 / 未闭合（如实）

- **这是策略层，不是完整记忆系统**：本轮未新增 Prisma 表、未做 KMS/SOPS 密钥管理、未做备份/恢复、未接 RAG 搜索。T05 的"独立五域记忆"要成为用户可见能力，仍需：schema 迁移（先迁移后发版）、写入路径接入本判决、检索/推理路径接入本判决、以及 5 主体 × 5 操作 × 3 状态在**真实存储**上的集成测试（而非纯函数）。
- **训练撤回**：无法保证从既有模型权重中立即移除 —— spec 已要求如实说明，本策略引擎只保证"推理/检索时不再使用已撤回数据"，不涉及权重级遗忘。
- **未独立复核**：实施者自测，无独立 Reviewer ⇒ 非 `INDEPENDENT_VERIFIED`。
