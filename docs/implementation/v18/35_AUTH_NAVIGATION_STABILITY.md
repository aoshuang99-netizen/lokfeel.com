# 登录缓存与 307 跳转稳定性（WB18-35）

> 两个问题，一个已定性并修好，一个只收窄了范围。
> 本文按"证据 → 判断 → 修法 → 仍未解决"的顺序写，不把推测写成结论。

- 采集时间：2026-10-23 06:55–07:20Z
- 生产版本：`dc102cd`（发布候选 `1170073` 尚未部署）

---

## 问题一：`/login` 与 `/register` 被标成公共可缓存（已修）

### 1.1 实测

| 路由 | `cache-control` | `age` |
|---|---|---|
| `/login` | **`public`** | 106 → 111 → 117 → 120（连续 4 次，一直涨、不归零） |
| `/register` | **`public`** | **173745**（≈ 48.3 小时 = 自 `dc102cd` 部署至今） |
| `/forgot-password` | `private,no-cache,no-store,max-age=0,must-revalidate` | 0 |
| `/reset-password` | 同上（307，无 token） | 0 |
| `/admin-login` | `public,max-age=0,must-revalidate` | 173755 |
| `/auto-login` | 同上 | 173759 |
| `/verify-request` | 同上 | 173764 |
| `/api/auth/session` | `no-store,max-age=0` + `Set-Cookie` | 0 |
| `/api/health` | `no-store,max-age=0`，`cf-cache-status: DYNAMIC` | 1 |

`age` 单调递增且从不归零 ⇒ **这确实是一份边缘缓存对象**，不是每次都回源。

### 1.2 根因（不是"框架默认"，是我们自己写的规则）

`next.config.ts` 的 `headers()` 里有三条照抄"给 ISR 页面开 CDN 缓存"的规则：

```ts
{ source: '/',        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=300, stale-while-revalidate=86400' }] }
{ source: '/login',   headers: [{ key: 'Cache-Control', value: 'public, s-maxage=300, stale-while-revalidate=86400' }] }
{ source: '/register',headers: [{ key: 'Cache-Control', value: 'public, s-maxage=300, stale-while-revalidate=86400' }] }
```

**决定性对照**（这是本文最硬的一条证据）：

- `/login/page.tsx`：`const session = await auth()` → 已登录 `redirect()`
- `/forgot-password/page.tsx`：`const session = await auth()` → 已登录也 `redirect()`
- 两者同一 `(auth)` 路由组、同一个 layout、同样的框架语义
- **前者 `public`，后者 `private,no-store`** ⇒ 差别只可能来自那条 config 规则

也就是说：框架给的默认值本来就是对的，是我们用一条配置把它盖掉了。

### 1.3 为什么这是缺陷，不只是"缓存有点松"

`headers()` 的优先级高于路由自己写的头（这个仓在 `/api/health` 上已经踩过反向的坑，
见 `next.config.ts` 里那段注释）。于是：

1. **已登录用户点回 `/login`**：可能拿到缓存里的匿名表单页，而不是被 `redirect()` 走。
   体感是"我明明登录了，怎么又让我登"。
2. **万一某次 307 被缓存**：匿名用户会被送去 `/dashboard`，再被弹回 `/login`。
   这和"登录后整页跳转偶发失败"是同一个形状 —— 见问题二，**这是目前最可疑的同源因素**。
3. `/register` 的 `age` 是 48 小时：一份两天前的注册页在被反复服务。

### 1.4 修法

`next.config.ts` 新增 `AUTH_ENTRY_PATHS`（7 个入口），统一：

```
Cache-Control: private, no-store, max-age=0, must-revalidate
```

`/` **保持**可缓存（首页 TTFB 靠它），只收认证面。
没有改 `/api/*` 的既有规则，没有动 `s-maxage` 的其它用处。

### 1.5 让这条结论可以被 CI 证伪

新增 `tests/e2e-ci/cache-headers.spec.ts`（**10 条** = 7 个认证入口 + 2 个端点 + 1 条反证），
打真实请求读响应头：

- 7 个认证入口：`must contain no-store` **且** `must not contain public`
  （只查前一半不够 —— `public, no-store` 这种自相矛盾的值也能过）
- `/api/health`、`/api/auth/session`：同样口径
- **反证**：`/` 不得含 `no-store` / `private`
  —— 没有这一条，一个"全站禁缓存"的粗暴改法也能让上面全绿，代价是 TTFB 打回原点

> 为什么断言响应头而不是断言配置文件：写了什么规则，和构建产物实际发什么头，是两件事。
> 路径写错就静默不生效 —— 这条缺陷本身就是这么被发现的。

---

## 问题二：登录后整页跳转偶发 `net:ERR_FAILED`（收窄，未根治）

### 2.1 现象

`774a1d6` 之前：认证面 18 条用例里约 **1/3** 在「登录 → `/dashboard`」这一步报
`net:ERR_FAILED`，**且每轮失败的用例都不一样**。

### 2.2 已经排除的（都有证据，不是推断）

| 假设 | 排除依据 |
|---|---|
| 登录接口坏了 | 307 那条 redirect 带 `has: cookie authjs.session-token` 条件 —— 能触发就说明 cookie 已下发且被服务端认 |
| 服务端抛异常 | 把 `next-start.log` 的错误行发成公开可读的 annotation，结果是**零**条 |
| 服务端这条路不通 | 纯 HTTP 探针 3 轮：`/dashboard → 307 → /dashboard/explore → 200`，逐跳可见 |
| 版面/移动端问题 | 同一轮里公开面 12 条全绿；失败只发生在"登录后那一跳" |

### 2.3 收窄后的判断

`net:ERR_FAILED` 在 Chromium 里是**网络层兜底码**，同时覆盖三种完全不同的原因：
连接被重置 / 响应体被中途掐断 / 导航被中途替换。继续读源码只会在三种假设之间来回跳。

可观测的差别只有一个：**跑了多少次**。
同一个 job 里诊断脚本 6 轮登录全过，而 18 条用例里有 6 条死在登录后那一跳。
⇒ 这不是"登录坏了"，是"18 次登录把一次偶发放大了 18 倍"。

### 2.4 处理方式（降低暴露面，不是掩盖）

- `tests/e2e-ci/global-setup.ts`：登录**一次**产出 `storageState`，允许 3 次尝试并逐次打印原因；
  3 次全失败仍然**硬失败**，不静默。
- 登录本身仍被两处把守：globalSetup（起不来整轮失败）+ 纯 HTTP 探针（3 轮逐跳）。
- `scripts/qa/browser-login-trace.mjs` 保留为 **canary**（永远 exit 0，只取证不判红）。

**没有**：跳过用例、放宽版面断言、给 E2E 加 `continue-on-error`、用无限重试掩盖。

### 2.5 发生率与影响范围（实测）

| 版本 | 现象 | 发生率 |
|---|---|---|
| `774a1d6` 之前 | 18 条各登一次 | 约 6/18 ≈ 33% 的**用例**失败（不是 33% 的登录失败） |
| `774a1d6` 之后 | 登录 1 次 | 0（该轮 42 条全绿） |
| `1170073` | 85 条（结构枚举） | 24 条新版面全绿；3 条交互探针红（选择器问题，非登录） |
| `bba8c36`（发布候选） | 85 条（结构枚举） | E2E job **success**，零失败；缓存 10 条全绿 |

**影响范围**：仅影响"同一浏览器短时间内重复整页登录"这一种形态。
真实用户一次会话只登一次，因此**对终端用户的影响未被证实**（不是"没有"，是"没有证据"）。

### 2.6 仍未解决

**根因未完全定位。** 现状是"降低暴露面 + 保留 canary + 把证据留在 CI 里"。
问题一的缓存缺陷是目前最可疑的同源因素（缓存 200/307 会让回跳变得不确定），
但它**还没有被证明**是原因 —— 要证明它，需要发布后再跑同一组用例对比。

---

## 3. 回归基线（发布后要对比的数字）

| 项 | 发布前（`dc102cd`） | 发布后目标 |
|---|---|---|
| `/login` 的 `cache-control` | `public` | `private, no-store, ...` |
| `/register` 的 `age` | 173745 | 0（每次回源） |
| E2E 用例数 | 42（`d922bf9`） | 78（`1170073`） |
| 登录相关用例失败率 | 0 / 42 | 0 / 78 |

发布后复验命令：

```bash
for p in /login /register /forgot-password /reset-password; do
  printf '%-18s ' "$p"
  curl -sI "https://app.lokfeel.com$p" | tr -d '\r' | grep -i '^cache-control'
done
# 预期：四行全部是 private, no-store, max-age=0, must-revalidate
```
