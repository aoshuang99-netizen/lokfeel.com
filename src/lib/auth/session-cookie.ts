/**
 * 会话 cookie 的**唯一命名规则**（V18-03）
 * ═══════════════════════════════════════════════════════════════════
 * 为什么单独抽一个文件
 * --------------------
 * 这个仓里有 **4 处**自己签发 NextAuth 会话 cookie 的地方：
 *
 *   1. `src/app/api/auth/login/route.ts`          —— 邮箱密码登录
 *   2. `src/app/api/guest/route.ts`               —— 游客会话
 *   3. `src/app/api/auth/oauth/google/callback`   —— Google 登录
 *   4. `src/app/api/auth/oauth/twitter/callback`  —— Twitter 登录
 *
 * 它们此前各自写了一份同样的判断：
 *
 *     const name = NODE_ENV === 'production'
 *       ? '__Secure-authjs.session-token'
 *       : 'authjs.session-token'
 *
 * 而 **Auth.js 自己不是这么判的**。`@auth/core` 的规则是
 * `useSecureCookies = <站点 URL 的协议是不是 https>`：有 `AUTH_URL` /
 * `NEXTAUTH_URL` 就用它的协议，没有就用请求推导出的协议。
 *
 * 两者在两种环境下**结论不同**，而第二种正是 CI：
 *
 *   | 环境 | NODE_ENV | 站点协议 | 旧代码写的名字 | Auth.js 读的名字 | 结果 |
 *   |---|---|---|---|---|---|
 *   | 生产 Netlify | production | https | `__Secure-…` | `__Secure-…` | 一致 ✅ |
 *   | CI `next start` | production | **http** | `__Secure-…` | `authjs.…` | **分叉** ❌ |
 *   | 自托管 http | production | http | `__Secure-…` | `authjs.…` | **分叉** ❌ |
 *
 * 分叉的表现是：`POST /api/auth/login` 返回 **200 并下发 cookie**，
 * 但随后每个接口都是 **401** —— 因为 Auth.js 找不到它认识的那个名字。
 *
 * 🔴 这就是 2026-10-22 CI 里 `CTRL-1` / `SEC-01..07` 全部 `HTTP 401` 的原因。
 *    它不是"隔离失效"，也不是"登录失败"，而是**签的和读的不是同一把锁**。
 *    顺带解释了一件更严重的事：`secure: true` 的 cookie 在 http 页面上会被
 *    浏览器直接丢弃 ⇒ 任何 http 部署（自托管、内网、预览域名）**根本登不进去**。
 *
 * 因此规则统一到「按公开 origin 的协议判定」，与 Auth.js 同源同判：
 *   · 判断 origin 用 `publicOriginOf()`（已有，且已处理"发布窗口期部署域名"的坑）；
 *   · 本文件只做「origin → cookie 名 + secure 标记」的纯函数映射，便于单测。
 *
 * 不做什么：
 *   · 不在读侧做兼容（不要"两个名字都试"）—— `auth()` 是 Auth.js 的，
 *     我们改不动；写侧对齐它才是唯一能收敛的做法。
 *   · 不读请求头 `X-Forwarded-Proto`。理由同 `public-origin.ts`：可伪造，
 *     且配置/框架值已覆盖自托管场景。
 */

import { normalizeOrigin, publicOriginOf } from '@/lib/http/public-origin'

/** 非安全上下文（http）下的 cookie 名 —— Auth.js v5 默认值 */
export const SESSION_COOKIE = 'authjs.session-token'
/** 安全上下文（https）下的 cookie 名 —— 浏览器只接受 `__Secure-` 前缀的 Secure cookie */
export const SECURE_SESSION_COOKIE = `__Secure-${SESSION_COOKIE}`

export interface SessionCookiePolicy {
  /** 该写哪个名字（同时也是 JWT 的 salt —— 见调用点注释） */
  name: typeof SESSION_COOKIE | typeof SECURE_SESSION_COOKIE
  /** cookie 的 Secure 标记，必须与 name 同步 */
  secure: boolean
}

/**
 * origin → cookie 策略。纯函数，无环境读取，便于单测。
 *
 * 解析不出 origin（空串 / 非法）时回落到非安全名：那种情况下连 Auth.js
 * 自己也无法确定站点 URL，非安全名是唯一"不会让浏览器直接丢弃"的选择。
 */
export function sessionCookiePolicy(origin: string | null | undefined): SessionCookiePolicy {
  const secure = normalizeOrigin(origin).startsWith('https:')
  return { name: secure ? SECURE_SESSION_COOKIE : SESSION_COOKIE, secure }
}

/** 直接从请求推导（路由里用这个）。`env` 仅用于测试注入。 */
export function sessionCookieForRequest(
  request: { url?: string | null; nextUrl?: { origin?: string | null } | null },
  env?: Record<string, string | undefined>,
): SessionCookiePolicy {
  return sessionCookiePolicy(publicOriginOf(request, env))
}
