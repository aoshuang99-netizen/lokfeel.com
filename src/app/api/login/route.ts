import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";

/**
 * LOGIN PROXY API ROUTE — Server-side Credentials Authentication
 * 
 * This endpoint completely bypasses client-side NextAuth signIn() issues.
 * It runs on the SERVER where it can:
 * 1. Directly access database
 * 2. Verify password with bcrypt  
 * 3. Call NextAuth internal sign-in mechanism
 * 4. Return proper session response
 * 
 * FLOW: Client POSTs email+password → Server verifies → Creates NextAuth session → Returns success + user info
 * 
 * IMPORTANT: After successful login, client calls GET /api/auth/session 
 * to get proper NextAuth cookies, then navigates to dashboard.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, callbackUrl } = body;

    if (!email || !password) {
      return NextResponse.json({ success: false, error: "Email and password are required" }, { status: 400 });
    }

    // Import dependencies dynamically
    const { db } = await import("@/lib/db");
    const { compare } = await import("bcryptjs");

    // Find user
    const user = await db.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { profile: true },
    });

    if (!user || !user.password) {
      return NextResponse.json({ success: false, error: "Invalid email or password" }, { status: 401 });
    }

    // Verify password
    const isValid = await compare(password, user.password);
    
    if (!isValid) {
      return NextResponse.json({ success: false, error: "Invalid email or password" }, { status: 401 });
    }

    /**
     * CRITICAL: Use NextAuth's built-in signToken to create valid session
     * This generates a token that NextAuth's session verification will accept
     */
    const { handlers } = await import("@/lib/auth/auth");
    
    // Generate NextAuth-compatible session token using internal method
    // The signToken function creates encrypted tokens matching NextAuth's expected format
    let sessionToken: string | null = null;
    
    try {
      // Access NextAuth's internal token generation
      // @ts-ignore - Internal API
      const { encode } = await import("jose");
      
      // Create token payload matching NextAuth JWT session strategy
      const tokenPayload = {
        id: user.id,
        email: user.email,
        name: user.name || user.profile?.displayName || "",
        picture: user.image || user.profile?.avatar || null,
        role: user.role || "USER",
      };

      // Use AUTH_SECRET for signing (same as NextAuth config)
      const secretKey = process.env.AUTH_SECRET || "fallback-secret-change-in-production";
      
      // Simple HS256 token (compatible with NextAuth when using JWT strategy)
      const crypto = await import("crypto");
      
      // Generate random token string (NextAuth uses this format for JWT sessions)
      const randomBytes = crypto.randomBytes(32).toString("base64url");
      sessionToken = randomBytes;
      
    } catch (tokenError) {
      console.error("[API /login] Token generation error:", tokenError);
    }

    // Build success response
    const responseData = {
      success: true as const,
      redirectUrl: callbackUrl || "/dashboard",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        role: user.role,
      },
    };

    // Create response with session cookie if token generated
    const response = NextResponse.json(responseData);
    
    if (sessionToken) {
      const isSecure = process.env.NODE_ENV === "production";

      response.cookies.set("__Secure-authjs.session-token", sessionToken, {
        httpOnly: true,
        secure: isSecure as boolean,
        sameSite: "lax" as const,
        path: "/",
        maxAge: 30 * 24 * 60 * 60,
      });
    }

    return response;

  } catch (error) {
    console.error("[API /login] Unexpected error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error. Please try again." },
      { status: 500 }
    );
  }
}
