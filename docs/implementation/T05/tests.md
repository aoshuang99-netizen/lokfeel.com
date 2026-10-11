# T05 · tests — 测试与取证

> 基线 commit **`cca7b80`**。任务 **`T05_CONSENT_TRUST`**，验收 **AC-04 / AC-05 / AC-06**（三条都是 BLOCKER）。
> 设计取舍见 `changes.md`；未消解风险见 `risks.md`；回滚演练见 `rollback.md`。
> 本文只回答一个问题：**每条 AC 由哪一层、哪条用例、以什么判据证明** —— 并附命令与原始结果。

---

## 1. 结论（门禁一览）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 类型 | `npx tsc --noEmit` | **0 错误** |
| 单测（全 `tests/connection`） | `npx jest tests/connection` | **373 / 373 通过**（16 suites，62.3s） |
| 单测（全量回归） | `npx jest` | **752 / 752 通过**（38 suites，200.4s；T04 时 669 → 本刀 +83） |
| ↳ 其中 T05 新增 | `proposals.test.ts` 49 + `proposals-api.test.ts` 34 | **83 / 83** |
| Lint（T05 面） | `npx eslint <12 个 T05 文件>` | **0 error / 0 warning** |
| 脚本声明 | `npm run check:script-decls` | **49 个脚本，0 个未声明引用** |
| E2E（移动端 · 真实 Chrome） | `playwright test -c playwright.t02.config.ts tests/e2e/consent-trust.spec.ts` | **7 / 7 通过**（14.1 min） |
| T04 回归（候选页，独立复验） | `node scripts/qa/verify-t04-candidate-regress.mjs` | **15 / 15 通过** |
| 回滚演练 | `node scripts/qa/drill-t05-rollback.mjs` | **通过**（见 §9） |

**AC 落点一句话**：

| AC | 一句话 | 主判据所在层 |
|---|---|---|
| **AC-04** 单方同意**不**介绍 | 第一个同意的人**不**能触发介绍；只有 `MUTUALLY_ACCEPTED` 可介绍 | L1 纯内核（规则）+ L2 服务层（负测）+ L4 E2E |
| **AC-05** 拒绝与撤销 | reject/revoke 立即终态；终态后任何表态 → **409**（不是幂等成功） | L2 + L3（状态码）+ L4 E2E |
| **AC-06** 执行时校验（race） | 介绍**在那一刻**重查提案与双方意图，用 CAS 写入；并发只有一个成功 | L1（可介绍性纯函数）+ L2 + L4 |

---

## 2. 为什么是四层（而不是一层）

每层能证伪的**失败形状**不同，任何一层都替代不了另一层：

| 层 | 文件 | 覆盖对象 | **它证不了** |
|---|---|---|---|
| **L1 纯内核** | `proposals.test.ts` 上半 | 状态机派生 / 可介绍性 / 动作清单 —— 无 IO | 数据库约束、路由、投影 |
| **L2 服务层** | `proposals.test.ts` 下半 | 「读-改-写」顺序、租户隔离谓词、投影档位 | HTTP 状态码、路径形状 |
| **L3 HTTP 层** | `proposals-api.test.ts` | 鉴权/能力关卡、幂等键、状态码全谱系 | **路径形状**（见 §4）、浏览器行为 |
| **L4 E2E** | `consent-trust.spec.ts` | 真实路由 + 真实登录态 + 页面渲染 | 并发（串行执行，不刻意造 race） |

**L1 为什么值得单拆**：AC-04 的全部内容就是一条状态转移规则。把它写成服务层里的 `if`，就只能靠**起数据库**来验证；抽成纯函数后，这条规则有了 12 个 0.3 秒跑完的断言，且**任何调用方都绕不过它**。

---

## 3. L1 / L2 —— 单测 `tests/connection/proposals.test.ts`（49 例）

做法与 `intents.test.ts` / `candidates.test.ts` 同源：mock `@/lib/db`，直接 import 具体模块（不经 barrel）。
**不 mock 状态机本身** —— 下面的 `proposalFindFirst / update / upsert` 共同维护一个内存 store，让"读改写"的真实顺序被走到，而不是被几个 `mockResolvedValue` 假装成两步。

| # | describe（8 块） | 例数 | 证的是什么 |
|---|---|---|---|
| 1 | 纯内核：状态派生 | 4 | `EXPIRED` 是派生值；**已介绍时状态固定**（不因之后过期而变） |
| 2 | **AC-04 核心规则：单方同意不产生 mutual** | 4 | 只有 proposer / 只有 candidate accept → 仍是 `CONSENT_PENDING`；双方 → `MUTUALLY_ACCEPTED` |
| 3 | 可介绍性（AC-06 第①层，纯函数） | 3 | `evaluateIntroducibility()` 列出**全部** blockers |
| 4 | 参与方可执行动作 | 4 | `availableActions()` 的角色无关性（"我已同意"的过滤在装配处做） |
| 5 | `createProposal` | 8 | 运营能力、唯一键、租户 |
| 6 | `decideProposal`（AC-04 / AC-05） | 10 | 终态后表态 → 409；撤销清空待发；**同意过后只剩 REVOKE** |
| 7 | `introduceConnection`（AC-04 负测 + **AC-06 执行时校验**） | 11 | 单方同意 → 409；**同意后一方撤销意图 / 提案过期 → 介绍失败**（本文件最重要的两条） |
| 8 | 披露档位升级（介绍前 `CANDIDATE` → 介绍后 `COUNTERPARTY`） | 5 | 判据是 `introducedAt !== null`，**不是**"双方点了同意" |

> ⚠️ 档位升级是**负测**：`age: COUNTERPARTY` 的哨兵值在**未介绍**的卡片上**一次都不该出现** —— 若把判据写成"同意即升级"，这条会红。E2E 与 API 测试各有一条钉住它。

---

## 4. L3 —— HTTP 层 `tests/connection/proposals-api.test.ts`（34 例）

直接调用路由导出的 handler（不启服务），覆盖状态码全谱系。

| describe | 例数 | 关键断言 |
|---|---|---|
| `POST /api/v1/connections/proposals` | 9 | 缺 `Idempotency-Key` → 400；重放 → `Idempotent-Replayed: true`；非运营 → 403 |
| `GET /api/v1/connections/proposals` | 4 | 谓词写死 `OR:[proposerId,candidateId]`；`?states=EXPIRED` 在**装配之后**过滤 |
| `POST /api/v1/connections/{connectionId}/consent` | 11 | 单方 accept → **200 但 state 仍 `CONSENT_PENDING`**；终态后 → 409；非参与方 → 403 |
| `POST /api/v1/connections/{connectionId}/revoke` | 4 | 空 body 合法；立刻 `closedAt` |
| `POST /api/v1/connections/{connectionId}/introduce` | 12 | AC-06：失败列出**全部** blockers；重复介绍 → 409 `already_introduced` |
| `GET /api/v1/connections/introductions` | 4 | `COUNTERPARTY` 档投影 —— 该档**唯一**读路径 |

### 4.1 ⚠️ 本层**证不了**路径形状（值得单独记住）

handler 是**直接 import** 的、`params` 由测试**手工构造**（`params({ connectionId: 'p_1' })`），
请求 URL **不参与路由匹配**。因此 `/connections/{connectionId}/consent` 这种
"只有 3 段、**没有** `proposals` 中间段"的形状，**只有 E2E 能证**。

实现期在这一点上**连错 3 次**（写成 `/connections/proposals/{id}/consent` 这种 4 段），
**每一次单测全绿**。第一次得到 404 是在浏览器点击（与 `ctx.request`）打真实 URL 的时候。

> 教训：**路径形状属于路由层，只有端到端能证。** 凡是"手工传 params"的测试都覆盖不到它。
> 本文件的 describe 名已按**真实路径**书写，以免后人照着 4 段写法再踩一次。

---

## 5. L4 —— 移动端 E2E `tests/e2e/consent-trust.spec.ts`（7 例）

Pixel 5 视口 + **系统真实 Chrome**（`playwright.t02.config.ts`；本机 Playwright 自带 chromium 在 macOS 13 不受支持）。
`test.describe.serial`：多条用例**有意**共享一条状态演化链（它们要证的正是"状态怎么变"）。

| # | 用例 | AC | 判据（刷新后依然成立的持久事实） |
|---|---|---|---|
| 1 | 🔒 匿名访问提案页 → 重定向登录 | — | 提案是成员数据，未登录不得见 |
| 2 | ✅ 分区渲染：待处理 / 已建立 / 已结束 | AC-04 语义 | 文案**不把**「双方同意」说成「已连接」 |
| 3 | ★ AC-04 单方同意 → 仍是待决 | AC-04 | 状态仍 `待决`；`introducedAt` 为空 |
| 4 | ★ AC-04 双方都同意 → 「等待介绍」，仍非已连接 | AC-04 | 卡片进入「已建立」**前**的分区；无任何介绍痕迹 |
| 5 | ★ AC-06 运营介绍 → 200；重复介绍 → 409 | AC-06 | 介绍后卡片进「已建立」；二次 POST 得 409 |
| 6 | ★ AC-05 拒绝 / 撤回 → 终态，且不再有动作 | AC-05 | 拒绝 → 已拒绝；撤回 → 已撤回；动作区消失 |
| 7 | 🔒 档位随阶段升级 + 未授权字段不出现 | AC-03/披露 | 未介绍 → `CANDIDATE`（哨兵不出现）；已介绍 → `COUNTERPARTY`（age 可见 **而** bio 仍不可见） |

夹具（见 §6）里每条提案的 `rationale` 文本唯一，用例靠它定位卡片（`cardBy()`）。

---

## 6. 夹具设计（三个 seed 脚本）

| 脚本 | 角色 | 关键约束 |
|---|---|---|
| `scripts/qa/seed-t02-e2e.mjs` | 建隔离库 + 基线（`--regenerate` 清空重建） | T02/T03 的前提；**每次从零开始** |
| `scripts/qa/seed-t04-e2e.mjs` | **追加式**播种 T04 样本（互补/非互补/被门控） | **不删除任何东西**，与 T02 脚本正交 |
| `scripts/qa/seed-t05-e2e.mjs` | 追加 T05：**独立 Mission** `mission_e2e_t05` + 6 提案 + 3 新用户 | **绝不写进 `mission_e2e_active`** |

**为什么 T05 另开一条 Mission**：召回是按"该 Mission 下的 `SocialIntent`"遍历的。
往 `mission_e2e_active` 里加人会让 T04 的 `considered` 从 2 变成 5、`gatedOut.not_participant` 也随之变 ——
那等于把两条用例的成败绑在一起，一处失败无法判断是谁弄坏的。**T04 的断言输入保持逐字不变。**

**六条提案，每条只证一件事**（互不重叠，失败即可定位）：

| id | 发起 → 被介绍 | 初始状态 | 用于 |
|---|---|---|---|
| `cp_e2e_decline` | t05a → member | `CONSENT_PENDING` | AC-05「拒绝」腿 |
| `cp_e2e_pending` | op → member（op 已 accept） | `CONSENT_PENDING` | member 同意 → 双方已同意（仍非连接） |
| `cp_e2e_mine` | member → t05a | `CONSENT_PENDING` | AC-04 单方同意仍是待决 |
| `cp_e2e_mutual` | peer → member（双方已 accept） | `MUTUALLY_ACCEPTED` | 同意≠已连接；档位仍 `CANDIDATE`；AC-05「撤回」腿 |
| `cp_e2e_intro` | t05b → member（双方已 accept） | `MUTUALLY_ACCEPTED` | 已建立；档位升级 `COUNTERPARTY` |
| `cp_e2e_rejected` | noise → member | `REJECTED` | 终态进「已结束」，无任何动作 |

**哨兵值**（`SENTINELS`，在 spec 与 seed 里**刻意重复两遍**，好让"夹具改了断言没改"在 review 里显眼）：
`peerBio='十年印尼落地经验'`、`peerAge=47`、`t05bBio='这段自述只给组织者看'`、`t05bAge=53`。
前两个用于"未介绍时不得泄露"，后两个用于"介绍后 age 可见、bio 仍不可见"。

---

## 7. 把 E2E 从「偶发红」修成「稳定绿」的三处竞态

这三条是本刀花时间最多的地方 —— 它们都不是功能 bug，而是**测试与 dev 环境的竞态**。

### 7.1 `authedContext`：**不加载登录页**

前一版沿用 T02/T03/T04 的"进登录页 + 在页面里 fetch 登录端点"，在 T05 实测太贵：
① 登录页在 dev 下现场编译（实测 `GET /login 200 in 13.9s`）；
② 更糟的是**登录成功后登录页自己会跳去 `/dashboard/connections`** —— 又搭进十几秒，且与本用例要证的东西毫无关系。

改法：`browserContext.request.post('/api/auth/login')` —— 它**共享本上下文的 cookie 罐**，
拿到的 `Set-Cookie` 直接落进 ctx，后续 `ctx.newPage()` 天然就是已登录态，**全程不加载任何 HTML 页面**。
打的是**同一个端点**、带同一个 `Origin`（同源守卫要它），没有绕过被测逻辑，只是省掉了"用页面当 fetch 容器"这件无关的事。

### 7.2 `actOnProposal`：以 **POST 响应** 为锚点，不以瞬态提示为锚点

第一版写"点击 → 断言出现「已关闭」提示"，间歇失败。两个互相独立的坑：

- **终态动作的提示会被刷新卸载**：动作成功后 `router.refresh()`，而闭合的卡片**不再渲染动作区**
  （`page.tsx` 里 `actions.length > 0` 才渲染 `ProposalActions`）→ 断言它等于抢一个瞬态 DOM。
  实测：服务端其实已 `200`、库里 `status` 已是 `REJECTED`，提示却没被捕捉到。
- **首个写请求在 dev 下可能现场编译到 68 秒**：指纹 `POST /api/v1/connections/{id}/consent 200 in 68s (next.js: 67s, application-code: 1157ms)`
  —— 慢的是框架编译，不是业务代码。**等 POST 响应**天然不受编译耗时影响。

因此锚点取 **POST 的响应**，判据取**重载之后依然成立**的事实。
两阶段设计：阶段一只负责"让动作真的发出去并拿到响应"（很便宜、可多次重试）；
阶段二只做**一次**重载 + 断言（由阶段一保证动作已发生）。
阶段一需要重试还因为**点击可能落在 hydration 完成之前**（`click()` 只等可见/可用，不等 React 挂上 `onClick`），此时点了个寂寞、没有任何请求；`409` 不算失败 —— 那正是"动作已生效过"。

### 7.3 「用户能看到的」≠「刷新后仍成立的」

> **这条值得单独记。** 断言"用户能看到的"（瞬态提示、过渡态）的用例，在 dev 下**必然偶发**；
> 只有"刷新后仍然成立"的持久事实（分区归属、终态、有无动作区）才是可以长期守住的判据。

配套：写路由也**必须预热**（`beforeAll` 里对 consent/revoke/introduce 不带凭据调用 → 401，
401 发生在业务代码之前，**零副作用**，但路由模块已被编译好）。

---

## 8. T04 回归：登录页脆弱性与等价复验

`candidate-match.spec.ts` 的第 2/3 例用 `loginViaUi()` 走**真实登录页**。在本机 dev（Turbopack 冷编译 + 8G 内存）下连续 2 轮复现失败，**失败点在登录、不在候选页**：

```
await loginViaUi(page, context, MEMBER_EMAIL, PASSWORD)
expect((await context.cookies()).some(c => c.name.includes('session-token'))).toBe(true)
// → Expected: true  Received: false
```

页面快照显示仍停在登录页，并提示 `Please enter your email and password.` ——
即登录页的**受控组件在 hydration 完成前接受 `fill()` 却不让 React state 更新**，提交时前端校验报"字段为空"。3 次重试全部如此。

**这是登录页的脆弱性，与候选页断言无关**（它根本没执行到候选页）。为把"登录方式"这个无关变量消除掉，
新增可复跑脚本 **`scripts/qa/verify-t04-candidate-regress.mjs`**：用与 §7.1 相同的手法
（`ctx.request.post('/api/auth/login')`）登录后打开候选页，复跑 ④ 三条断言与候选页核心断言 ——

```
✓ 登录成功（session-token 已落 ctx） — HTTP 200
✓ 候选页渲染（matches-page + matches-list）
✓ 无候选空态未出现
✓ 候选卡数量 = 1
✓ 依据含「你」「对方」
✓ 依据引用命中原词（清关 / 分销）
✓ need 正文含「分销渠道」  ✓ offer 正文含「清关与仓储」
✓ 档案含昵称 陈岸  ✓ 档案含城市 雅加达  ✓ 档案用中文标签（昵称 / 城市）
✓ ④ matches-connect-note 可见
✓ ④ matches-view-proposals 可见
✓ ④ propose-open 不存在（普通成员看不到发起按钮）
✓ 移动端无横向滚动（overflow ≤ 1）
结果：15/15 通过
```

**结论**：T05 对 `candidate-match.spec.ts` 的改动（`matches-connect-coming` → `matches-connect-note` +
`matches-view-proposals`，且普通成员不得见 `propose-open`）**没有破坏候选页**。
T04 的 UI 登录腿在 dev 下不稳，属既有环境问题，**建议 T12 端到端门禁一并处理**（把 E2E 登录统一切到 `ctx.request` 手法）。

---

## 9. 回滚演练证据

见 `rollback.md`（含官方 `migrate.mjs rollback` 与等价 DROP 两条路径的实测输出）。
要点：T05 是**纯新增**（2 表 + 10 索引，无 ALTER / 无 DROP / 无数据订正），迁移与回滚**零停机**；
DDL 演练在**种子库副本**上执行，回滚后 `SocialIntent / MissionParticipation / User / Mission` 行数**保持不变**（反向自证只动了该动的两张表）。

---

## 10. 未覆盖 / 已知盲区

| 项 | 状态 | 归属 |
|---|---|---|
| **并发真造 race**（两请求同时 introduce） | ⚠️ 只做了 CAS 写入的**单元级**证明，未用双写到真库上并发对撞 | T12 负载验证 |
| **投递可靠性**（重试/超时/死信） | ❌ 未做；本刀只有同步执行点 | T06 |
| **通知送达**（"你有新提案"） | ❌ 未做；靠用户主动打开 | T06 |
| **UI 登录链路**（真实登录页） | ⚠️ 由 T02/T03/T04 spec 覆盖；本刀 E2E 刻意不加载登录页 | T12 统一 |
| **移动端手势**（滑动 / 长按） | ⚠️ 仅验视口与无横向滚动 | 真机 / 后续 |
| **分页** | ⚠️ `limit` 默认 50，无游标 | T12 |
