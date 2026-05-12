/**
 * Google OAuth Callback — Custom Direct Token Exchange
 *
 * GET /api/auth/callback/google?code=...&scope=...
 *
 * WHY custom (instead of NextAuth's built-in handler):
 * NextAuth's internal Google callback goes through PrismaAdapter + JWT callback
 * chain which can fail silently (Configuration error, adapter error, etc.).
 * This custom handler gives us full control:
 * 1. Exchange authorization code for Google tokens directly
 * 2. Fetch user profile from Google API
 * 3. Find or create user in database
 * 4. Create NextAuth-compatible JWT session via next-auth/jwt encode()
 * 5. Set session cookie and redirect to dashboard
 *
 * This is the same proven pattern used in /api/auth/login for credentials.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { encode } from "next-auth/jwt";

export const dynamic = "force-dynamic";

const COOKIE_NAME = process.env.NODE_ENV === "production"
  ? "__Secure-authjs.session-token"
  : "authjs.session-token";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const code = searchParams.get("code");
    const error = searchParams.get("error");
    const callbackUrl = searchParams.get("state") || "/dashboard";

    // Handle OAuth errors from Google
    if (error) {
      const errorDesc = searchParams.get("error_description") || error;
      console.error("[Google OAuth] Authorization error:", errorDesc);
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", `Google 授权失败: ${errorDesc}`);
      return NextResponse.redirect(loginUrl);
    }

    if (!code) {
      console.error("[Google OAuth] Missing authorization code");
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "Google 回调缺少授权码");
      return NextResponse.redirect(loginUrl);
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = `${request.nextUrl.origin}/api/auth/callback/google`;

    if (!clientId || !clientSecret) {
      console.error("[Google OAuth] Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET");
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "Google 登录未配置，请联系管理员");
      return NextResponse.redirect(loginUrl);
    }

    // Step 1: Exchange authorization code for tokens
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      const tokenError = await tokenResponse.text();
      console.error("[Google OAuth] Token exchange failed:", tokenResponse.status, tokenError);
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "Google 令牌交换失败，请重试");
      return NextResponse.redirect(loginUrl);
    }

    const tokens = await tokenResponse.json();
    const { access_token, id_token } = tokens;

    // Step 2: Fetch user profile from Google
    // Prefer id_token (contains verified email), fallback to userinfo endpoint
    let googleUser: { sub: string; email: string; name: string; picture: string; email_verified: boolean } | null = null;

    if (id_token) {
      // Decode JWT id_token (no verification needed — Google signed it)
      const parts = id_token.split(".");
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
        googleUser = {
          sub: payload.sub,
          email: payload.email || "",
          name: payload.name || payload.given_name || "",
          picture: payload.picture || "",
          email_verified: payload.email_verified || false,
        };
      }
    }

    if (!googleUser) {
      const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      if (!userInfoRes.ok) {
        console.error("[Google OAuth] User info fetch failed:", userInfoRes.status);
        const loginUrl = new URL("/login", request.url);
        loginUrl.searchParams.set("error", "获取 Google 用户信息失败");
        return NextResponse.redirect(loginUrl);
      }
      googleUser = await userInfoRes.json();
    }

    if (!googleUser) {
      console.error("[Google OAuth] Failed to get Google user info from any source");
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "获取 Google 用户信息失败");
      return NextResponse.redirect(loginUrl);
    }

    if (!googleUser.email) {
      console.error("[Google OAuth] No email in Google profile");
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "无法获取 Google 邮箱，请确保允许邮箱访问");
      return NextResponse.redirect(loginUrl);
    }

    console.log("[Google OAuth] Got user:", googleUser.sub, googleUser.email, googleUser.name);

    // Step 3: Find or create user in database
    const normalizedEmail = googleUser.email.toLowerCase().trim();

    const user = await db.$transaction(async (tx) => {
      // Check existing Google account
      const existingAccount = await tx.account.findUnique({
        where: {
          provider_providerAccountId: {
            provider: "google",
            providerAccountId: googleUser.sub,
          },
        },
        include: { user: true },
      });

      if (existingAccount) {
        // Update user info
        await tx.user.update({
          where: { id: existingAccount.userId },
          data: {
            name: googleUser.name || existingAccount.user.name,
            image: googleUser.picture || existingAccount.user.image,
            emailVerified: googleUser.email_verified ? new Date() : existingAccount.user.emailVerified,
          },
        });
        return await tx.user.findUnique({ where: { id: existingAccount.userId }, include: { profile: true } });
      }

      // Check by email
      const existingUser = await tx.user.findUnique({
        where: { email: normalizedEmail },
        include: { accounts: true, profile: true },
      });

      if (existingUser) {
        // Link Google account if not already linked
        const hasGoogleAccount = existingUser.accounts.some(
          (a) => a.provider === "google" && a.providerAccountId === googleUser.sub
        );
        if (!hasGoogleAccount) {
          await tx.account.create({
            data: {
              userId: existingUser.id,
              type: "oauth",
              provider: "google",
              providerAccountId: googleUser.sub,
            },
          });
        }
        await tx.user.update({
          where: { id: existingUser.id },
          data: {
            name: googleUser.name || existingUser.name,
            image: googleUser.picture || existingUser.image,
            emailVerified: googleUser.email_verified ? new Date() : existingUser.emailVerified,
          },
        });
        return await tx.user.findUnique({ where: { id: existingUser.id }, include: { profile: true } });
      }

      // Create new user
      const newUser = await tx.user.create({
        data: {
          email: normalizedEmail,
          name: googleUser.name || "",
          image: googleUser.picture || null,
          emailVerified: googleUser.email_verified ? new Date() : null,
        },
      });

      await tx.account.create({
        data: {
          userId: newUser.id,
          type: "oauth",
          provider: "google",
          providerAccountId: googleUser.sub,
        },
      });

      await tx.profile.create({
        data: {
          userId: newUser.id,
          displayName: googleUser.name || "",
          avatar: googleUser.picture || null,
          profileStatus: "DRAFT",
          age: 18,
          gender: "OTHER",
          sexuality: "OTHER",
        },
      });

      return await tx.user.findUnique({ where: { id: newUser.id }, include: { profile: true } });
    });

    if (!user) {
      console.error("[Google OAuth] Failed to create/find user");
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "创建用户失败，请重试");
      return NextResponse.redirect(loginUrl);
    }

    // Step 4: Create NextAuth-compatible JWT session token
    const secret = process.env.AUTH_SECRET;
    if (!secret) {
      console.error("[Google OAuth] AUTH_SECRET not configured");
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "服务器配置错误");
      return NextResponse.redirect(loginUrl);
    }

    const tokenPayload = {
      id: user.id,
      email: user.email,
      name: user.name || user.profile?.displayName || "",
      picture: user.image || user.profile?.avatar || null,
      role: user.role || "USER",
      emailVerified: user.emailVerified || null,
      sub: user.id,
    };

    const sessionToken = await encode({
      token: tokenPayload,
      secret,
      salt: COOKIE_NAME,
      maxAge: 7 * 24 * 60 * 60,
    });

    // Step 5: Redirect to dashboard with session cookie
    const destination =
      user.role === "ADMIN" || user.role === "SUPER_ADMIN"
        ? "/admin"
        : callbackUrl;

    const response = NextResponse.redirect(new URL(destination, request.url));

    const isSecure = process.env.NODE_ENV === "production";
    response.cookies.set(COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: isSecure,
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });

    console.log("[Google OAuth] Success! User:", user.id, user.email, "→", destination);

    return response;
  } catch (error: any) {
    console.error("[Google OAuth] Callback error:", error?.message || error, error?.stack);
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", "Google 登录过程中发生错误，请重试");
    return NextResponse.redirect(loginUrl);
  }
}
