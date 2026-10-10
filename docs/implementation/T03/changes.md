# T03 · changes — 变更记录

> 基线 commit `c0904e6`（T02 文档收尾，`main`）。
> 任务：建立成员意图/Offer/字段披露模型（`tasks/T03_INTENT_MEMBER.md`）。
> 验收：**AC-03**（BLOCKER，逐字段披露）+ **AC-12**（P0，意图提交）。
> 前序：T01 已备好 `intent.read` / `intent.manage` 能力位；T02 已提供父锚点 `MissionParticipation(missionId,userId)`。

---

## 1. 提交

| 项 | 值 |
|---|---|
| 代码提交 | `877878e` — `feat(t03): 成员意图与逐字段披露 —— Intent CRUD、披露投影与导入许可`（含 `[skip netlify]`） |
| 本文档回填 | 紧随其后的文档提交（`git log -1 --format=%h`） |
| 分支 | `main`（**未推送**，理由与 T02 一致：避免触发 Netlify 构建额度） |
| 工作树 | 干净 |

---

## 2. 交付物清单

### 2.1 Schema（1 文件重写 + 2 处关系）

| 文件 | 规模 | 说明 |
|---|---|---|
| `prisma/schema/connection.prisma` | +90 行 | 新增 `SocialIntent` 模型 + `IntentStatus` / `DisclosureAudience` 两个枚举；`Mission` 增加反向关系 `socialIntents` |
| `prisma/schema/tenancy.prisma` | +3 行 | `Organization` 增加 `socialIntents SocialIntent[]` |
| `prisma/schema/core.prisma` | +3 行 | `User` 增加 `socialIntents @relation("UserSocialIntents")` |
| `src/generated/**` | 7 文件再生 | Prisma client 随 schema 再生（本仓生成物入库） |

**`SocialIntent` 字段**：`id` / `organizationId` / `missionId` / `userId` / `need` / `offer` / `constraints`(String) /
`disclosure`(String) / `status`(IntentStatus) / `expiresAt` / `withdrawnAt` / `importConsentAt` / `importedFields`(String)，
唯一约束 `@@unique([missionId, userId])`（一人一意图），三个外键全部 `onDelete: Cascade`。

**枚举语义（写在 `///` 注释里，因为它是容易搞反的地方）**：

- `IntentStatus`：只存 `ACTIVE` / `WITHDRAWN`。**`EXPIRED` 不落库**，由 `expiresAt` 派生 —— 这样不需要任何定时任务参与，"过期失效"没有可失效的依赖。
- `DisclosureAudience`：`SELF`(仅本人) < `ORGANIZER`(本人+组织者) < `COUNTERPARTY`(本人+组织者+对手方，最宽)。
  **包含式**语义 —— 选 `COUNTERPARTY` 意味着"组织者也能看到"。推论：组织者视角 ⊇ 对手方视角。
  这条方向写反会让"更宽的档位反而更保密"，属于静默的权限反转（§4 有专门用例锁死）。

依旧全文件**无 `@db.*` 原生类型**，同一份定义可同时为 libSQL 与 PostgreSQL 生成。

### 2.2 运行时库（新增 7 文件 · 1,567 行）

| 文件 | 行 | 作用 | 关键约束 |
|---|---|---|---|
| `src/lib/connection/field-catalog.ts` | 203 | **字段目录单一事实来源**（14 个字段的 label/group/sensitive/disclosable/importable/defaultAudience） | `audienceCanSee(viewer='SELF')` **恒为 false**；`MISSING_FIELD_AUDIENCE='SELF'` |
| `src/lib/connection/disclosure.ts` | 256 | 披露表编解码 + 白名单投影 | 写路径 `normalizeDisclosure` **fail loud(400)**；读路径 `decodeDisclosure` **fail silent**；`fieldsVisibleTo` 只接受 `ExternalAudience` |
| `src/lib/connection/input-helpers.ts` | 120 | 校验原语（从 `mission-input.ts` 抽出，与 `intent-input.ts` 共用） | 纯搬运 + 去重，行为逐字不变（§5 有说明） |
| `src/lib/connection/intent-import.ts` | 104 | 档案导入计划（"从我的档案带入哪些字段"） | 导入三件套（`importFromProfile` + `importFields` + `importConsent`）**缺一件即 400** |
| `src/lib/connection/intent-input.ts` | 160 | 写路径入参解析 | `disclosure` **整体替换**；不可变字段（`missionId`/`userId`/`status`/`importFields`）出现即 400 |
| `src/lib/connection/subject-profile.ts` | 109 | 主体档案装载（披露的**值来源**） | `SUBJECT_PROFILE_SELECT` 白名单列；`email` 取自 `User`（不在 `Profile`） |
| `src/lib/connection/intents.ts` | 615 | 领域服务层 | 三重谓词（`id` + `organizationId` + `userId`）；🔴 **披露唯一出口** `discloseSubject()` |

改动既有文件：

| 文件 | 改动 | 为什么必须改 |
|---|---|---|
| `src/lib/connection/idempotency.ts` | 修复 `stableStringify` 的 `Date` 缺陷（+10 行） | 原实现对 `Date` 走 `Object.entries()` 得 `{}` → 两个**不同**的 `expiresAt` 算出**相同**指纹 → 幂等层把"改了有效期的重提"误判为重放，直接返回旧结果。这是 T02 遗留缺陷，被 T03 的日期字段首次暴露。 |
| `src/lib/connection/mission-input.ts` | 删除本地校验原语、改为 import `input-helpers`（−89 净变化） | 同一套 `requiredString`/`optionalDate` 出现两份实现就会分叉（"同一个 `expiresAt` 在任务创建通过、在意图提交被拒"），收敛到一处后行为只有一种。 |
| `src/lib/connection/index.ts` | +94 行导出 | T03 新增符号统一出口 |

### 2.3 API（新增 6 路由 · 296 行）

| 路由 | 行 | 能力/鉴权 | 说明 |
|---|---|---|---|
| `src/app/api/v1/intents/route.ts` | 80 | `intent.manage` / `intent.read` | POST 强制 `Idempotency-Key`；GET 可按 `missionId` 过滤 |
| `src/app/api/v1/intents/[intentId]/route.ts` | 46 | 同上 | GET / PATCH（本人视角，三重谓词） |
| `src/app/api/v1/intents/[intentId]/status/route.ts` | 44 | `intent.manage` | POST `{action: withdraw\|reactivate}`（幂等） |
| `src/app/api/v1/intents/[intentId]/disclosure/route.ts` | 32 | `intent.read` | 披露预览（返回**真实值**投影，让用户看到"将暴露什么"） |
| `src/app/api/v1/intents/fields/route.ts` | 48 | `intent.read` | 字段目录（含 `catalogProblems` / `protectedFields`） |
| `src/app/api/v1/missions/[missionId]/intents/route.ts` | 46 | `mission.read` | 🔴 **组织者视角 = AC-03 的执法点**：白名单投影，未授权字段的键**不存在** |

### 2.4 前端（新增 2 文件 · 539 行）

| 文件 | 行 | 说明 |
|---|---|---|
| `src/app/m/[token]/intent/page.tsx` | 112 | RSC。未登录 `redirect` 到登录并带 `callbackUrl`；用 `getMyIntentByShareToken()` 在**服务端**取 `missionId`（公开投影刻意不含它） |
| `src/app/m/[token]/intent/intent-form.tsx` | 427 | 客户端表单。移动优先；逐字段披露矩阵；受保护字段渲染成**说明**而非开关；提交后拉披露预览 |

### 2.5 迁移（1 文件重写）

| 文件 | 规模 | 说明 |
|---|---|---|
| `scripts/connection/migrate.mjs` | +271/−? | 支持 **C0/C1 双批次**：`--batch=C0\|C1\|ALL` 作用于 `apply`/`rollback`/`verify`；`verify` 新增 `SocialIntent` 的列约束/默认值/**三路孤儿**（org/mission/user）/唯一性断言 |

批次划分的理由：T02 的 C0（`Mission` 等三表）与 T03 的 C1（`SocialIntent`）**互不依赖**，拆开后可单独回滚 T03 而不动 T02 的表。

### 2.6 测试（新增 6 文件 · 1,499 行 + 1 E2E · 184 行）

| 文件 | 行 | 覆盖点 |
|---|---:|---|
| `tests/connection/field-catalog.test.ts` | 119 | 目录自检、受众包含式方向、受保护字段、敏感字段默认 SELF |
| `tests/connection/disclosure.test.ts` | 259 | **AC-03 主证据**：未授权字段**键不存在**、值级泄露、包含式语义、编解码容错 |
| `tests/connection/intent-import.test.ts` | 91 | 三件套校验、受保护字段 `not_importable`、未知字段 `unknown_field` |
| `tests/connection/intent-input.test.ts` | 180 | 长度/受保护字段 400/`importConsent` 必需/不可变字段 400 |
| `tests/connection/intents.test.ts` | 449 | 三重谓词防回归锁、`createIntent` 四道关卡、状态派生、撤销幂等、`reactivate` 过期 409、组织者视角 |
| `tests/connection/intent-api.test.ts` | 401 | HTTP 层（401/403/400/409/幂等）+ **组织者视图端到端字符串扫描**（email/age/bio 的值不出现） |
| `tests/e2e/intent-disclosure.spec.ts` | 184 | 移动端 AC-12 + AC-03 全流程（真实 Chrome + Pixel 5） |

夹具：`scripts/qa/seed-t02-e2e.mjs` 增加 member 的 `Profile`（林晓/32/WOMAN/上海/供应链负责人），并在每次播种时清理 `SocialIntent` 与 `MissionParticipation`，让 E2E 从"未加入 / 未提交"起步。

---

## 3. 关键设计决策（与替代方案的取舍）

### 3.1 披露是"包含式档位"而不是"枚举受众列表"

**选择**：三档 `SELF < ORGANIZER < COUNTERPARTY`，档位内含前档。
**替代方案**：每个字段挂一组受众集合（`['ORGANIZER']` / `['ORGANIZER','COUNTERPARTY']`）。
**取舍**：集合方案表达力更强（能表达"给对手方但不给组织者"），但那个组合在产品上无意义且容易被误设成"越过组织者直连"。
档位方案让"受众只能单调扩张"成为**类型级事实**，且前端一个字段一行三选一，移动端不用展开多选。
代价：无法表达非单调组合 —— 目前不需要。

### 3.2 🔴 `SELF` 被排除在投影受众类型之外（防"传 SELF 即全量"）

实现过程中被单测抓出的一个真实缺陷：早先 `discloseSubject(profile, live, viewer)` 接受任意 `DisclosureAudience`，
而"某字段档位 ≥ viewer 档位"的判据在 `viewer='SELF'`（rank 0）时对**每一个**字段都成立 →
投影等于**返回整份档案**。也就是说，任何一处误传 `SELF` 都会把全量资料当"仅本人可见"发出去。

**修法**（三层，缺一层都不够）：

1. `audienceCanSee(viewer, required)`：`viewer==='SELF'` **直接 return false**；
2. `ExternalAudience = Exclude<DisclosureAudience,'SELF'>`，`fieldsVisibleTo` / `discloseSubject` 只接受它 → **误传在编译期就报错**；
3. `DisclosureSummary.byAudience` 的类型排除 `SELF` —— "仅本人可见"归入 `withheld`，不作为一个"受众"展示（否则前端会渲染成一个档位，误导用户以为那是一种披露）。

### 3.3 缺省 fail-closed：字段不在披露表里 = 不披露

`disclosure` 列存 `map[fieldKey] = audience`。**未出现的键一律视为 `SELF`**（`MISSING_FIELD_AUDIENCE`），
而不是"未设置 = 默认同意"。空披露表编码为 `null`（不是 `"{}"`），语义是"没有授权任何字段"。

### 3.4 受保护字段结构性不可授权

`email` 的 `disclosable: false` / `importable: false`。写路径 `normalizeDisclosure` 遇到它 → **400**（fail loud，不让用户以为授权成功）；
读路径遇到 → 丢弃；API 缺省恒 `SELF`；前端渲染成说明文案而不是开关（给开关只会制造"以为能开"的错觉）。
AC-03 的负测正是在这里落地：`email` 的**值**在组织者视图与意图页 HTML 里一次都不出现。

### 3.5 披露值**实时**从 `Profile` 读，不做副本

披露表只存"谁可以看哪个字段"，值在每次投影时从 `User` + `Profile` 现取。
若把值复制进 `SocialIntent`，用户更新昵称后会出现"档案里是新昵称、披露出去的是旧昵称"的副本腐化 —— 而这种不一致**不会报错**。

### 3.6 "导入"与"披露"分开存储

`importedFields` 记录"这几个字段是从我的档案带进来的"，`disclosure` 记录"给谁看"。两者正交：
从档案导入不等于对外披露（导入后仍可为 `SELF`）。导入许可生成独立审计事件 `intent.profile_import_consented`。

### 3.7 审计只记结构性信息

`writeTenantAudit` 只写：被授权的字段键列表、是否含敏感字段、导入字段列表。
**不写** `need` / `offer` 正文 —— 审计表是运营可读的，正文属于用户内容，不该因为"审计"就二次落一份。

---

## 4. 与验收标准的对照

| 验收 | 落点 | 证据 |
|---|---|---|
| **AC-03** 未授权字段不进入 API 输出 | `discloseSubject()` 白名单投影；`listMissionIntentsForOrganizer` 是唯一组织者出口 | `disclosure.test.ts`（键不存在/值级泄露/`SELF` 空投影）、`intent-api.test.ts`（组织者视图字符串扫描）、E2E（页面 HTML 不含邮箱值） |
| **AC-03** 未进入"检索 / Agent 上下文" | 本任务的**唯一**对外读出口是上述两处投影；T04（召回）与 T09（Agent）必须经同一函数 | 见 `risks.md` R3：这是**交接约束**，T04/T09 开工时必须复用，不得另行 select |
| **AC-12** Intent/Offer/约束/有效期可编辑 | `PATCH /api/v1/intents/[intentId]` + 表单 | `intent-input.test.ts`、`intents.test.ts`、E2E（改正文 → 刷新仍在） |
| **AC-12** 字段校验 | `input-helpers` + `intent-input`，全部 `ValidationError(400)` 且带 `details.field` | `intent-input.test.ts` 边界用例 |
| **AC-12** 用户主动授权 | 缺省不披露 + 逐字段选择 + 披露预览"即将披露什么" | E2E ④⑤⑥（先扩大、再收紧，预览实时反映） |

**未覆盖 / 明确不做**：向量索引与 Agent prompt 的实际注入（属 T04/T09）；`AC-05` 的撤销语义只做到"撤销后披露归零"这一**前置能力**，提案层的撤销在 T05。

---

## 5. 已知的、必须写下来的坑

1. **Turbopack dev 路由缓存会让新子路由 404**。症状极具迷惑性：`/api/v1/public/missions/<token>` 返回 200，
   而同一目录下的 `/join` 返回 **Next 全局 404 页**（不是业务 JSON 404），`git status` 干净、文件完好。
   判据：对同一 URL 发 `GET` —— 路由存在会回 **405**，不存在才回 404。
   处理：删 `.next` 重启 dev server。**不要**因此去改业务代码。
2. **`waitForLoadState('networkidle')` 在 dev 下不可靠**。HMR 长连接与客户端预取让"500ms 无网络"可能永不满足，
   表现为"服务端其实已经 200、测试在等待上耗尽超时"。改成对**目标元素** `toPass` 重试等待。
3. **纯函数测试不要经 barrel 导入**。`@/lib/connection`（index.ts）会传递依赖到 `next-auth`（ESM），
   jest 下报 `Cannot use import to load ES Module`。T03 的 6 个新测试文件一律直接 import 具体模块。
