import { NextResponse } from "next/server"
import { encode } from "next-auth/jwt"
import { isSafeRedirect } from "@/lib/auth/safe-redirect"

/**
 * GET /api/guest
 * Create a guest (read-only) session and redirect to dashboard.
 *
 * The JWT payload includes `guest: true` so the dashboard
 * can render a "Login to interact" overlay on protected actions.
 * No DB record is created — this is a pure JWT-based guest session.
 */
export const dynamic = "force-dynamic"

const COOKIE_NAME =
  process.env.NODE_ENV === "production"
    ? "__Secure-authjs.session-token"
    : "authjs.session-token"

export async function GET(request: Request) {
  const secret = process.env.AUTH_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    )
  }

  const tokenPayload = {
    id: `guest_${Date.now()}`,
    email: null,
    name: "Guest",
    picture: null,
    role: "USER",
    emailVerified: null,
    sub: `guest_${Date.now()}`,
    guest: true,
  }

  const sessionToken = await encode({
    token: tokenPayload,
    secret,
    salt: COOKIE_NAME,
    maxAge: 24 * 60 * 60, // 24 hours for guest sessions
  })

  const isSecure = process.env.NODE_ENV === "production"
  const url = new URL(request.url)
  const rawCallback = url.searchParams.get("callbackUrl") || "/dashboard"
  // EP-S2 (2026-09-04): validate callbackUrl to prevent open-redirect phishing
  // (new URL(absoluteExternalUrl, origin) ignores origin → would redirect off-site)
  const callbackUrl = isSafeRedirect(rawCallback) ? rawCallback : "/dashboard"

  const response = NextResponse.redirect(
    new URL(callbackUrl, url.origin)
  )

  response.cookies.set(COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    path: "/",
    maxAge: 24 * 60 * 60,
  })

  return response
}
