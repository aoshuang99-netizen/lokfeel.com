# T10 · Community Bridge —— Slice 3 交付记录（HTTP 面 + 能力守卫）

> 计划见同目录 `plan.md` §5（HTTP 面）；内核见 `slice-1.md`；落库与服务层见 `slice-2.md`。
> 范围：`src/app/api/v1/bridges/**`、`tests/bridges/bridges-api.test.ts`、`package.json`（+3 脚本）。
> **不发版**：提交带 `[skip netlify]`，仅在本地与隔离库验证。

## 1. 端点清单（**8 个**，比 plan.md §5 的 7 个多一个）

| 端点 | 能力 | 说明 |
|---|---|---|
| `GET  /api/v1/bridges` | `bridge.read` | 列本组织**参与**的协议（作为发起方**或**被邀方；`OR` 谓词写进 SQL） |
| `POST /api/v1/bridges` | `bridge.manage` | 发起协议，**必须** `Idempotency-Key`；首次 `201` / 重放 `200` |
| `GET  /api/v1/bridges/{bridgeId}` | `bridge.read` | 🔴 **超出计划的一个端点**：协议详情 + **本人**可见性投影（`myProjection`） |
| `POST /api/v1/bridges/{bridgeId}/approve` | `bridge.manage` | 被邀方批准（`ACTIVE` 的**唯一**入口） |
| `POST /api/v1/bridges/{bridgeId}/revoke` | `bridge.manage` | 任一方撤销（终态，即刻生效） |
| `POST /api/v1/bridges/{bridgeId}/opt-in` | `bridge.optin` | 成员逐个加入（`disclosedFieldKeys` 必须 ⊆ 本侧协议允许集） |
| `POST /api/v1/bridges/{bridgeId}/opt-out` | `bridge.optin` | 成员退出（收窄方向，不受协议状态限制） |
| `GET  /api/v1/bridges/{bridgeId}/discovery` | `bridge.read` | 跨群可见成员投影（**唯一**的跨群读取路径） |

### 为什么多出一个 `GET {bridgeId}`（诚实记录一处计划偏离）

计划只列了 7 个端点，"协议详情"与"**本人**可见性"两件事没有落点。而逐字段归因
（`narrowed` + `owner: 'ORGANIZER' | 'MEMBER'`）**不能**放进跨群 `discovery`（那是元数据泄漏，
见 `slice-2.md` §4.1），却又必须有个出口 —— 否则 `BRIDGE_NARROW_OWNER` 与内核的
`BridgeVisibilityPlan.narrowed` 会变成**没有调用方的死代码**（"无调用方"在本仓是要用检索工具
核实的待证事实，而不是可以忽略的推测）。

于是选择**并进详情端点**而不是单开 `GET /opt-in`：两者回答的是同一件事的两个角度
（"协议是什么" / "我在协议里的位置"），拆开会迫使 UI 发两次请求才能渲染一个面板，
且两次的 `now` 可能不同（一份显示"已生效"、另一份显示"已过期"）。详情端点**共用同一个 `now`**。

## 2. 交付物

| 文件 | 职责 | 关键设计 |
|---|---|---|
| `bridges/route.ts`（新） | `GET` 列表 / `POST` 发起 | `POST` 三条硬约束：① 必须带幂等键；② 落库即 `PENDING`；③ 被邀方组织由**服务端**回查 |
| `bridges/_shared/params.ts`（新） | `bridgeIdOf(params)` | `_shared` 前缀 → Next 不把它当路由段 |
| `bridges/[bridgeId]/route.ts`（新） | 详情 + 本人投影 | 两个投影**共用同一个 `now`** |
| `bridges/[bridgeId]/{approve,revoke}/route.ts`（新） | 双边裁决 | **不执行任何副作用**：只做状态迁移 |
| `bridges/[bridgeId]/{opt-in,opt-out}/route.ts`（新） | 成员自助 | opt-in **不要求**幂等键（它天然幂等：重复 = 更新同一行） |
| `bridges/[bridgeId]/discovery/route.ts`（新） | 跨群投影 | 协议不可用回 `200 + 空 + 原因码`，**不**回 4xx |
| `package.json`（改） | `check:bridge-invariants` / `verify:bridge-invariants` / `test:bridge` | 与 T09 的三条同名脚本对齐 |

### 幂等键的取舍（两处刻意不同）

| 端点 | 要求幂等键？ | 为什么 |
|---|---|---|
| `POST /api/v1/bridges` | **要** | 会**创建资源**（一份协议 = 一个新的跨组织授权面）。重试若被当成新请求，要么撞唯一约束变 500，要么在将来引入字段更新时**覆盖配置** |
| `POST .../opt-in` | **不要** | 天然幂等：库级 `@@unique([bridgeId, userId])` + 应用级 `upsert`。语义就是"把我的选择设成这个"，重复请求的期望结果相同 |

## 3. 测试钉住的东西（`tests/bridges/bridges-api.test.ts`，**35 例**）

| 分组 | 例数 | 关键断言 |
|---|---|---|
| 能力关卡 | 5 | 匿名 → 401 且**不查库**；MEMBER **能**读；MEMBER **不能**发起（403 + `tenant.capability_denied` 审计）；MEMBER **能** opt-in；OPERATOR **不能**批准 |
| 发起协议 | 10 | 缺幂等键 400；首次 201 + `PENDING` + `recipientApprovedAt = null`；同键同体 200 + `replayed` 且**不再创建**；同键不同体 409；自邀 400（且**不查组织表**）；被邀方组织不存在 400；已存在协议 409；字段键不在目录里 400 并**列出**违规值；`shareableMissionKinds` 含 `'*'` 400；缺 `purpose` 400 |
| 双边审批 | 7 | 发起方 approve → 403 `WRONG_SIDE`；被邀方 approve → `ACTIVE` + `recipientApprovedAt` 落值 + CAS 谓词 `{id, status:'PENDING'}`；已 `ACTIVE` 再批准 409；**CAS 失败**（并发）409；撤销后不可批准；撤销落 `revokedBy`；跨租户 → 404 |
| 成员 opt-in/out | 6 | 🔴 越界字段 400 + `bridge.optin_rejected` 审计且**不落库**；允许集内落库且 `organizationId` 取自**租户上下文**（不是请求体）；已撤销 → 409；`PENDING` **可以** opt-in；从未加入就 opt-out → 404；opt-out 置 `WITHDRAWN` 且**保留行** |
| 跨群投影 | 7 | 见下 |

### 🔴 跨群投影那 7 条里最有价值的三条

1. **查询谓词审计**：断言 `db.bridgeMemberOptIn.findMany` 的 `where` **恰好等于**
   `{ bridgeId, organizationId: 对方组织, status: 'ACTIVE' }`，并断言其序列化形式**不含**
   `city|email|displayName|company` —— 即"不存在以档案字段为条件的过滤"这条铁律在
   **运行时**被核对，而不只是靠内核的文本级门禁 B2。
2. **两把锁**（`displayName` 那一例）：夹具刻意让 `displayName` **同时**满足
   ① `discloseSubject(profile, live, 'CANDIDATE')` 的白名单（成员的意图里确实授权了它）
   与 ③ 成员有披露依据，**但**不满足三方交集（双方群主都没在协议里开它）。
   于是 `hasOwnProperty('displayName') === false` **只能**由 `restrictToKeys()` 二次裁剪解释。
   若哪天有人删掉那层"冗余"裁剪，**这条断言是唯一会红的东西**。
3. **元数据泄漏防线**：已 opt-in 但无披露依据的成员只进 `gatedOut` 计数；
   断言整个响应体的序列化文本**不含**该成员的 userId、**不含**字符串 `narrowed`。

### 测试文件本身踩到并修掉的三个坑（诚实记录）

1. **mock 过于宽松会掩盖真问题**：`findBridgeRow` 的谓词是
   `OR: [{initiatorOrgId: 观察者}, {recipientOrgId: 观察者}]`。首版 mock 只要 `OR` 里**出现**
   `ORG_A` 就返回行 —— 于是"跨租户 → 404"那条断言会被一个过宽的 mock 悄悄放过
   （**绿得毫无意义**）。改为从**谓词本身**取观察者组织：`where.OR[0].initiatorOrgId`。
2. **审计元数据的断言要看持久化形态**：`writeTenantAudit` 会先
   `JSON.stringify(redactMetadata(...))` 再落库，因此 `safeMetadata` 是**字符串**。
   改成 `JSON.parse(...)` 后断言，并**顺带**断言该字符串不含字段键值 ——
   这比断言调用时的对象更贴近合规读者真正会看到的东西。
3. **"回声"式 mock**：`agreedFieldKeys`（双边交集）首版断言写错，因为它测的是**夹具行的字段集**
   而不是本次请求的输入。改为让 `bridgeCreate` mock **回声**本次写入的值，
   断言才真正覆盖"按输入算交集"这条逻辑。

## 4. 🔴 未覆盖 / 诚实声明

1. **本层证不了路径形状**：`/api/v1/bridges/*` 在**生产**的可达性、Cloudflare 代理层的行为、
   以及"发布窗口期 `request.url` = 部署专用域名"那类同源问题，都**不在** mock 覆盖范围内。
   那是 **Slice 4** 的 `scripts/qa/verify-ac19-bridge-e2e.mjs`（真实 Chrome + 隔离库 + 两个租户夹具）
   的职责 —— 它必须覆盖三组：**正向**（双群主批准 + 双方 opt-in ⇒ 交集字段可见）、
   **反向**（未 opt-in / `PENDING` / 收窄后 / revoke 后 四者皆不可见）、**越权**（以 A 群成员
   身份读 B 群私有行 ⇒ 失败）。
2. **前端未接线**：Bridge 面板（并入 Consent 区子面板，见 plan.md §8.3）属 Slice 4。
   因此 AC-18 的"七屏口径"目前**没有**新增屏。
3. **没有"改字段"的端点**：协议一旦创建，两侧字段集不可修改；不同意只能撤销重开。
   这是本切片的**有意收敛**（7→8 个端点里没有一个 PATCH）。若后续要支持"协商后改配置"，
   必须新增端点并**重跑双边批准**（否则就出现了"单边改配置即时生效"的漏洞）。
4. **`Idempotency-Key` 的取值约束**（长度上限）由 T02 的 `requireIdempotencyKey` 统一把关，
   本切片未重复实现。
