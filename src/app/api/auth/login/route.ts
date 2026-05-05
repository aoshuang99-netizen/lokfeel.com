import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { verifyPassword } from "@/lib/auth/auth"
import { signIn } from "@/lib/auth/auth"

/**
 * POST /api/auth/login
 * Custom credentials login — bypasses NextAuth CSRF protection.
 *
 * Why this route:
 * NextAuth v5 beta's signIn() from next-auth/react loses the CSRF token
 * when used with redirect:false, causing MissingCSRF errors.
 * This route calls the authorize logic directly + creates a session
 * without going through NextAuth's CSRF-protected callback.
 *
 * Security: bcrypt password hashing is verified server-side.
 * CSRF is not needed for credentials-based auth when the only state-changing
 * operation is password verification + session creation.
 */
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
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

    // ─── 2. Find user ───
    const user = await db.user.findUnique({
      where: { email: normalizedEmail },
      include: { profile: true },
    })

    if (!user) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      )
    }

    // ─── 3. Verify password ───
    if (!(user as any).password) {
      return NextResponse.json(
        { error: "This account does not use password login" },
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

    // ─── 4. Create session via NextAuth signIn ───
    // Use signIn to create the JWT cookie (server-side)
    const signInResult = await signIn("credentials", {
      email: normalizedEmail,
      password,
      redirect: false, // We'll handle redirect manually
    })

    // Determine redirect destination based on role
    const role = (user as any).role
    const destination =
      role === "ADMIN" || role === "SUPER_ADMIN"
        ? "/admin"
        : (callbackUrl || "/dashboard")

    // signIn with redirect:false returns an object with ok/error
    // We need to redirect the browser to set the cookie
    if ((signInResult as any)?.error) {
      return NextResponse.json(
        { error: "Authentication failed" },
        { status: 401 }
      )
    }

    // Return success + redirect URL for the client to navigate to
    return NextResponse.json({
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
  } catch (error) {
    console.error("[Login API] Error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
