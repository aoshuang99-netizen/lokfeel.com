/**
 * Google OAuth 2.0 Custom Callback Endpoint
 *
 * GET /api/auth/google/callback?code=...&state=...
 *
 * WHY CUSTOM (instead of NextAuth built-in):
 * NextAuth v5 beta's built-in Google callback handler throws errors on
 * Vercel cold starts (Configuration/missing PKCE cookie), because:
 * 1. The __Secure-authjs.pkce.code_verifier cookie may not be forwarded
 *    correctly across Vercel's edge/serverless boundaries
 * 2. NextAuth's internal error handling redirects to /login?error=Configuration
 *    which is misleading — the config IS correct, the handler just fails
 *
 * This custom callback mirrors the Twitter callback pattern:
 * 1. Read PKCE code_verifier from cookie (set during signin)
 * 2. Exchange code + code_verifier for Google tokens
 * 3. Decode id_token to get user profile
 * 4. Find or create user in database
 * 5. Create NextAuth JWT session token directly
 * 6. Redirect to dashboard with session cookie
 *
 * The [...nextauth] route handler intercepts /api/auth/callback/google
 * and redirects here.
 */

import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens, decodeIdToken, getGoogleConfig } from "@/lib/auth/google-oauth";
import { db } from "@/lib/db";
import { encode } from "next-auth/jwt";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const config = getGoogleConfig();

    if (!config.valid) {
      console.error("[Google OAuth Callback] Google OAuth not configured");
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "Google OAuth 未配置，请联系管理员");
      return NextResponse.redirect(loginUrl);
    }

    // Step 1: Extract code and state from query params
    const { searchParams } = request.nextUrl;
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");

    if (error) {
      const errorDesc = searchParams.get("error_description") || error;
      console.error("[Google OAuth Callback] Authorization error:", errorDesc);
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", `Google 授权失败: ${errorDesc}`);
      return NextResponse.redirect(loginUrl);
    }

    if (!code) {
      console.error("[Google OAuth Callback] Missing authorization code");
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "Google 回调缺少授权码");
      return NextResponse.redirect(loginUrl);
    }

    // Step 2: Read PKCE code_verifier from cookie
    // NextAuth sets this cookie as __Secure-authjs.pkce.code_verifier
    const codeVerifier = request.cookies.get("__Secure-authjs.pkce.code_verifier")?.value
      || request.cookies.get("authjs.pkce.code_verifier")?.value;

    if (!codeVerifier) {
      console.error("[Google OAuth Callback] Missing PKCE code_verifier cookie");
      // Don't fail hard — try without PKCE (some flows don't use it)
      console.warn("[Google OAuth Callback] Attempting token exchange without PKCE verifier...");
    }

    // Step 3: Exchange code for tokens
    const redirectUri = `${request.nextUrl.origin}/api/auth/callback/google`;

    let tokenResponse;
    try {
      tokenResponse = await exchangeCodeForTokens({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        redirectUri,
        code,
        codeVerifier: codeVerifier || "", // May be empty if cookie was lost
      });
    } catch (err: any) {
      console.error("[Google OAuth Callback] Token exchange error:", err.message);
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "Google 令牌交换失败，请重试");
      return NextResponse.redirect(loginUrl);
    }

    // Step 4: Decode ID token to get user info
    let googleUser;
    try {
      googleUser = decodeIdToken(tokenResponse.id_token);
    } catch (err: any) {
      console.error("[Google OAuth Callback] ID token decode error:", err.message);
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "Google 令牌解析失败");
      return NextResponse.redirect(loginUrl);
    }

    console.log("[Google OAuth Callback] Got user:", googleUser.sub, googleUser.email, googleUser.name);

    // Step 5: Find or create user in DB
    const normalizedEmail = googleUser.email.toLowerCase().trim();
    const userName = googleUser.name || googleUser.email.split("@")[0];
    const avatar = googleUser.picture || null;

    const user = await db.$transaction(async (tx) => {
      // Check existing user by Google account
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
        // Update user info if better data available
        if (userName && (!existingAccount.user.name || existingAccount.user.name === existingAccount.user.email)) {
          await tx.user.update({
            where: { id: existingAccount.userId },
            data: {
              name: userName,
              image: avatar || existingAccount.user.image,
              emailVerified: googleUser.email_verified ? new Date() : existingAccount.user.emailVerified,
            },
          });
        } else if (avatar && !existingAccount.user.image) {
          // Just update the avatar if missing
          await tx.user.update({
            where: { id: existingAccount.userId },
            data: { image: avatar },
          });
        }
        return existingAccount.user;
      }

      // Check by email
      const existingUser = await tx.user.findUnique({
        where: { email: normalizedEmail },
        include: { accounts: true, profile: true },
      });

      if (existingUser) {
        // Link Google account
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
        // Update user info
        if (userName) {
          await tx.user.update({
            where: { id: existingUser.id },
            data: {
              name: userName,
              image: avatar || existingUser.image,
              emailVerified: googleUser.email_verified ? new Date() : existingUser.emailVerified,
            },
          });
        }
        return existingUser;
      }

      // Create new user
      const newUser = await tx.user.create({
        data: {
          email: normalizedEmail,
          name: userName,
          image: avatar,
          emailVerified: googleUser.email_verified ? new Date() : null,
        },
      });

      // Create Account record
      await tx.account.create({
        data: {
          userId: newUser.id,
          type: "oauth",
          provider: "google",
          providerAccountId: googleUser.sub,
        },
      });

      // Create Profile
      await tx.profile.create({
        data: {
          userId: newUser.id,
          displayName: userName,
          avatar: avatar,
          profileStatus: "DRAFT",
          age: 18,
          gender: "OTHER",
          sexuality: "OTHER",
        },
      });

      return newUser;
    });

    // Step 6: Create NextAuth-compatible JWT session token directly
    const secret = process.env.AUTH_SECRET;
    if (!secret) {
      console.error("[Google OAuth Callback] AUTH_SECRET not configured");
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "服务器配置错误");
      return NextResponse.redirect(loginUrl);
    }

    const COOKIE_NAME = process.env.NODE_ENV === "production"
      ? "__Secure-authjs.session-token"
      : "authjs.session-token";

    const tokenPayload = {
      id: user.id,
      email: user.email,
      name: user.name || userName || "",
      picture: user.image || avatar || null,
      role: user.role || "USER",
      emailVerified: user.emailVerified || null,
      sub: user.id,
    };

    const sessionToken = await encode({
      token: tokenPayload,
      secret,
      salt: COOKIE_NAME,
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    // Step 7: Redirect to dashboard with session cookie
    const callbackUrl = request.cookies.get("__Secure-authjs.callback-url")?.value
      || request.cookies.get("authjs.callback-url")?.value
      || "/dashboard";
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

    // Clear OAuth cookies
    response.cookies.set("__Secure-authjs.pkce.code_verifier", "", { maxAge: 0, path: "/" });
    response.cookies.set("authjs.pkce.code_verifier", "", { maxAge: 0, path: "/" });
    response.cookies.set("__Secure-authjs.callback-url", "", { maxAge: 0, path: "/" });
    response.cookies.set("authjs.callback-url", "", { maxAge: 0, path: "/" });
    response.cookies.set("__Host-authjs.csrf-token", "", { maxAge: 0, path: "/" });
    response.cookies.set("authjs.csrf-token", "", { maxAge: 0, path: "/" });

    console.log("[Google OAuth Callback] Success! User:", user.id, user.email, "→", destination);

    return response;
  } catch (error: any) {
    console.error("[Google OAuth Callback] Fatal error:", error);
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", `Google 登录过程中发生错误: ${error.message?.substring(0, 50) || '未知错误'}`);
    return NextResponse.redirect(loginUrl);
  }
}
