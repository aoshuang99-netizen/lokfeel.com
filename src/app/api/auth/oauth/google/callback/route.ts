/**
 * Google OAuth 2.0 Custom Callback Endpoint (v2 — Fixed Route Conflict)
 *
 * GET /api/auth/oauth/google/callback?code=...&state=...
 *
 * WHY THIS PATH: Moved from /api/auth/google/callback to avoid [...nextauth]
 * catch-all route conflict. The signin endpoint is now at /api/auth/oauth/google/signin.
 *
 * WHY CUSTOM (instead of NextAuth built-in):
 * NextAuth v5 stores PKCE code_verifier as a JWE-encrypted cookie, which
 * cannot be used directly in the Google token exchange. Our custom signin
 * endpoint generates its own PKCE and stores the code_verifier as a plain-text
 * cookie ("google-pkce-verifier"), which this callback can read and use correctly.
 *
 * Flow:
 * 1. Extract authorization code + state from query params
 * 2. Verify `state` against the httpOnly cookie (CSRF binding — MANDATORY)
 * 3. Read PKCE code_verifier from our custom cookie (MANDATORY — no silent fallback)
 * 4. Exchange code + code_verifier + client_secret for Google tokens
 * 5. Decode id_token to get user profile
 * 6. Find or create user in database
 * 7. Create NextAuth JWT session token directly
 * 8. Redirect to dashboard with session cookie
 */

import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens, decodeIdToken, getGoogleConfig } from "@/lib/auth/google-oauth";
import { db } from "@/lib/db";
import { encode } from "next-auth/jwt";
import { isSafeRedirect } from "@/lib/auth/safe-redirect";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const config = getGoogleConfig();

    console.log("[Google OAuth Callback] Starting callback handler");
    console.log("[Google OAuth Callback] Config valid:", config.valid);
    console.log("[Google OAuth Callback] Request URL:", request.url);
    console.log("[Google OAuth Callback] Search params:", Object.fromEntries(request.nextUrl.searchParams));

    if (!config.valid) {
      console.error("[Google OAuth Callback] Google OAuth not configured");
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "Google OAuth not configured. Please contact support.");
      return NextResponse.redirect(loginUrl);
    }

    // Step 1: Extract code + state from query params
    const { searchParams } = request.nextUrl;
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");

    console.log("[Google OAuth Callback] Authorization code present:", !!code);
    console.log("[Google OAuth Callback] State present:", !!state);
    console.log("[Google OAuth Callback] Error from Google:", error || "none");

    if (error) {
      const errorDesc = searchParams.get("error_description") || error;
      console.error("[Google OAuth Callback] Authorization error:", error, errorDesc);
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", `Google authorization failed: ${errorDesc}`);
      return NextResponse.redirect(loginUrl);
    }

    if (!code) {
      console.error("[Google OAuth Callback] Missing authorization code");
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "Google callback missing authorization code");
      return NextResponse.redirect(loginUrl);
    }

    // Step 1b: Verify `state` — CSRF binding between the browser that STARTED
    // the flow and this callback. Mirrors the Twitter callback implementation.
    //
    // 安全说明（2026-10-01 修复）：此前完全不带 state，回调也不校验，
    // 因此若 PKCE cookie 恰好缺失（下面的 fallback 曾允许"无 PKCE 继续"），
    // 就存在登录 CSRF / 会话混淆的空间。现在 state 是**强制**的：
    // cookie 不存在或不一致一律拒绝，不再有"仅告警继续"的路径。
    const savedState = request.cookies.get("google-oauth-state")?.value;
    console.log("[Google OAuth Callback] Saved state present:", !!savedState);
    console.log("[Google OAuth Callback] State match:", !!savedState && savedState === state);

    if (!state || !savedState || savedState !== state) {
      console.error("[Google OAuth Callback] State verification failed — rejecting (possible CSRF)");
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "Security check failed. Please start the sign-in again.");
      const failure = NextResponse.redirect(loginUrl);
      failure.cookies.set("google-oauth-state", "", { maxAge: 0, path: "/" });
      failure.cookies.set("google-pkce-verifier", "", { maxAge: 0, path: "/" });
      return failure;
    }

    // Step 2: Read PKCE code_verifier from our custom cookie
    // Set by /api/auth/oauth/google/signin (plain-text, NOT JWE-encrypted like NextAuth's)
    const codeVerifier = request.cookies.get("google-pkce-verifier")?.value;

    console.log("[Google OAuth Callback] 🔍 code_verifier present:", !!codeVerifier, "length:", codeVerifier?.length || 0);

    // ⚠️ PKCE 现在是强制的。此前这里只 console.warn 然后继续，
    // 使 code_challenge 形同装饰。signin 端点在同一响应里就写下了 cookie，
    // 因此"读不到"只可能意味着：浏览器禁用了 cookie、超过 30 分钟、或有人在
    // 伪造回调 —— 三种情况都应该拒绝而不是静默降级。
    if (!codeVerifier) {
      console.error("[Google OAuth Callback] Missing PKCE code_verifier cookie — rejecting");
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "Sign-in session expired. Please try again.");
      return NextResponse.redirect(loginUrl);
    }

    // Step 3: Exchange code for tokens
    // NOTE: The redirect_uri MUST match what was used in the authorization request.
    // The signin handler sends /api/auth/callback/google (matching Google Cloud Console).
    // Token exchange MUST use the same redirect_uri.
    const redirectUri = `${request.nextUrl.origin}/api/auth/callback/google`;

    console.log("[Google OAuth Callback] Redirect URI (for token exchange):", redirectUri);

    let tokenResponse;
    try {
      console.log("[Google OAuth Callback] Exchanging code for tokens...");
      tokenResponse = await exchangeCodeForTokens({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        redirectUri,
        code,
        codeVerifier,
      });
      console.log("[Google OAuth Callback] Token exchange successful, got id_token:", !!tokenResponse.id_token);
    } catch (err: any) {
      console.error("[Google OAuth Callback] Token exchange error:", err.message);
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "Google token exchange failed. Please try again.");
      return NextResponse.redirect(loginUrl);
    }

    // Step 4: Decode ID token to get user info
    let googleUser;
    try {
      googleUser = decodeIdToken(tokenResponse.id_token);
    } catch (err: any) {
      console.error("[Google OAuth Callback] ID token decode error:", err.message);
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "Google token decode failed");
      return NextResponse.redirect(loginUrl);
    }

    console.log("[Google OAuth Callback] Got user:", googleUser.sub, googleUser.email, googleUser.name);

    // Step 5: Find or create user in DB (OPTIMIZED — single query when possible)
    const normalizedEmail = googleUser.email.toLowerCase().trim();
    const userName = googleUser.name || googleUser.email.split("@")[0];
    const avatar = googleUser.picture || null;

    // Fast path: try to find existing account first (most common case)
    let user;
    const existingAccount = await db.account.findUnique({
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
      const updates: any = {};
      if (userName && (!existingAccount.user.name || existingAccount.user.name === existingAccount.user.email)) {
        updates.name = userName;
      }
      if (avatar && !existingAccount.user.image) {
        updates.image = avatar;
      }
      if (googleUser.email_verified && !existingAccount.user.emailVerified) {
        updates.emailVerified = new Date();
      }
      if (Object.keys(updates).length > 0) {
        await db.user.update({
          where: { id: existingAccount.userId },
          data: updates,
        });
      }
      user = existingAccount.user;
    } else {
      // Check by email
      const existingUser = await db.user.findUnique({
        where: { email: normalizedEmail },
      });

      if (existingUser) {
        // Link Google account
        await db.account.create({
          data: {
            userId: existingUser.id,
            type: "oauth",
            provider: "google",
            providerAccountId: googleUser.sub,
          },
        });
        // Update user info
        const updates: any = {};
        if (userName) updates.name = userName;
        if (avatar) updates.image = avatar;
        if (googleUser.email_verified) updates.emailVerified = new Date();
        if (Object.keys(updates).length > 0) {
          await db.user.update({ where: { id: existingUser.id }, data: updates });
        }
        user = existingUser;
      } else {
        // Create new user + profile in transaction
        user = await db.$transaction(async (tx) => {
          const newUser = await tx.user.create({
            data: {
              email: normalizedEmail,
              name: userName,
              image: avatar,
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
      }
    }

    // Step 6: Create NextAuth-compatible JWT session token directly
    const secret = process.env.AUTH_SECRET;
    if (!secret) {
      console.error("[Google OAuth Callback] AUTH_SECRET not configured");
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "Server configuration error");
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
      tokenVersion: user.tokenVersion || 0,
    };

    const sessionToken = await encode({
      token: tokenPayload,
      secret,
      salt: COOKIE_NAME,
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    // Step 7: Redirect to dashboard with session cookie
    const rawCb = request.cookies.get("google-callback-url")?.value
      || request.cookies.get("__Secure-authjs.callback-url")?.value
      || request.cookies.get("authjs.callback-url")?.value
      || "/dashboard";
    const callbackUrl = isSafeRedirect(rawCb) ? rawCb : "/dashboard";
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

    // Clear OAuth cookies (both our custom ones and NextAuth's)
    response.cookies.set("google-pkce-verifier", "", { maxAge: 0, path: "/" });
    response.cookies.set("google-oauth-state", "", { maxAge: 0, path: "/" });
    response.cookies.set("google-callback-url", "", { maxAge: 0, path: "/" });
    response.cookies.set("__Secure-authjs.pkce.code_verifier", "", { maxAge: 0, path: "/" });
    response.cookies.set("authjs.pkce.code_verifier", "", { maxAge: 0, path: "/" });
    response.cookies.set("__Secure-authjs.callback-url", "", { maxAge: 0, path: "/" });
    response.cookies.set("authjs.callback-url", "", { maxAge: 0, path: "/" });
    response.cookies.set("__Host-authjs.csrf-token", "", { maxAge: 0, path: "/" });
    response.cookies.set("authjs.csrf-token", "", { maxAge: 0, path: "/" });

    console.log("[Google OAuth Callback] Success! User:", user.id, user.email, "→", destination);

    return response;
  } catch (error: any) {
    // 生成唯一的错误ID用于追踪
    const errorId = `oauth_google_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    
    // 详细记录错误信息
    console.error("[Google OAuth Callback] ❌ Fatal error:", {
      errorId,
      message: error.message,
      stack: error.stack,
      code: error.code,
      metadata: error.metadata,
    });

    // 根据错误类型提供更好的错误信息
    let userMessage = "Google login failed. Please try again.";
    
    if (error.message?.includes("token exchange failed")) {
      userMessage = "Failed to connect to Google. Please try again.";
    } else if (error.message?.includes("ID token decode failed")) {
      userMessage = "Failed to verify Google account. Please try again.";
    } else if (error.message?.includes("database")) {
      userMessage = "Server error. Please contact support.";
    } else if (error.message?.includes("AUTH_SECRET")) {
      userMessage = "Server configuration error. Please contact support.";
    }

    // 重定向到登录页面，附带错误信息和错误ID
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", userMessage);
    loginUrl.searchParams.set("errorId", errorId);
    
    console.error(`[Google OAuth Callback] ❌ Error ID: ${errorId} - Redirecting to login with error: ${userMessage}`);
    
    return NextResponse.redirect(loginUrl);
  }
}
