/**
 * V20.5 · Batch 3 —— `POST /api/auth/logout`
 *
 * 为什么需要它：**这个产品此前根本没有登出入口。**
 * 全仓 `grep -rn "signOut\|登出\|退出登录" src` 返回 0 条 ——
 * `/api/auth/signout`（Auth.js 自带）只能靠 CSRF 双提交 cookie 调，
 * 而本仓的登录走的是自研 `/api/auth/login`（同样绕开了 CSRF 层），
 * 所以前端没有任何"点一下就登出"的路径。用户唯一的登出方式是清浏览器数据。
 * 对 GA 来说这是 P1：共享设备上换人 = 必须能登出。
 *
 * 为什么不用 Auth.js 的 `/api/auth/signout`：
 *   它要求 `csrfToken` 与 `authjs.csrf-token` cookie 双提交。实测（Batch 3 探测脚本
 *   `scripts/qa/_probe-signout.mjs`）只带会话 cookie 时它返回
 *   `302 → /login?error=MissingCSRF` 且**不下发任何 set-cookie** ——
 *   也就是说前端如果照着"POST 一下 /api/auth/signout"来写，会得到一个
 *   "看起来跳走了、其实没登出"的假成功。那正是最难排查的一类缺陷。
 *
 * 于是这里用与登录端点对称的做法：自校验同源 + 自己清 cookie。
 *   · CSRF：要求 `Origin`（缺失则 `Referer`）与本站 host 同源 ——
 *     与 `/api/auth/login` 共用 `isSameSiteRequest` / `resolveSiteHosts`，
 *     不另写第三套判定。登出被 CSRF 利用的后果是"把用户踢下线"，属低危，
 *     但既然判定函数已经有了，没有理由不加。
 *   · 清 cookie：**两个名字都清**。会话 cookie 名是按公开 origin 的协议判定的
 *     （http → `authjs.session-token`，https → `__Secure-authjs.session-token`），
 *     而浏览器的 cookie jar 里可能同时残留两种（例如先在预览域名登录、再上生产）。
 *     只清"当前协议对应的那个"会留下另一个，用户在 https 站点上"登出"后
 *     仍带着 http 时期的老 cookie —— 值得花两行代码排除。
 *
 * 🔴 边界（必须写清，不夸大）：登出是**删客户端凭据**，不是服务端撤销。
 *    JWT 是无状态的，登出后把旧 cookie 手工塞回去仍然可用 —— Batch 3 的
 *    S09 就是这条断言。要真撤销必须 `User.tokenVersion + 1`（改密码/重置密码
 *    走的就是这条路径，`requireAuth` 里"版本不等即拒"）。
 */

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { isSameSiteRequest, resolveSiteHosts } from '@/lib/http/public-origin'
import { SECURE_SESSION_COOKIE, SESSION_COOKIE, sessionCookieForRequest } from '@/lib/auth/session-cookie'
import { ACTIVE_ORG_COOKIE } from '@/lib/tenancy/active-org'

export const dynamic = 'force-dynamic'

/** 清空一个 cookie（`Max-Age=0`）。属性必须与写入时一致，否则浏览器视为另一个 cookie。 */
function expire(
  response: NextResponse,
  name: string,
  { secure }: { secure: boolean },
) {
  response.cookies.set({
    name,
    value: '',
    maxAge: 0,
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    // `__Secure-` 前缀的 cookie 浏览器只接受带 Secure 的；反过来，http 站点上
    // 带 Secure 的 Set-Cookie 会被直接丢弃。所以这里的 secure 标记按 cookie 名判定，
    // 不能一律跟当前请求走。
    secure: name === SECURE_SESSION_COOKIE ? true : secure,
  })
}

export async function POST(request: NextRequest) {
  const allowedHosts = resolveSiteHosts({
    host: request.headers.get('host'),
    forwardedHost: request.headers.get('x-forwarded-host'),
    nextUrlOrigin: request.nextUrl.origin,
  })
  const origin = request.headers.get('origin')
  const referer = request.headers.get('referer')
  if (!isSameSiteRequest(origin || referer, allowedHosts)) {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'CSRF_REJECTED', message: 'Cross-origin request blocked.' } },
      { status: 403 },
    )
  }

  const policy = sessionCookieForRequest(request)
  const response = NextResponse.json({ success: true, data: { signedOut: true } })
  expire(response, policy.name, { secure: policy.secure })
  const other = policy.name === SESSION_COOKIE ? SECURE_SESSION_COOKIE : SESSION_COOKIE
  expire(response, other, { secure: policy.secure })
  // 租户软偏好也一并清掉：换人用同一台机器时，下一个人不该继承上一个人的
  // "我在看哪个社群"的选择（那不是凭据，但同样是痕迹）。
  response.cookies.set({ name: ACTIVE_ORG_COOKIE, value: '', maxAge: 0, path: '/' })
  return response
}
