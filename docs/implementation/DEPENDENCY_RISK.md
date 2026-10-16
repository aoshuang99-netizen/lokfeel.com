# 生产依赖风险登记册（AC-23）

> 状态：**已登记并纳入门禁**（2026-10-16）
> 配套门禁：`scripts/ci/dependency-ratchet.mjs` · 冻结快照 `dependency-baseline.json`
> 机制说明：`CI_GATES.md` §5

---

## 0. 先说清楚这份文档**不是**什么

它**不是**「这些高危我们已经处理完了」。事实是：

> **本次没有升级任何依赖。** 这 28 条生产可达的高危/严重项，
> 全部处于「**已登记 + 已在有效期内**」状态，**不是已修复**。

之所以这么做，理由在 §2（`npm audit fix` 的实测结果）。
之所以还能让 CI 变可信，是因为门禁从「恒红」改成了**棘轮**：
新增高危、严重度升级、缺书面理由、豁免到期 —— 四种情况**都判红**。

**未完成的补救已列为 AC-23 之后的第一优先跟办项**，见 §5。

---

## 1. 口径与统计（2026-10-16 实测）

| 口径 | high | critical | moderate | low | 是否阻断 CI |
|---|---|---|---|---|---|
| 全量（含 devDependencies） | 34 | 3 | 28 | 2 | ❌ 不阻断（仅打印） |
| **生产可达**（`npm audit --omit=dev`） | **26** | **2** | 7 | 2 | ✅ **棘轮阻断** |

**为什么 dev 侧不阻断**：37 条 high/critical 里有 9 条来自
`jest` / `ts-jest` / `eslint-config-next` / `@next/eslint-plugin-next` ——
它们**不进生产运行时**（Netlify 构建产物不含 devDependencies）。
把两组混进一个门槛，结果是真正该拦的生产漏洞被工具链噪音淹没（这正是改造前的状态）。

---

## 2. 为什么不做 `npm audit fix` 一把梭（实测，不是推测）

```bash
$ npm audit fix --dry-run
# add 122 / remove 34 / change 162 packages

$ npm audit fix --dry-run --json | jq .metadata.vulnerabilities
{ "info":0, "low":2, "moderate":28, "high":34, "critical":3, "total":67 }
#                                                            ↑ 与修复前**完全一致**
```

两条结论：

1. **动了 162 个包，却一条 high/critical 都没消掉。**
   可修复项全部要求 semver-major 升级（`fixAvailable.isSemVerMajor: true`）；
2. 该计划里含 `undici 7→8`、`deepmerge-ts 7→8` 这类**主版本跃迁** ——
   变更半径已经远大于「CI 门禁改造」，**必须在发版冻结期之外单独跑一轮全量回归**
   （`tsc` + jest 98 套 / 2030 例 + `next build` + 新增的 e2e 冒烟）。

⇒ 结论：**批量升级是一次独立的、有实质风险的变更，不应夹在门禁改造里做。**
本登记册负责「不让它被遗忘」；门禁负责「不让它变多」。

---

## 3. 逐组处置（28/28 已登记）

> 每组的 `reviewBy` **到期由门禁判红** —— 不允许永久豁免。
> `disposition` 取值：`fix-planned`（已排期修）· `accept`（接受）·
> `mitigated`（有补偿控制）· `not-reachable`（不可达）。

### 3.1 `upgrade-queued` —— 18 条 · `fix-planned` · reviewBy `2026-11-15`

```
@fastify/busboy  @modelcontextprotocol/sdk  @prisma/config  browserslist
deepmerge-ts  engine.io  fast-uri  form-data  hono  ip-address  mysql2
prisma  sharp  socket.io-parser  source-map-js  ws
proxy-addr (critical)  websocket-driver (critical)
```

- **可修**：npm 判定 `fixAvailable: true` —— 范围内传递升级即可修复。
- **为何现在不修**：见 §2。已排入「依赖升级批次」。
- **优先级**：`proxy-addr` / `websocket-driver` 为 **critical**，属该批次**第一优先**。
- **可达性提示**：`ws` / `engine.io` / `socket.io-parser` 属实时通道链路；
  `sharp` 属图片处理（生产在用）；`prisma` / `@prisma/config` 属 ORM 本体。

### 3.2 `framework-upgrade-queued` —— 1 条 · `fix-planned` · reviewBy `2026-11-15`

```
next
```

- **可修**：`next` 16.3.6 → **16.4.2**，`isSemVerMajor: false`（小版本）。
- **为何现在不修**：Next 小版本会变动编译期与运行期行为，必须整轮回归，
  不宜与门禁改造同批。
- **优先级**：**依赖升级批次的第一优先项** —— 它是框架本体，生产直接可达，
  且是所有依赖里影响面最广的一个。

### 3.3 `auth-stack-no-viable-fix` —— 3 条 · `accept` · reviewBy `2026-12-15`

```
@auth/core   @auth/prisma-adapter   next-auth
```

- `@auth/core` / `@auth/prisma-adapter`：`fixAvailable: false` —— **不存在可升级到的修复版本**；
- `next-auth`：npm 给出的「修复」是降到 **1.12.1（v1 遗留线）**，而生产在 `5.0.0-beta.32`
  —— 属**降级**，不可采纳。
- **为何只能接受**：三者同属 next-auth v5 **beta** 认证栈，上游尚在 beta 期，无正式版可升。
- ⚠️ **这是本次豁免里影响面最大的一组**（认证是生产主链路），
  到期复审列为**最高优先**；它本质上是「升级到 next-auth 正式版」这一动作的一部分。

### 3.4 `mail-no-fix-and-channel-off` —— 1 条 · `mitigated` · reviewBy `2026-12-15`

```
nodemailer
```

- `fixAvailable: false` —— 全线版本受影响，无修复版本可升。
- **补偿控制（真实、可验证）**：真实邮件外发通道在生产**尚未启用**
  （缺 `RESEND_API_KEY`，见 `verify:email:channel`），
  当前**没有面向公网的可达外发路径**，实际暴露面为零。
- 🔴 **失效条件**：**一旦启用 RESEND，本豁免立即失效，必须先复核。**
  （`FINAL_ACCEPTANCE_REPORT.md` §4.5 已记「接上即 `CAPTURED → SENT`，零代码改动」——
  也就是说这条豁免的失效**不需要改代码**，所以必须写在这里，
  而不是指望有人在启用邮件时想起来。）

### 3.5 `upgrade-is-downgrade` —— 5 条 · `mitigated` · reviewBy `2026-12-15`

```
firebase   @firebase/firestore   @firebase/firestore-compat
@grpc/grpc-js   protobufjs
```

- npm 给出的 `fixAvailable` 指向 **`firebase@9.14.0`**，而生产在 **12.19.0**
  —— 那是**降级**，不可采纳。
- 属 firebase SDK 的上游告警沿 `firestore` → `@grpc/grpc-js` / `protobufjs` 链路传递。
- **为何只能缓解**：只能等上游在 12.x 线修复；在此之前保持现状并到期复核。

---

## 4. 门禁如何兜住这 28 条

`scripts/ci/dependency-ratchet.mjs` 对**生产可达**高危执行四类判定，任一命中即判红：

| # | 判定 | 含义 |
|---|---|---|
| 1 | 出现**基线之外**的新高危包 | 供应链新增风险 |
| 2 | 已冻结项的**严重度升级**（如 high → critical） | 风险变重（比总数更早发现） |
| 3 | 已冻结项**缺少书面豁免**（缺 `reason`/`disposition`/`reviewBy`） | 防「冻结了但没写理由」 |
| 4 | 豁免的 **`reviewBy` 已过期** | 防「永久豁免」 |

自证 `npm run verify:check:deps` 逐条证明这四类**真的会红**（6/6 通过）。

---

## 5. 未完成项（已在 BACKLOG 登记）

| # | 动作 | 优先级 | 为什么必须做 |
|---|---|---|---|
| 1 | **依赖升级批次**：`next` → 16.4.2 优先，其次 `proxy-addr` / `websocket-driver`（critical） | P0 | 28 条生产高危的唯一真正出路 |
| 2 | 升级后跑**全量回归**：`tsc` + jest 全量 + `next build` + `verify:*` 全套 + e2e 冒烟 | P0 | 162 包的变更半径必须整轮验证 |
| 3 | `@auth/*` / `next-auth` 升级到 next-auth 正式版 | P1 | 认证栈影响面最大，且当前无修复版本 |
| 4 | **启用 RESEND 邮件通道前**先复核 §3.4 的 nodemailer 豁免 | P0（触发式） | 该豁免的失效不需要改代码，极易被漏掉 |
| 5 | `fixAvailable` 为「降级」的包（firebase 族）跟踪上游 12.x 修复进度 | P2 | 当前无可行动作 |

> 本文件的处置结论与 `dependency-baseline.json` 的 `exemptions` **必须保持一致**：
> 改了其中一处而不改另一处，门禁会在到期日或严重度变化时判红。

---

## 6. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-10-16 | 首版。28 条生产可达高危全部登记（18 + 1 + 3 + 1 + 5 五组）；配套棘轮门禁上线；`next` 16.4.2 升级列为第一优先跟办 |
