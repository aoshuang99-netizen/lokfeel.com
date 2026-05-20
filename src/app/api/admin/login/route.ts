import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { compare } from "bcryptjs";
import { createAdminSession } from "@/lib/admin-auth";

// Admin credentials disabled by default in production for security.
// Enable explicitly with ADMIN_CREDENTIALS_ENABLED=true in Vercel env vars.
const ADMIN_CREDENTIALS_ENABLED = process.env.ADMIN_CREDENTIALS_ENABLED === "true";
const DEMO_ADMINS = ADMIN_CREDENTIALS_ENABLED ? [
  { username: "admin", password: "Admin@2026!", role: "SUPER_ADMIN" },
  { username: "moderator", password: "Mod@2026!", role: "MODERATOR" },
  { username: "analyst", password: "Analyst@2026!", role: "ANALYST" },
] : [];

const SESSION_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 24 * 60 * 60, // 24 hours
  path: "/",
};

function createLoginResponse(username: string, role: string) {
  const sessionToken = createAdminSession({
    username,
    role,
    exp: Date.now() + 24 * 60 * 60 * 1000,
  });

  const response = NextResponse.json({
    success: true,
    user: { username, role },
  });

  response.cookies.set("admin_session", sessionToken, SESSION_OPTIONS);
  return response;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, username, password } = body;

    // Support both 'email' and 'username' from login form
    const loginId = (email || username || "").toLowerCase().trim();

    if (!loginId || !password) {
      return NextResponse.json(
        { success: false, error: "用户名和密码不能为空" },
        { status: 400 }
      );
    }

    // Check admin credentials (all environments, controlled by env var)
    const demoAdmin = DEMO_ADMINS.length > 0
      ? DEMO_ADMINS.find((a) => a.username === loginId && a.password === password)
      : null;

    if (demoAdmin) {
      return createLoginResponse(demoAdmin.username, demoAdmin.role);
    }

    // Check database for admin users
    const user = await db.user.findFirst({
      where: {
        OR: [
          { email: loginId },
          { name: loginId },
        ],
        adminRoles: {
          some: {},
        },
      },
      include: {
        adminRoles: true,
      },
    });

    if (user && user.password) {
      const isValid = await compare(password, user.password);
      if (isValid) {
        const role = user.adminRoles?.[0]?.role || "ADMIN";
        const sessionToken = createAdminSession({
          userId: user.id,
          email: user.email,
          role,
          exp: Date.now() + 24 * 60 * 60 * 1000,
        });

        const response = NextResponse.json({
          success: true,
          user: {
            username: user.name || user.email,
            role,
          },
        });

        response.cookies.set("admin_session", sessionToken, SESSION_OPTIONS);
        return response;
      }
    }

    return NextResponse.json(
      { success: false, error: "用户名或密码错误" },
      { status: 401 }
    );
  } catch (error) {
    console.error("[Admin Login] Error:", error);
    return NextResponse.json(
      { success: false, error: "服务器错误，请稍后重试" },
      { status: 500 }
    );
  }
}
