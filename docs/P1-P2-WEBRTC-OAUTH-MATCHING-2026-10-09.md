# WebRTC 通话 / 实时通道 / OAuth / 性别词表：静默失效的根因修复

> 2026-10-09 · 基线 `13e8c2d` → 本文件所记改动为第二批
> 同类文档见 `SECURITY-HARDENING-2026-09-29.md`
>
> 这些缺陷的共同特征是 **不报错、不崩溃、只是静默不工作**，
> 因此都不会被常规冒烟测试发现。本文记录实测证据、根因、修复与防复发门禁。

---

## 摘要

| # | 缺陷 | 表现 | 根因 |
|---|------|------|------|
| 1 | 频道前缀与鉴权白名单不一致 | 通话订阅 403 | 订阅构造 `private-user-{id}`，鉴权只放行 `private-im-` |
| 2 | 跨用户信令用客户端事件 | 机制上不可能送达 | Pusher `client-` 事件只能发到**自己**已授权的频道 |
| 3 | 实时开关是 opt-in | 生产漏设变量 → 整体静默失效 | `NEXT_PUBLIC_USE_PUSHER === "true"` 才启用 |
| 4 | **鉴权请求 Content-Type 被覆盖** | **所有私有频道订阅 500 失败** | 客户端声明 `application/json`，pusher-js 实发 urlencoded 体 |
| 5 | 发起通话调用了 store 的同名方法 | 点按钮不发任何信令 | store 的 `initiateCall` 只改状态；真正实现在 `useWebRTC` |
| 6 | `usePusherSignaling(undefined, …)` | 被叫方订阅永不建立 | userId 传 `undefined`，钩子首行即 `if (!userId) return` |
| 7 | 来电 UI 在 `if (!open) return null` 之后 | 弹窗关闭时永远看不到来电 | 通话界面未打开正是被叫方的常态 |
| 8 | **清理 effect 依赖 `[localStream]`** | **PeerConnection 刚建好就被关掉** | 每拿到本地流即触发上一次的 cleanup |
| 9 | Twitter OAuth redirect_uri 不一致 | 永远换不到令牌 | 违反 RFC 6749 §4.1.3 逐字符一致 |
| 10 | 匹配引擎原始性别字符串比较 | 符合偏好的候选人被静默过滤/扣分 | `MALE/FEMALE` 与 `MAN/WOMAN` 双词表未归一化 |

> **1–8 全部集中在视频通话链路上，且是叠加的**：修掉任何一两个都不足以让通话跑通。
> 这也解释了为什么该功能「接线完成」在文档里写了三轮，实际从未在线上工作过。

---

## 一、实时通道：订阅从未成功（缺陷 1–4）

### 1.1 前缀不一致（缺陷 1）

订阅侧构造 `private-user-{id}`，鉴权端点 `/api/im/pusher/auth` 只放行 `private-im-` 前缀 → 403。
**Pusher 不会因此报错，只会静默不投递。**

**修复**：频道命名收敛为单一来源 `src/lib/im/channels.ts`
（`userChannel()` / `conversationChannel()` / `isAllowedImChannel()` / 反向解析），
订阅侧与鉴权侧全部从这里取名。

### 1.2 客户端事件机制上不可能跨频道（缺陷 2）

Pusher 的 `client-` 前缀事件只能发往调用方**自己已被授权**的频道。通话双方是两个频道，
因此 `calleeChannel.trigger('client-offer', ...)` 在任何配置下都不可能送达。

**修复**：新增服务端中继 `POST /api/im/call/signal`（`src/app/api/im/call/signal/route.ts`），
守卫链条：
```
requireAuth → 限流 300/min → 事件白名单 → payload 含 callerId/calleeId
→ 请求方须是通话一方 → to 须恰是另一方 → 双方须已存在会话 → pushCallSignal 投递
```
客户端发送侧 `src/lib/im/call-signal-client.ts` 全部改走该端点。

### 1.3 开关语义（缺陷 3）

`NEXT_PUBLIC_USE_PUSHER` 原为 opt-in（必须显式 `"true"`），生产漏设即整体失效。
**修复**：改 opt-out（`!== "false"`），真正的判据是「Pusher key 是否为空」。

### 1.4 【最隐蔽】鉴权请求编码（缺陷 4）

客户端构造 Pusher 时写了：

```ts
auth: { headers: { "Content-Type": "application/json" } }
```

而 pusher-js 的默认授权器发送的是 **urlencoded 请求体**（`socket_id=…&channel_name=…`），
只是被这行覆盖成了 JSON 头。服务端 `request.formData()` 遇到 `application/json` 会直接抛：

```
Content-Type was not one of "multipart/form-data" or "application/x-www-form-urlencoded"
```

→ `/api/im/pusher/auth` 返回 **500** → **所有私有频道订阅失败**，
且 pusher-js 默认不打印订阅错误 → **完全静默**。

> 为什么一直没被发现：`useIM.ts` 里 `ENABLE_POLLING = true`。
> 轮询兜底让「消息还能收到」，于是实时通道坏了一年也没人注意；
> 但通话信令没有轮询兜底，所以视频通话彻底不通。

**实测证据**（Playwright 抓浏览器真实响应）：
```
[A] pusher/auth 响应: POST 500 {"message":"Content-Type was not one of \"multipart/form-data\" or \"application/x-www-form-urlencoded\"."}
[B] pusher/auth 响应: POST 500 （同上）
```

**修复（两侧都改）**：
1. 客户端删除该 `auth.headers` 覆盖，使用 pusher-js 默认行为；
2. 服务端 `readAuthParams()` 兼容 `application/json` /
   `application/x-www-form-urlencoded` / `multipart/form-data` 三种编码，
   并保留「声明 JSON、实为 urlencoded」这类历史错配的兜底。

---

## 二、视频通话接线（缺陷 5–8）

### 2.1 点按钮调用了不发信令的那个 `initiateCall`（缺陷 5）

`page-content.tsx` 原本调用的是 **zustand store** 的 `initiateCall`，它只把
`callState` 置为 `CALLING`；真正 `getUserMedia → createOffer → 发 offer` 的实现住在
`useWebRTC()` 里，**从没有人调用过**。

**修复**：聊天页只负责「打开通话界面 + 记录呼叫目标」，
由 `VideoCallModal` 在打开时调用 `useWebRTC().initiateCall(calleeId)`。

### 2.2 失效的第二份订阅（缺陷 6）

`VideoCallModal` 里 `usePusherSignaling(undefined, …)` 把 userId 传成了 `undefined`
（源码注释写着「应该从 auth store 获取」），而该钩子首行就是 `if (!userId) return;`
→ 永不订阅 → 它唯一的副作用 `setShowIncomingCall(true)` 永不触发。

而 `useWebRTC()` 内部已经用真实 userId 订阅了同一频道并绑定全部信令 ——
这处是重复且失效的第二份订阅，已删除。

### 2.3 来电 UI 放在了提前 return 之后（缺陷 7）

`IncomingCallModal` 渲染在 `if (!open) return null` **之后**。
而被叫方收到 offer 时通话界面恰恰是关闭的 → 即使状态正确也永远看不到来电。

**修复**：来电弹窗改为由 store 的 `callState === CallState.RINGING` 驱动，
在 `open` 判定**之前**渲染；通话主界面仅在 `open || CONNECTING || CONNECTED` 时铺满。
来电者姓名/头像由 `/api/users/{callerId}` 现取（offer 载荷里只有 id）。

### 2.4 【元凶】清理 effect 依赖 `[localStream]`（缺陷 8）

```ts
useEffect(() => {
  return () => {
    closeConnection(peerConnectionRef.current);
    if (localStream) stopMediaStream(localStream);
  };
}, [localStream]);   // ← 错
```

`initiateCall` 里 `setLocalStream(stream)` 会让依赖变化 →
React 先执行**上一次的清理** → 把**刚创建**的 PeerConnection 关掉 →
`createOffer` 还没返回，连接已被销毁。

**实测日志**（修复前）：
```
[useWebRTC] PeerConnection initialized
[WebRTC] Added audio track to peer connection
[WebRTC] Added video track to peer connection
[useWebRTC] Cleaning up          ← 刚建好就被拆
[WebRTC] Connection closed
（之后再无 Sending offer）
```

**修复**：清理只在**卸载**时执行（依赖数组为空），本地流用 ref 跟踪供卸载清理使用。

---

## 三、Twitter OAuth 换不到令牌（缺陷 9）

授权请求声明 `redirect_uri=/api/auth/oauth/twitter/callback`，
而换取令牌时提交的是 `/api/auth/twitter/callback`。RFC 6749 §4.1.3 要求两者逐字符一致。

**修复**：`src/lib/auth/twitter-oauth.ts` 提供单一来源
`twitterCallbackUrl(baseUrl)`（`TWITTER_OAUTH_CALLBACK_PATH` 可覆盖，非法值回落默认），
4 个路由统一调用，且经 `publicOriginOf()` 避免发布窗口期污染。

---

## 四、匹配引擎性别静默丢人（缺陷 10）

生产库 `Profile.gender` 实测分布：

```
MALE 8254 | FEMALE 3624 | OTHER 7 | MAN 1 | NON_BINARY 1
```

双词表并存，而 `enhanced-engine.ts` / `engine.ts` 直接用 `toUpperCase()` 比较：
`FEMALE ≠ WOMAN` → 符合偏好的候选人被**静默过滤**（enhanced）或**错误扣分**（engine），全程无日志。

**修复**：统一经 `normalizeGender()` 归一化。
存量数据**无需迁移**——是否统一词表属产品决策，待定。

---

## 五、防复发门禁

| 命令 | 断言 | 结果 |
|------|------|------|
| `npm run verify:pusher` | 构造器产物命中白名单；静态扫描订阅实参；事件名无 `client-`；开关为 opt-out；**未覆盖鉴权 Content-Type**；**鉴权路由兼容三种编码** | 48 / 0 |
| `npm run verify:oauth` | `twitterCallbackUrl()` 行为与 env 覆盖；禁止手拼回调 URL | 9 / 0 |
| `npm run verify:gender` | 判别函数覆盖双词表；`normalizeGender` 跨词表等价；禁止原始性别比较 | 27 / 0 |
| `npm run verify:geo` | 地域/CORS/缓存策略配置驱动 | 67 / 0 |
| `npm run verify:bot` | Bot 模块可被单一变量关闭 | 111 / 0 |
| `npm run check:redis` | Redis 降级路径 | 17 / 0 |

以上门禁**均带自检**：注入历史坏写法后必须能被抓到。

---

## 六、端到端验证（`scripts/qa/verify-video-call-signaling.mjs`）

双浏览器上下文 + 假摄像头 + **真实生产 Pusher**，16 项断言全过：

```
✅ 自己的个人频道 → 200（前缀白名单命中）
✅ 他人的个人频道 → 403（不可越权订阅）
✅ 旧前缀 private-user- → 403（历史 403 根因已不会复发）
✅ 呼叫方/被叫方 均已订阅个人频道
✅ 呼叫方/被叫方 Pusher 连接就绪
✅ 隔离测试：被叫方能收到服务端直投的 offer（收路径正常）
✅ 呼叫方进入通话主界面
✅ 被叫方弹出「来电」界面
✅ 来电弹窗展示了来电者名字 → Ethan Brooks
✅ 接听后进入通话主界面
✅ 呼叫方仍在通话主界面
```

被叫方截图可见通话计时器已在走（0:00:22）、远端视频在播放、本地画中画与控制栏齐备
—— **真实通话已建立**。

> 运行注意：Playwright 1.63 不支持 macOS 13 的内置 Chromium
> （报 `does not support chromium on mac13`），脚本会自动退回系统 Google Chrome
> （`channel: 'chrome'`）。本地需先以 `NEXT_PUBLIC_ENABLE_VIDEO_CALL=1` 与 Pusher 变量起服务。

---

## 七、验证结果汇总

| 项 | 结果 |
|----|------|
| `tsc --noEmit` | 0 错误 |
| `jest` | 17 suites / 292 tests 全过 |
| 6 道门禁 | 全过（见上表） |
| 视频通话 E2E | 16 / 0 |
| 生产公开 origin 复验 | 13 / 0（发布窗口期内） |

## 八、生产库清理

删除 `qa.male@` / `qa.female@` 测试账号及其关联数据（1 会话 / 8 消息 / 13 回执 / 1 Match）。
`scripts/qa/cleanup-qa-accounts.mjs` **默认 dry-run**，`--apply` 才执行；
命中行先备份到 `.qa-cleanup-backup-*.json`（已 gitignore）；
遇「仅一方是 QA 的会话」主动中止。清理后剩余 `qa.` 账号：**0**。

## 九、仍未闭合（需用户决策）

1. **视频通话总开关**：生产 `NEXT_PUBLIC_ENABLE_VIDEO_CALL` 未设为 `1`，
   即按钮不渲染。链路本身已端到端验证通过，是否对用户开放属产品决策
   （源码注释明确标注「阶段 4 唯一需要产品决策的项」）。
2. **TURN 未采购**：代码已支持 `NEXT_PUBLIC_USE_TURN` / `NEXT_PUBLIC_TURN_URLS` 等覆盖，
   但未配置 TURN 时对称 NAT 下的通话仍可能失败（当前仅公共 STUN）。
3. **支付生产不可用**：缺 `CREEM_API_KEY` / `CREEM_WEBHOOK_SECRET` / 两个 `PRODUCT_ID`。
4. **性别词表统一**：属数据迁移决策（存量约 1.19 万行），代码层已兼容，无需改数据。
