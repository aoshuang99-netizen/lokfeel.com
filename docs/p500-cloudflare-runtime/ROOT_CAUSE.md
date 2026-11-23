# Cloudflare Preview 全站 500 · 根因取证与修复（2026-11-23）

> 状态：**根因已定位（有原始堆栈）；修复候选已落地，待构建与独立 Preview 复验。**
> 本文取代本轮早前的 Sentry `createRequire` 假设——该假设已被运行时证据证伪，见 §3。

## 1. P0-01 · 第一条原始异常

**取得方式（可复核）**
1. Cloudflare `wrangler tail lokfeel-preview --format json` 只能看到外层包装消息
   `Failed to prepare server,Error: An error occurred while loading the instrumentation hook`；
   OpenNext 的 `error()` 日志未打印，`details: e` 被 `JSON.stringify(Error)` 序列化成 `{}`，
   真正的 `cause` 被吞掉。
2. 用 `npx opennextjs-cloudflare preview --config wrangler.preview.jsonc` 在
   `127.0.0.1:8787` **本地复现同样的全站 500**（不依赖 Cloudflare 平台）。
3. 在**构建产物**（`.open-next/server-functions/default/handler.mjs`，非源码、非提交物）
   临时注入 `console.error` 并把 `cause` 序列化进 500 响应体，取回完整堆栈。
   取证后由 `cf:build` 重新生成产物自动清除该调试注入。

**Error class / 消息**

```
ChunkLoadError: Failed to load chunk
server/chunks/[root-of-the-server]__1tt-pf6z9r63u._.js
from runtime for chunk server/instrumentation.js
```

外层包装：`Error: An error occurred while loading the instrumentation hook`（`cause: err`）。

**脱敏 stack（本地 workerd 复现，路径已省略为 `worker.js`）**

```
ChunkLoadError: Failed to load chunk server/chunks/[root-of-the-server]__1tt-pf6z9r63u._.js from runtime for chunk server/instrumentation.js
    at loadRuntimeChunkPath (worker.js:309477:25)
    at loadRuntimeChunk     (worker.js:309462:40)
    at Object.c             (worker.js:309555:173)
    at .open-next/server-functions/default/.next/server/instrumentation.js (worker.js:58879:10)
    at getInstrumentationModule  (worker.js:58932:48)
    at NextNodeServer.loadInstrumentationModule (worker.js:331434:103)
    at NextNodeServer.prepare    (worker.js:25002:97)
    at NextNodeServer.handleRequest (worker.js:24729:22)
```

**失败环节**：`NextNodeServer.prepare()` → `loadInstrumentationModule()` → Turbopack
runtime `loadRuntimeChunkPath()` → `requireChunk(chunkPath)` 查不到 chunk。
发生在**数据库查询之前**，因此 `/api/health` 返回 500 而不是设计中的 503；
也解释了「所有 SSR/API 500、静态资源 200（ASSETS 直接服务）」。

**部署身份（P0-01 要求项）**
- 应用候选 SHA：`9bc4fbb7cdc999d5e61814d2bd22967859b964cd`
- 本轮修复分支：`rc/p03-preview-runtime-audit-20261123`，HEAD `2192e22`
- Cloudflare Preview Worker：`lokfeel-preview`；triage Run `45146053714` 时
  Worker version **35** / version ID `0b4346a5-787d-4ae2-a870-daa896a50d27` /
  deployment ID `9a9f47af-2734-4ae1-9b3b-7af784f0b31a` / created_on `2026-11-21`
  ⇒ 当时线上 Worker **并非最新候选 SHA**，且 `wrangler secret list` 返回 `names: []`。
- 后续部署 Run `45148478238` = completed success，但仍全站 500 ⇒
  **部署 Job success ≠ 运行时 PASS**（用户硬约束）。

**修复候选部署后的线上身份（2026-11-23 实测）**
- 修复提交：`9c6b7415b64b865de9db129b0b60735d15d089f1`；
  部署 Run `45155686683`（Cloudflare Preview #71），CI Run `45155686794`。
- 真实 Preview `/api/health` 响应头：`server: cloudflare`、
  `cf-ray: a5ef7b63ea31ad44-SJC`（503 请求）；首页 200 请求
  `cf-ray: a5ef7b706df7eb2d-SJC`。
- 运行时构建身份：`commit=9c6b741`、`commitSource=env`、
  `builtAt=2026-11-23T10:24:23.627Z` ⇒ **Git SHA、构建制品、运行时可查证三者对齐**。
- 四公开页连续 3 轮采样：`/`、`/register`、`/product`、`/solutions` 全部 200
  （部署传播期曾短暂出现新旧版本混合，稳定后全 200，不以单次结果下结论）。

**独立 GitHub-hosted Runner 复验（已执行，非本地代理代替）**
- `Preview Runtime Audit` Run `45157012028`，结果分支
  `audit-results/p03-45157012028` → `evidence/preview/result.json`：
  - `pageStats: PASS 8 / BLOCKED 8` ⇒ **四公开页 × 桌面/移动 8/8 全部 200**；
  - `health: FAIL, http 503, unhealthy, commit=9c6b741, commitSource=env`
    ⇒ **运行时 SHA 与 `expectedSha=9c6b7415...` 对齐**；
  - `api: plans-read PASS`（`pricingPublished=false`）、
    `invite-lookup-invalid FAIL`（500）、`invite-write BLOCKED`；
  - `cta: home-primary-cta PASS`（真实点击可达）；
  - `login: BLOCKED`（`QA_PASSWORD` 未提供，未用默认口令代替）；
  - `verdict: FAIL` —— 只由 health 503 / 非法邀请码 500 / 登录 BLOCKED 造成，
    **不是**全站 500 复发。
- `Preview 500 Triage` Run `45157012025`，结果分支
  `audit-results/p500-45157012025` → `evidence/triage/result.json`：
  - 最新 Worker **version 48**，version ID
    `239cec24-c364-4dde-be6a-5e1961669997`（`2026-11-23T10:25:56Z`）；
  - 最新 **deployment ID** `757b4f6b-80a7-482a-97ec-b13ea9d159e3`
    （`2026-11-23T10:26:00Z`，100% 流量）；
  - `tail.exceptionEvents: []`、`firstException: null`
    ⇒ **`An error occurred while loading the instrumentation hook` 已从线上日志消失**；
  - 四个公开路由 200（CF-Ray `a5ef83cec927dc9f-SEA` 等），
    health 503 / invalid-invite 500；
  - `wrangler secret list` → `names: []`（隔离 DB 凭据仍未配置）；
  - `verdict: FAIL`（判定条件 `any500 || health.status !== 200`）。
- CI：`45155686794`（候选 `9c6b741`，#430）与 `45157012131`（QA-only `afa8343`，#431）
  均 **completed success**；Cloudflare Preview 部署 `45155686683`（#71）
  completed success，但运行时 PASS 由上面的真实 URL 证据独立确认。

## 2. 完整因果链（五步，逐步可验证）

| # | 事实 | 证据 |
|---|---|---|
| 1 | Next 16.4.5 + Turbopack 构建出 514 个 `server/chunks/[root-of-the-server]__*.js` | `find .next/server/chunks -name "*root-of-the-server*" \| wc -l` = 514 |
| 2 | `output: standalone` 的 file tracing 只带 254 个；`instrumentation.js.nft.json` **明确列出** `chunks/[root-of-the-server]__1tt-pf6z9r63u._.js` 与 `...__1o2yle93kxvp4._.js`，但 standalone 里两个都 MISSING | `ls .next/standalone/.next/server/chunks/...` → 两个均 MISSING；源文件分别为 1.8KB / 1.5MB |
| 3 | OpenNext `copyTracedFiles.js` 的 `processNftFile()` 把 nft 列出的文件**从 standaloneNextDir** 复制到 outputNextDir；src 不存在时静默跳过 | `node_modules/@opennextjs/aws/dist/build/copyTracedFiles.js:84-96`；`.open-next/.../chunks/` 只有 254 个 root-of-server chunk |
| 4 | worker bundle 的 `requireChunk()` 是 build 期生成的 switch 表，缺失 chunk 没有对应 case ⇒ `loadRuntimeChunkPath` 抛 `ChunkLoadError` | `.open-next/server-functions/default/handler.mjs` 中 `function requireChunk(chunkPath){switch(chunkPath){...}}`，无 `1tt-pf6z9r63u` case |
| 5 | `prepare()` 失败 ⇒ 每个 SSR/API 请求 500；静态资源由 `ASSETS` 绑定直接返回 200 | 本地 preview 7/7 endpoint 500 + `/favicon.ico` 200 |

## 3. 已证伪的假设（诚实边界）

- **`@sentry/nextjs@11.7.0` 模块顶层 `createRequire`**：已按
  `getsentry/sentry-javascript#25683` 生成 `patches/@sentry+nextjs+11.7.0.patch`
  并确认补丁实际应用到 `node_modules`（esm/cjs 两处均为 `try/catch`），
  `npm run cf:build` 成功、Cloudflare 部署 Job success，**但运行时仍 500**。
  真实异常发生在 **chunk 加载阶段**，Sentry 代码尚未执行 ⇒ 该假设不是本轮根因。
  补丁作为防御性兼容保留，但不作为 PASS 依据。
- **「缺 DB/Auth 环境变量」**：`/api/health` 的 503 分支根本没机会执行；
  500 发生在 `prepare()`，与 DB 连通性无关。Worker secrets 为空是**另一个**待办
  （P0-02 恢复隔离运行环境），不是全站 500 的根因。
- **「QA_PASSWORD 缺失」**：只解释登录审计未运行，不解释公开页与 health 全 500。

## 4. 最小修复（围绕已确认根因）

修改 `scripts/ci/patch-opennext-build.mjs`（该文件本就是 Next 16 Turbopack ×
OpenNext 不兼容的 workaround），新增 `ensureTraceRestoreFix()`：向
`copyTracedFiles.js` 的 `processNftFile()` 注入一段补齐逻辑——

```js
if (!existsSync(src)) {                      // src = standaloneNextDir/...
    const buildSrc = path.join(dotNextDir, subDir, tracedPath);
    if (existsSync(buildSrc)) {
        mkdirSync(path.dirname(src), { recursive: true });
        copyFileAndMakeOwnerWritable(buildSrc, src);
    }
}
filesToCopy.set(src, dst);
```

即：**把 nft 已追踪、但 Next 16 Turbopack standalone 漏掉的 runtime chunk，
从构建目录补回 standalone 目录**，让 OpenNext 正常打进 worker bundle。

- 不改业务代码、不改 `next.config.ts`、不换打包器、不动生产 DB / 密钥；
- 幂等、带锚点校验（上游变更会 fail loudly，不会静默产出坏 bundle）；
- 覆盖所有 nft 追踪文件，不只 instrumentation 这两个 chunk。

## 5. 修复后验证口径（未通过前一律 FAIL）

1. `npm run cf:build` 完成；`.open-next/.../chunks/` 出现两个缺失 chunk，
   `handler.mjs` 的 `requireChunk` switch 出现对应 case。
2. 本地 preview：`/`、`/register`、`/product`、`/solutions` 与 `/api/health` 全 200，
   `/api/health` 返回 `commit` 且与候选 SHA 可对齐。
3. 部署到 `lokfeel-preview` 后由 **GitHub-hosted Runner** 独立复验：
   四公开页桌面/移动 8/8、health 200 + SHA、非法邀请码 4xx、
   `/api/payments/dodo/plans` 安全关闭、主 CTA 真实可达、无 500/502。
4. 采集真实 Preview 的 CF-Ray / request ID 与 Worker deployment ID、版本身份。
5. 上述全绿后才进入 P0-03（隔离 QA 库 + 双账号邀请/接受/关系/双向聊天）。

> 未获 Owner 精确 SHA 批准前，不部署/迁移生产、不重开支付门、不写生产数据。

## 6. 第二个独立根因：DB adapter 的 native binding（P0-02）

500 修好后本地实测（构建产物已含两个补齐 chunk）：

| 端点 | 修复前 | 修复后 |
|---|---|---|
| `/`、`/register`、`/product`、`/solutions` | 500 | **200** |
| `/favicon.ico`（ASSETS） | 200 | 200 |
| `/api/payments/dodo/plans` | 500 | **200** |
| `/api/health` | 500 | **503**（设计中的 DB 失败分支） |
| `/api/invites/lookup?code=invalid` | 500 | 500（`{"error":{"code":"INTERNAL","message":"查询失败"}}`） |

`/api/health` 从 500 变 503 且能返回 `commit=2192e22` / `commitSource=git`，
**证明 instrumentation 500 根因已消除**。503 的错误文本：

```
Failed to load external module @prisma/adapter-libsql-54387eee42c9c9c0:
Error: Neon: unsupported Linux architecture:
```

取证：`src/lib/db.ts` 用 `require("@prisma/adapter-libsql")`（node 入口，
依赖 `@libsql/client` → native binding → `currentTarget()` 检测
`process.platform/arch`；workerd 里 `process.arch` 为空 ⇒ 抛错）。
包自带纯 JS 的 web 入口 `@prisma/adapter-libsql/web`
（只依赖 `@libsql/client/web`、`@prisma/driver-adapter-utils`、`async-mutex`）。

**已尝试但未闭合（并已回退）**：在 `src/lib/db.ts` 按 Workers 运行时条件
改用 `@prisma/adapter-libsql/web` 后重新构建并实测，原生 binding 错误消失，
但 health 变为新的 503：

```
WebAssembly.Module(): Wasm code generation disallowed by embedder
```

即 Cloudflare Workers 禁止动态 WASM 编译，web 入口同样走不通。该改动**没有**
带来 health 200，却改变了生产链路的模块选择路径，因此按「最小修改、不放水、
不撤安全门禁」原则已 `git checkout -- src/lib/db.ts` 回退，**不进入本轮提交**。
结论：Prisma 在 Workers 上需要专门的 D1 adapter 或预编译 wasm 方案，不是
换一个 require 路径能解决的；这属于需要资源与架构决策的独立工作项。

**仍未闭合（诚实边界）**：修复 adapter 只让 Preview **具备**连库能力；
`lokfeel-preview` Worker 的 `wrangler secret list` 仍返回 `names: []`，
本地 `.dev.vars` 也只有 `NEXTJS_ENV=development`。要让 `/api/health` 变成
200 healthy、并让非法邀请码按契约返回 4xx，仍需**隔离 QA 数据库**：
一个独立的 libSQL/Turso 端点 + 专用 token + `AUTH_SECRET` + 公开 URL，
作为 Worker secrets 注入。按用户硬约束，**不得复制生产 DB 或生产密钥**，
因此该凭据必须由 Owner 提供或授权新建；在此之前 P0-02 / P0-03 保持 BLOCKED。

## 7. 构建期 / 运行时 / QA Runner 环境分层复核

| 层 | 现状 | 结论 |
|---|---|---|
| CI 构建期（`cloudflare-preview.yml` env） | `postgresql://ci:ci@localhost:5432/ci`、`NEXTAUTH_URL=http://localhost:3000` 占位 | 仅构建期占位，**不可**当作 Preview 运行配置 |
| 构建期 env 是否内联进 bundle | 已逐项比对 `.env` / `.env.local` / `.env.production` 的 `DATABASE_URL`、`TURSO_AUTH_TOKEN`、`AUTH_SECRET`、`CREEM_API_KEY` | **均未内联**（只输出布尔，未输出值）⇒ 不会意外把生产凭据带进 Preview |
| Worker 运行时 | `wrangler.preview.jsonc` 只声明 `ASSETS` / `WORKER_SELF_REFERENCE`；平台侧 secrets = `names: []` | 运行时缺全部 DB/Auth 配置，待 Owner 注入隔离凭据 |
| QA Runner | `QA_PASSWORD` 未配置 | 登录审计 BLOCKED；不能用默认口令代替 |
| 版本身份 | 本地产物 `commit=2192e22`（git 源）；triage 时线上 Worker version 35 来自 2026-11-21 | 修复候选部署后必须重新采集 deployment ID 与运行时 SHA，三者对齐 |

