/**
 * Twitter OAuth 2.0 Callback Endpoint
 *
 * GET /api/auth/twitter/callback?code=...&state=...
 *
 * Flow:
 * 1. Verify state from cookie (CSRF protection)
 * 2. Read code_verifier from cookie (PKCE)
 * 3. Exchange code + code_verifier for access_token
 * 4. Fetch user info from Twitter API v2
 * 5. Find or create user in database
 * 6. Generate one-time sign-in token
 * 7. Render auto-submitting HTML page that completes NextAuth sign-in
 */

import { NextRequest, NextResponse } from "next/server";
import {
  exchangeCodeForToken,
  fetchUserInfo,
  getTwitterConfig,
} from "@/lib/auth/twitter-oauth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const config = getTwitterConfig();

    // Step 1: Extract code and state from query params
    const { searchParams } = request.nextUrl;
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");

    if (error) {
      const errorDesc = searchParams.get("error_description") || error;
      console.error("[Twitter OAuth] Authorization error:", errorDesc);
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", `Twitter 授权失败: ${errorDesc}`);
      return NextResponse.redirect(loginUrl);
    }

    if (!code || !state) {
      console.error("[Twitter OAuth] Missing code or state");
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "Twitter 回调缺少必要参数");
      return NextResponse.redirect(loginUrl);
    }

    // Step 2: Verify state (CSRF protection)
    const savedState = request.cookies.get("twitter-oauth-state")?.value;
    if (!savedState || savedState !== state) {
      console.error("[Twitter OAuth] State mismatch — possible CSRF attack");
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "安全验证失败，请重试");
      return NextResponse.redirect(loginUrl);
    }

    // Step 3: Read PKCE code_verifier
    const codeVerifier = request.cookies.get("twitter-pkce-verifier")?.value;
    if (!codeVerifier) {
      console.error("[Twitter OAuth] Missing PKCE code_verifier");
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "PKCE 验证失败，请重试");
      return NextResponse.redirect(loginUrl);
    }

    // Step 4: Exchange code for access token
    const redirectUri = `${request.nextUrl.origin}/api/auth/twitter/callback`;

    let tokenResponse;
    try {
      tokenResponse = await exchangeCodeForToken({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        redirectUri,
        code,
        codeVerifier,
      });
    } catch (err: any) {
      console.error("[Twitter OAuth] Token exchange error:", err.message);
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "Twitter 令牌交换失败");
      return NextResponse.redirect(loginUrl);
    }

    // Step 5: Fetch user info
    let twitterUser;
    try {
      twitterUser = await fetchUserInfo(tokenResponse.access_token);
    } catch (err: any) {
      console.error("[Twitter OAuth] User info fetch error:", err.message);
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "获取 Twitter 用户信息失败");
      return NextResponse.redirect(loginUrl);
    }

    console.log("[Twitter OAuth] Got user:", twitterUser.id, "@", twitterUser.username);

    // Step 6: Find or create user in DB
    const normalizedEmail = twitterUser.email || `${twitterUser.username}@twitter.lokfeel.com`;
    const userName = twitterUser.name || `@${twitterUser.username}`;
    const avatar = twitterUser.profileImageUrl || null;

    const user = await db.$transaction(async (tx) => {
      // Check existing user by Twitter account
      const existingAccount = await tx.account.findUnique({
        where: {
          provider_providerAccountId: {
            provider: "twitter",
            providerAccountId: twitterUser.id,
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
              emailVerified: new Date(),
            },
          });
        }
        return existingAccount.user;
      }

      // Check by email
      const existingUser = await tx.user.findUnique({
        where: { email: normalizedEmail.toLowerCase().trim() },
        include: { accounts: true, profile: true },
      });

      if (existingUser) {
        // Link Twitter account
        const hasTwitterAccount = existingUser.accounts.some(
          (a) => a.provider === "twitter" && a.providerAccountId === twitterUser.id
        );
        if (!hasTwitterAccount) {
          await tx.account.create({
            data: {
              userId: existingUser.id,
              type: "oauth",
              provider: "twitter",
              providerAccountId: twitterUser.id,
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
              emailVerified: new Date(),
            },
          });
        }
        return existingUser;
      }

      // Create new user
      const newUser = await tx.user.create({
        data: {
          email: normalizedEmail.toLowerCase().trim(),
          name: userName,
          image: avatar,
          emailVerified: new Date(),
        },
      });

      // Create Account record
      await tx.account.create({
        data: {
          userId: newUser.id,
          type: "oauth",
          provider: "twitter",
          providerAccountId: twitterUser.id,
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

    // Step 7: Generate one-time sign-in token (reuse firebase-token provider)
    const signInToken = `fb_${user.id}_${crypto.randomUUID().replace(/-/g, "")}_${Date.now()}`;

    await db.verificationToken.create({
      data: {
        identifier: `firebase:${user.id}`,
        token: signInToken,
        expires: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
      },
    });

    // Get callback URL from cookie
    const callbackUrl = request.cookies.get("twitter-callback-url")?.value || "/dashboard";

    // Step 8: Return HTML that auto-signs in via NextAuth
    // Uses a hidden form that POSTs to /api/auth/callback/firebase-token
    // This approach is more reliable than fetch + CDN imports because:
    // - Form submissions always send cookies (including CSRF)
    // - No CDN dependencies that could be blocked
    // - Works with strict CSP policies
    const escapedCallback = callbackUrl.replace(/'/g, "\\'").replace(/"/g, '&quot;');
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Signing in...</title></head>
<body>
<noscript><p style="text-align:center;padding:40px;color:#aaa">JavaScript is required. Please enable it and refresh.</p></noscript>
<div id="loading" style="text-align:center;padding:40px;color:#aaa;font-family:system-ui">Signing in with X...</div>
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

    // Clear OAuth cookies (but preserve session cookies for the form POST)
    const response = new NextResponse(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
    // Set cookies to expire immediately rather than delete
    // This ensures the form POST still works on the same page
    response.cookies.set("twitter-pkce-verifier", "", { maxAge: 0, path: "/" });
    response.cookies.set("twitter-oauth-state", "", { maxAge: 0, path: "/" });
    response.cookies.set("twitter-callback-url", "", { maxAge: 0, path: "/" });

    return response;
  } catch (error) {
    console.error("[Twitter OAuth] Callback error:", error);
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", "Twitter 登录过程中发生错误");
    return NextResponse.redirect(loginUrl);
  }
}
