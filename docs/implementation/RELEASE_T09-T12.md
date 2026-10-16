# 发版记录 · T09 + T10 + T11 + T12（含 AC-10 / AC-23 / AC-24）

> 发版提交：`2d5385d`（2026-10-16 17:10:05 +0800）
> 前一个生产版本：`f6630ea`（2026-10-13，部署 `6acde3962c8778501cd81f27`）
> 本次打包 **34 个提交**（`f6630ea..2d5385d`），259 文件，+121889 / −47368。

---

## 1. 发版前的四项硬前提（全部实测，非"应该没问题"）

| # | 前提 | 取证方式 | 结果 |
|---|---|---|---|
| ① | 生产库 schema 已就绪 | `connection:migrate probe` → 65 张表；`verify` | ✅ **255/255** |
| ② | 本次无需再 apply 迁移 | C0–C9 目标表**全部已存在**（含 C9 `CommunityBridge` / `BridgeMemberOptIn`） | ✅ 免迁移 |
| ③ | schema 变更为纯新增 | `git diff --stat f6630ea..HEAD -- prisma/` | ✅ agent.prisma +374 / bridge.prisma +135 / tenancy.prisma +20，**零删除** |
| ④ | 发版前确实"未发版" | `verify:no-release:surface` | ✅ 5 条 404 + **3/3 正向对照** |

**①的关键性**：若某批次表未建就发版，应用启动即 `no such table` —— 所以先 probe 再发版，而不是"发完再看"。

**构建链**：`build = npx prisma generate && next build` —— 生产表结构与本地产出的 Client **由同一条 `prisma generate` 保证一致**，不存在手工同步环节。

**发版前快照**（`db-snapshot before`）：
```
表数量 65 · User 12922 · Profile 11887 · Organization 1 · Membership 0
```

---

## 2. 发版执行

```
db-snapshot(before)
  → connection:migrate probe + verify（255/255）
  → commit 2d5385d（**不带** [skip netlify]）
  → bash scripts/push-main.sh
```

推送后 `ls-remote` 复核远端 `refs/heads/main` = `2d5385d`，领先/落后 `0/0`。

> ⚠️ 推送时脚本打印了 `Everything up-to-date`。**这不是失败，但也不能当成功** ——
> 所以当场用 `ls-remote` 取远端真实 HEAD 复核（脚本的输出语句不是证据，远端 ref 才是）。

---

## 3. 发版后复验（免凭据 · 公开 HTTP 面）

### 3.1 生效断言（`npm run verify:released:surface`）

| 路由 | 发版前 | 发版后 | 归属 |
|---|---|---|---|
| `/api/v1/bridges` | 404 | **401** | T10 Community Bridge |
| `/api/v1/agents/runs` | 404 | **401** | T09 Agent 运行 |
| `/api/mcp` | 404 | **405**（GET 不允许；MCP 走 POST） | T11 Streamable HTTP |
| `/.well-known/agent-card.json` | 404 | **200** | T11 A2A agent card |
| `/api/v1/me/export` | 404 | **401** | AC-10 |
| `/api/v1/me/erasure` | 404 | **401** | AC-10 |

结果：**6/6 达期望 + 2/2 正向对照命中**。

**为何 405 / 200 也算"在"**：`/api/mcp` 的 GET 返回 405 恰恰证明路由存在（Streamable HTTP 只收 POST）；
agent-card 是公开发现面，应 200。**若用"非 404 即通过"一把尺子，会把 405 与 500 混为一谈。**

**为何必须有正向对照**：`/api/health` 必须真 200、`/api/v1/org` 必须是 401/403。
否则"新路由可达"可能只是全站异常造成的**假绿** —— 这是本探针赖以成立的唯一假设。

**部署指纹**：响应头含 `x-nf-request-id` + `cache-status: "Netlify Durable"`，
且 `cf-cache-status: DYNAMIC` ⇒ 结论来自 **Netlify 源站**，不是 Cloudflare 缓存。

> 🔎 **时间感知偏差的记录**：轮询初版给出"8 秒生效"，与 Next.js 构建耗时不符，因此**没有采信**，
> 而是改用 6 条路由 + 部署指纹交叉确认。结论成立；"8 秒"是轮询启动时构建其实已完成的错觉，
> 不是"构建真的只要 8 秒"。

### 3.2 public-origin 修复（`verify-public-origin.mjs`）

**13 通过 / 0 失败**：
- 缺失 `state` / `state` 不匹配 / PKCE 失败 → 一律跳回 `https://app.lokfeel.com/login`
- `/api/auth/signin/google` → `https://app.lokfeel.com/api/auth/oauth/google/signin?callbackUrl=%2Fdashboard`
- Google `redirect_uri` = `https://app.lokfeel.com/api/auth/callback/google`
- **泄漏总扫描：0 处** `<deploy-id>--<site>.netlify.app`

### 3.3 数据库零影响（`db-snapshot diff before after`）

```
表数量 65 → 65 · 新增表 0 · 消失表 0 · 既有表行数变化：全部未变
```

发版过程对既有数据 **零影响**（本次发版不含写路径）。

---

## 4. A1（生产侧出口连通性）—— ✅ 已实跑闭合（分层读数）

### 4.1 前置：生产原本**没有任何账号能进组织**

首轮实跑时卡在登录：

```
[1] 匿名访问      ✅ 401 + JSON 信封   ⇒ 路由已上线、能力闸门生效
[2] 真实登录      ❌ POST /api/auth/login → 401 Invalid email or password
    ⏭️  SKIP 带会话复验诊断端点（登录未拿到 cookie）
```

**根因不是密码过期** —— 用项目自带的定性器（本地 bcrypt 直验库中哈希）：

```
npm run qa:probe:login
── qa.male@lokfeel.com   ❌ 库中不存在该账号 → 需要在生产重建
── qa.female@lokfeel.com ❌ 库中不存在该账号 → 需要在生产重建
```

独立只读 SQL 复核：`User` 中 `qa.*` = **0 行**；`Membership` = **0**；非 bot 人工账号 = **0**。
⇒ 诊断端点**取不到会话**，与代码无关。

### 4.2 为闭合 A1 所做的**生产写入**（已获显式授权）

| 步骤 | 工具 | 结果 |
|---|---|---|
| ① 重建 2 个 QA 账号 | `node scripts/qa/create-qa-accounts.mjs`（既有） | `qa.male` = `129868c6-…` / `qa.female` = `b032732b-…`，`isBot=0`、APPROVED/step9 |
| ② 加入组织 | **`node scripts/qa/grant-qa-org.mjs --apply`（本轮回填新增）** | 2 条 `Membership`：`org_default` + `OPERATOR` / `ACTIVE` |

**为什么 role 取 OPERATOR 而不是 ADMIN**：`agent.execute` 属 OPERATOR 及以上，而 `agent.approve` 是
**ADMIN** 门槛 —— AC-08 的制度设计正是「**能跑不能批**」。把 QA 账号直接提成 ADMIN 会**抹掉这条分离**，
让后续校验分不清"设计如此"与"配错了"。

**为什么新增脚本而不是一次 SQL**：建号脚本（`create-qa-accounts.mjs`）只建 `User` + `Profile`、**不建
`Membership`**，而租户域端点要求成员关系 ⇒ 这个缺口会**反复出现**。新脚本默认 dry-run、幂等、
支持 `--revoke`，与本仓「默认只读」的惯例一致。

### 4.3 复验读数（`npm run verify:agent:connectivity:server`）

```
结果：22 通过 / 0 失败 / 0 跳过
[2] POST /api/auth/login → 200 ✅（下发了会话 cookie）
[3] GET  /api/v1/agents/diagnostics/connectivity → 200 ✅
[4] 报告五段齐备 ✅（endpoint / network / identity / credentials / probe）
[5] summary 与客户端重算一致（服务端=FAIL 重算=FAIL）✅ · 响应体无 sk- 密钥 ✅
[8] 无部署专用域名泄漏 ✅

关键读数：
  endpoint   : https://app.lokfeel.com/.netlify/ai   [env]   probe=…/.netlify/ai/models
  network    : PASS   HTTP 400   285ms     ← 出口**能到**该端点
  identity   : INFO   （host 非 openai.com —— 错误体形状由该端点自定，刻意不判死）
  credentials: FAIL   keyPresent=true len=366   ← HTTP 400，非预期状态
  summary    : FAIL —— 见各层 detail
```

> ⚠️ **22/0 的含义要读准**：脚本断言的是**报告的形状与诚实性**（五段齐备、summary 与重算一致、
> 不泄漏 key、单调性成立），**不是**"连通性 PASS"。所以 22/0 = **这份报告可信**，
> 结论要看报告内容本身。

### 4.4 A1 的准确结论（分层，不合并说）

| 层 | 结论 | 依据 |
|---|---|---|
| 匿名层 | ✅ 已验 | 401 + JSON 信封（路由已部署、能力闸门生效） |
| **网络层** | ✅ **PASS** | 生产函数**成功到达**外部端点 —— 往返 **285ms** 并收到 HTTP 响应 |
| 身份层 | ℹ️ INFO | host 不是 `openai.com`（见 §4.5），错误体形状由端点自定 |
| 凭据层 | ⚠️ **FAIL** | 端点回 **400**（非 401/403） |

⇒ **A1 的核心问题「生产出口能不能出去」已由端点实证：能。**（这是本项要回答的问题。）
⇒ 但**不得**由此外推为"OpenAI 凭据可用" —— 400 是端点对**请求**的答复，不是对**凭据**的答复
（凭据被拒会回 401）。

### 4.5 🔴 顺带拿到的生产事实：出口指向 **Netlify AI Gateway**

```
endpoint.baseUrl = https://app.lokfeel.com/.netlify/ai     source = env
credentials.keyLength = 366
```

即生产的 `OPENAI_BASE_URL` 指向 **Netlify 的 AI 网关**（`/.netlify/ai`，免费计划会自动注入该组变量），
而非 `https://api.openai.com/v1`。外部不带凭据直打同一 URL → **401**；而生产函数带着凭据打 → **400**。

**最可能的解释**：网关只代理 `POST /chat/completions` 之类的推理路径，**不实现 `GET /models`** ——
而诊断探针刻意只打 `/models`（**不计费**，见 T09 Slice 5 设计）。⇒ 这是**探针假设与端点形状不匹配**，
不是"出口被墙"。

**处置（本轮不修，需拍板）**：
- 若要验"凭据被真实推理端点接受"，必须打**计费**路径 ⇒ 属成本决策；
- 若要改用直连 OpenAI，需改生产 `OPENAI_BASE_URL` + 配真实 key ⇒ 也属成本决策；
- 也可以维持现状（网关免费额度）—— 那 A1 的结论就停在"网络层 PASS"。

**结论不上推**：本条**只是记录端点形状**；"Agent 在生产能否成功出稿"**本轮未验**（需一次真实计费调用）。

---

## 5. 未闭合项（不虚报）

| 项 | 状态 | 原因 |
|---|---|---|
| **A1 出口连通性** | ✅ **已闭合** | 生产实跑 **22/0**：真实登录 200 + 会话、诊断端点 200、**网络层 PASS**（285ms 到达外部端点）。见 §4 |
| **凭据被推理端点接受** | ⏳ 未验 | 端点回 **400**（诊断探针只打不计费的 `/models`）。要验必须打**计费**路径 ⇒ 成本决策，见 §4.5 |
| AC-25 付费价值 | ⛔ BLOCKED | 无真实试点客户（外部依赖，不可 MOCK） |
| AC-21 真实扣款/退款 | ⛔ BLOCKED | 缺 Creem 凭据（沙箱部分 PASS） |
| 28 条生产可达高危依赖 | 🟡 已登记 + 棘轮 | 未做批量升级（见 `DEPENDENCY_RISK.md`） |
| `organizationId` 未建模（11 表） | 🟡 已知漂移 | 已冻结进棘轮（见 `CI_GATES.md` §4bis） |
| 限流器共用 per-IP 桶 | 🟡 已登记 | 代码级结论，未做运行期实证（见 `PERFORMANCE_BASELINE.md`） |
| **QA 账号 + Membership 留在生产** | 🟡 待收尾 | 验证已完成；如需清理走 `cleanup-qa-accounts.mjs --apply`（`Membership` 随 `User` 级联删除） |

---

## 6. 复跑命令

```bash
# 发版前
node scripts/connection/migrate.mjs probe     # 只读：表/列/索引
node scripts/connection/migrate.mjs verify    # 对账断言
node scripts/qa/db-snapshot.mjs before

# 发版（需要写权限）
git commit --allow-empty -m "chore(release): ..."   # 不带 [skip netlify]
bash scripts/push-main.sh
git ls-remote origin refs/heads/main                # 远端真实 HEAD（唯一证据）

# 发版后
npm run verify:release:wait                     # 轮询生效（免凭据）
npm run verify:released:surface                 # 6 条路由生效断言
node scripts/qa/verify-public-origin.mjs        # 对外跳转公开域名
node scripts/qa/db-snapshot.mjs after && node scripts/qa/db-snapshot.mjs diff before after

# A1（生产侧出口连通性）—— 前置：QA 账号必须在生产存在且属于组织
npm run qa:probe:login                          # ① 先分清"密码过期"还是"账号不存在"
node scripts/qa/create-qa-accounts.mjs          # ② 缺账号时重建（写生产，需授权）
node scripts/qa/grant-qa-org.mjs                # ③ 只盘点（dry-run）
node scripts/qa/grant-qa-org.mjs --apply        #    建/更新 Membership（role 默认 OPERATOR）
npm run verify:agent:connectivity:server        # ④ 实跑：匿名层 / 网络层 / 身份层 / 凭据层

# 收尾（如需清理生产 QA 痕迹）
node scripts/qa/cleanup-qa-accounts.mjs --apply # 删 User（Membership 随外键 CASCADE 消失）
```

---

## 7. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-10-16 | 首版。发版 `2d5385d`（34 提交 / T09+T10+T11+T12 / AC-10/23/24）；发版前 4 项前提实测；发版后 3 项复验（生效断言 6/6 · public-origin 13/0 · DB 零变化）。新增 `verify:released:surface` / `verify:release:wait`；删除已失效的 `verify-no-release-surface.mjs`。 |
| 2026-10-16 | **A1 闭合**（发版后同日）：首轮实跑发现生产 `qa.*` 账号 **0 行** + `Membership` **0** ⇒ 登录 401；经授权重建 2 个 QA 账号 + 建 `org_default` 成员关系（**新增 `grant-qa-org.mjs`**，role=OPERATOR 而非 ADMIN —— 保住 AC-08「能跑不能批」的分离），复跑得 **22/0**：网络层 **PASS**（285ms 到达外部端点）。🔴 **顺带拿到生产事实**：`OPENAI_BASE_URL` 指向 **Netlify AI Gateway**（`/.netlify/ai`），探针打的 `/models` 回 400 ⇒ **凭据层 FAIL 但≠凭据无效**（400 是端点对请求的答复，凭据被拒会回 401）。**"Agent 生产能否出稿"本轮未验**（需计费调用）。 |
