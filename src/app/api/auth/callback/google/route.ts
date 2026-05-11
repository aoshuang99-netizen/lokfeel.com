/**
 * Google OAuth 2.0 Callback Endpoint
 *
 * GET /api/auth/callback/google?code=...&state=...
 *
 * This CUSTOM handler replaces NextAuth's built-in Google callback
 * to fix the NextAuth v5 beta bug where render.signin(providerId)
 * throws UnknownAction, causing error=Configuration.
 *
 * Flow:
 * 1. Verify state from cookie (CSRF protection) — set by our custom signin
 * 2. Exchange code for tokens (id_token + access_token) with Google
 * 3. Decode id_token to get user info (email, name, picture)
 * 4. Find or create user in database
 * 5. Generate one-time sign-in token for firebase-token provider
 * 6. Render auto-submitting HTML page that completes NextAuth sign-in
 *
 * This mirrors the Twitter OAuth callback pattern for consistency.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Google OAuth endpoints
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

interface GoogleTokenResponse {
  access_token: string;
  id_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
  picture: string;
  given_name?: string;
  family_name?: string;
  locale?: string;
}

/**
 * Decode JWT payload without verification (we trust Google's signature
 * since we fetched the tokens directly from Google's token endpoint).
 */
function decodeJwtPayload(token: string): Record<string, any> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Invalid JWT format");
    const payload = parts[1];
    // Base64url decode
    const decoded = Buffer.from(
      payload.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf-8");
    return JSON.parse(decoded);
  } catch (err) {
    console.error("[Google OAuth] JWT decode error:", err);
    throw new Error("Failed to decode Google ID token");
  }
}

export async function GET(request: NextRequest) {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

    if (!clientId || !clientSecret) {
      console.error("[Google OAuth] Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET");
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "Google OAuth not configured");
      return NextResponse.redirect(loginUrl);
    }

    // Step 1: Extract code and state from query params
    const { searchParams } = request.nextUrl;
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");

    if (error) {
      const errorDesc = searchParams.get("error_description") || error;
      console.error("[Google OAuth] Authorization error:", errorDesc);
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "Google authorization failed");
      return NextResponse.redirect(loginUrl);
    }

    if (!code || !state) {
      console.error("[Google OAuth] Missing code or state");
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "Google callback missing parameters");
      return NextResponse.redirect(loginUrl);
    }

    // Step 2: Verify state (CSRF protection)
    const savedState = request.cookies.get("auth-google-state")?.value;
    if (!savedState || savedState !== state) {
      console.error("[Google OAuth] State mismatch — possible CSRF attack");
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "Security verification failed. Please try again.");
      return NextResponse.redirect(loginUrl);
    }

    // Step 3: Exchange code for tokens
    const redirectUri = `${request.nextUrl.origin}/api/auth/callback/google`;

    let tokenResponse: GoogleTokenResponse;
    try {
      const tokenParams = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      });

      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenParams.toString(),
      });

      if (!tokenRes.ok) {
        const errorText = await tokenRes.text();
        console.error("[Google OAuth] Token exchange failed:", tokenRes.status, errorText);
        throw new Error(`Google token exchange failed: ${tokenRes.status}`);
      }

      tokenResponse = await tokenRes.json();
    } catch (err: any) {
      console.error("[Google OAuth] Token exchange error:", err.message);
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "Google token exchange failed");
      return NextResponse.redirect(loginUrl);
    }

    // Step 4: Decode ID token to get user info
    let googleUser: GoogleUserInfo;
    try {
      const decoded = decodeJwtPayload(tokenResponse.id_token);
      googleUser = {
        sub: decoded.sub,
        email: decoded.email,
        email_verified: decoded.email_verified || false,
        name: decoded.name || "",
        picture: decoded.picture || "",
        given_name: decoded.given_name,
        family_name: decoded.family_name,
        locale: decoded.locale,
      };
    } catch (err: any) {
      console.error("[Google OAuth] ID token decode error:", err.message);
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "Failed to verify Google account");
      return NextResponse.redirect(loginUrl);
    }

    console.log("[Google OAuth] Got user:", googleUser.sub, googleUser.email);

    if (!googleUser.email) {
      console.error("[Google OAuth] No email in Google profile");
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "Google account has no email. Please use email/password login.");
      return NextResponse.redirect(loginUrl);
    }

    // Step 5: Find or create user in DB
    const normalizedEmail = googleUser.email.toLowerCase().trim();
    const userName = googleUser.name || googleUser.email.split("@")[0];
    const avatar = googleUser.picture?.replace("=s96-c", "=s400-c") || null; // Get higher res avatar

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
              emailVerified: googleUser.email_verified ? new Date() : undefined,
            },
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
              emailVerified: googleUser.email_verified ? new Date() : undefined,
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

    // Step 6: Generate one-time sign-in token (reuse firebase-token provider)
    const signInToken = `fb_${user.id}_${crypto.randomUUID().replace(/-/g, "")}_${Date.now()}`;

    await db.verificationToken.create({
      data: {
        identifier: `firebase:${user.id}`,
        token: signInToken,
        expires: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
      },
    });

    // Get callback URL from cookie
    const callbackUrl = request.cookies.get("auth-google-callback")?.value || "/dashboard";

    // Step 7: Return HTML that auto-signs in via NextAuth
    // Uses a hidden form that POSTs to /api/auth/callback/firebase-token
    const escapedCallback = callbackUrl.replace(/'/g, "\\'").replace(/"/g, "&quot;");
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Signing in...</title></head>
<body>
<noscript><p style="text-align:center;padding:40px;color:#aaa">JavaScript is required. Please enable it and refresh.</p></noscript>
<div id="loading" style="text-align:center;padding:40px;color:#aaa;font-family:system-ui">Signing in with Google...</div>
<script>
(function() {
  // Fetch CSRF token first (needed for NextAuth form POST)
  fetch('/api/auth/csrf', { credentials: 'include' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.csrfToken) throw new Error('No CSRF token');
      // Create and submit a hidden form
      var form = document.createElement('form');
      form.method = 'POST';
      form.action = '/api/auth/callback/firebase-token';
      form.style.display = 'none';
      // CSRF token
      var csrf = document.createElement('input');
      csrf.type = 'hidden'; csrf.name = 'csrfToken'; csrf.value = data.csrfToken;
      form.appendChild(csrf);
      // Sign-in token
      var token = document.createElement('input');
      token.type = 'hidden'; token.name = 'token'; token.value = '${signInToken}';
      form.appendChild(token);
      // User ID
      var userId = document.createElement('input');
      userId.type = 'hidden'; userId.name = 'userId'; userId.value = '${user.id}';
      form.appendChild(userId);
      // Callback URL
      var cb = document.createElement('input');
      cb.type = 'hidden'; cb.name = 'callbackUrl'; cb.value = '${escapedCallback}';
      form.appendChild(cb);
      document.body.appendChild(form);
      form.submit();
    })
    .catch(function(e) {
      document.getElementById('loading').textContent = 'Sign-in error: ' + e.message;
      setTimeout(function() { window.location.href = '/login?error=' + encodeURIComponent('Sign-in failed'); }, 2000);
    });
})();
</script>
</body></html>`;

    // Clear OAuth cookies
    const response = new NextResponse(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
    response.cookies.set("auth-google-state", "", { maxAge: 0, path: "/" });
    response.cookies.set("auth-google-callback", "", { maxAge: 0, path: "/" });

    return response;
  } catch (error) {
    console.error("[Google OAuth] Callback error:", error);
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", "Google sign-in failed. Please try again.");
    return NextResponse.redirect(loginUrl);
  }
}
