# 生产依赖风险登记册（AC-23）

> 状态：**28 条生产可达高危已清零**（2026-10-17 依赖升级批次；详见 §7）
> 实测：`high 26 + critical 2` → **`high 0 + critical 0`**（余 2 low + 4 moderate，均不阻断）
> 配套门禁：`scripts/ci/dependency-ratchet.mjs` · 冻结快照 `dependency-baseline.json`
> 机制说明：`CI_GATES.md` §5

---

## 0. 这份文档现在是什么

**2026-10-16 首版**时它是一份「已登记但未修复」的欠账清单：28 条生产可达高危全部处于
「已冻结 + 有书面豁免 + 有复核期限」状态，并且**没有升级任何依赖**（原因见 §2 的实测）。

**2026-10-17 这一批把它们真修掉了**，做法是「同大版本升级 + 定向 overrides」，而不是
`npm audit fix --force` 一把梭 —— 后者实测会动 162 个包却一条高危都消不掉。

因此本文档现在的职责变成三件事：

1. **§7 是这一批的完整施工记录**：每个包从哪个版本到哪个版本、依据哪条 advisory、为什么用 override；
2. **§3 是历史豁免的存档**（已全部退役）—— 保留它是为了将来有人问「当初为什么接受过」时有据可查；
3. **§5 是剩下的跟办项**：认证栈正式版、firebase 大版本、邮件通道启用前的复核。

> `dependency-baseline.json` 的 `frozen` 与 `exemptions` 已随之**清空**。
> 这不是「把门禁关掉」：门禁语义反而更硬了 —— 现在**任何**新增的生产高危都是「基线之外」，
> 无需豁免即可直接判红。

---

## 1. 口径与统计

| 口径 | high | critical | moderate | low | 是否阻断 CI |
|---|---|---|---|---|---|
| 全量（含 devDependencies）· 2026-10-16 | 34 | 3 | 28 | 2 | ❌ 不阻断（仅打印） |
| **生产可达**· 2026-10-16（升级前） | **26** | **2** | 7 | 2 | ✅ 棘轮阻断 |
| **生产可达**· 2026-10-17（升级后） | **0** | **0** | 4 | 2 | ✅ 棘轮阻断（现为 0 条） |

**为什么 dev 侧不阻断**：37 条 high/critical 里有 9 条来自
`jest` / `ts-jest` / `eslint-config-next` / `@next/eslint-plugin-next` ——
它们**不进生产运行时**（Netlify 构建产物不含 devDependencies）。
把两组混进一个门槛，结果是真正该拦的生产漏洞被工具链噪音淹没（这正是改造前的状态）。

**升级后剩余的 6 条**（全部非阻断）：`@babel/core`(low) · `body-parser`(low) ·
`@hono/node-server`(moderate) · `gaxios`(moderate) · `qs`(moderate) · `uuid`(moderate)。
均为传递依赖，无 high/critical；处置见 §5。


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

## 3. 历史豁免存档（28/28 已退役 · 2026-10-17）

> ⚠️ **本节是存档，不是当前状态**。下列 28 条已全部随升级批次消失（见 §7），
> `dependency-baseline.json` 的 `exemptions` 已清空。保留原文仅为可追溯。
>
> 每条原先都有 `reviewBy`，到期由门禁判红 —— 不允许永久豁免。
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

自证 `npm run verify:check:deps` 逐条证明这四类**真的会红**（**8/8 通过**）。

**🔴 清零当天在这条自证里揪出一个真缺陷**：原实现把 ③–⑥ 四条包在
`if (names.length > 0)` 里 —— `frozen` 清零后它们被**静默跳过**，自证照样打印
「全部通过」，实际只跑了 2 条。这是典型的「空集上恒真」：严重度升级、缺豁免、
豁免过期在空 Map 上都恒不成立。

修法：③–⑥ 改用**合成基线**（`__selftest_pkg__` + 配套豁免），与真实快照是否为空解耦，
并新增一条**前置断言**「合成基线非空」。变异验证：把合成基线置空后重跑 ⇒
`合成基线非空` / `缺豁免登记` / `豁免过期` **三条判红、exit 1** —— 证明这几条不是空跑。

---

## 5. 剩余跟办项

> 原表 1–5 项中，**第 1、2 项已于 2026-10-17 办结**（§7）；第 3–5 项保留。

| # | 动作 | 优先级 | 状态 / 为什么还要做 |
|---|---|---|---|
| 1 | **依赖升级批次**：`next` → 16.4.2 + `proxy-addr` / `websocket-driver`（critical） | P0 | ✅ **已办结**（§7） |
| 2 | 升级后跑**全量回归**：`tsc` + jest 全量 + `next build` + `verify:*` + e2e 冒烟 | P0 | ✅ **已由 CI 承担并跑通**（§7.4：本地受环境限制，判定权交给 CI 各 job） |
| 3 | `@auth/*` / `next-auth` 升级到 next-auth 正式版 | P1 | 仍待上游。当前 beta.32 的 advisory 链已随 nodemailer 升级消失，但**正式版仍是应做的事** |
| 4 | **启用 RESEND 邮件通道前**先复核 nodemailer | P0（触发式） | 原豁免已撤销（nodemailer 已升到 10.1.2）。⚠️ 但 `next-auth@beta.32` 的 `peerOptional` 仍声明 `^7.0.7 \|\| ^8.0.5` ⇒ 启用 next-auth 自带 Email provider 前必须确认兼容 |
| 5 | 剩余 6 条 moderate/low（`qs` / `uuid` / `gaxios` / `@hono/node-server` / `body-parser` / `@babel/core`） | P2 | 均不阻断。`uuid<11.1.1`、`qs` 等需父包先动；跟踪上游，不单独 override（收益低、变更半径反而大） |
| 6 | **overrides 的保鲜**：16 条 overrides 是「钉住传递版本」的临时手段 | P1 | 每次依赖升级后核对；父包追平后应**删除对应 override**，否则会长期压住上游版本（§7.5） |

> 本文件的处置结论与 `dependency-baseline.json` 的 `exemptions` **必须保持一致**：
> 改了其中一处而不改另一处，门禁会在到期日或严重度变化时判红。

---

## 6. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-10-16 | 首版。28 条生产可达高危全部登记（18 + 1 + 3 + 1 + 5 五组）；配套棘轮门禁上线；`next` 16.4.2 升级列为第一优先跟办 |
| 2026-10-17 | **28 条清零**：同大版本升级 6 项 + 定向 overrides 16 条；`frozen`/`exemptions` 置空；自证从 6 条扩到 8 条并修掉「快照为空即静默跳过」的假绿（§7）。同日 CI 全绿（`5fc3bf6`）→ 发版 `6ad3405dbb50` → 生产复验通过 |
| 2026-10-17 | **并入 Dependabot #27**（11 项 minor/patch，`cherry-pick -x` + 重算锁）：16 条 overrides 全部仍生效、审计 `high 0 / critical 0` 未变；CI `39025021586` 全绿 → 发版 `6ad34dc8b568` → 生产复验 6/6 + 13/0 + 限流 429×10。记录见 `BACKLOG.md` §7septies |

---

## 7. 2026-10-17 依赖升级批次（28 → 0）

### 7.1 结果

| 指标 | 升级前 | 升级后 |
|---|---|---|
| 生产可达 high | 26 | **0** |
| 生产可达 critical | 2 | **0** |
| 生产可达 moderate / low | 7 / 2 | 4 / 2 |
| 阻断级条目（`frozen`） | 28 | **0** |
| 审计覆盖 | `prod 608 / total 1749` 依赖（`--omit=dev`） | 同口径 |

取证命令（**不需要 node_modules**，直接读锁文件）：

```bash
npm audit --omit=dev --package-lock-only --json > /tmp/audit-after.json
node scripts/ci/dependency-ratchet.mjs --self-test --report=/tmp/audit-after.json   # 8/8
node scripts/ci/dependency-ratchet.mjs --report=/tmp/audit-after.json               # exit 0
```

### 7.2 直接升级（6 项）

| 包 | 旧 → 新 | 清掉的条目 | 依据 |
|---|---|---|---|
| `next`（+ `eslint-config-next` 同步） | `16.3.6` → **`16.4.2`** | `next` | advisory 区间 `16.0.0–16.3.7`；`isSemVerMajor: false`。顺带把 `postcss` 刷到 8.5.23 |
| `sharp` | `^0.35.4` → **`^0.35.5`** | `sharp` | librsvg CVE-2026-96889，修复版即 0.35.5 |
| `prisma` / `@prisma/client` / `@prisma/adapter-libsql` / `@prisma/adapter-pg` | `^7.10.0` → **`^7.10.1`** | `@prisma/config` · `deepmerge-ts` · `mysql2` | 7.10.1 的 `@prisma/config` 依赖 `deepmerge-ts@8.0.2`，`prisma` 依赖 `mysql2@3.24.4` —— 一处升级连带三条 |
| `nodemailer` | `^7.0.7` → **`^10.1.2`** | `nodemailer` · `@auth/core` · `@auth/prisma-adapter` · `next-auth` | advisory 区间 `<=10.0.5`。后三条的 `via` **只有** `nodemailer`，所以是真修掉，不是压掉 |
| `ws` | `^8.21.3` → **`^8.22.0`** | `ws` | advisory 区间 `8.0.0–8.20.1` |
| `@types/nodemailer` | **移除** | — | nodemailer 10 自带类型（`types: ./dist/cjs/nodemailer.d.ts`），留着会与包内声明重复 |

### 7.3 定向 overrides（16 条）

父包不跟版时，只能钉住传递依赖。**全部选同大版本的补丁/小版本**，不跨 major：

| 包 | 钉住 | 修掉的 advisory 区间 | 谁引进来的 |
|---|---|---|---|
| `proxy-addr`（**critical**） | `2.0.8` | `1.1.0–2.0.7` | `creem → @modelcontextprotocol/sdk → express` |
| `websocket-driver`（**critical**） | `0.7.5` | `<=0.7.4` | `firebase → @firebase/database → faye-websocket` |
| `@modelcontextprotocol/sdk` | `1.32.1` | `1.12.0–1.30.1` | `creem`（声明 `^1.26.0`，锁在 1.29.0） |
| `@fastify/busboy` | `3.2.3` | `<=3.2.1` | `firebase-admin` |
| `@grpc/grpc-js` | `1.14.6` | `<=1.13.5` | `firebase-admin → @google-cloud/firestore` |
| `protobufjs` | `7.6.5` | `<=7.6.4` | `firebase` / `firebase-admin` |
| `browserslist` | `4.29.3` | `<=4.28.6` | 构建链 |
| `engine.io` | `6.6.11` | `0.7.8–0.7.9 \|\| 4.1.0+` | `socket.io` |
| `socket.io-parser` | `4.2.7` | `4.0.0–4.2.6` | `socket.io` / `socket.io-client` |
| `ws`（全树） | `$ws`（= `^8.22.0`） | `8.0.0–8.20.1` | `engine.io-client` / `socket.io-adapter` 各带一份 8.18.3 |
| `fast-uri` | `3.1.8` | `3.0.0–3.1.7` | `ajv`（creem / prisma 两路） |
| `form-data` | `4.0.6` | `4.0.0–4.0.5` | `pusher → @types/node-fetch` |
| `hono` | `4.13.13` | `<=4.13.6` | `@modelcontextprotocol/sdk` |
| `ip-address` | `10.7.4` | `<=10.7.0` | `express-rate-limit` |
| `source-map-js` | `1.2.2` | `1.0.0–1.2.1` | `next → postcss` |
| `nodemailer`（全树） | `$nodemailer`（= `^10.1.2`） | `<=10.0.5` | `@auth/core` 的 peer 会在 `@auth/prisma-adapter` 下**另装一份 8.0.11** |

### 7.4 验证

| 项 | 结果 |
|---|---|
| 锁文件审计 | `high 0 / critical 0`；`prod 608`、`total 1749` 依赖被真实计入（**不是空跑**） |
| 并入 Dependabot #27 后 | 同上口径重跑：`high 0 / critical 0`，moderate 4 / low 2 **逐项未变**；`prod 632`（+24，来自 `@sentry/nextjs@11.7.0` 的新依赖）、`total 1660` |
| 逐包核对锁文件 | 每条高危包在 `package-lock.json` 中**只剩一个版本**且在修复区间外 |
| `check:deps` 门禁 | 通过：`冻结基线 0 条`、`无新增生产高危`、`exit 0` |
| `verify:check:deps` 自证 | **8/8**，含新增的合成基线四连与前置断言 |
| 变异验证 | 合成基线置空 ⇒ 3 条判红、`exit 1`（证明新断言非空跑） |
| **全量回归** | **由 CI 承担**：Typecheck(tsc) · Lint 棘轮 · Jest · **Build(next build)** · Migration · E2E(Playwright 冒烟) · Dependency audit。⚠️ 本地 `npm install` 受环境限制无法完成（见下），故本地不产出「已全量回归」的结论 |
| **CI 实测** | run `39021438953`（`5fc3bf6`）→ **11 job：9 success + 2 skipped / 0 失败**。Build 2m22s · Jest 1m20s · Typecheck 1m33s · E2E 2m27s · Migration 1m07s · Dependency audit 1m05s · Lint 棘轮 1m19s |
| **发版** | Netlify deploy `6ad3405dbb509383d7f55ecf` ← `5fc3bf6`，`state=ready` |
| **生产健康** | `/api/health` 200 ×2（4.24s / 1.56s），`redis.backend=upstash`、`degraded:false`、`degradeCount:0` |
| **发版后复验** | `verify:released:surface` 6/6 + 对照 2/2（exit 0）· `verify-public-origin` **13 通过 / 0 失败**（0 处部署域名泄漏）· 限流并发探针 MCP `200×120 + 429×10`、A2A `401×120 + 429×10`，`RateLimit-Backend: upstash` |

> 为什么还要跑一遍限流探针：`next` 16.3.6 → 16.4.2 与 `proxy-addr`/`ws` 的 override 都可能影响
> 中间件取 IP 与连接行为，而限流正是**按 IP 计数**的。升级后实测 429 仍在第 121 次触发、
> 桶仍互相独立、`Backend` 仍为 `upstash` ⇒ 这条依赖升级没有把上一轮的限流修复打回去。

**本地安装为什么没跑完（如实记录）**：三条限制叠加 ——
① 沙箱策略**拒绝删除** `node_modules` 内的既有路径（npm reify 必须删旧），
② 单条命令约 **20 分钟**被 broker 掐断，而全树 `npm ci` 约需 24 分钟，
③ 机器负载常驻 **45**（非本任务产生）。
结论：本地完成度停在「锁文件级验证」，**最终判定权交给 CI**，不拿半装的树冒充绿色。

### 7.5 两个 overrides 的坑（都踩过）

1. **`EOVERRIDE`：直接依赖必须用 `$pkg` 引用**。
   `"ws": "8.22.0"` 与直接依赖声明 `^8.22.0` 字面不一致 ⇒
   `Override for ws@^8.22.0 conflicts with direct dependency`。改 `"ws": "$ws"` 才通过。
2. **peer 会偷偷装第二份**。把 nodemailer 升到 10 后，`@auth/prisma-adapter` 下被塞了一份
   `nodemailer@8.0.11`（为满足 `@auth/core` 的 peer `^7 || ^8`）—— 8.0.11 **仍在漏洞区间**。
   只升根依赖消不掉这条，必须 `"nodemailer": "$nodemailer"` 把全树拉平。
   **教训**：升级后不能只看根依赖的版本，要看锁文件里同名包有几份。

### 7.6 明确没做的事

- **没有升 firebase 12 → 13（major）**：`websocket-driver` / `protobufjs` / `@grpc/grpc-js`
  已用同大版本 override 解决，不值得为此付一次大版本跃迁的代价。
- **没有升 next-auth beta → 正式版**：上游未发布（§5 第 3 项）。
- **没有处理剩余 6 条 moderate/low**：不阻断，且多数要等父包先动。
- **没有删掉 overrides**：它们是临时钉版手段，父包追平后应逐条删除（§5 第 6 项）。

