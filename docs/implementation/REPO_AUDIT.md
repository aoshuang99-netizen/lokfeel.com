# REPO_AUDIT — LokFeel 真实仓库审计（T00 阻断门）

> 依据 `lokfeel_workbuddy_v1/WORKBUDDY_MASTER_PROMPT.md` 第「首先执行（阻断门）」节产出。
> 审计对象是**真实生产仓库**，不是交付包内的参考实现。
> 所有结论均标注文件路径与行号；凡未经实测的推断一律标注「未验证」。

---

## 1. 元信息

| 项 | 值 | 证据 |
|---|---|---|
| 本地路径 | `/Users/frankzhao/WorkBuddy/20260402202519/nexus-app` | `pwd` |
| 远端 | `github.com/aoshuang99-netizen/lokfeel.com.git` | `git remote -v` |
| 分支 | `main` | `git branch` |
| HEAD | `6085d31` | `git rev-parse HEAD` |
| 远端同步 | `HEAD == origin/main`（无未推送提交） | `git rev-parse origin/main` |
| 工作树 | **干净**（`git status --short` 为空） | 审计前后各查一次 |
| 生产域名 | `https://app.lokfeel.com`（Netlify + Cloudflare 橙云） | `netlify.toml:1-6` |
| 产品 | LokFeel 关系结构匹配引擎 | `README.md` |

**审计过程中未修改任何既有文件**；本文件与同目录产物是本次唯一新增内容（工作树在审计开始时干净，故「不覆盖用户修改」自动成立）。

---

## 2. 运行时与依赖

| 项 | 值 | 证据 |
|---|---|---|
| Node | **22**（`.nvmrc` = `22`） | `.nvmrc`；`netlify.toml:11` `NODE_VERSION="22"` |
| 包管理器 | npm（`package-lock.json` 存在） | `ls package-lock.json` |
| 框架 | **Next.js 16.3.6**（App Router + Turbopack） | `package.json:99` |
| UI | React 19.3.0 | `package.json:105-106` |
| ORM | **Prisma 7.10**，datasource `provider = "sqlite"` | `package.json:84,102`；`prisma/schema/core.prisma:9-11` |
| 数据库客户端 | `@libsql/client` + `@prisma/adapter-libsql`（Turso/libSQL）；另装 `@prisma/adapter-pg` 备用 | `package.json:81-83` |
| 认证 | **NextAuth v5**（`^5.0.0-beta.32`） | `package.json:100` |
| 中间件 | 仓库根 **`proxy.ts`**（Next 16 已废弃 `middleware.ts`） | `proxy.ts:27-28,31` |
| 支付 | Creem（主）+ Stripe + PingPong 适配器 | `package.json:92,113`；`src/app/api/payments/*` |
| 实时 | Pusher + socket.io + 自建 WebSocket | `package.json:103-104,110-111`；`src/lib/im/websocket` |
| 邮件 | Resend / Nodemailer | `package.json:101`；`src/lib/email.ts` |
| 其它 | Sentry、Upstash Redis、Firebase、sharp、zod 4 | `package.json:85-117` |
| Python | **仅交付包参考实现需要**；生产仓库无 Python 运行时 | 无 `requirements.txt`/`pyproject.toml` |

> ⚠️ **数据层方言冲突（P0）**：`prisma/schema/core.prisma:10` 写死 `provider = "sqlite"`，
> 而目标契约 `contracts/schema.sql` 是 **PostgreSQL**（`gen_random_uuid()` / `jsonb` / `timestamptz` / `CHECK` 约束）。
> 这是本次改造中影响面最大的**结构性差异**，详见 `MIGRATION_PLAN.md` §1。

---

## 3. 代码规模与结构

| 指标 | 数值 | 命令 |
|---|---|---|
| `src/` TS/TSX 文件 | **483** | `find src -name "*.ts" -o -name "*.tsx" \| wc -l` |
| `src/` 总行数 | **186,631** | `find src ... \| xargs wc -l` |
| `src/lib/` 行数 | 27,728 | 同上（`src/lib`） |
| API 路由文件 | **147**（177 个路由段） | `find src/app/api -name route.ts \| wc -l` |
| Prisma model | **39**（core 33 + bot 6） | `grep -c "^model " prisma/schema/*.prisma` |
| Prisma enum | 43 | `grep -n "^enum " prisma/schema/*.prisma` |
| 迁移 | 6 | `ls prisma/migrations \| wc -l` |
| 页面 | ~85（`(admin)` / `(auth)` / `(dashboard)` / `(public)` 四个路由组） | `find src/app -name page.tsx` |
| Jest 测试文件 | 18 | `find tests -name "*.test.ts*"` |
| Playwright E2E | 6 | `tests/e2e/*.spec.ts` |

### 3.1 目录骨架

```
src/
├── app/
│   ├── (admin)/admin/**            # 后台（21 页）
│   ├── (auth)/{login,register,...} # 认证页
│   ├── (dashboard)/dashboard/**    # 用户端（10 页，含 chats / connections / matches）
│   ├── (public)/**                 # 法务与营销页（18 页）
│   └── api/**                      # 147 个 route.ts
├── config/region-policy.ts         # 地域封禁 + CORS + 调试端点门控（配置驱动）
├── lib/
│   ├── auth/                       # NextAuth v5 配置 + requireAdminAuth
│   ├── with-permission.ts          # RBAC 高阶函数守卫（withPermission / withAnyPermission）
│   ├── matching/{engine,enhanced-engine,scoring}.ts
│   ├── rules/{engine,schema,sync,defaults}.ts   # PowerBoard 规则引擎
│   ├── im/**                       # 会话/消息/网关/presence/信令
│   ├── rtc/ice-sources.ts          # WebRTC ICE 四级来源
│   ├── bot-engine/**               # 数字用户行为引擎
│   └── guards/admin-guard.ts
└── generated/                      # Prisma client 产物
proxy.ts                            # ⚠️ 中间件在仓库根，不在 src/
```

---

## 4. 业务闭环映射（核心结论）

目标闭环：**Mission → Intent → Reciprocal Match → Proposal → Mutual Consent → Introduction → Coordination → Outcome**

| 环节 | 现状 | 证据（文件:行） | 缺口 |
|---|---|---|---|
| **Mission** | 🔴 **不存在** | `grep -r "Mission" src` 零命中；Prisma 无 Mission 模型 | 无任务实体、无成功标准、无额度、无分享链接 |
| **Intent** | 🟡 **部分**（画像级，非任务级） | `Profile` 的 `relationshipGoal`/`attachmentStyle`/`boundaries`/`dealbreakers`/`selectedTags`/`kinkInterests`/`hardLimits`（`core.prisma:180-203`）；`Match.pitchMessage`（`core.prisma:306`） | 意图**不挂任务、无有效期、无逐字段披露范围**；无 offer/constraints 结构 |
| **Reciprocal Match** | 🟡 **单向主导** | `Match`（`core.prisma:263-337`，含 `matchScore` + 5 维兼容分）、`MatchReaction`；`src/lib/matching/engine.ts:355 calculateMatchScore`、`:468 findTopMatches`；`/api/matching/enhanced`、`/api/auto-match`、`/api/matches/weekly` | 模型是 **sender→receiver 单向投递**（`senderId`/`receiverId` + `pitchMessage`），非「双向需求互认」；无硬门控先于召回的显式分层 |
| **Consent** | 🟢 **已实现且成熟** | `ConsentRequest`（`core.prisma:645-680`，含 `consentType`/`requestedLevel`/`state`/`grantToken`/`expiresAt`）、`ConsentGrant`（`:682-712`，含 `grantedLevel`/`expiresAt`/`isRevoked`/`revokedAt`）；`Conversation.cachedConsentState`（`:449`）；`/api/im/consent` **311 行**（GET 查授权、POST 建请求、PATCH 决策→建 grant/撤销，含过期校验与实时推送） | 授权作用域是 **会话 × 媒体等级**，**未挂到 mission/proposal/outcome**；无 `purpose` / `recipient_scope` / `field_scope` 三元组 |
| **Introduction / Coordination** | 🟢 **已实现** | `Conversation`/`ConversationParticipant`/`IMMessage`/`MessageReceipt`/`MessageReaction`/`UserPresence`（`core.prisma:366-639`）；`/api/im/{send,conversations,messages,read,typing,presence,reactions}`；`lib/im/**` | **无介绍工作流状态机**（无 outbox / 幂等键 / 重试 / 死信 / 人工接管）；`IMMessage.clientMsgId`（`:509`）已具备幂等锚点但仅限消息级 |
| **实际连接（音视频）** | 🟡 **可用但有阻塞** | `/api/rtc/ice-servers`、`/api/im/call/signal`、`lib/rtc/ice-sources.ts`（四级来源）；TURN 已切 Cloudflare Realtime | 已知未闭合：Pusher 频道前缀不一致、无 TURN 时对称 NAT 失败（见 `docs/P1-P2-*`） |
| **Outcome** | 🔴 **不存在** | 无 `Outcome` 模型；无 `verification_level`；无漏斗/成本/工时统计 | 三级验证（自报/对方确认/外部验证）**全缺**；计费未挂"结果" |
| **Agent 编排** | 🟡 **仅模拟** | `lib/bot-engine/**`（行为引擎/学习/调度）、`/api/bot-automation`、`prisma/schema/bot.prisma`（6 模型） | 是**数字用户模拟**，不是「人↔人协调 Agent」；无 LLM schema 校验、无人工批准闸门、无提示注入防御、无成本限额 |
| **多租户 / SaaS Console** | 🔴 **不存在** | `grep -r "tenantId\|tenant_id\|organization\|workspace" src` **零命中**；`docs/MULTI-TENANCY-DESIGN.md:12-14` 自述「42 张表中没有任何 tenant/organization/workspace 概念」 | 单租户单实例；无 `organizations`/`memberships`；SaaS Console 无 |
| **计费** | 🟡 **模型齐、生产未通** | `Subscription`/`Payment`（`core.prisma:816-879`）、`/api/payments/{creem,status,verify-card}`、`/api/webhooks/creem`（**HMAC 签名校验已实现**，`route.ts:25-48`） | 生产缺 `CREEM_API_KEY`/`WEBHOOK_SECRET`/两个 `PRODUCT_ID` → 计费链路 **BLOCKED** |

### 4.1 一句话结论

> 仓库已具备 **Consent / IM / 音视频 / RBAC / 审计 四块高价值积木**（可直接复用），
> 但**缺失闭环的两端**（Mission、Outcome）和**贯穿性的租户维度**。
> 改造的本质不是「重写」，而是：**在既有 Consent+IM 之上，向前补 Mission/Intent，向后补 Outcome，向外包一层 tenant**。

---

## 5. 可复用能力清单（带证据）

| 能力 | 位置 | 复用价值 |
|---|---|---|
| 会话/消息模型（含幂等锚点 `clientMsgId`、序号 `seq`、回执、表情、presence） | `core.prisma:366-639` | ★★★ 直接作为 Coordination 层 |
| 同意请求/授权（请求→待决→决策→授权→撤销，含过期与 token） | `core.prisma:645-712`、`/api/im/consent` | ★★★ 扩展 scope 即可用于 Mission Consent |
| PowerBoard 规则引擎（节奏/媒体/内容/隐私四类 JSON 策略 + 版本） | `core.prisma:718-751`、`lib/rules/**` | ★★★ 作为确定性权限门控的现成载体 |
| 哈希链审计日志 | `core.prisma:757-787`（`prevHash`/`entryHash`） | ★★★ 直接满足审计不可抵赖 |
| RBAC（角色/权限/自定义角色 + `withPermission` 高阶守卫） | `core.prisma:1008-1092`、`lib/with-permission.ts`、`lib/admin-permissions.ts` | ★★★ 扩为租户内 RBAC |
| 匹配引擎（5 维兼容分 + 解释） | `lib/matching/engine.ts:355,468`、`lib/matching/scoring.ts` | ★★ 改造为「硬过滤 + 双向召回 + 解释排序」 |
| 地域/CORS/调试端点门控（配置驱动、纯函数、可测） | `src/config/region-policy.ts`、`proxy.ts` | ★★ 直接沿用；新增路径需同步 `DEFAULT_DEBUG_PATHS` |
| WebRTC ICE 四级来源 + TURN 一键开通 | `lib/rtc/ice-sources.ts`、`scripts/setup-cloudflare-turn.mjs` | ★★ 连接环节现成 |
| 认证（NextAuth v5 + OAuth state/PKCE + 一次性 auto-login token） | `src/lib/auth/**`、`/api/auth/**` | ★★ 扩展 OIDC/组织 |
| CI（typecheck/lint/test/build/secret-scan/audit/DCO 七道门） | `.github/workflows/ci.yml` | ★★★ 可直接作为 AC-23 证据载体 |
| 测试基建（18 Jest + 6 Playwright） | `tests/**` | ★★ 扩展即可 |

---

## 6. 安全发现

### 6.1 实测证据（只读探测，2026-10-10 14:44 CST，出口 CN）

| 端点 | 结果 | 判定 |
|---|---|---|
| `GET /api/health` | `200` | 预期公开 |
| `GET /api/debug/config-check` | `403 {"error":"Forbidden: Admin access required"}` | ✅ 有 `requireAdminAuth`（`route.ts:23`） |
| `GET /api/db-check` | `403` 同上 | ✅ 有守卫（`route.ts:14`，`isDebugPath` 亦覆盖） |
| `GET /api/geo-check` | `200`，回显 `cf-ipcountry=CN`、`blocked:true` | 🟡 未鉴权诊断端点，泄露**无**用户数据，风险低 |
| `GET /api/config/firebase` | `200`，回显 Firebase Web 配置 + Google Client ID | 🟡 Firebase Web 配置**设计上公开**；此处无新增泄露面 |

> ✅ **未发现匿名可读的用户数据接口**。

### 6.2 方法论修正（重要）

首轮用固定正则扫 147 个路由，报出 **60 条「无守卫」**；加入 `withPermission` / `withAnyPermission` 后降到 **23 条**；逐条读源码后确认 23 条**全部是有意公开**（认证流、health、geo-check、config/firebase、guest、analytics collect、payments products、admin login/logout/session）。

⚠️ **教训（已写入技能）**：**模式匹配既会漏报（`requireAdminAuth`/`withPermission` 都不在首轮正则里）也会误报。路由鉴权的真相只能在「读入口包装函数」或「真实请求探测」里得到，不能靠 grep 计数。**

### 6.3 凭据入库检查

| 项 | 结果 |
|---|---|
| `.env` / `.env.local` / `.env.production` 是否被追踪 | ✅ **未追踪**（`.gitignore:34-38`） |
| 被追踪的变体 | `.env.check`、`.env.creem-check`、`.env.pull`、`.env.vercel`、`.env.test`、`.env.local.template`、`.env.pingpong.example` |
| 其中是否含真实密钥 | ✅ **否**。`.env.creem-check`/`.env.vercel` 值为空串 `""`；`.env.test` 全为 `test-*` 占位（实测读全文确认）；其余为 `*.example`/`*.template` |
| CI 密钥扫描 | ✅ 已启用 gitleaks，`fetch-depth: 0` 扫全历史（`ci.yml` secret-scan 任务） |

🟡 **遗留卫生问题**：`.env.vercel` / `.env.creem-check` 虽无真实值，但**枚举了全部 55 个密钥名**，且未被 `.gitignore` 规则覆盖。建议删除或纳入忽略（非阻断）。

### 6.4 地域策略观察

生产 `GET /api/geo-check` 自述 `blocked:true`（CN 在封禁名单），但 `/api/*` 仍返回 `200` 而非 `451`。
说明**当前生产配置下地域策略未对 API 路由生效**（或 API 走 allow 分支）→ **API 的鉴权只能依赖路由自身守卫**。
这一点必须在 T01 明确并加测试（AC-02），不能默认「有地域封禁就等于有访问控制」。

---

## 7. 风险与阻断项

| # | 级别 | 风险 | 证据 | 处置 |
|---|---|---|---|---|
| R1 | 🔴 BLOCKER | **数据层方言冲突**：目标契约 PostgreSQL，现网 libSQL/sqlite | `core.prisma:10` vs `contracts/schema.sql:1-4` | T01 前定方案（见 `MIGRATION_PLAN.md`） |
| R2 | 🔴 BLOCKER | **零租户维度**：39 张业务表无 tenant | 全量 grep 零命中；`docs/MULTI-TENANCY-DESIGN.md` | T01 全面改造，最长路径 |
| R3 | 🔴 BLOCKER | 无 Mission / 无 Outcome 实体 → 闭环不成立 | 见 §4 | T02 / T08 |
| R4 | 🟠 P0 | 匹配为单向投递，非双向互认 | `core.prisma:263-337` | T04 重构召回层 |
| R5 | 🟠 P0 | 无工作流持久化（outbox/重试/死信/接管） | 无相关模块 | T06 新建 |
| R6 | 🟠 P0 | 支付生产 BLOCKED | 缺 Creem 三项凭据 | 用户提供后解阻（T08） |
| R7 | 🟡 P1 | 地域策略对 API 不生效 | §6.4 实测 | T01 明确 + 加测试 |
| R8 | 🟡 P1 | 既有 Jest 失败（`plans-consistency`、`webrtc/components`） | 上轮已用 worktree 对照证明为既有 | T12 前清零 |
| R9 | 🟡 P1 | `.env.*` 变体入库（无真实值） | §6.3 | 卫生清理 |
| R10 | 🟡 P1 | 性别词表不一致（存量 `MALE/FEMALE` vs 代码 `MAN/WOMAN`） | `core.prisma:1106 Gender`；`scripts/qa/migrate-gender-vocab.mjs` | 产品决策后迁移 |
| R11 | 🟢 P2 | 文档漂移：`MULTI-TENANCY-DESIGN.md` 称「42 张表 / `prisma/schema.prisma`」，实际已拆为 `prisma/schema/*.prisma`（39 model） | — | 随 T01 一并订正 |

---

## 8. 交付包参考实现的独立验证

`reference_backend/` 是契约演示（内存态、静态 token，`app/main.py:2` 自述 DEMO ONLY）。
其 4 项测试的**真实执行结果**记录在 `docs/implementation/T00/tests.md`（不采信交付包自述）。

---

## 9. 结论

- **可访问真实仓库**：是。审计基于 `6085d31`，工作树干净，未覆盖任何用户修改。
- **闭环成熟度**：Consent/Coordination 两段**成熟可用**；Mission/Outcome 两段**完全缺失**；Intent/Match 段**方向不符需改造**；tenant **完全缺失**。
- **无阻断级安全漏洞**（未发现匿名读用户数据）；但**地域策略不保护 API** 属需显式处置的认知风险。
- 据此进入 T01，改造顺序与回滚方案见 `MIGRATION_PLAN.md`，复用/重构/新增/移除清单见 `REUSE_MATRIX.md`。

---

_审计人：WorkBuddy（按 `WORKBUDDY_MASTER_PROMPT.md` 角色定义执行）· 2026-10-10 · 基线 commit `6085d31`_
