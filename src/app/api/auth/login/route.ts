import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { verifyPassword } from "@/lib/auth/auth"
import { encode } from "next-auth/jwt"
import { isSafeRedirect } from "@/lib/auth/safe-redirect"
import { isSameSiteRequest, resolveSiteHosts } from "@/lib/http/public-origin"
import { sessionCookieForRequest } from "@/lib/auth/session-cookie"
import { clientIpFrom, recordLoginOutcome } from "@/lib/auth/login-audit"

/**
 * POST /api/auth/login
 * Custom credentials login — bypasses NextAuth's CSRF-protected callback entirely.
 *
 * WHY: NextAuth v5's credentials callback at /api/auth/callback/credentials
 * requires a valid CSRF token from the double-submit cookie pattern.
 * Client-side fetch() to this endpoint loses the CSRF cookie in certain
 * configurations (SameSite, Secure, redirect following), causing silent failures.
 *
 * SOLUTION: This route verifies credentials server-side, then creates a valid
 * NextAuth JWT session token using next-auth/jwt's encode(), and sets it as
 * an httpOnly cookie. This is exactly what NextAuth's internal flow does,
 * but without the CSRF middleware layer.
 *
 * Security: bcrypt password hashing is verified server-side.
 * JWT is signed with AUTH_SECRET (same as NextAuth config).
 */
export const dynamic = "force-dynamic"

// Open-redirect guard shared with the OAuth callbacks (isSafeRedirect) so every
// auth entry-point enforces the same allow-list. See src/lib/auth/safe-redirect.ts.

// NextAuth JWT cookie 的名字与 Secure 标记**不在这里定**。
// 曾经这里写的是 `NODE_ENV === 'production' ? '__Secure-…' : 'authjs.…'`，
// 而 Auth.js 是按「站点 URL 的协议」判定的。`next start`（NODE_ENV=production）
// 但站点是 http（CI / 自托管 / 内网）时，两者分叉 ⇒ 本接口 200 下发 cookie，
// 后续接口 401。规则已收敛到 `sessionCookieForRequest()`，见该文件开头的表格。

export async function POST(request: NextRequest) {
  try {
    // ─── 0. CSRF guard (defense-in-depth) ───
    // This custom credentials endpoint intentionally bypasses NextAuth's CSRF
    // cookie layer (see file header). Browsers always send `Origin` for
    // same-origin POST/fetch and for cross-site POST; a forged cross-site
    // form submit will either lack `Origin` or carry an attacker host → reject.
    // When `Origin` is absent we fall back to `Referer` host (a genuine
    // same-origin SPA login always sends one of the two).
    const origin = request.headers.get("origin")
    const referer = request.headers.get("referer")
    // ⚠️ 判定「可接受站点 host」时不能只用 request.nextUrl.host：实测部署刚发布后的
    // 一段时间里它会被解析成平台部署专用域名（<deploy-id>--<site>.netlify.app），
    // 只拿它比对会让**所有真实登录在这段时间内 403**。改为取多个来源的并集
    // （Host / X-Forwarded-Host / nextUrl / 配置的公开域名）。见 lib/http/public-origin.ts。
    const allowedHosts = resolveSiteHosts({
      host: request.headers.get("host"),
      forwardedHost: request.headers.get("x-forwarded-host"),
      nextUrlOrigin: request.nextUrl.origin,
    })
    const csrfOk = isSameSiteRequest(origin || referer, allowedHosts)
    if (!csrfOk) {
      return NextResponse.json(
        { error: "Cross-origin request blocked. Please log in from the app." },
        { status: 403 }
      )
    }

    let body: any = {}
    try {
      body = await request.json()
    } catch (e) {
      return NextResponse.json(
        { error: "Invalid request body. Please provide email and password." },
        { status: 400 }
      )
    }
    
    const { email, password, callbackUrl } = body as {
      email?: string
      password?: string
      callbackUrl?: string
    }

    // ─── 1. Validate inputs ───
    if (!email || !password) {
      return NextResponse.json(
        { error: "Missing email or password" },
        { status: 400 }
      )
    }

    const normalizedEmail = email.toLowerCase().trim()

    // ─── 2. Find user (LEAN: no profile include, we only need user fields) ───
    const user = await db.user.findUnique({
      where: { email: normalizedEmail },
    })

    if (!user) {
      // 未知邮箱不落业务表（没有 userId 可挂），只留服务器日志。
      // 仍然调用一次：让"所有登录尝试都经过审计入口"成为结构事实，而不是靠记性。
      await recordLoginOutcome({
        userId: null,
        outcome: "failed",
        reason: "unknown_email",
        ip: clientIpFrom(request.headers),
        userAgent: request.headers.get("user-agent"),
      })
      console.warn("[Login API] 未知邮箱登录尝试")
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      )
    }

    // ─── 3. Verify password ───
    if (!(user as any).password) {
      // CHECK: Does this user have OAuth accounts?
      const oauthAccounts = await db.account.findMany({
        where: { userId: user.id },
        select: { provider: true },
      });
      const providers = oauthAccounts.map(a => a.provider).join(", ");
      await recordLoginOutcome({
        userId: user.id,
        outcome: "failed",
        reason: "oauth_only",
        ip: clientIpFrom(request.headers),
        userAgent: request.headers.get("user-agent"),
      })
      return NextResponse.json(
        {
          error: "This account uses social login.",
          errorCode: "OAUTH_ONLY",
          providers,
          email: normalizedEmail,
        },
        { status: 401 }
      )
    }

    const isValid = await verifyPassword(password, (user as any).password)

    if (!isValid) {
      // 记失败尝试是这次事故后补的关键能力：没有它，事后无法回答
      // "这个账号有没有被人拿去爆破过"。
      await recordLoginOutcome({
        userId: user.id,
        outcome: "failed",
        reason: "bad_password",
        ip: clientIpFrom(request.headers),
        userAgent: request.headers.get("user-agent"),
      })
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      )
    }

    // 成功路径也记：审计的价值在于"有基线"，只有失败记录时无法判断异常。
    await recordLoginOutcome({
      userId: user.id,
      outcome: "succeeded",
      ip: clientIpFrom(request.headers),
      userAgent: request.headers.get("user-agent"),
    })

    // ─── 4. Create NextAuth-compatible JWT session token ───
    // This mimics exactly what NextAuth's internal sign-in flow does:
    // jwt() callback → encode() → set cookie
    const secret = process.env.AUTH_SECRET
    if (!secret) {
      console.error("[Login API] AUTH_SECRET is not configured")
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      )
    }

    // Build the JWT payload that matches our config.ts jwt() callback
    // NOTE: encode() automatically sets iat, exp, jti in the JWE headers,
    // so we only need to include our custom fields here.
    const tokenPayload = {
      id: user.id,
      email: user.email,
      name: user.name || "",
      picture: user.image || null,
      role: (user as any).role || "USER",
      emailVerified: (user as any).emailVerified || null,
      sub: user.id,
      tokenVersion: (user as any).tokenVersion || 0,
    }

    // CRITICAL: 名字既是 cookie 名，也是 JWT 的 salt —— 两者必须来自同一处，
    // 否则 decode 出来的东西 Auth.js 读不到（表现为"登录成功但一直 401"）。
    // 生产 https → "__Secure-authjs.session-token"；http（CI / 自托管）→ "authjs.session-token"。
    const cookie = sessionCookieForRequest(request)

    const sessionToken = await encode({
      token: tokenPayload,
      secret,
      salt: cookie.name,
      maxAge: 7 * 24 * 60 * 60, // 7 days (matches config.ts)
    })

    // ─── 5. Determine redirect destination ───
    const role = (user as any).role
    // Validate callbackUrl to close the open-redirect: only allow relative
    // paths or same-origin URLs; fall back to /dashboard otherwise.
    const safeCallback = isSafeRedirect(callbackUrl) ? callbackUrl! : "/dashboard"
    const destination =
      role === "ADMIN" || role === "SUPER_ADMIN"
        ? "/admin"
        : safeCallback

    // ─── 6. Build response with session cookie ───
    const response = NextResponse.json({
      success: true,
      redirectUrl: destination,
      role,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: (user as any).role,
      },
    })

    // Set the NextAuth session cookie (same parameters NextAuth uses internally)
    response.cookies.set(cookie.name, sessionToken, {
      httpOnly: true,
      secure: cookie.secure,
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60, // 7 days
    })

    return response
  } catch (error: any) {
    console.error("[Login API] Error:", error?.message || error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
