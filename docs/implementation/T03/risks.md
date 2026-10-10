# T03 · risks — 风险与残留

> 分级：🔴 上线阻断 / 🟡 需关注 / 🟢 已消解（保留记录以免后人重复踩）。
> 每条都写"**为什么**它是风险"与"**什么时候**必须消解"，而不是只贴标签。

---

## 🔴 R1 — AC-03 的另外两个下游（检索、Agent 上下文）尚未接线

**状态**：本任务只覆盖了「未授权字段不进入 **API 响应**」这一条。AC-03 的原文是
「未授权字段不进入 Agent prompt、**检索结果**、消息」。

**为什么是阻断级**：AC-03 是 BLOCKER。T03 交付的 `discloseSubject()` 是**结构化**投影，
而 T04 的候选召回大概率会走"另写一条 select 把 profile 捞出来做排序"——那条路一旦出现，
披露就只在 API 层有效、在召回层失效，且**不会有任何测试报错**（因为披露测试测的是 `discloseSubject` 本身）。

**消解时机与方式**：

- T04 开工时，候选的字段装载**必须**经 `fieldsVisibleTo()` 先求可见集合，再投影；
  禁止在召回路径上出现裸 `db.profile.findMany({ select: ... })` 后直接返回给调用方。
- T09 开工时，注入 Agent 上下文的成员资料必须来自同一函数。
- 交接判据（写进 T04 卡片）：**新增一条测试，断言召回结果里不含未授权字段的键**，而不只是断言排序正确。

---

## 🔴 R2 — 隔离仍是应用级，不是数据库级

**状态**：继承 T01/T02。libSQL 没有 RLS，`SocialIntent` 的隔离完全靠 `intents.ts` 里的三重谓词
（`id` + `organizationId` + `userId`）。

**T03 的具体表现**：意图是**最敏感**的一类数据（含 `need`/`offer` 正文 + 披露配置），
比 T02 的 Mission（组织级内容）更容易因一次谓词遗漏而跨租户泄露。

**已做的补偿**：

- 服务层所有函数签名都要求 `TenantContext`（`ctx.organizationId` 不由客户端提供）；
- `tests/connection/intents.test.ts` 里有**防回归锁**：逐一断言每条查询都带谓词；
- 组织者视角走**另一条**独立函数，且只返回投影（不含 `userId`）。

**残余**：编译期无法强制。彻底消除要靠 M6（迁 PostgreSQL + RLS）。

---

## 🟡 R3 — `constraints` / `disclosure` 是 String 存的 JSON

**状态**：`SocialIntent.constraints` 与 `disclosure` 都是 `String`（libSQL 无 `jsonb`）。

**已消解的部分**：编解码收敛到 `json-codec.ts`（`constraints`）与 `disclosure.ts`（`disclosure`），
写路径 `normalizeDisclosure` fail loud、读路径 `decodeDisclosure` fail silent（脏数据丢弃而非抛错）。

**残余风险**：第三方工具直连数据库写入时不受这道收口保护。
一旦上 PG，应改为 `jsonb` 列并把校验下沉到 DB 约束。

---

## 🟡 R4 — 幂等指纹曾把 `Date` 序列化成 `{}`（已修，但同类风险仍在）

**问题**：`stableStringify` 用 `Object.entries(value)` 递归，`Date` 的属性不可枚举 → 序列化成 `{}`。
后果：`expiresAt` 不同但其他字段相同的两次提交算出**相同指纹**，幂等层判定为"重放"并返回旧结果 ——
用户改了有效期却被告知"提交成功"，而库里没变。

**已修**：显式识别 `instanceof Date` 走 `toISOString()`。`tests/connection/idempotency.test.ts` 已加锁。

**同类风险**：任何**非 JSON 原生**的值进入指纹都会静默退化（`Map` / `Set` / `undefined` 同理）。
当前入参解析已把输入收敛为 `string` / `number` / `boolean` / `string[]` / `Date`，暂不构成实际暴露面。
若将来允许结构化入参，**先扩展 `stableStringify` 再放行**。

---

## 🟡 R5 — 过期是"派生"的，依赖查询时刻的 `now`

`EXPIRED` 不落库，由 `expiresAt <= now` 现算（`deriveIntentStatus`）。好处是不需要定时任务、
不存在"任务停摆导致过期不生效"。代价是**结果依赖调用方传入的时钟**。

**当前**：所有调用点都用 `new Date()`（服务层默认参数），没有跨时区/跨机器比较。
**消解时机**：多实例部署且要"按时"触发下游动作时（例如 T06 的定时任务），必须改用**服务端统一时钟**
（DB 的 `CURRENT_TIMESTAMP` 或显式注入的 `now`），否则不同实例的时钟偏移会让"刚好过期"的意图在不同实例上判定不一致。

---

## 🟡 R6 — 撤销/过期后"披露归零"是读时判定，将来加缓存必须同步失效

`liveDisclosureOf()` 在**每次投影时**判断：非 `ACTIVE` 或已过期 → 返回空披露表。
因此撤销是**立即**生效的，不依赖任何后台清理。

**但**：一旦在投影外层加缓存（例如给组织者视图加 5 分钟缓存），这条不变量就破了 ——
撤销后缓存里仍是旧投影。**加缓存时必须同时加"撤销/编辑即失效"的逻辑，或在缓存键里带上 `updatedAt`。**

---

## 🟡 R7 — 字段 label 有第二份定义（前端分组标题）

`field-catalog.ts` 是字段的单一事实来源，但 `intent-form.tsx` 里有一个
`GROUP_LABELS`（identity/professional/background/preference/contact 的中文名）。
新增分组时若忘记同步，界面会直接显示英文 group 键（`{GROUP_LABELS[group] ?? group}` —— 有兜底所以**不会崩**，
但也**不会报错**，只会显示成 `newGroup`）。

**消解时机**：下一次改字段目录时，把 `GROUP_LABELS` 也搬进 `field-catalog.ts`。

---

## 🟡 R8 — E2E 依赖本机真实 Chrome 与 dev server，未接 CI

`playwright.t02.config.ts` 用 `channel: 'chrome'`（本机 Playwright 自带 chromium 在 macOS 13 不受支持），
且需要先起 `next dev` 与隔离库。**当前只能在开发机复现**，CI 里不会跑。

**影响**：AC-12/AC-03 的浏览器证据是**人工可复现**，不是自动化门禁。
**消解时机**：接入 CI 时统一用 `next build && next start`（生产模式）+ 容器内 chromium，可同时消掉 R9 的 dev 差异。

---

## 🟡 R9 — Turbopack dev 路由缓存会伪装成"路由不存在"

**症状**（本次实施中真实发生）：`/api/v1/public/missions/<token>` 返回 200，
同目录下的 `/join` 返回 **Next 全局 404 页**（HTML，不是业务 JSON 信封），
`git status` 干净、文件内容完好、`tsc` 通过。

**判据**：对同一 URL 发 `GET`。**路由存在 → 405**（方法不允许）；不存在 → 404。
本次 GET 返回 404 ⇒ 路由未注册，而非业务 404。

**处理**：删 `.next` 重启 dev server。**这是一条工程性风险**：它会诱导人去改本来正确的业务代码
（本次若直接"修" join 路由，会引入一个不存在的 bug）。

---

## 🟢 R10 — 受众档位方向（包含式）曾实现反了

**曾发生**：初版实现把 `COUNTERPARTY` 理解为"仅对手方可见"，与文档注释的
`SELF < ORGANIZER < COUNTERPARTY` 矛盾。若流入生产，会造成**更宽的档位反而更保密**的静默权限反转：
用户以为选了"匹配后可见"，实际连组织者都看不到（功能失效）；
反过来若有人在别处按"更宽"理解，就会把本不该给对手方的字段发出去。

**已消解**：统一为包含式，并在 `connection.prisma` 的枚举上写 `///` 注释固化语义；
`field-catalog.test.ts` / `disclosure.test.ts` / `intents.test.ts` 三处断言锁死方向。

---

## 🟢 R11 — `SELF` 曾能让投影返回全量档案

**曾发生**：`discloseSubject(profile, live, 'SELF')` 在"档位 rank ≥ viewer rank"判据下对每个字段都成立
→ 返回整份档案。这是一个**危险的 API 形状**：任何一处误传 `SELF` 就等于全量泄露。

**已消解**：三层防线（`audienceCanSee` 恒 false / `ExternalAudience` 类型排除 / `byAudience` 类型排除），
其中两层是**编译期**的 —— 误传直接 `tsc` 失败，不依赖运行期测试覆盖。

---

## 🟢 R12 — Service Worker 曾缓存所有 `/api/` 响应（已修，且已上锁）

**曾发生**（本任务实施中由移动端 E2E 抓出，**不是** T03 引入的，是既存 `public/sw.js` 的策略）：

```js
// 旧代码
if (isApiRequest(request)) {
  if (request.method === 'GET') {
    event.respondWith(staleWhileRevalidate(request, API_CACHE))   // ← 先返回缓存副本
  }
  ...
}
```

`staleWhileRevalidate` 的语义是**立即返回缓存、后台再更新**。于是：

1. **功能**：任何"刚写完立刻读"都会拿到**上一次**的数据。
   T03 的暴露路径：用户把字段从「组织者」收紧为「仅自己」→ PATCH 成功（库里确认写入 `SELF`）
   → 随后的 `GET /disclosure` 返回的却是缓存里的旧范围 → 界面显示"年龄：32"仍在对组织者可见。
   **反向更危险**：放开授权后界面不更新，用户以为没生效。
2. **隐私**：意图正文、披露配置、组织者视角的成员资料、会话响应都被写进 Cache Storage，
   在设备上留下可被后续会话/其他账号读取的副本；撤销披露后旧副本依然可读。

**为什么很难发现**：服务端日志里**有**那次请求且返回 200（SW 确实转发了网络请求），
应用层的单测、集成测试、类型检查全部正常 —— 只有"真实浏览器 + 真实 SW + 连续两次读"才暴露。

**已消解**：

- `public/sw.js`：`/api/*` **一律不拦截**（直接 `return`），交给浏览器按 HTTP 语义处理 ——
  这样服务端本来就有的 `Cache-Control: no-store` 才真正生效；
- 同时把默认分支的缓存名从 `API_CACHE` 改为语义准确的 `PAGE_CACHE`，消除"API 分支复用一个名叫 API 的页面缓存"这个后门；
- `CACHE_VERSION` v3 → v4，且 `activate` **继续清理 `api-` 前缀** ——
  否则"不再写新缓存"只对新请求生效，设备上旧的那份个人数据副本会永远留着；
- 新增 `tests/sw-cache-policy.test.ts`（7 条源码断言）把它钉死：API 分支不得出现 `respondWith`、
  任何策略不得使用 `API_CACHE`、activate 必须仍清理 `api-` 前缀。
  （`sw.js` 是纯 JS，不在 `tsc` 覆盖范围内，这类约束只能用源码断言守住。）

**残留**：默认分支（页面导航）仍走 `networkFirst(request, PAGE_CACHE)`，会把**已登录用户的页面 HTML**
写入 Cache Storage。它不会造成"读到旧数据"（network-first 在线时总是走网络），但仍属设备上的个人数据副本。
**建议**：后续把该分支也改为不写缓存（或仅在离线时使用），需要产品确认离线体验的取舍后一并处理。

---

## 🟡 R13 — E2E 夹具库的 `--reset` 曾与 dev server 的句柄冲突

**曾发生**：`seed-t02-e2e.mjs --reset` 原本是 `unlink` 库文件再重建。若 dev server 已经在运行，
它持有的文件句柄指向**被 unlink 的旧 inode**，而 SQLite 的 `-wal` 是按**路径**打开的 →
主库 fd 与 wal 对不上，写入直接报 `SQLITE_READONLY: attempt to write a readonly database`。
症状极具误导性：**读全对、写全挂**（页面能渲染夹具数据，一提交就 500），
报错说 "readonly" 而文件权限其实是 `rw-r--r--`。

**已消解**：`--reset` 改为在同一个连接里 `DROP` 全部表后重建，文件 inode 不变 →
dev server 无需重启即可反复重跑。**这是测试工具链的修复，不是产品缺陷**，
但它浪费的排查时间最多（容易被误判成权限问题）。

---

## 🟡 R14 — `intents.ts` 的 `update` 只带 `id` 谓词

`db.socialIntent.update({ where: { id: current.id }, ... })` 生成的 SQL 是
`WHERE (id = ? AND 1=1)` —— **没有** `organizationId` / `userId` 谓词。

**为什么当前安全**：紧邻其前必有一句 `findFirst({ where: { id, organizationId, userId } })`，
不存在则抛 404，因此能走到 `update` 的行必然已通过三重谓词。

**为什么仍要记录**：它让"每条查询都带租户谓词"这条防回归锁出现了一个**例外**，
而例外是下一次重构时最容易被扩大的地方（例如有人把 findFirst 的谓词放宽，update 就悄悄越权了）。

**根治方式**：等 M6 迁 PostgreSQL 后改用 `updateMany({ where: { id, organizationId, userId } })`
并断言 `count === 1`（libSQL 下 `updateMany` 亦可用，但会失去返回值，需要额外一次读）。
