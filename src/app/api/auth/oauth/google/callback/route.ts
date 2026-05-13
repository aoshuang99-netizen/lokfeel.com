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
 * 1. Extract authorization code from query params
 * 2. Read PKCE code_verifier from our custom cookie
 * 3. Exchange code + code_verifier + client_secret for Google tokens
 * 4. Decode id_token to get user profile
 * 5. Find or create user in database
 * 6. Create NextAuth JWT session token directly
 * 7. Redirect to dashboard with session cookie
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
      loginUrl.searchParams.set("error", "Google OAuth not configured. Please contact support.");
      return NextResponse.redirect(loginUrl);
    }

    // Step 1: Extract code from query params
    const { searchParams } = request.nextUrl;
    const code = searchParams.get("code");
    const error = searchParams.get("error");

    if (error) {
      const errorDesc = searchParams.get("error_description") || error;
      console.error("[Google OAuth Callback] Authorization error:", errorDesc);
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

    // Step 2: Read PKCE code_verifier from our custom cookie
    // Set by /api/auth/oauth/google/signin (plain-text, NOT JWE-encrypted like NextAuth's)
    const codeVerifier = request.cookies.get("google-pkce-verifier")?.value;

    if (!codeVerifier) {
      console.warn("[Google OAuth Callback] Missing google-pkce-verifier cookie — attempting without PKCE");
    }

    // Step 3: Exchange code for tokens
    // NOTE: The redirect_uri MUST match what was used in the authorization request
    const redirectUri = `${request.nextUrl.origin}/api/auth/callback/google`;

    let tokenResponse;
    try {
      tokenResponse = await exchangeCodeForTokens({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        redirectUri,
        code,
        codeVerifier: codeVerifier || undefined,
      });
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
    };

    const sessionToken = await encode({
      token: tokenPayload,
      secret,
      salt: COOKIE_NAME,
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    // Step 7: Redirect to dashboard with session cookie
    const callbackUrl = request.cookies.get("google-callback-url")?.value
      || request.cookies.get("__Secure-authjs.callback-url")?.value
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

    // Clear OAuth cookies (both our custom ones and NextAuth's)
    response.cookies.set("google-pkce-verifier", "", { maxAge: 0, path: "/" });
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
    console.error("[Google OAuth Callback] Fatal error:", error);
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", `Google login error: ${error.message?.substring(0, 50) || 'Unknown error'}`);
    return NextResponse.redirect(loginUrl);
  }
}
