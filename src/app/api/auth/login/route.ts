import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { verifyPassword } from "@/lib/auth/auth"
import { encode } from "next-auth/jwt"
import { isSafeRedirect } from "@/lib/auth/safe-redirect"

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

// NextAuth JWT cookie names (matches next-auth v5 defaults)
const COOKIE_NAME = process.env.NODE_ENV === "production"
  ? "__Secure-authjs.session-token"
  : "authjs.session-token"

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
    const siteHost = request.nextUrl.host
    const hostMatches = (h?: string | null) => {
      if (!h) return false
      try {
        return new URL(h).host === siteHost
      } catch {
        return false
      }
    }
    const csrfOk = origin ? hostMatches(origin) : hostMatches(referer)
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
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      )
    }

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

    // CRITICAL: salt MUST match the cookie name exactly.
    // NextAuth's getToken() uses cookieName as the salt for decryption.
    // In production: "__Secure-authjs.session-token"
    // In development: "authjs.session-token"
    const sessionToken = await encode({
      token: tokenPayload,
      secret,
      salt: COOKIE_NAME,
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
    const isSecure = process.env.NODE_ENV === "production"
    response.cookies.set(COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: isSecure,
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
