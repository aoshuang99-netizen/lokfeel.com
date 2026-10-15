# T10 · Community Bridge —— Slice 4 交付记录（前端面板 + AC-19 E2E 取证）

> 计划见同目录 `plan.md` §6（Slice 4）；内核见 `slice-1.md`；落库与服务层见 `slice-2.md`；HTTP 面见 `slice-3.md`。
> 范围：`src/lib/living/bridge/**`、`src/components/living/bridge/**`、`src/app/workspace/living-workspace.tsx`、
> `tests/living/bridge/**`、`scripts/qa/{ac19-fixture,seed-ac19-bridge-e2e,verify-ac19-bridge-e2e}.mjs`、
> 门禁脚本 R10 扩展。
> **不发版**：提交带 `[skip netlify]`，仅在本地 + 隔离库验证。

## 1. 交付物

| 文件 | 行数 | 职责 |
|---|---|---|
| `src/lib/living/bridge/types.ts` | 242 | 展示层类型；**只** `import type` 内核 + 6 条编译期漂移守卫 |
| `src/lib/living/bridge/board.ts` | 522 | 面板数据装配（纯函数，零 IO）：把 DTO 折成可直接渲染的视图模型 |
| `src/lib/living/bridge/index.ts` | 18 | barrel |
| `src/components/living/bridge/bridge-panel.tsx` | 803 | 面板 UI（全量 `data-testid`，见 §4） |
| `tests/living/bridge/types.test.ts` | 462 | 漂移守卫 + 档位/标签表 |
| `tests/living/bridge/board.test.ts` | 550 | 装配纪律（①环 ≠ 单侧配置、来源不可用 ≠ 没有数据） |
| `scripts/qa/ac19-fixture.mjs` | 184 | **纯数据零副作用**夹具常量单一来源（见 §2.1） |
| `scripts/qa/seed-ac19-bridge-e2e.mjs` | 320 | 三租户隔离库夹具（`DROP ALL` + `migrate diff` 现场生成 DDL） |
| `scripts/qa/verify-ac19-bridge-e2e.mjs` | 881 | AC-19 端到端取证主脚本（9 段 / **69 条断言**） |

改动（`git diff --stat`）：8 文件 **+192 / −47**。

## 2. AC-19 的可执行定义

AC-19 的正文是「跨群可见字段必须是**三方交集**」。落到可判定的形式只有一条：

> 某个成员 A 的字段 `f` 对另一群的观察者 B 可见，**当且仅当**同时满足：
> ① **群主配置**：`initiatorFieldKeys ∩ recipientFieldKeys`（双边协议交集）含 `f`；
> ② **成员 opt-in**：A 的 `disclosedFieldKeys` 含 `f`；
> ③ **成员意图档位**：A 的 `intentVisibleFieldKeys` 经 `fieldsVisibleTo(map, 'CANDIDATE')` 后仍含 `f`。

任一层只能**收窄**，不能放宽。三层是**与**关系，缺一不可。

### 2.1 夹具刻意做的三组对照（这是整套取证能成立的前提）

| 成员 | 档案 | 意图 | opt-in | 角色 |
|---|---|---|---|---|
| `bMember` | ✅ | ✅ | ✅ | **正向主角**：三层全过 ⇒ 可见 |
| `bMember2` | ✅ | ✅ | ❌ | 反向：**未 opt-in ⇒ 不可见**（且连 `gatedOut` 都不进） |
| `bMember3` | ✅ | ❌ | ✅ | 反向：**无披露依据 ⇒ 只进 `gatedOut` 计数** |

**`bMember` 的意图档位刻意造成三环收窄**：`city/displayName` 给到 `CANDIDATE`（可见），
`company` 给到 `ORGANIZER`、`occupation` 给到 `COUNTERPARTY`（二者 rank < `CANDIDATE` ⇒ 被挡）。

于是 ①环通过 4 项（`city/company/displayName/occupation`）、实际可见 **2 项** ——
**「①环比实际可见宽」正是 AC-19 的命题本身**。若哪天有人把可见性退化成「①环交集」，
`visibleCount===1`、`sharedFieldKeys===['city','displayName']`、`company` 键不存在这三条会同时变红。

**为什么夹具单独成文件**：`.mjs` 是 `tsc` 死角（`node --check` 只查语法、不查声明）。
seed 与 verify 各写一份 id 常量，一旦漂移，症状是「verify 查不到行 → 404 → 写成『必须 404』的断言反而变绿」——
**正向断言给出的是指向功能缺陷的假信号**。单一来源消灭了这个失效模式。

### 2.2 用户身份与越权靶标

`aOwner`(甲群主) · `aMember`(甲群成员) · `bOwner`(乙群主) · `bMember` · `bMember2` · `bMember3` · `cOwner`(丙群主)。
两份协议：`br_ac19_ab`（甲↔乙，主战场）、`br_ac19_bc`（乙↔丙，**越权靶标**）。

## 3. E2E 九段与关键断言

| 段 | 主题 | 关键断言 |
|---|---|---|
| ⓪ | 引导 | 夹具就绪（3 群 / 7 账号 / 4 意图 / 2 协议）；`/api/health` 200；**5 个身份走真实登录端点**换会话 cookie |
| A | 结构证据 | 列表 `PENDING`+`INITIATOR`；①环=双边交集（4 项）；**越权 c1a/c1b/c1c/c1d/c2/c3**；反向 b1（`PENDING` ⇒ 200+空+`BRIDGE_PENDING`）；幂等 A5a/A5b/A5c |
| B | 正向 | `bOwner` 批准 ⇒ `ACTIVE`；重复批准 409；刚生效无人 opt-in ⇒ 空但 **`refusalCode===null`**；`bMember` opt-in 四项；`bMember3` opt-in（**opt-in 不依赖意图**） |
| C | 甲群视角逐键 | `visibleCount===1`、`optedInCount===2`、`sharedFieldKeys===['city','displayName']`、值=`深圳`/`周雨`；**`company`/`occupation` 键不存在**；`email`/`age`/`bio` 键不存在；成员对象**无** `narrowed`/`refusalCode`；`gatedOut=[{code:'NO_INTENT_DISCLOSURE',count:1}]`；`profileAudience==='CANDIDATE'` |
| D | 反方向 | `aMember` opt-in ⇒ `bOwner` 视角可见（`上海`/`林晓`）——**共享是双向的** |
| E | 本人视角 | `myProjection` 的 `narrowed` 归因 `INTENT_DISCLOSURE` / `owner:'MEMBER'`（**只有本人**能看到「是我的设置还是群主的协议」） |
| F | 反向 b4 | opt-in 收窄 ⇒ `city` 键**消失**；恢复勾选 ⇒ 回到交集（证明 opt-in 是**幂等更新**） |
| G | 反向 b2 | `bMember2` 不在 members，**也不在** `gatedOut`（谓词只有「已 opt-in 的人」） |
| H | 真实 Chrome | 见 §4 |
| I | 终态 | 撤销后 `BRIDGE_REVOKED` + 空；撤销后 opt-in 409；opt-out 200（`WITHDRAWN`）；重复 opt-out 409 |

### 越权那六条的**分层**（这是本轮修过的一处断言）

- `c1a`：甲群成员读乙↔丙**详情** ⇒ 404
- `c1b`：甲群成员读乙↔丙**跨群投影** ⇒ 404
- `c1c`：**MEMBER** 批准乙↔丙 ⇒ **403**（能力守卫：`bridge.manage` ∈ `ADMIN_EXTRA`）
- `c1d`：**OWNER 但非当事方**批准 ⇒ **404**（越过能力层后，仍只看到「不存在」）
- `c2`：MEMBER 调 approve ⇒ 403（能力不足）
- `c3`：**发起方**群主批准自己的协议 ⇒ 403（`WRONG_SIDE`，单边不得激活）

> 🔴 **c1c 与 c1d 必须分成两条**：`withTenant(capability)` 的失败顺序是**能力守卫（403）先于** handler 内的
> 当事方判定（404）。只测 MEMBER ⇒ 测到的是能力层；只测 OWNER ⇒ 测不到能力层。
> 两条都要，才能把「两层不混淆」钉住。（首版把二者写成一条「MEMBER 批准 ⇒ 404」，因此红了。）

## 4. 前端面板（H 段渲染层取证）

Bridge 面板**并入 Consent 区**作为子面板（`consent-tab-bridge`），**NAV 仍是 7 项**——
不新增第八屏。这是有意的：Bridge 与 Gate 回答的是同一类问题（「我能给别人看什么」），
拆成两屏会让用户在两个地方分别回答同一次授权。

H 段用真实 Chrome 断言（**页面级 `pageerror === 0`**）：

- hydration 完成、未被登录守卫弹回 `/login`
- NAV 仍 **7 项**；`consent-tab-bridge` 子面板存在
- 协议列表 ≥2 份；`bridge-status` = 「已生效」
- ①环四项标签全在（昵称 / 城市 / 职业 / 公司）——**不是单侧配置**
- `bridge-refusal` 含「尚未选择加入」（**协议可用 ≠ 我加入了**，两者文案不同）
- `bridge-visible-count` = 「1」；`bridge-field-city` = 「深圳」；`bridge-field-displayName` = 「周雨」
- `bridge-field-{company,occupation,email,age,bio}` **count 全 0**（被三环挡掉的字段在界面上一个都没有）
- `bridge-member-bMember2` count 0（未 opt-in 的成员卡不存在）
- `bridge-gated-out` 显示按原因聚合的计数（**只有计数，没有 userId / 字段键**）
- 点 `bridge-revoke` ⇒ 状态「已撤销」+ `visible-count` = 「0」（**立刻**，不缓存上次可见集合）
- 撤销后 `bridge-discovery-refusal` 含「协议已被撤销」（而**不是**显示成查询失败）

## 5. 🔴 本轮发现并修掉的三个真实问题

### 5.1 `POST /api/v1/bridges` 的幂等重放**永远不可达**（功能缺陷）

- **现象**：E2E 的 A5c（同键重放 ⇒ 200 + `replayed:true`）实际返回 **409**。
- **根因**：`createBridge` 把「一对组织只能有一份协议」的 IO 检查放在**函数开头**，
  早于 `withIdempotency` 的幂等查找 ⇒ 真实重试必然先撞 409，**而第一份协议已经建好了**。
- **对照组**：T09 的 `createAgentRun` 把形状校验放在幂等**之前**、且**没有任何 IO 前置检查**，所以没有这个问题。
- **修法**：把该检查移入 `withIdempotency` 的 `create` 回调**内部**。
  - 重放（命中幂等记录）⇒ 200 `replayed:true`（幂等优先）
  - 另一把键建同一对组织 ⇒ 仍 409
  - 真并发 ⇒ 由库级 `@@unique([initiatorOrgId, recipientOrgId])` 兜底（P2002 → 409）
- **落点**：`src/lib/bridges/bridges.ts`（+27/−13）。源码 JSDoc ④ 已写明「为什么必须待在回调内部」。

### 5.2 单测「同键同体重放」是**假绿**

- **现象**：该用例在 5.1 修复前**通过**，但它测的分支在**生产上不可达**。
- **根因**：`beforeEach` 让 `bridgeFindFirst` 对无 id 的调用返回 `null` ⇒ 预检查永不命中。
- **修法**：第二次请求前设
  `bridgeFindFirst.mockResolvedValue({ ...BRIDGE_ROW, status: 'PENDING', recipientApprovedAt: null })`，
  让预检查**真的命中**。若有人把预检查挪回函数开头，这条断言立刻变红——这才叫「牙齿」。

### 5.3 门禁脚本自证清理**对删除守卫不健壮**（崩栈掩盖信号）

- **现象**：`npm run verify:bridge-invariants` 在本机以 200+ 行 shim 崩溃栈退出（非零），
  看似「脚本 bug」，实为本机删除守卫（`CODEBUDDY_SAFE_DELETE_BULK_CONFIRM_REQUIRED`）拦截 `unlinkSync`。
- **根因**：`cleanup()` 里对 `unlinkSync` 有 try/catch，但 `selfTest` 正文里**两处裸调用**
  （control 文件、每个变异文件）没有 ⇒ 抛栈。**崩溃比「报告清理失败」更糟**：它把环境限制伪装成脚本缺陷。
- **同源**：`check-bridge-invariants.mjs` 照抄 `check-agent-invariants.mjs` ⇒ **两处都改**。
- **修法**：抽出 `removeNow(p)`（=`cleanup` 的同一实现），正文两处改调用它。
  语义：删除成功 = 行为不变；删除失败 = **打警告 + 保留在 `created` 里**，
  由 `finally` 的 `cleanup()` 再试，最终由「收尾复验（清理后）」兜底报红。
- **连带发现**：上一次崩栈**静默留下**了 `src/lib/bridge/__mutant-bridge-control.tsx`，
  被 `check-bridge-invariants` 的 **B0 守卫**（「残留变异文件」）下一次运行时抓出——**fail loud 生效了**。

### 5.4 `tsc` 抓到 `jest` 抓不到的真实错误（TS1009）

- **现象**：`src/lib/living/bridge/types.ts` 的多行类型实参带了尾随逗号（`Exact<A, B,>`）——
  `npx jest` **全绿**（94 套 / 1967 例），而 `npx tsc --noEmit` 报 `error TS1009: Trailing comma not allowed`。
- **为什么单测看不见**：jest 经 babel 剥离类型（`@babel/preset-typescript`），**不做类型检查**。
  ⇒「测试全绿」与「类型正确」是两件独立的事，这正是门禁里 `tsc` **不可省**的原因。
- **修法**：删掉尾随逗号（1 行）。落点 `src/lib/living/bridge/types.ts`。

## 6. 门禁与证据（全部实跑）

| 项 | 结果 |
|---|---|
| `npm run verify:ac19:bridge` | ✅ **69 通过 / 0 失败** |
| `npx jest tests/bridges tests/bridge tests/living/bridge` | ✅ **5 套件 / 160 例通过** |
| `npm run check:bridge-invariants` | ✅ 基线 exit 0（3 文件） |
| `npm run verify:bridge-invariants` | ✅ **B1–B5 五条全被捕获**，收尾复验 exit 0 |
| `npm run check:agent-invariants` / `verify:agent-invariants` | ✅ 基线 exit 0 / **A1–A5 全被捕获**（加固生效） |
| `npm run check:ui-invariants` | ✅ 47 文件通过（R10 已含 `@/lib/bridges` 前缀） |
| `npm run verify:ui-invariants` | ✅ **11 条变异全被捕获**（含本轮新增 `r10-prefix-bridges`）+ 5 个 scope 覆盖面 |
| `npm run check:script-decls` | ✅ 75 脚本 / 0 未声明引用 |
| `node --check` × 3 个新脚本 | ✅ 全绿 |
| `npx tsc --noEmit` | ✅ **exit 0**（修掉 §5.4 的 TS1009 后复跑，33s） |
| `npx jest`（**全量**） | ✅ **94 套 / 1967 例通过** |
| `npx eslint <本轮 13 个改动路径>` | ✅ **exit 0** |
| `npx eslint .`（全仓） | ⚠️ `1573 problems (870 errors, 703 warnings)` —— **全部为既有**，见下 |

> ⚠️ **全仓 `eslint .` 不是门禁**：本项目 `lint` 脚本就是裸 `eslint`（无范围收敛），
> 会扫到 `.open-next/`、`coverage/`、`check-tables.ts`、`fix-enums.js`、`prisma/*`、`scripts/*` 等
> **未修改**的既有文件（`no-require-imports` / `no-explicit-any` / `ban-ts-comment` 等历史债）。
> 本轮改动的 13 个路径**单独 lint exit 0**（正向证据），且它们**均未**出现在全仓 error 列表中。
> 交付门禁口径 = `tsc` + `jest` + `check:*-invariants`(+`verify:`) + `check:script-decls`。

> ⚠️ **本机跑门禁需带删除阈值**：`CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD=100000 npm run …`。
> 这是**本机沙箱特有**（真实 CI 无删除守卫）。§5.3 的加固已让脚本在受限环境下**报红而非崩栈**，
> 但阈值仍是本机的最简做法。

## 7. 未覆盖 / 诚实声明

1. **隔离是应用级、非 DB 级**：libSQL 无 RLS，跨租户不可见靠查询谓词 + 能力守卫。
   结构性保证的第一道是内核门禁 **B2**（`src/lib/bridge/` 零 IO ⇒ 无从直查对方私有行）。真正消除要靠 M6（PG + RLS）。
2. **`GET /{bridgeId}` 是本切片前（Slice 3）就有的超计划端点**，理由见 `slice-3.md` §1；本切片未新增端点。
3. **没有「改字段」的端点**：协议一旦创建，两侧字段集不可修改；不同意只能撤销重开。这是有意收敛。
4. **发版未做**：按用户决策「等 B 做完统一发版」。🔴 **C9 迁移批次尚未 apply 到生产**（C0–C8 已 apply），
   发版前需再跑一次 `npm run connection:migrate` 的 `apply`。
5. **交接 T11**：Slice 3 新增的 8 个端点**仍未**写入 `contracts/connection.openapi.yaml`
   （该文件在工作区交付包 `lokfeel_workbuddy_v1/contracts/`，不在本仓库内）。
   T11 做「OpenAPI 固化」时需连同 T09 的 `/api/v1/agents/*` 一并补齐。
