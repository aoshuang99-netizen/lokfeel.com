# 视频通话开放 · TURN 中继 · 性别词表统一（2026-10-09 第二轮）

> 承接第一轮（`docs/P1-P2-WEBRTC-OAUTH-MATCHING-2026-10-09.md`）：实时鉴权 500 与视频通话四处接线缺陷已修复、
> 通话链路端到端打通。本轮把三个"待决策/待办"项一次性收掉，使通话**真正可对用户开放**。
>
> 用户指令：「2 3 4 进行自动化解决」。

---

## 0. 三项任务与结论

| # | 原状态 | 本轮动作 | 结论 |
|---|--------|----------|------|
| 2 | `NEXT_PUBLIC_ENABLE_VIDEO_CALL` 未设 → 通话按钮不渲染 | 语义改为 **opt-out**（不设即启用）+ 生产显式写入 `=1` | ✅ 开放 |
| 3 | 无 TURN，对称 NAT / 运营商 CGNAT 下必然失败 | 新增服务端签发 ICE 配置端点，接 **Cloudflare TURN**（无需账号） | ✅ 实测拿到 relay 候选 |
| 4 | 生产 11,878 行 `MALE/FEMALE` 与代码约定 `MAN/WOMAN` 并存 | 数据迁移 + 写入侧/读取侧全量归一 + 门禁钉死 | ✅ 单词语表 |

---

## 1. 任务 2：视频通话开关改为 opt-out

`src/app/(dashboard)/dashboard/chats/[roomId]/page-content.tsx`

```diff
-const VIDEO_CALL_ENABLED = process.env.NEXT_PUBLIC_ENABLE_VIDEO_CALL === "1";
+const VIDEO_CALL_ENABLED = process.env.NEXT_PUBLIC_ENABLE_VIDEO_CALL !== "0";
```

**为什么改语义而不是只写环境变量**

1. 与仓库内既有开关一致（`src/hooks/use-im-pusher.ts` 的 `USE_PUSHER !== "false"`）。
2. `NEXT_PUBLIC_*` 在**构建期内联**，只写环境变量而忘了触发重建，线上会静默保持关闭——这正是本项一直"没生效"的成因之一。
3. 回滚开关仍然保留：`NEXT_PUBLIC_ENABLE_VIDEO_CALL=0` 一个变量即可关闭，无需改代码。

同时经 Netlify API 显式写入生产环境变量（202/201 均写入成功，回读确认）：

```
POST /api/v1/accounts/aoshuang99/env?site_id=c46478e9-…  → 201
[{"key":"NEXT_PUBLIC_ENABLE_VIDEO_CALL","values":[{"value":"1","context":"all"}]}]
```

> 📌 修正既往认知：`scripts/netlify-credit-watch.mjs` 注释里"Netlify 无法通过 API 写 env"的说法**仅适用于计费类字段**
> （`auto_topup_enabled` / `credit_alert_percentage`）。**普通环境变量写入是可用且幂等的**。

---

## 2. 任务 3：TURN 中继

### 2.1 为什么不能继续只靠 STUN

STUN 只能拿到 `srflx`（公网映射），在 **对称 NAT / 运营商 CGNAT** 下映射地址不可用于对端，必须走 `relay`。
生产用户主要在中国大陆，移动网络大量处于 CGNAT——没有 TURN 就没有通话。

### 2.2 候选供应商实测

| 候选 | 结果 | 证据 |
|------|------|------|
| Open Relay（`openrelay.metered.ca` + `openrelayproject`） | ❌ **已失效** | `TURN allocate error (400)`；`turn.metered.ca` 已 NXDOMAIN |
| freestun.net / relay.backups.cz | ❌ 不可用 | 无 relay 候选 |
| **Cloudflare TURN**（`speed.cloudflare.com/turn-creds`） | ✅ **可用** | 真实 Chrome 收集到 **relay=5** |

Cloudflare 的凭据端点**无需注册、无需账号**，返回短时凭据；官方免费额度 1000 GB/月。
实测返回：

```json
{"urls":["stun:stun.cloudflare.com:3478",
         "turn:turn.cloudflare.com:3478?transport=udp",
         "turn:turn.cloudflare.com:3478?transport=tcp",
         "turns:turn.cloudflare.com:5349?transport=tcp"],
 "username":"g0399…","credential":"0e41…"}
```

> ⚠️ 该端点校验来源，必须带 `Referer/Origin: https://speed.cloudflare.com/`，否则 403。

### 2.3 实现：**服务端签发**，绝不用 `NEXT_PUBLIC_*`

`NEXT_PUBLIC_*` 会被内联进前端 bundle，公开的长期 TURN 凭据等于把流量费送给任何人。

**新增 `GET /api/rtc/ice-servers`**（`src/app/api/rtc/ice-servers/route.ts`）：

- 需登录态；未登录 **401**（客户端静默退回 STUN，不影响匿名页面）
- 三级来源：**① 服务端静态覆写 `TURN_URLS/TURN_USERNAME/TURN_CREDENTIAL`** → **② Cloudflare** → **③ 仅 STUN**
- 上游 6s 超时 + 形状校验（拿不到合法凭据就退回 STUN，**绝不喂空配置**）
- 结果缓存 10 分钟，避免每次通话都打上游

**新增客户端加载器** `src/lib/rtc/ice-servers-client.ts`：

- `loadIceServers()` 预取（并发合并为一次请求）+ `getIceServersCached()` 同步读取
- 采用「**预取 + 同步读取**」而不是把 `createPeerConnection` 改成 async——后者会牵动
  offer/answer 时序与 StrictMode 双调用，风险远大于收益
- **永不 reject**：任一失败都退回 `getIceServers()`（STUN-only）。拿不到 TURN 只是"弱网可能失败"，
  拿不到 ICE 配置则是"一定连不上"，所以异常必须吞掉

**接线**：

- `src/utils/webrtc.ts` → `createPeerConnection` 改用 `getIceServersCached()`
- `src/hooks/useWebRTC.ts` → 挂载时预取；`initiateCall` / `acceptCall` 在建连前 `await loadIceServers()`

### 2.4 生产可选升级

若日后自建/自购 TURN，只需在 Netlify 设三个**服务端**变量（无需改代码、不进 bundle）：

```
TURN_URLS=turn:your.turn:3478?transport=udp,turns:your.turn:5349?transport=tcp
TURN_USERNAME=…
TURN_CREDENTIAL=…
```

---

## 3. 任务 4：性别词表统一

### 3.1 背景

`enum Gender` 同时挂着两套值：现行 `MAN/WOMAN/TRANSGENDER_*/NON_BINARY`，历史（源码标注 Legacy）`MALE/FEMALE`。
新注册走现行词表，存量 11,878 行是历史词表。代码层虽已用 `lib/gender-utils` 兼容两套，
但**任何一处漏用 helper 的原始比较都会静默失效**。

### 3.2 数据迁移

`scripts/qa/migrate-gender-vocab.mjs`（默认 dry-run，`--apply` 落库）：

| 项 | 结果 |
|----|------|
| `Profile.gender` MALE→MAN / FEMALE→WOMAN | **11,878** 行 |
| `Profile.preferredGender` MALE→MAN / FEMALE→WOMAN | **4,637** 行 |
| 落库前备份 | `.gender-migration-backup-<ts>.json`（已加 .gitignore） |
| 幂等 | 只匹配 `IN ('MALE','FEMALE')`；重跑影响 0 行 |
| 影响面 | 全库仅 `Profile` 有 gender 列（`genderIdentity` 是自由文本，按设计不动） |
| 刻意不动 `updatedAt` | 词表归一 ≠ 用户改资料，改它会污染"最近更新"排序/统计 |

迁移后分布：`MAN=8255  WOMAN=3624  OTHER=7  NON_BINARY=1`，历史写法 **0**。

### 3.3 代码侧归一（关键：不修这些，迁移会被下一次写入污染）

**写入口（会重新产生历史值）**

| 文件 | 问题 |
|------|------|
| `app/(dashboard)/dashboard/settings/page.tsx` | 偏好性别下拉的 `value="MALE"/"FEMALE"` → 用户一改设置就写回历史值 |
| `api/admin/generate-test-users/route.ts` | `? 'FEMALE' : 'MALE'` 批量造历史值 |
| `api/admin/import-users/route.ts` | `as 'MALE' \| 'FEMALE'` 强转 |
| `prisma/seed.ts`、`prisma/init-admin.ts` | 重建库 / 初始化管理员会种回历史值 |
| `scripts/seed-bot-profiles.ts` | 同上（维护脚本） |

**读取侧（迁移后会读错）**

| 文件 | 问题 |
|------|------|
| `app/(dashboard)/dashboard/profile/[id]/page.tsx` | `getGenderLabel` 只列 `MALE/FEMALE` → 迁移后**页面直接显示 "WOMAN" 原始枚举值** |
| `lib/bot-engine/schedulers/prisma-adapter.ts` | `genderMap` 只列 MALE/FEMALE → **全部 11,878 个 bot 被降级成 `non_binary`**，人设/语气/匹配策略整体静默改变 |
| `api/test/mock-checkout/route.ts` | `=== "FEMALE"` → WOMAN 用户可绕过 Lady Free 免费权益去付费 |
| `lib/avatar-utils.ts`、`api/admin/{cleanup,fix-null,upgrade,assign-real-photos}-avatars`、`api/cron/migrate-avatars` | 头像配色/风格判定重复实现且各写各的 |

统一收敛到 `isMaleGender()` / `isFemaleGender()` / `normalizeGender()`。

### 3.4 门禁加固

`scripts/verify-gender-vocab.mts`：**27 → 36** 条

- **E 节（新增）**：扫描 `src/` 与 `prisma/`，禁止 `gender: 'MALE'|'FEMALE'`、`<option value="MALE">`、
  成对三元 `? 'FEMALE' : 'MALE'`；并断言 `getGenderLabel` 标签表含现行写法
- **F 节（新增）**：迁移脚本必须存在、**默认 dry-run**、落库前备份、幂等条件正确、不碰 `updatedAt`
- D 节（既有）继续拦"原始字符串比较"

`scripts/verify-webrtc-ice.mts`（**新增，30 条**）：端点鉴权/超时/形状校验/三级降级/缓存、
客户端并发合并与清洗、接线正确性、凭据不进 bundle，以及**运行时的 5 条失败路径断言**
（fetch 抛错 / 401 / 空 urls / 正常形状）。

---

## 4. 验证汇总

| 验证 | 结果 |
|------|------|
| `verify:gender` | **36 / 0** |
| `verify:ice` | **30 / 0** |
| `verify:pusher` | **48 / 0** |
| `verify:oauth` | **9 / 0** |
| `jest` | **17 suites / 292 tests** 全过 |
| `tsc --noEmit` | **0 错误** |
| `verify-gender-migration`（对生产库实查） | **11 / 0** |
| 真实浏览器 ICE 收集（Cloudflare TURN） | **relay=5**，结论 TURN 可用 |

### 本轮踩到的坑

1. **同消息内并行编辑同一文件会静默丢一处** —— `generate-test-users` 有一处 `gender === 'FEMALE'` 被丢掉，
   由 `tsc` 的 `TS2367（类型无重叠）` 兜住。**已再次验证：同文件编辑必须串行。**
2. **libSQL 返回 `{rows}` 不是数组** —— 复验脚本初版写成 `(await execute())[0]?.n`，
   所有计数恒为 0，导致断言"通过"却毫无意义（假绿）。**判据脚本本身必须先自证。**
3. **沙箱无法直连外部 TURN** —— `curl`/`nc` 探活全部失败（透明代理 MITM，TLS 报 `ERR_TLS_CERT_ALTNAME_INVALID`），
   但**真实 Chrome 有真网**（拿到了 srflx 与 relay）。**外部连通性必须用真实浏览器验，不能用 curl/nc 下结论。**
4. **对照实验救了误判** —— 用 `api.github.com` 做 TLS 对照，才能区分"沙箱限制"与"服务器真挂"。

---

## 5. 未闭合

1. **支付**：仍缺 `CREEM_API_KEY` / `CREEM_WEBHOOK_SECRET` / 两个 `PRODUCT_ID`（用户明确排除）
2. **Cloudflare TURN 端点是公共端点**：免费、无需账号，但非官方 SLA 承诺的集成方式。
   规模化后建议改为**自建 Turn key**（服务端 `TURN_*` 三个变量即可切换，代码无需改动）
3. **`Profile.genderIdentity` 自由文本**：`male/Man/MALE` 等混用，属"自我认同描述"而非枚举，按设计不动
4. **存量 1,451 名女性无 LADY_FREE**：迁移前后一致（2173 覆盖），属既有状态，非本次回归
