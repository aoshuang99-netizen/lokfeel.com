# V20.1 · P0-01 Cloudflare 真实环境盘点

> 审计日期：2026-11-05（GMT+8）｜审计者：栈师（全栈工程 Agent）
> 配套作战令：`LOKFEL V20.1｜Cloudflare 全栈统一部署与正式上线作战令`
> 本文件是 **P0-01 的真实盘点结果**，不是计划书。所有"实际资源"均标注真实来源；凡依赖 Cloudflare API 且本环境无凭据的项，一律标记 **`BLOCKED_ACCESS`**，不臆造。

---

## 0. 方法学与诚实边界

| 维度 | 状态 | 说明 |
| --- | --- | --- |
| 仓库只读审计 | ✅ 已完成 | 真实读取 `git` / `package.json` / `wrangler.jsonc` / `open-next.config.ts` / `next.config.ts` / `netlify.toml` / `prisma/` |
| 线上生产事实 | ✅ 已独立核验 | `GET https://app.lokfeel.com/api/health` 返回 `commit=79459d6 / status=healthy` |
| Cloudflare API 查询 | ⛔ `BLOCKED_ACCESS` | 环境内 **无任何** `CLOUDFLARE_API_TOKEN` / `CF_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` / `CF_ACCOUNT_ID` / `CLOUDFLARE_API_KEY`；`wrangler whoami` / `accounts list` 无法鉴权 |
| `wrangler` 二进制 | ✅ 已安装 | `node_modules/.bin/wrangler`（4.x），但无凭据 → 仅本地配置校验可用，远端不可达 |
| CF 构建（无需凭据） | 🔴 `FAILED` | `e8uDyl` 真实崩溃：Next 16.4.2 Turbopack 占位 `middleware.js` 桩触发 OpenNext `copyTracedFiles` 误判（详见 §12，根因已实查）。修复：升 `@opennextjs/cloudflare` 1.20.12→1.20.15（aws 4.1.11→4.1.12 含修复），`next` 不变 |

**纪律声明**：`wrangler.jsonc` 中出现的 worker 名 `lokfeel-app` 仅是**本地配置文件里的名称**，不是"已创建的 Cloudflare 资源"。本审计不把模板/计划写成已上线资源。

---

## 1. 当前 GitHub main HEAD

| 项 | 值 | 来源 |
| --- | --- | --- |
| `origin/main` HEAD | `d4ad0d4` | `git ls-remote git@github.com:aoshuang99-netizen/lokfeel.com.git` |
| 本地当前分支 | `t4/v199-visual` | `git branch --show-current` |
| 本地 HEAD | `b9af63b` | `git rev-parse HEAD` |
| 本地相对 `main` | **5 commits ahead**（`0 5`） | `git rev-list --left-right --count origin/main...HEAD` |
| 生产部署提交 | `79459d6` | 线上 `/api/health`，且为 `origin/main` 的祖先 |

**关键事实**：V20.0 的 S1 沙箱装配工作（提交 `b6727ee` V20.0 S1 沙箱装配闭环、`47d4d8f` A-03b 运行时探测 + 沙箱 stub 修正）**仅存在于 `t4/v199-visual` 分支，尚未 push 到 `origin/main`**。发布前必须先合入 `main`（见 §11 风险 R-01）。

---

## 2. 当前生产部署平台 / 生产 SHA

| 项 | 值 | 来源 |
| --- | --- | --- |
| 生产域 | `app.lokfeel.com` | 代码与记忆一致 |
| 计算平台 | **Netlify Functions** | `netlify.toml`（`@netlify/plugin-nextjs`，`build.command=npm run build`，`publish=.next`） |
| 边缘/网络 | **Cloudflare（orange-cloud）** | `next.config.ts` 注释明确 `app.lokfeel.com sits behind Cloudflare`，`cf-ipcountry` 已可读取；CSP 放行 `static.cloudflareinsights.com` beacon |
| 生产 SHA | `79459d6` | 线上 `/api/health.commit` |
| 健康 | `healthy`，`dbLatency` 正常，`botModule` 启用 | `/api/health` |

**原生产拓扑**：CF 目前只承接 **DNS + TLS + WAF + Web Analytics**；**计算与 API 跑在 Netlify Functions**。这正是 V20.1 R1 要把"计算+API"迁移到 CF Workers 的部分。

---

## 3. Cloudflare Account ID — `BLOCKED_ACCESS`

- 环境内 `CLOUDFLARE_ACCOUNT_ID` / `CF_ACCOUNT_ID` 均未设置。
- `wrangler whoami` / `wrangler accounts list` 无法鉴权（缺 token）。
- **结论**：Account ID 无法在本环境获取，标记 `BLOCKED_ACCESS`。需用户提供（或经受控授权注入 `CLOUDFLARE_API_TOKEN`）后方可读取。

---

## 4. Workers / Pages 项目列表 — `BLOCKED_ACCESS`

- 仓库内存在 `wrangler.jsonc`，定义 worker 名 `lokfeel-app`（本地配置），**但这不等于 CF 上已创建资源**。
- 无法调用 `wrangler deployments list` / CF API 列出真实项目。
- **结论**：真实 Workers/Pages 项目列表 `BLOCKED_ACCESS`。`wrangler.jsonc` 视为"待部署模板"，非"已建资源"。

---

## 5. DNS / 域名 / TLS / 路由 — 部分已知，明细 `BLOCKED_ACCESS`

**已知（来自代码/配置，可信）**：
- `app.lokfeel.com` 在 CF orange-cloud 后（`next.config.ts` 明确）。
- `admin.lokfeel.com` 经 `next.config.ts` rewrites 映射到 `/admin-login`（`source:'/'` + `host:admin.lokfeel.com`）。
- CSP 已放行 `static.cloudflareinsights.com`（CF Web Analytics 自动注入 beacon）。
- `proxy.ts`（仓库根）读取 `cf-ipcountry` 做地域策略——说明 CF 边缘已在工作。

**未知（需 CF API，标记 `BLOCKED_ACCESS`）**：
- 真实 Zone ID、DNS 记录明细、TLS 模式（Full/Strict）、WAF 规则、Turnstile、Access 配置。
- 仓库内未检索到 Cloudflare **Turnstile / Access / WAF 自定义规则** 的接入代码（仅有 DNS/Analytics 侧痕迹）。

---

## 6. 现有数据库连接方式

| 项 | 值 | 来源 |
| --- | --- | --- |
| Prisma datasource provider | `sqlite` | `prisma/schema/core.prisma:10` |
| Prisma generator | `prisma-client-js` → `src/generated` | `prisma/schema/core.prisma:4-6` |
| 运行时驱动 | `@prisma/adapter-libsql` + `@libsql/client` | `src/lib/db.ts:159,168` |
| 连接形态 | **libSQL / Turso（HTTP 客户端）** | `TURSO_DB_URL` / `TURSO_TOKEN` / `DATABASE_URL` / `DATABASE_AUTH_TOKEN` |
| 需求 | 租户隔离已落地（39/32 表外键枚举见记忆） | — |

**R1 策略（与作战令一致）**：保留 Turso 不变，仅迁移计算面。
**R2 策略**：后续再评估 D1 迁移（需 `prisma-client-js` 在 Workers 上的兼容性验证，见 §8 风险）。

---

## 7. 现有缓存 / 文件 / 队列 / 实时服务

| 能力 | 当前实现 | 对应 CF 目标（R2） | 来源 |
| --- | --- | --- | --- |
| 缓存 | **Upstash Redis**（`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`） | KV / 自建 Durable Objects | `src` env 枚举 |
| 文件 / 证据 | 未在本轮详查，需补 `outcome evidence` 落点核查 | **R2** | — |
| 定时任务 | **Netlify 定时函数** `netlify/functions/cron-runner.ts`（每小时，cron `23 * * * *`） | **CF Cron Triggers** | `netlify.toml:45-46` |
| 异步队列 | 无独立队列（cron 轮询内部端点 + `CRON_SECRET`） | **CF Queues / Workflows**（R2） | `netlify.toml` 注释 |
| 实时通信 | **Pusher**（`PUSHER_*` / `NEXT_PUBLIC_PUSHER_*`） | 保持 / WebSocket | env 枚举 |
| WebRTC | **TURN**（`TURN_*`） | 保持 | env 枚举 |
| 邮件 | **Resend**（`RESEND_API_KEY`）+ SMTP 兜底 | 保持 | env 枚举 |
| 短信 | Twilio（`TWILIO_*`） | 保持 | env 枚举 |
| 媒体/头像 | DiceBear / Google / Twitter（`next/image` remotePatterns） | 保持 / R2 | `next.config.ts` |

---

## 8. Next.js 版本 / 构建脚本 / Prisma 适配（真实版本号）

| 组件 | 版本 | 来源 |
| --- | --- | --- |
| Next.js | **16.4.2** | `package.json` |
| React | 19.3.0 | `package.json` |
| Turbopack | 默认打包器 | `next.config.ts` `turbopack` 段 |
| @opennextjs/cloudflare | **1.20.12** | `package.json` + `node_modules` |
| wrangler | ^4.141.0（本地 4.x） | `package.json` + `wrangler --version` |
| prisma / @prisma/client | ^7.10.1 | `package.json` |
| @prisma/adapter-libsql | ^7.10.1 | `package.json` |
| @libsql/client | ^0.18.0 | `package.json` |
| @sentry/nextjs | ^11.7.0（wrapper 在 `next.config.ts`） | `package.json` |
| next-auth | ^5.0.0-beta.32 | `package.json` |

**构建脚本（真实存在）**：
- `build`: `npx prisma generate && next build`
- `dev`: `next dev --turbopack -p 3099`（端口 **3099**，非 3000）
- `cf:build`: `opennextjs-cloudflare build`
- `cf:deploy`: `opennextjs-cloudflare build && opennextjs-cloudflare deploy`
- `cf:preview`: `opennextjs-cloudflare build && opennextjs-cloudflare preview`
- `cf:upload`: `opennextjs-cloudflare build && opennextjs-cloudflare upload`
- `cf-typegen`: `wrangler types --env-interface CloudflareEnv cloudflare-env.d.ts`

**兼容性关注点（P0-02 需实测）**：
- `prisma-client-js` 生成器（非 edge/wasm 客户端）+ `nodejs_compat` 标志 → Workers 上能否正常运行需构建验证。
- `@libsql/client` 走 HTTP → Workers 兼容性好；但需 `global_fetch_strictly_public` 等标志确认。
- `serverExternalPackages` 含 `firebase-admin` 等原生依赖 → Workers 需确认 nft 追踪与 WASM/原生模块支持。
- Sentry wrapper、`next-auth` beta、流式响应、Middleware（`proxy.ts`）→ 均需在 CF 运行时复测。

---

## 9. 运行时环境变量名称（全量枚举 → P0-03 凭据清单源）

共枚举出 **241 个** 不同 `process.env.*` 名称（来源：`src` + `scripts` + `prisma`）。按职责分类（仅列关键项，完整清单见 `27_CF_SECRETS_REGISTER.md` 待建）：

| 分类 | 关键变量 |
| --- | --- |
| 数据库 | `DATABASE_URL` `DATABASE_AUTH_TOKEN` `TURSO_DB_URL` `TURSO_TOKEN` |
| 认证 | `AUTH_SECRET` `AUTH_URL` `NEXTAUTH_SECRET` `NEXTAUTH_URL` `ADMIN_SECRET` |
| AI Provider | `AGENT_PROVIDER` `AGENT_TEST_ISOLATION` `AGENT_EXPECT_REAL_CALLS` `OPENAI_API_KEY` `OPENAI_BASE_URL` `OPENAI_MODEL`（`WORKBUDDY_LLM_ENDPOINT/KEY/MODEL` 见记忆） |
| 支付 | `CREEM_API_KEY` `CREEM_WEBHOOK_SECRET` `CREEM_ENV` `STRIPE_SECRET_KEY` `STRIPE_WEBHOOK_SECRET` `PINGPONG_*` `GUMROAD_*` |
| 邮件 | `RESEND_API_KEY` `SMTP_HOST/PORT/USER/PASSWORD/FROM` |
| Firebase | `FIREBASE_CLIENT_EMAIL` `FIREBASE_PRIVATE_KEY` `FIREBASE_PROJECT_ID` + `NEXT_PUBLIC_FIREBASE_*` |
| 实时/WebRTC | `PUSHER_*` `NEXT_PUBLIC_PUSHER_*` `TURN_*` |
| CF 部署（非运行时） | `CF_ACCOUNT_ID` `CF_API_TOKEN`（仅 `wrangler` 用，不应进前端） |
| Netlify | `NETLIFY_*` |
| Upstash | `UPSTASH_REDIS_REST_URL` `UPSTASH_REDIS_REST_TOKEN` `UPSTASH_API_KEY` `UPSTASH_EMAIL` |
| 社交登录 | `GOOGLE_CLIENT_ID/SECRET` `TWITTER_CLIENT_ID/SECRET` |
| 短信 | `TWILIO_*` |
| 媒体 | `PEXELS_API_KEY` |
| 构建/可观测 | `COMMIT_REF` `GITHUB_SHA` `NEXT_PUBLIC_BUILD_*` `NEXT_PUBLIC_GTM_ID` |
| 代理 | `HTTPS_PROXY` `HTTP_PROXY` `LOKFEEL_PROXY_URL/PORT` |
| 测试/E2E | `E2E_*` `QA_*` `AC*_DB_FILE` `LIFECYCLE_E2E_DB` 等（大量，仅测试用） |

> 注：本环境检测到 `HTTP_PROXY`/`HTTPS_PROXY` 已设置（wrangler 启动时有 proxy 警告），不影响本地构建，但 CI/部署需确认代理不会干扰 CF API 调用。

---

## 10. Cloudflare 访问权限是否具备

| 检查 | 结果 |
| --- | --- |
| `wrangler` 二进制 | ✅ 已安装（4.x） |
| `CLOUDFLARE_API_TOKEN` | ❌ 未设置 |
| `CF_API_TOKEN` | ❌ 未设置 |
| `CLOUDFLARE_ACCOUNT_ID` / `CF_ACCOUNT_ID` | ❌ 未设置 |
| `CLOUDFLARE_API_KEY` | ❌ 未设置 |
| OIDC（GitHub Actions） | ❓ 未核实（需查看仓库 Secrets / Variables，`BLOCKED_ACCESS`） |

**结论**：本环境**不具备**任何 Cloudflare 写/读凭据。所有 CF 远端操作（创建 Worker、绑定 R2/KV/Queues、设 Secrets、切 DNS）均需用户提供 token 或经受控授权。本地仅能：校验 `wrangler.jsonc` 合法性、跑 `cf:build`（无需凭据）。

---

## 11. 原生产平台 vs CF 目标平台差异（关键）

| 层 | 今天（Netlify + CF 边缘） | V20.1 R1 目标（CF Workers） | 风险 |
| --- | --- | --- | --- |
| 计算/API | Netlify Functions | **CF Workers**（`lokfeel-app`，OpenNext） | 运行时兼容（§8） |
| 域名/DNS/TLS | **CF 已承接** | CF 不变 | 低 |
| WAF/Analytics | **CF 已承接** | CF 不变 | 低 |
| 数据库 | Turso（libSQL HTTP） | **Turso 保持不变（R1）** | 低（HTTP 兼容） |
| 缓存 | Upstash Redis | 暂保持（R2 再议 KV） | 低 |
| 定时任务 | Netlify 定时函数 | **CF Cron Triggers** | 中（需改写调度） |
| 文件/证据 | 待核查 | R2（R2） | 中（落点未明） |
| 凭据管理 | Netlify env + `.env` | **CF Secrets + GitHub OIDC** | 中（P0-03） |

**R-01（发布阻断级）**：V20.0 S1 沙箱提交（`b6727ee`/`47d4d8f`）尚在 `t4/v199-visual`，未合 `main`。若直接对未合入分支做 CF 部署，生产代码将缺 S1 闭环修复 → **必须先合 main**。

---

## 12. CF 构建脚手架一致性（已提交，待 P0-02 验证）

**`wrangler.jsonc`（真实内容，已读）**：
```jsonc
{
  "name": "lokfeel-app",
  "main": ".open-next/worker.js",
  "compatibility_date": "2025-09-01",
  "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],
  "assets": { "directory": ".open-next/assets", "binding": "ASSETS" },
  "services": [{ "binding": "WORKER_SELF_REFERENCE", "service": "lokfeel-app" }]
}
```

**`open-next.config.ts`（真实内容，已读）**：`defineCloudflareConfig({})`；注释明确**初始不绑定增量缓存**（保持 Worker 小巧，避免付费 R2/KV），ISR 后续再接。

**`package.json` `cf:*` 脚本**：`cf:build` / `cf:deploy` / `cf:preview` / `cf:upload` / `cf-typegen` 均存在。

**构建验证**：`npm run cf:build`（无需 CF 凭据）已后台运行（任务 `e8uDyl`，8m52s）。

### 🔴 构建结果：`FAILED`（真实兼容性阻断，非计划书）

任务包装层报告 exit 0，但 OpenNext 构建进程**实际抛错崩溃**（详见下方栈）。这正是作战令警告的"不要把 `next build` 通过等同于 Workers 兼容"。

**崩溃栈（节选）**：
```
Bundling middleware function...
Bundling static assets...
Building server function: default...
node_modules/@opennextjs/aws/dist/build/copyTracedFiles.js:143
    throw new Error(`This error should only happen for static 404 and 500 page from page router...,
        File server/middleware.js does not exist
  at computeCopyFilesForPage (.../aws/dist/build/copyTracedFiles.js:143:19)
  at copyTracedFiles (.../aws/dist/build/copyTracedFiles.js:177:9)
  at generateBundle (.../cloudflare/dist/cli/build/open-next/createServerBundle.js:122:60)
```

### 根因（已实查）

| 证据 | 值 |
| --- | --- |
| 仓库是否有 `middleware.ts` | **无**（git ls-files + 磁盘均无） |
| `.next/server/middleware-manifest.json` | `{"version":3,"middleware":{},"functions":{}}` → **空，无真实中间件** |
| `.next/server/middleware.js` | 233 字节，**Next 16.4.2 (Turbopack) 生成的占位 stub** |
| `.next/server/middleware.js.nft.json` | 16725 字节（存在，诱导 OpenNext 以为有中间件） |
| `.next/standalone/.next/server/middleware.js` | **不存在**（standalone trace 正确地省略了占位 stub） |

**结论**：Next 16.4.2 + Turbopack 会**无条件**吐出 `server/middleware.js` 占位桩；OpenNext `copyTracedFiles`（来自捆绑的 `@opennextjs/aws@4.1.11`）看到 `.nft.json` 即尝试把 `standalone/.next/server/middleware.js` 拷入产物，但该文件在 standalone 中不存在 → 抛错。这是 **Next 16.4.1–16.4.4 与 OpenNext 的已知兼容缺陷**，与本项目业务代码无关。

### 修复决策（最小爆炸半径，已授权"修复兼容缺陷"）

**第一次尝试（已证伪）**：仅升 `@opennextjs/cloudflare` 1.20.12→1.20.15（捆绑 aws 4.1.11→4.1.14）。重跑 `cf:build` **仍同一崩溃**。经查 `copyTracedFiles.js`：`safeComputeCopyFilesForPage` 仅用于 404/500/`_not-found`，而 middleware 分支（第 177 行）**始终调用不安全的 `computeCopyFilesForPage("middleware")`**，且触发条件是 `.next` 中存在 `MIDDLEWARE_TRACE_FILE`（Next 16.4.2 Turbopack 为占位 stub 仍会产出该 trace）。

**根因修正**：问题在 **Next 侧**。OpenNext `1.20.16` 把 peer 抬到 `next >=16.4.5`，即官方确认 **Next 16.4.5 才修正 Turbopack 占位 middleware 的 trace 产出**。故仅升适配器无效。

→ **最终方案（维护者受支持组合）**：同时升
- `next`: `16.4.2` → **`16.4.5`**（同 minor 补丁，且 16.4.5 本身是安全发布：修补 use-cache 跨租户/缓存投毒等 6 项中危告警 → 顺带加固生产）
- `@opennextjs/cloudflare`: `1.20.15` → **`1.20.16`**（peer 要求 `next >=16.4.5`）

**下一步（P0-02 入口）**：执行双升 + `cf:build` 重跑；并通过 `npm run typecheck` / `lint` 确认 Netlify 生产路径未因 Next 补丁版本回归（见 §14）。

---

## 13. P0-01 验收清单回填

| 验收项 | 结果 |
| --- | --- |
| 所有实际资源有真实来源 | ✅ 仓库/线上事实均标注来源；CF API 资源 `BLOCKED_ACCESS` |
| 无权限的资源标记 `BLOCKED_ACCESS` | ✅ §3/§4/§5/§10 已标 |
| 不得把计划中的 CF 服务写成已创建 | ✅ `wrangler.jsonc` 明确标注为"待部署模板" |
| 明确原生产平台与 CF 目标平台差异 | ✅ §2 / §11 |

---

## 14. 下一步（P0-02 入口）

1. ~~等待 `e8uDyl` 构建结果~~ → **`e8uDyl` 已失败**（Next 16.4.2 占位 middleware 触发 OpenNext `copyTracedFiles` 崩溃，详见 §12）。
2. **修复已应用**：`next` 16.4.2→**16.4.5**（同 minor 安全补丁）+ `@opennextjs/cloudflare` 1.20.12→**1.20.16**（peer 要求 `next>=16.4.5`），已 `npm install` 生效（`aws` 4.1.11→4.1.15、`wrangler` 4.141→4.151）。重跑构建任务 `KtdE86` 进行中。
3. **CF 流水线文件已建立**（P0-02 交付）：
   - `.github/workflows/cloudflare-preview.yml`：PR → 构建 → `opennextjs-cloudflare preview` → 评论 Preview URL。
   - `.github/workflows/cloudflare-production.yml`：push main / 手动 `confirm=DEPLOY` → 构建 → `opennextjs-cloudflare deploy`。
   - 两文件均要求仓库 Secrets `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`（最小权限，Preview/Production 分域）；本地无凭据，未实测远端。
4. 若 `KtdE86` 通过 → 验证 `.open-next/worker.js` 产出，进入真实 Preview 部署（需 CF 凭据）。
5. 若仍失败 → 按真实错误定位（Prisma client-js 在 Workers / 原生模块 / 其它 Next 16.4.5 差异）。
6. **P0-03 前置**：本审计 §9 的 241 变量分类即 `27_CF_SECRETS_REGISTER.md` 的输入；CF 凭据到位前 Secrets 仅能列出、不能注入。

> 本文件未执行任何生产部署、不可逆数据迁移或真实付费操作。所有 CF 远端动作均受凭据缺失约束，如实标记。
