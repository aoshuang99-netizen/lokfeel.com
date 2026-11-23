# Owner 决策卡 · Preview 500 清零后的唯一阻断（2026-11-23）

> 结论先行：**全站 500 已修复并在真实 Cloudflare Preview 复验通过（页面层）**；
> 仍未达成的是「Preview 能连隔离数据库」，因此 P0-02 的 health 200、P0-03 的
> 双账号真实聊天、P0-04/P0-05 的发布验收 **全部 BLOCKED**。
> 这需要 Owner 提供资源，不能用生产 DB/密钥绕过。

## 1. 已完成（有可复核证据）

| 项 | 结果 |
|---|---|
| P0-01 第一条原始异常 | `ChunkLoadError`（error class + 脱敏 stack + 失败文件/环节），见 `ROOT_CAUSE.md` §1 |
| 根因 | Next 16 Turbopack standalone 漏掉 instrumentation 依赖的 runtime chunk → OpenNext 照抄 → worker bundle 无 `requireChunk` case |
| 最小修复 | `scripts/ci/patch-opennext-build.mjs` 补齐 nft 追踪但 standalone 缺失的文件（51 行，不改业务代码） |
| 精确候选 SHA | `9c6b7415b64b865de9db129b0b60735d15d089f1` |
| 真实 Preview 四公开页 | `/`、`/register`、`/product`、`/solutions` **200**（3 轮采样稳定） |
| 运行时身份 | `/api/health` 返回 `commit=9c6b741`、`commitSource=env`；CF-Ray `a5ef7b63ea31ad44-SJC` |
| 支付门 | `/api/payments/dodo/plans` 200 且 `pricingPublished=False`（fail-closed 未被撤掉） |
| 首页 CTA | `Start a real conversation` 真实可见 |
| 凭据隔离 | 已逐项比对本地 `.env*`，构建未把 `DATABASE_URL`/`TURSO_AUTH_TOKEN`/`AUTH_SECRET`/`CREEM_API_KEY` 内联进 bundle |
| 独立 Runner | `45157012028`：8/8 公开页 200、主 CTA PASS、SHA 对齐；`45157012025`：Worker version 48 / deployment `757b4f6b-80a7-482a-97ec-b13ea9d159e3`、`tail.exceptionEvents: []` |
| CI | #430（候选 `9c6b741`）与 #431（QA-only `afa8343`）均 completed success；Preview 部署 #71 completed success |

## 2. 唯一阻断（原始证据）

修复 500 后 `/api/health` 从 500 变为 **503**，错误为：

```
Failed to load external module @prisma/adapter-libsql-54387eee42c9c9c0:
Error: Neon: unsupported Linux architecture:
```

改用纯 JS 的 `@prisma/adapter-libsql/web` 后变为：

```
WebAssembly.Module(): Wasm code generation disallowed by embedder
```

两条路都不通。同时 `wrangler secret list --name lokfeel-preview` 返回 `names: []`，
本地 `.dev.vars` 只有 `NEXTJS_ENV=development`。后果：

- 非法邀请码 `GET /api/invites/lookup?code=invalid` 返回 **500**（契约要求 4xx）；
- 任何需要 DB 的业务动作（登录、邀请、关系、消息）**无法执行**；
- P0-03 的双账号 E2E 无从谈起。

**这不是缺 `QA_PASSWORD`，也不是"疑似缺环境变量"**：公开页已 200，只有 DB 链路失败。

## 3. 需要 Owner 批复的三选一

| 方案 | 动作 | 代价 / 风险 |
|---|---|---|
| **A（推荐）** | 新建一个**独立** libSQL/Turso 数据库（非生产），提供 `DATABASE_URL` + 专用 token，并把 Prisma 迁到 Cloudflare D1 adapter 或预编译 wasm 方案 | 需工程实现 Prisma-on-Workers 适配；一次性 |
| **B** | 授权在 Cloudflare 上创建 D1 数据库并绑定 `lokfeel-preview`，工程改用 `@prisma/adapter-d1` | 改 adapter + schema 迁移，工作量最大但最贴合 Workers |
| **C** | 保持 Preview 仅作**页面/UI 验收**，明确把 P0-03 双账号 E2E 移到已有隔离库的自托管 Staging 环境执行 | 不满足"同一 SHA Preview 跑通真实业务"，需 Owner 明确接受范围收缩 |

同时需要注入 `lokfeel-preview` Worker 的运行时 secrets（**隔离值，禁止复制生产**）：

```
DATABASE_URL / TURSO_AUTH_TOKEN（或 D1 binding）
AUTH_SECRET / NEXTAUTH_URL / NEXT_PUBLIC_APP_URL
```

以及为 GitHub QA Runner 配置 `QA_EMAIL` / `QA_PASSWORD`（两个独立测试账号）。

## 4. 本轮明确未做（安全边界）

- 未部署 / 未迁移生产，未重开支付门，未写生产数据；
- 未复制生产 DB、生产密钥或真实用户数据到 Preview；
- 未把本地 16/16 截图、Deploy Job success 或 API 200 当作运行时 PASS；
- 未用默认口令代替 `QA_PASSWORD`；
- 未保留已证伪的 Sentry 假设作为 PASS 依据，也未保留未闭合的 web adapter 实验改动（已回退）。

## 5. 下一项直接修复动作（拿到 A/B 资源后立即执行）

1. 按选定方案实现 Prisma-on-Workers 适配（仅 Preview 路径，条件隔离，生产链路不变）；
2. 由 Cloudflare Owner 注入隔离 secrets，并 `wrangler secret list` 复核存在性（不输出值）；
3. 重跑 `npm run cf:build` → Cloudflare Preview 部署 → `/api/health` 必须 200 healthy + SHA；
4. 非法邀请码必须 4xx；plans 仍 `pricingPublished=False`；
5. GitHub-hosted Runner 独立复验八页双视口 + 主 CTA 真实点击；
6. 确认隔离库后，A/B 双账号完成邀请 → 接受 → 关系落库 → 双向收发消息，
   提交录屏、Network Trace、对象 ID 与 DB 对账；
7. 独立 Reviewer 签字 + Owner 精确 SHA / 环境 / 迁移 / 回滚审批包，
   才允许讨论 P0-05 受控生产发布。
