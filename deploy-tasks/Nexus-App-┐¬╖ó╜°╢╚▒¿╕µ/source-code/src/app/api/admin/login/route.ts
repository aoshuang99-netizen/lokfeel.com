import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { compare } from "bcryptjs";
import { Buffer } from "buffer";

// Demo admin credentials - ONLY available in development mode
const DEMO_ADMINS = process.env.NODE_ENV === 'development' ? [
  { username: "admin", password: "Admin@2026!", role: "SUPER_ADMIN" },
  { username: "moderator", password: "Mod@2026!", role: "MODERATOR" },
  { username: "analyst", password: "Analyst@2026!", role: "ANALYST" },
] : [];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        { success: false, error: "用户名和密码不能为空" },
        { status: 400 }
      );
    }

    // Check demo admin credentials only in development mode
    const demoAdmin = DEMO_ADMINS.length > 0 
      ? DEMO_ADMINS.find((a) => a.username === username && a.password === password)
      : null;

    if (demoAdmin) {
      // Create session token (simplified)
      // In production, use proper JWT or session management
      const sessionToken = Buffer.from(
        JSON.stringify({
          username: demoAdmin.username,
          role: demoAdmin.role,
          exp: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
        })
      ).toString("base64");

      const response = NextResponse.json({
        success: true,
        user: {
          username: demoAdmin.username,
          role: demoAdmin.role,
        },
      });

      // Set session cookie
      response.cookies.set("admin_session", sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 24 * 60 * 60, // 24 hours
        path: "/",
      });

      return response;
    }

    // Check database for admin users
    const user = await db.user.findFirst({
      where: {
        OR: [
          { email: username },
          { name: username },
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
        const sessionToken = Buffer.from(
          JSON.stringify({
            userId: user.id,
            email: user.email,
            role: user.adminRoles?.[0]?.role || "ADMIN",
            exp: Date.now() + 24 * 60 * 60 * 1000,
          })
        ).toString("base64");

        const response = NextResponse.json({
          success: true,
          user: {
            username: user.name || user.email,
            role: user.adminRoles?.[0]?.role || "ADMIN",
          },
        });

        response.cookies.set("admin_session", sessionToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          maxAge: 24 * 60 * 60,
          path: "/",
        });

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
