import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { compare } from "bcryptjs";
import { createAdminSession } from "@/lib/admin-auth";

// Admin credentials are NOT hardcoded in source (previously a hardcoded
// backdoor: admin/Admin@2026!, etc.). A single optional env-backed admin
// account may be enabled for emergencies via ADMIN_USERNAME / ADMIN_PASSWORD /
// ADMIN_ROLE; otherwise admin access requires a real admin user in the DB.
const DEMO_ADMINS = (() => {
  const u = process.env.ADMIN_USERNAME;
  const p = process.env.ADMIN_PASSWORD;
  if (u && p) {
    return [{ username: u, password: p, role: (process.env.ADMIN_ROLE || "SUPER_ADMIN") }];
  }
  return [];
})();

const SESSION_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 24 * 60 * 60, // 24 hours
  path: "/",
};

function createLoginResponse(
  username: string,
  role: string,
  isFormSubmit: boolean,
  baseUrl: string
) {
  const sessionToken = createAdminSession({
    username,
    role,
    exp: Date.now() + 24 * 60 * 60 * 1000,
  });

  // For form submit, redirect to admin dashboard
  if (isFormSubmit) {
    const response = NextResponse.redirect(
      new URL("/admin", baseUrl),
      302
    );
    response.cookies.set("admin_session", sessionToken, SESSION_OPTIONS);
    return response;
  }

  // For API/JSON, return JSON response
  const response = NextResponse.json({
    success: true,
    user: { username, role },
  });
  response.cookies.set("admin_session", sessionToken, SESSION_OPTIONS);
  return response;
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";
    let username: string | undefined;
    let password: string | undefined;
    let isFormSubmit = false;

    // Parse based on content type
    if (contentType.includes("application/json")) {
      const body = await request.json();
      username = body.username || body.email || body.name;
      password = body.password;
    } else if (
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
    ) {
      const formData = await request.formData();
      username = (formData.get("username") as string | null) ?? undefined;
      password = (formData.get("password") as string | null) ?? undefined;
      isFormSubmit = true;
    }

    const loginId = (username || "").toLowerCase().trim();

    if (!loginId || !password) {
      if (isFormSubmit) {
        // Redirect back to login with error
        const url = new URL("/admin-login", request.url);
        url.searchParams.set("error", "missing_fields");
        return NextResponse.redirect(url, 302);
      }
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
      return createLoginResponse(demoAdmin.username, demoAdmin.role, isFormSubmit, request.url);
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
        const username = user.name || user.email;
        return createLoginResponse(username, role, isFormSubmit, request.url);
      }
    }

    // Invalid credentials
    if (isFormSubmit) {
      const url = new URL("/admin-login", request.url);
      url.searchParams.set("error", "invalid_credentials");
      return NextResponse.redirect(url, 302);
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
