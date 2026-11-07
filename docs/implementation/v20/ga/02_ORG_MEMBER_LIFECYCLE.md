# 02 · 组织 / 成员 / 权限收口（Batch 1）

> 结论先行：**Batch 1 的四项验收（1.1 建组织即管理员 / 1.2 邀请全流程 / 1.3 成员移出 / 1.4 D-12 回归）
> 在「生产构建 + 生产数据库」上全部 PASS，30/30 断言零 SKIP。**
> 但这一轮真正有价值的不是"通过"，而是**第一轮跑出来的 9 条红里有 4 个是产品缺陷** ——
> 其中两个会让用户看到错误的失败原因，一个会让"过期链接"永远落不了库，
> 一个会让移出成员直接 500。它们全部在单测里是绿的。
>
> 状态词表：`PASS` / `FAIL` / `BLOCKED` / `NOT_TESTED`，每条都带 SHA、命令、退出码或真实 API 证据。

---

## 0. 基线与环境

| 项 | 值 |
| --- | --- |
| 代码 SHA（本轮全部证据） | `36053fe` |
| 上一提交 | `1187527`（Batch 1 UI）→ `409ae14`（Batch 1 后端）→ `37ea993`（Batch 0 安全） |
| 被测运行形态 | `next build` 产物 + `next start -p 3111`（**生产构建**，非 `next dev`） |
| 数据库 | 生产 Turso `libsql://lokfeelcom-lokfeelboss.aws-us-east-1.turso.io`（与线上同一库） |
| 应用地址 | `http://localhost:3111`（`AUTH_URL`/`NEXTAUTH_URL`/`NEXT_PUBLIC_APP_URL` 同步覆盖） |
| 线上当前部署 | `bc46a22`（Netlify deploy `6aeeb9cd`）—— **不含**本轮新增路由 |
| 复验脚本 | `scripts/qa/verify-t07-org-lifecycle.mjs`（`npm run verify:member-lifecycle`） |

### 为什么这一轮打的不是 `https://app.lokfeel.com`

线上仍是 `bc46a22`，`/api/v1/organizations`、`/api/v1/invitations*`、`/invitations/accept`
**在线上根本不存在**。对线上跑这个脚本只会得到一串 404，"404 = 路由没发布"这件事
既不能证明也不能否证任何业务不变量。所以本轮的证据口径明确写成
**「生产构建 + 生产数据库 + 本地端口」**，并在 Batch 8 发布后用同一条命令对
`https://app.lokfeel.com` 重跑一遍（命令见 §7）。这不是把本地结果冒充线上，
而是把"能不能跑通"和"有没有发布"拆成两件事分别取证。

> ⚠️ 这条口径必须在最终报告里保持可见：**Batch 1 的 PASS 不含"线上 HTTP 路径已验证"**。

---

## 1. 验收 1.1 —— 新建组织 100% 有有效管理员

### 1.1.1 承重结构

`createOrganizationWithOwner()`（`src/lib/tenancy/org-create.ts`）把
`organization.create` 与 `membership.create({role:'OWNER', status:'ACTIVE'})`
放在**同一个交互事务**里。不变量因此是事务边界上的性质，而不是"记得补一句"的约定 ——
D-12 的事故形态正是"组织建出来了，但没有任何人有 `agent.approve` / `outcome.verify`"。

创建者拿 **OWNER 而不是 ADMIN**：只有 OWNER 能转让/删除租户。若组织的第一名成员只是
ADMIN，这个组织将永远无法被删除或转让（这是"看起来能用、实际永远锁死"的形态）。

### 1.1.2 证据

| 断言 | 结果 | 证据 |
| --- | --- | --- |
| C01 匿名创建 → 401 | **PASS** | `status=401` |
| C02 创建 → 201 且 `role=OWNER` | **PASS** | `status=201 role=OWNER id=cmw67o90f000ncdk8pgjpjxsg` |
| C03 库里恰好 1 条 ACTIVE OWNER | **PASS** | `memberships=1 activeOwner=1`（直查 `Membership`） |
| C04 `GET /api/v1/org` → `myRole=OWNER` + 四项能力 | **PASS** | `myRole=OWNER`，`member.invite/remove/update_role/org.update` 齐备 |
| C05 同 slug 重试 → 409 且不重复 | **PASS** | `status=409 code=SLUG_TAKEN orgs=1 memberships=1` |
| C06 保留字 slug → 400 | **PASS** | `slug=console` → `400 SLUG_RESERVED` |
| C07 审计两条 | **PASS** | `organization.created` + `membership.created`（`TenantAuditEvent` 直查） |

幂等由**数据库约束**保证（`Organization.slug` 唯一 + `Membership @@unique([organizationId,userId])`），
不是应用层"先查再写"——后者在并发下必然漏。

---

## 2. 验收 1.2 —— 邀请 → 发送 → 接受 → 加入 → 角色 → 审计

### 2.1.1 三个设计决定（都是被失败模式逼出来的）

1. **库里只存 token 的 sha256**（`I02` 实测：`tokenHash` 64 字符，明文不入库）。
   代价是"重发必须换票"，但那是"链接只在发出那一刻存在"的正确含义。
2. **接受时必须校验会话邮箱 == 邀请邮箱**（`A02`）。这是"链接即凭据"模型里最常被漏掉的一条：
   不校验的话，一个被转发到群里的链接等于一张公共入场券。
3. **过期是惰性的**，没有定时任务 —— 定时任务会带来"任务没跑就永远不过期"的新失败模式。
   代价是过期必须在**被真正拿去接受**时落库（见 §5 缺陷 #3，我最初这里写错了）。

### 2.1.2 证据

| 断言 | 结果 | 证据 |
| --- | --- | --- |
| I01 邀请 → 201 + 链接 + `emailSent` 布尔 | **PASS** | `201`，token 43 字符；本地 `emailSent=false emailError=Email service not configured` |
| I02 只存哈希 | **PASS** | `len(hash)=64 明文入库=false` |
| I03 同邮箱重复邀请 → 换票 | **PASS** | 旧票 `REVOKED`，新票 `role=OPERATOR` |
| I04 邀请已是成员 → 409 | **PASS** | `ALREADY_MEMBER` |
| I05 邀请授予 OWNER → 403 | **PASS** | `OWNER_GRANT_FORBIDDEN` |
| I06 非法邮箱 → 400 | **PASS** | `INVALID_EMAIL` |
| I07 非成员带 `?organizationId=` 读 → 403 | **PASS** | `invitations=403 members=403`（客户端给的 orgId 不是授权依据） |
| A01 匿名 accept → 401 | **PASS** | `401` |
| A02 别人拿链接 → 403 且票未消费 | **PASS** | `EMAIL_MISMATCH`，票仍 `PENDING` |
| A03 本人接受 → 200 + 入库 | **PASS** | `role=OPERATOR reactivated=false`；`membership=OPERATOR/ACTIVE 票=ACCEPTED acceptedAt=有` |
| A04 同一 token 再接受 → 409 | **PASS** | `NOT_PENDING`（链接只能用一次） |
| A05 伪造 token → 404 | **PASS** | `INVALID_TOKEN` |
| A06 过期票 → 409 且落库 EXPIRED | **PASS** | `409 EXPIRED`，`DB=EXPIRED`（修复后才绿，见 §5） |
| A07 撤销后接受 → 409 且 REVOKED | **PASS** | `DELETE=200`，`accept=409/NOT_PENDING`，`DB=REVOKED` |

角色：邀请时授予的角色 = 接受后拿到角色（本轮 OPERATOR 全链路一致）。
撤销是**终态**，撤销后同一 token 永久失效；要让人重新进来必须换票。

### 2.1.3 邮件发送路径 —— 本轮的诚实说明

本地 `.env.local` 没有 `RESEND_API_KEY`，所以 `emailSent=false`。
这不是跳过：它恰好证明了**发信失败不回滚邀请**这条设计 —— 邀请仍然建成功，
响应里带 `inviteUrl`，管理员可以把链接直接给人。
前端据此显示的是"邀请已创建，但邮件没有发出去（邮件服务未配置）。请把下面的链接直接发给对方"，
而**不是**"邀请已发送"。

生产环境配有 `RESEND_API_KEY`，因此线上重跑必须看到 `emailSent=true`。
**这一条在 Batch 8 之前记为 `NOT_TESTED`**（真实投递与收件无法在本地伪造）。

---

## 3. 验收 1.3 —— 成员移出

### 3.1.1 软移出，不删行

`removeMember()` 把成员关系置为 `SUSPENDED`，**不删行**。三个理由：

1. 审计要能对上：硬删会让 `TenantAuditEvent.resourceId` 指向不存在的行；
2. 会话立即失效：`resolveTenant()` 只认 `ACTIVE`，下一次请求就 403，不用等 JWT 过期；
3. 可恢复：重新邀请时把同一行改回 `ACTIVE`，不撞 `@@unique([organizationId,userId])`。

### 3.1.2 证据

| 断言 | 结果 | 证据 |
| --- | --- | --- |
| R01 移出自己 → 409 | **PASS** | `SELF_REMOVE` |
| R02 移出成员 → 200 | **PASS** | `status=200`（修复前是 500，见 §5 缺陷 #4） |
| R03 软移出：行仍在、状态 SUSPENDED | **PASS** | `role=OPERATOR status=SUSPENDED`（角色被保留：移除后仍需在审计里读得出"他曾是什么"） |
| R04 被移出者下一次请求 → 403 | **PASS** | `members=403 org=403` |
| R05 再移出一次 → 400 | **PASS** | `NOT_ACTIVE`（"成功但没改"是谎报） |
| R06 跨租户 membershipId → 404 | **PASS** | `404 NOT_FOUND`（不是 403：403 会泄露"该 id 真实存在"） |
| R06b 他租户成员未被改动 | **PASS** | 目标行仍 `ACTIVE` |
| R07 重新邀请 → `reactivated=true` 且行数不变 | **PASS** | `reactivated=true 成员行数=1` |
| R08 审计事件齐备 | **PASS** | `invitation.accepted:2, invitation.created:5, invitation.revoked:1, membership.created:1, membership.removed:2, organization.created:1` |

「最后一名管理员」在**移出**路径上结构性不可达（要能执行移出，发起人自己就是 ACTIVE 管理员，
`activeAdminCount` 必然 ≥2），因此它是纵深防御而非可触发路径；
该不变量真正可触发的位置是角色降级，由 D-12 的既有用例覆盖（见 §4）。

---

## 4. 验收 1.4 —— D-12 回归（不重复开发已验证能力）

按要求：**只重跑既有验证器，不重新实现**。

### 4.1 `verify-member-role-prod.mjs`（角色写路径）— 8 PASS / 0 FAIL / 0 SKIP

```
node scripts/qa/verify-member-role-prod.mjs --base=http://localhost:3111
```

| 断言 | 结果 |
| --- | --- |
| P01 匿名 PATCH → 401 | PASS |
| P02 OPERATOR 改角色 → 403 | PASS |
| P03 ADMIN 改自己 → 409 `SELF_ROLE_CHANGE` | PASS |
| P04 授予 OWNER → 403 | PASS |
| P05 降级 OPERATOR→MEMBER → 200 且回读一致 | PASS |
| P06 还原 MEMBER→OPERATOR → 200 且回读一致 | PASS |
| P07 非法角色 → 400 | PASS |
| P08 审计两条（去 + 回） | PASS（样本 4 条） |

### 4.2 `org-admin-invariant.mjs`（管理员不变量体检）— 全绿

```
node scripts/qa/org-admin-invariant.mjs
default (org_de…)        ACTIVE  成员 3  管理员 1  ✅
preview (757eee…)        ACTIVE  成员 2  管理员 2  ✅
e2e-b1-mw67nwl3 (cmw67o…) ACTIVE  成员 1  管理员 1  ✅
```

结论：**没有组织处于"0 管理员"状态**。D-12 的修复（`bc46a22`）在这一轮改动后仍然成立。

### 4.3 单元测试

```
npx jest tests/tenancy tests/auth   → 16 suites / 275 tests  全绿   exit 0
npx jest tests/api                  → 1 suite / 9 tests      全绿   exit 0
```

---

## 5. 本轮发现并修复的 4 个真缺陷（Batch 1 的主要产出）

第一轮跑出 **21 PASS / 9 FAIL**。九条红里 5 条是我自己断言写错（改的是断言，不是实现），
**4 条是产品缺陷**。以下每条都给出"故障形态 → 为什么会发生 → 修法 → 如何证明修好了"。

### 缺陷 #1 · `errorResponse()` 对 403/404 丢弃 `error.details`

- **故障形态**：I05 / A02 / A05 三条同时红 —— 期望 `OWNER_GRANT_FORBIDDEN` / `EMAIL_MISMATCH` /
  `INVALID_TOKEN`，实际全是 `PERMISSION_DENIED` / `NOT_FOUND`。
- **根因**：`errorResponse()` 里 `case 403: return forbidden(error.message)`，而 `forbidden()` 的
  签名根本没有 `details` 参数。租户层精心区分的十余个拒绝码全部挂在这两个状态码上，
  于是在 HTTP 边界被一次性抹平。
- **为什么这不是"少个字段"**：界面靠 `code` 决定给用户哪一句话。
  `EMAIL_MISMATCH` 的正确下一步是"换用被邀请的邮箱登录"，被显示成"你没有权限"之后，
  用户会去找管理员要权限 —— 而管理员无论做什么都解决不了。
- **修法**：`forbidden(message, details?)` / `notFound(message, details?)` 增加透传；
  `errorResponse` 传入 `error.details`。HTTP 语义码仍是 `PERMISSION_DENIED`（协议层不变），
  业务码放 `error.details.code`。
- **证明**：`tests/api/error-envelope.test.ts` 9 条断言；
  **负向对照**：把透传改回去 → 立刻 3 条红（`3 failed, 6 passed`），改回来 9/9 绿。

### 缺陷 #2 · slug 冲突返回 500 而不是 409

- **故障形态**：C05 期望 `409 SLUG_TAKEN`，实际 `500 INTERNAL_ERROR`。
- **根因**：`if (err.code === 'P2002')` 在 libSQL adapter 下**永远不命中**。真实错误是：
  ```
  { code: 'N/A',
    message: 'SQLITE_CONSTRAINT: SQLite error: UNIQUE constraint failed: Organization.slug' }
  ```
  服务端日志 `prisma:error` 原样可见。
- **为什么这很糟**：用户填了一个已被占用的标识，得到"服务器内部错误"，
  合理反应是重试 —— 而每次重试都必然再失败一次。正确的提示是"换个标识"。
- **修法**：`isUniqueViolation(error, 'Organization.slug')`（`src/lib/errors.ts`），
  同时认 `P2002` 与 `UNIQUE constraint failed` 文案，并做列名比对避免误判别的唯一键。
- **证明**：C05 复跑 `409 SLUG_TAKEN orgs=1 memberships=1`（幂等同时被证明）；
  单测覆盖 libSQL 形态、标准 P2002、他列冲突、普通错误四种输入。

### 缺陷 #3 · 邀请"惰性过期落库"从未真正落库

- **故障形态**：A06 `status=409 code=EXPIRED`（对外正确），但 `DB=PENDING`（库里没变）。
- **根因**：在交互事务里先 `UPDATE status='EXPIRED'` 再 `throw ConflictError` ——
  **throw 会回滚事务内已执行的全部语句**，那条 UPDATE 也跟着消失。
  注释承诺的"审计里才看得到有人拿过期链接来试过"因此从来不存在：
  接口一直答 EXPIRED，库里永远 PENDING，下次还会再答一次 EXPIRED。
- **修法**：事务内**正常返回**判定结果（`{kind:'expired'}`），事务提交之后在事务外抛错。
  单次消费语义不变（ACCEPTED 分支仍在同一事务内写入）。
- **证明**：A06 复跑 `409 EXPIRED DB=EXPIRED`；`jest tests/tenancy` 275/275 不变。

### 缺陷 #4 · `DELETE /api/v1/members/[id]` 500：`TRANSACTION_CLOSED`

- **故障形态**：R02 期望 200，实际 `500`；服务端日志：
  ```
  prisma:error Invalid `prisma.membership.update()` invocation:
  Database error. ... TRANSACTION_CLOSED: Cannot execute statements because the transaction is closed
  ```
- **根因**：Prisma 交互事务默认 `timeout = 5s`。本机 SQLite 上几乎不可能触发，
  但 Turso 单条往返 100ms~1s（本轮实测 `/api/health` 的 `dbLatency` 3.2~3.5s），
  "读目标行 → 数管理员 → 写入"三步越界。越界后的错误**不是超时**，
  而是最后一个写语句上的 `TRANSACTION_CLOSED`，最终变成 500。
  也就是说：**在网络慢的时候，移出成员 / 改角色 / 建组织这类普通操作会整片失败。**
- **修法**：新增 `src/lib/tenancy/tx.ts` 的 `TENANT_TX = { maxWait: 10s, timeout: 20s }`，
  统一应用到五个租户写事务（org-create / invitations.create / invitations.accept /
  member-roles / member-removal）。
- **口径声明**：这是**可用性预算**，不是验收阈值。没有任何断言是因为它才变绿的 ——
  同一批断言在同一个 5s 事务下是红的，20s 下是绿的，差别就是"事务还活着"本身。
  R02/R03/R04/R05 与 D-12 的 P05/P06 一起复跑全绿。

> 顺带：缺陷 #4 修好后，D-12 的 P05/P06（角色降级 + 还原）在同一高延迟环境下也稳定通过，
> 说明这条修复是**共因**而不是只为某一个断言打的补丁。

---

## 6. 前端（成员屏 + 邀请接受页）

代码：`src/app/console/members/page.tsx`（+365 行）、`src/app/invitations/accept/page.tsx`（新增）。

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 邀请表单（邮箱 + 角色） | **PASS**（构建 + 类型 + lint） | 只在服务端 `capabilities` 含 `member.invite` 时渲染 |
| 发信成功 / 失败分开呈现 | **PASS** | `emailSent=true` → "已发送"；`false` → 给出可复制链接 + 原因 |
| 邀请记录四态 + 撤销 | **PASS** | 待接受 / 已接受 / 已撤销 / 已过期 |
| 移出（带影响提示 + 确认） | **PASS** | 明确写出"立即失去访问权 / 下一次请求即 403 / 历史保留" |
| 角色下拉 | **PASS** | 拒绝码 → 人话映射（`LAST_ADMIN` / `SELF_ROLE_CHANGE` / `OWNER_PROTECTED` …） |
| 视觉验收（截图 / 视口 / 主题） | **NOT_TESTED** | 属于 Batch 2 的 13 屏 × 4 视口 × 2 主题矩阵，不在这里提前宣称 |

**一个容易漏掉的点**：`useApiResult()` 把成功/失败做成**返回值**。
原来 `useApiPost()` / `useApiDelete()` 把失败原因放进 `error` state，
而 `await` 之后读到的 state 仍是上一次渲染的值 —— 于是"删除失败"会被界面显示成"删除成功"。
这不是细节，是**谎报业务结果**。本轮所有新的写操作都走返回值的口径。

---

## 7. 未尽事项与残留风险

| # | 事项 | 状态 | 处置 |
| --- | --- | --- | --- |
| B1-1 | 线上 HTTP 路径复验 | **NOT_TESTED** | Batch 8 发布后执行：<br>`node scripts/qa/verify-t07-org-lifecycle.mjs --base=https://app.lokfeel.com` |
| B1-2 | 邀请邮件真实投递（`emailSent=true`） | **NOT_TESTED** | 同上重跑，断言 I01 变为 `emailSent=true` |
| B1-3 | 成员屏 / 接受页视觉与无障碍 | **NOT_TESTED** | Batch 2（104 格矩阵 + axe） |
| B1-4 | 邀请页的未登录跳转 | **NOT_TESTED** | 属 Batch 3（会话/回调）与 Batch 2 的浏览器取证 |
| R1 | 「最后一名管理员」在移出路径结构性不可达 | 已知 | 纵深防御保留；真实可触发点在角色降级，已被 D-12 覆盖 |
| R2 | `GET /api/v1/org` 无 `organizationId` 参数，取"最早加入的 ACTIVE 关系" | 已知 | 多组织用户的实际租户取决于加入顺序。**这是设计**（租户不可由客户端指定），但要求前端在切换组织后必须带 `?organizationId=` 调用其它租户接口。本轮 E2E 第二轮就是因为漏传，把邀请写进了上一轮的组织 —— 已在脚本里改为一律显式传参 |
| R3 | 事务超时上限 20s | 已知 | 极端慢网下仍可能失败；失败形态已从"误导性的 TRANSACTION_CLOSED"收敛为可识别的超时。后续若要根治需引入幂等重试（不在 V20.5 范围） |
| R4 | 本轮在**生产库**留下 1 个 e2e 组织 `e2e-b1-mw67nwl3`（1 名成员，无外部数据） | 已知 | 脚本每次运行前会自动清理 `e2e-b1-%` 命名空间；也可用报告末尾打印的 SQL 手工删除。**不删除**是为了让审计事件可回溯 |

---

## 8. 本轮改动清单

| 文件 | 性质 |
| --- | --- |
| `src/lib/tenancy/org-create.ts` | 新建组织 + OWNER 同事务；`isUniqueViolation` 判定；`TENANT_TX` |
| `src/lib/tenancy/invitations.ts` | 邀请全流程；accept 改为"事务内判定 → 提交后抛错"；`TENANT_TX` |
| `src/lib/tenancy/member-removal.ts` | 软移出 + 五类拒绝码 + 跨租户 404；`TENANT_TX` |
| `src/lib/tenancy/member-roles.ts` | 角色变更事务加 `TENANT_TX` |
| `src/lib/tenancy/tx.ts` | 新增：租户事务预算（唯一出处） |
| `src/lib/errors.ts` | 新增 `isUniqueViolation()` |
| `src/lib/api-response.ts` | 403/404 透传 `details`（语义码不再丢） |
| `prisma/schema/tenancy.prisma` | 新增 `OrganizationInvitation` + `InvitationStatus` |
| `scripts/tenancy/migrate-invitations.mjs` | 生产库迁移（已 apply，13 列 4 索引，verify PASS） |
| `scripts/qa/verify-t07-org-lifecycle.mjs` | 新增：30 断言、HTTP + DB 双证、自清理 |
| `tests/api/error-envelope.test.ts` | 新增：9 条（含负向对照） |
| `tests/tenancy/*` | 既有 251 条 + 本轮新增（org-create 21 / member-removal 15 / invitations 28） |
| `src/app/console/members/page.tsx` / `src/app/invitations/accept/page.tsx` | 前端 |

---

## 9. 一句话总结

Batch 1 交付的不只是"邀请能用"，而是**四个只在真实 HTTP + 真实数据库 + 真实延迟下才会
现形的缺陷**。它们有一个共同点：**单元测试全绿**。
这正是"以本地单测冒充线上结果"最危险的地方 —— 不是测错了，是测的东西和跑的东西不是同一个。
