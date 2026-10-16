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

## 4. A1（生产侧出口连通性）—— **部分闭合，如实记**

`npm run verify:agent:connectivity:server` 在生产实跑结果：

```
[1] 匿名访问      ✅ 401 + JSON 信封   ⇒ 路由已上线、能力闸门生效
[2] 真实登录      ❌ POST /api/auth/login → 401 Invalid email or password
    ⏭️  SKIP 带会话复验诊断端点（登录未拿到 cookie）
结果：2 通过 / 2 失败 / 1 跳过
```

**根因定位（不是密码问题）**：用项目自带的 `qa:probe:login` 诊断（本地 bcrypt 直验库中哈希）：

```
── qa.male@lokfeel.com   ❌ 库中不存在该账号 → 需要在生产重建
── qa.female@lokfeel.com ❌ 库中不存在该账号 → 需要在生产重建
```

独立复核（只读 SQL）：`SELECT ... FROM User WHERE email LIKE 'qa.%'` → **0 行**；
生产 `Membership` 总数 **0**；非 bot 的人工账号 **0**。

### 结论

| 层 | 状态 | 依据 |
|---|---|---|
| 匿名层（路由已部署 + 能力闸门） | ✅ **已验** | 401 + JSON 信封 |
| 网络层 / 凭据层（生产出口真实结论） | ⛔ **BLOCKED** | 生产无 QA 账号 ⇒ 无法取得会话 ⇒ 诊断端点拒绝进入 |

**为什么这不是"脚本坏了"**：脚本对 403/无 cookie 明确定义为 **SKIP 而非 FAIL**
（"本环境缺前提"≠"端点坏了"）。**缺前提 ≠ 破坏**，也 **≠ 通过**。

**要闭合 A1 的剩余两步**（两者都属于**生产数据写入**，需显式授权）：
1. 在生产重建 QA 账号（`qa.male` / `qa.female`）；
2. 给该账号在 `org_default` 建 `Membership`，角色 ≥ `OPERATOR`（诊断端点要求 `agent.execute`）。

⚠️ 在此之前，**任何"生产出口连通性已验"的说法都不成立**（T09 Slice 5/6 的口径：无凭据 ⇒ `BLOCKED`，**不得报绿**）。

---

## 5. 未闭合项（不虚报）

| 项 | 状态 | 原因 |
|---|---|---|
| **A1 网络层/凭据层** | ⛔ BLOCKED | 生产无 QA 账号 + `Membership=0`（见 §4） |
| AC-25 付费价值 | ⛔ BLOCKED | 无真实试点客户（外部依赖，不可 MOCK） |
| AC-21 真实扣款/退款 | ⛔ BLOCKED | 缺 Creem 凭据（沙箱部分 PASS） |
| 28 条生产可达高危依赖 | 🟡 已登记 + 棘轮 | 未做批量升级（见 `DEPENDENCY_RISK.md`） |
| `organizationId` 未建模（11 表） | 🟡 已知漂移 | 已冻结进棘轮（见 `CI_GATES.md` §4bis） |
| 限流器共用 per-IP 桶 | 🟡 已登记 | 代码级结论，未做运行期实证（见 `PERFORMANCE_BASELINE.md`） |

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

# A1（当前会被 BLOCKED）
npm run verify:agent:connectivity:server
npm run qa:probe:login                          # 先分清"密码过期"还是"账号不存在"
```

---

## 7. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-10-16 | 首版。发版 `2d5385d`（34 提交 / T09+T10+T11+T12 / AC-10/23/24）；发版前 4 项前提实测；发版后 3 项复验（生效断言 6/6 · public-origin 13/0 · DB 零变化）；**A1 判定为分层结论：匿名层已验、网络/凭据层 BLOCKED（生产无 QA 账号）**。新增 `verify:released:surface` / `verify:release:wait`；删除已失效的 `verify-no-release-surface.mjs`。 |
