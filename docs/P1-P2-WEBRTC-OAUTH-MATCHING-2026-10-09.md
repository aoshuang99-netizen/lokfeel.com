# WebRTC 信令 / Twitter OAuth / 性别词表：三处静默失效的根因修复

> 2026-10-09 · 基线 `13e8c2d` · 同类文档见 `SECURITY-HARDENING-2026-09-29.md`
>
> 三个缺陷的共同特征是 **不报错、不崩溃、只是静默不工作**——因此都不会被常规冒烟测试发现。
> 本文记录实测证据、根因、修复与防复发门禁。

---

## 摘要

| # | 缺陷 | 表现 | 根因 | 修复 |
|---|------|------|------|------|
| 1 | 视频通话信令 403 | 通话永远停在"呼叫中" | ①频道前缀与鉴权白名单差 3 字符；②跨用户信令走了客户端 `channel.trigger`（机制上不可能） | 频道命名单一来源 + 服务端中继端点 |
| 2 | Twitter OAuth 换不到令牌 | 授权后回跳失败 | 授权请求与换令牌用的 `redirect_uri` 不一致（RFC 6749 §4.1.3 要求逐字符一致） | `twitterCallbackUrl()` 单一来源 + env 可覆盖 |
| 3 | 匹配结果静默丢人 | 符合偏好的候选人被过滤/扣分 | 性别词表双约定并存（`MALE/FEMALE` vs `MAN/WOMAN`），比较前未归一化 | 统一走 `normalizeGender()` |

---

## 一、视频通话信令 403（P0）

### 1.1 根因 A：频道前缀与鉴权白名单不一致

- 订阅侧构造的频道名是 `private-user-{id}`；
- 鉴权端点 `/api/im/pusher/auth` 只放行 `private-im-` 前缀。

两者相差 3 个字符 → 订阅一律 403。**Pusher 不会因此报错，只会静默不投递。**

### 1.2 根因 B：跨用户信令根本无法用客户端事件

Pusher 的 `client-` 前缀事件**只能发往调用方自己已被授权的频道**。通话双方是两个人，
两个不同的频道，因此 `calleeChannel.trigger('client-offer', ...)` 在任何配置下都不可能送达。
这不是配置问题，是机制限制。

### 1.3 修复

**① 频道命名收敛为单一来源** — `src/lib/im/channels.ts`

```
IM_CHANNEL_PREFIX = 'private-im'
userChannel(userId)          → 'private-im-user-{id}'
conversationChannel(convId)  → 'private-im-conversation-{id}'
isAllowedImChannel()         → 白名单判定
parseUserChannel/parseConversationChannel → 反向解析
```

订阅侧（`use-im-pusher.ts`、`webrtc.config.ts`、`pusher-bridge.ts`）与鉴权侧全部从这里取名。

**② 信令改走服务端中继** — `src/app/api/im/call/signal/route.ts`

客户端 `call-signal-client.ts` 的所有 `sendXxxSignal()` 改为
`fetch('/api/im/call/signal')`，由服务端 `pushCallSignal()` 投递到目标
`private-im-user-{id}`。守卫链条：

```
requireAuth → 限流 300/min → 事件白名单 → payload 含 callerId/calleeId
→ 请求方须是通话一方 → to 须恰是另一方 → 双方须已存在会话 → 投递
```

Pusher 不可用时返回 503，客户端返回 `false`（不抛异常，避免打断通话 UI）。

### 1.4 顺带修复的开关语义

`NEXT_PUBLIC_USE_PUSHER` 原为 **opt-in**（必须显式 `"true"` 才启用），
生产漏设该变量 → 客户端 `pusher` 恒为 `null` → 实时消息与通话整体静默失效。

改为 **opt-out**：`process.env.NEXT_PUBLIC_USE_PUSHER !== "false"`。
真正的判据是「Pusher key 是否为空」——key 为空时客户端自动禁用，无需额外信号。
这样默认即开启，不会因为漏配一个变量而整体失效。

---

## 二、Twitter OAuth 换不到令牌（P1）

### 2.1 根因

授权请求声明 `redirect_uri=/api/auth/oauth/twitter/callback`，
而换取令牌时提交的是 `/api/auth/twitter/callback`。

RFC 6749 §4.1.3 要求两者**逐字符一致**，否则令牌端点直接拒绝。
历史原因是 `/api/auth/twitter/*` 与 `/api/auth/oauth/twitter/*` 两套路由各自拼 URL。

### 2.2 修复

`src/lib/auth/twitter-oauth.ts` 新增单一来源：

```
DEFAULT_TWITTER_CALLBACK_PATH = '/api/auth/oauth/twitter/callback'
twitterCallbackPath()          ← env TWITTER_OAUTH_CALLBACK_PATH 可覆盖，非法值回落默认
twitterCallbackUrl(baseUrl)    ← 用 publicOrigin 拼接，绝不读 request.url
```

4 个路由（signin/callback × 两套路径）全部改为调用 `twitterCallbackUrl(publicOrigin)`。

> ⚠️ 这里必须用 `publicOriginOf()` 而非 `request.url`——发布窗口期内
> `request.url` 会变成部署专用域名，会把 `redirect_uri` 也污染成内部域名。
> 详见 `SECURITY-HARDENING-2026-09-29.md` §13。

---

## 三、匹配引擎性别静默丢人（P1）

### 3.1 根因

生产库 `Profile.gender` 实测分布：

```
MALE 8254 | FEMALE 3624 | OTHER 7 | MAN 1 | NON_BINARY 1
```

**双词表并存**，但代码有两套约定：

- 历史：`MALE` / `FEMALE`
- 现行：`MAN` / `WOMAN`

`enhanced-engine.ts` 与 `engine.ts` 里直接用 `pref.toUpperCase() === target.gender.toUpperCase()` 比较。
`FEMALE ≠ WOMAN` → 符合偏好的候选人被 **静默过滤**（enhanced）或 **错误扣分**（engine），
全程无任何报错日志。

### 3.2 修复

- `findTopEnhancedMatches`：`normalizeGender(pref) === normalizeGender(target)`
- `scoreLifestyle`：同样经 `normalizeGender()` 归一化后再比

`src/lib/gender-utils.ts` 已正确覆盖双词表；`src/lib/avatar-utils.ts` 亦以
`gender === 'female' || gender === 'FEMALE' || gender === 'WOMAN'` 形式完整覆盖，无需改动。

### 3.3 关于"统一词表"

代码层已通过 `normalizeGender()` 兼容双词表，**不需要改数据**。
是否把存量 1.19 万行 `MALE/FEMALE` 迁移为 `MAN/WOMAN` 属产品决策，待定。

---

## 四、防复发门禁

三道门禁已接入 `package.json`，且**都带「自检」**（对历史坏写法注入后必须能被抓到）：

| 命令 | 断言 | 结果 |
|------|------|------|
| `npm run verify:pusher` | 构造器产物命中白名单；静态扫描 `subscription` 实参；事件名无 `client-`；开关为 opt-out | 43 / 0 |
| `npm run verify:oauth` | `twitterCallbackUrl()` 行为与 env 覆盖；静态禁止其它文件手拼回调 URL | 9 / 0 |
| `npm run verify:gender` | 判别函数覆盖双词表；`normalizeGender` 跨词表等价；静态禁止原始性别字符串比较 | 27 / 0 |

另有既有门禁：geo 67 / bot 111 / redis 17。

---

## 五、验证结果

| 项 | 结果 |
|----|------|
| `tsc --noEmit` | 0 错误 |
| `jest` | 17 suites / 292 tests 全过 |
| 门禁 | 上表 6 道全过 |
| 新增单测 | `tests/im-call-signaling.test.ts`（16）、`tests/oauth-redirect-uri.test.ts`（5） |
| 测试基建 | `tests/mocks/next-auth-react.ts` 桩（next-auth@5 纯 ESM，CJS 下不可直接 require）；jest 排除 `tests/e2e/` |

## 六、生产库清理

删除 `qa.male@lokfeel.com` / `qa.female@lokfeel.com` 两个测试账号及其关联数据
（1 会话 / 11 消息 / 5 回执 / 1 Match）。脚本 `scripts/qa/cleanup-qa-accounts.mjs` **默认 dry-run**，
`--apply` 才执行；命中行先备份到 `.qa-cleanup-backup-*.json`（已 gitignore）；
遇「仅一方是 QA 的会话」主动中止，避免破坏真实用户数据。

## 七、发版后仍需复验（需真实环境 / 第三方）

1. 双端视频通话全链路（信令经 `/api/im/call/signal`，需真机）
2. Twitter OAuth 登录回跳（需真实 Twitter 应用）
3. 发现页性别偏好筛选的实际可见性
4. 发布窗口期内 `publicOriginOf()` 是否正确——**推 main 后立即复验**，窗口期会自愈
