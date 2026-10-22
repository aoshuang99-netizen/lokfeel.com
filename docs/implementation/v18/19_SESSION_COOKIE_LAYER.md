# 19 · 会话 cookie 层：一次「十条 401」的归因

> 2026-10-22，CI 的 e2e job 里 `CTRL-1`、`CTRL-2`、`SEC-01`…`SEC-07` **十条断言全是 `HTTP 401`**。
> 看上去像"租户隔离全线崩溃"。实际只有一个原因，而且不在隔离层。

---

## 1. 症状与第一层误判

```
SEC-01 A 读 B 的 mission — HTTP 401
SEC-02 A 改 B 的 mission 不产生副作用 — HTTP 401
...
CTRL-1 A 读自己的 mission — HTTP 401        ← 正对照也 401
```

`CTRL-1` 是**正对照**：它证明"至少自己的东西能读到"。它也 401，说明问题在
**进入业务代码之前**，与"谁的、哪个租户"无关。

`withTenant` 的拒绝语义写在 `src/lib/tenancy/guard.ts`：

| 情形 | 状态码 |
|---|---|
| 匿名 / 游客 / tokenVersion 失配 | **401** |
| 无成员关系 / 成员停用 / 租户停用 | 403 |
| 角色能力不足 | 403 |

所以 401 的含义是**会话没被识别**，不是"越权被拦"。
（如果当时把它当成"隔离失败"，下一步就会去改 `resolveTenant` —— 改错地方。）

## 2. 根因：写侧与读侧用了两套规则

四份代码各自签发会话 cookie，都写着同一句判断：

```ts
const name = NODE_ENV === 'production'
  ? '__Secure-authjs.session-token'
  : 'authjs.session-token'
```

而 `@auth/core` 自己的规则是 `useSecureCookies = 站点 URL 的协议是不是 https`。

| 环境 | NODE_ENV | 站点协议 | 写侧（旧代码） | 读侧（Auth.js） | 结果 |
|---|---|---|---|---|---|
| 生产 Netlify | production | https | `__Secure-…` | `__Secure-…` | 一致 |
| **CI `next start`** | **production** | **http** | `__Secure-…` | `authjs.…` | **分叉** |
| 自托管 / 内网 http | production | http | `__Secure-…` | `authjs.…` | **分叉** |

分叉时的现象**不是报错**：`POST /api/auth/login` 仍然 `200` 并下发 cookie
（脚本的"登录成功"门槛因此通过），随后每个接口都 `401`。

🔴 更严重的一半：`secure: true` 的 cookie 在 **http 页面会被浏览器直接丢弃**。
即"任何 http 部署根本登不进去"—— 只是线上是 https，所以没人发现。

## 3. 改了什么

| 文件 | 改动 |
|---|---|
| `src/lib/auth/session-cookie.ts`（新） | 唯一规则：`origin → { name, secure }`，名字即 JWT 的 salt |
| `src/app/api/auth/login/route.ts` | 用 `sessionCookieForRequest(request)`；删掉 `NODE_ENV` 判断 |
| `src/app/api/guest/route.ts` | 同上（游客会话同样会被丢弃） |
| `oauth/google/callback` · `oauth/twitter/callback` | 用 `sessionCookiePolicy(publicOrigin)`（两处已有 `publicOrigin`） |
| `scripts/qa/v18-isolation-proof.mjs` | 新增 **AUTH-01**：登录后用 `/api/auth/session` 判「会话是否真被识别」，不成立即 `BLOCKED` 退出 |

最后一条是**观测**上的修正，比修复本身更值得留：十条一样的红，
信息量低于一条准确的红。它把"一个前置失败"伪装成"七个安全问题"。

## 4. 复验

```bash
node scripts/qa/v18-isolation-proof.mjs --self-test     # 16 条（新增 4 条 AUTH-01 判别器）
npx jest tests/auth                                     # 8 条（含「NODE_ENV=production 不改变结论」）
```

CI 侧无需额外手段：`next start` + `http://127.0.0.1:3000` 就是分叉环境本身。
若 AUTH-01 再红，annotation 里会直接给出「下发的 cookie 名 + 会话体」，
不必再翻 job logs（那需要 admin 权限）。

## 5. 这份改动守不住什么

1. **不改 Auth.js 的读侧。** 它是库，规则是它的；我们只能让写侧对齐。
   将来若升级 Auth.js 改了 cookie 名约定，这里必须跟着改（`session-cookie.ts` 是唯一落点）。
2. **不保证 https 之外的安全。** http 站点上 cookie 可被链路窃听 —— 这是协议问题，
   不是 cookie 名能解决的。生产必须 https（`selfhost-env-audit` 的 S10 已把
   `__Secure-` 前缀当作"你确实是 https"的反证）。
3. **不覆盖服务端渲染的读路径。** 页面级 `auth()` 与 API 走同一个 Auth.js 读侧，
   规则一致，但没有独立的 E2E 断言去盯"页面登录态"。
