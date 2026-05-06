import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/auth";

export const dynamic = 'force-dynamic';

/**
 * Debug endpoint to check authentication state.
 * GET /api/debug-auth
 * Returns detailed auth information for debugging.
 * ⚠️ ADMIN ONLY — Protected endpoint
 */
export async function GET(req: NextRequest) {
  try {
    const { user } = await requireAdminAuth();

    const result: any = {
      timestamp: new Date().toISOString(),
      env: {
        AUTH_SECRET_exists: !!process.env.AUTH_SECRET,
        AUTH_SECRET_length: process.env.AUTH_SECRET?.length || 0,
        AUTH_URL: process.env.AUTH_URL,
        NODE_ENV: process.env.NODE_ENV,
      },
      cookies: {} as any,
      getTokenResult: null as any,
      authResult: null as any,
      recommendation: "",
    };

    // 1. Log all cookies (redacted for security)
    const cookieHeader = req.headers.get("cookie") || "";
    const cookieNames = cookieHeader.split(";").map(c => c.trim().split("=")[0]).filter(Boolean);
    result.cookies = {
      count: cookieNames.length,
      names: cookieNames,
      hasNextAuth: cookieNames.some(n => n.includes("next-auth") || n.includes("nextauth")),
    };

    // 2. Try getToken()
    const { getToken } = await import("next-auth/jwt");
    try {
      const token = await getToken({
        req,
        secret: process.env.AUTH_SECRET,
      });
      result.getTokenResult = {
        success: !!token,
        hasId: !!(token as any)?.id,
        id: (token as any)?.id || null,
        role: (token as any)?.role || null,
        email: (token as any)?.email || null,
      };
    } catch (e: any) {
      result.getTokenResult = {
        success: false,
        error: e.message,
      };
    }

    // 3. Try auth()
    const { auth } = await import("@/lib/auth");
    try {
      const session = await auth();
      result.authResult = {
        success: !!session?.user,
        hasId: !!(session?.user as any)?.id,
        id: (session?.user as any)?.id || null,
        role: (session?.user as any)?.role || null,
        email: (session?.user as any)?.email || null,
      };
    } catch (e: any) {
      result.authResult = {
        success: false,
        error: e.message,
      };
    }

    // 4. Recommendation
    if (result.getTokenResult.success) {
      result.recommendation = "getToken() works! User is authenticated.";
    } else if (result.authResult.success) {
      result.recommendation = "auth() works! User is authenticated.";
    } else if (result.cookies.hasNextAuth) {
      result.recommendation = "Cookies present but token verification failed. AUTH_SECRET mismatch likely.";
    } else {
      result.recommendation = "No auth cookies found. Please log in first.";
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    if (error?.message?.includes('Unauthorized') || error?.message?.includes('Forbidden') || error?.message?.includes('Admin')) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
