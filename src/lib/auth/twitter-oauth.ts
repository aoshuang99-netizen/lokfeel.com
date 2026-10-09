/**
 * Twitter OAuth 2.0 + PKCE Utilities
 *
 * Implements Twitter OAuth 2.0 with PKCE (Proof Key for Code Exchange).
 * This bypasses Firebase Auth entirely for X/Twitter sign-in.
 *
 * Flow:
 * 1. Generate PKCE code_verifier + code_challenge
 * 2. Redirect user to Twitter authorization URL
 * 3. User authorizes, Twitter redirects back with code
 * 4. Exchange code + code_verifier for access_token
 * 5. Use access_token to fetch user info from Twitter API v2
 *
 * Env vars required:
 * - TWITTER_CLIENT_ID: OAuth 2.0 Client ID
 * - TWITTER_CLIENT_SECRET: OAuth 2.0 Client Secret
 */

import { createHash, randomBytes } from "crypto";

// ─── Twitter OAuth 2.0 endpoints ───
const TWITTER_AUTH_URL = "https://twitter.com/i/oauth2/authorize";
const TWITTER_TOKEN_URL = "https://api.twitter.com/2/oauth2/token";
const TWITTER_USERINFO_URL = "https://api.twitter.com/2/users/me";

// ─── PKCE helpers ───

/**
 * Generate a PKCE code verifier (43-128 chars, URL-safe)
 */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Generate PKCE code challenge (S256 = base64url(SHA256(code_verifier)))
 */
export function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

// ─── Authorization URL ───

/**
 * Build the Twitter OAuth 2.0 authorization URL with PKCE
 */
export function buildAuthorizationUrl(options: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  scopes?: string[];
}): string {
  const scopes = options.scopes || ["tweet.read", "users.read", "offline.access"];

  const params = new URLSearchParams({
    response_type: "code",
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    scope: scopes.join(" "),
    state: options.state,
    code_challenge: options.codeChallenge,
    code_challenge_method: "S256",
  });

  return `${TWITTER_AUTH_URL}?${params.toString()}`;
}

// ─── Token exchange ───

interface TwitterTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

/**
 * Exchange authorization code + code_verifier for access token
 * client_secret is OPTIONAL (some Twitter apps support public clients)
 * If clientSecret is empty, omits it from the request
 */
export async function exchangeCodeForToken(options: {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
}): Promise<TwitterTokenResponse> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code: options.code,
    redirect_uri: options.redirectUri,
    code_verifier: options.codeVerifier,
    client_id: options.clientId,
  });

  // Only include client_secret if provided
  if (options.clientSecret && options.clientSecret.length > 0) {
    params.append("client_secret", options.clientSecret);
  }

  const response = await fetch(TWITTER_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[Twitter OAuth] Token exchange failed:", response.status, errorText);
    throw new Error(`Twitter token exchange failed: ${response.status}`);
  }

  // Twitter may return JSON or form-encoded
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return await response.json();
  }

  // Parse form-encoded response
  const text = await response.text();
  const pairs = text.split("&");
  const result: Record<string, string> = {};
  for (const pair of pairs) {
    const [key, value] = pair.split("=");
    if (key && value) {
      result[key] = decodeURIComponent(value.replace(/\+/g, " "));
    }
  }
  return result as unknown as TwitterTokenResponse;
}

// ─── User info ───

export interface TwitterUserInfo {
  id: string;
  username: string;
  name: string;
  profileImageUrl?: string;
  verified?: boolean;
  email?: string;
}

/**
 * Fetch user info from Twitter API v2 using access token
 */
export async function fetchUserInfo(accessToken: string): Promise<TwitterUserInfo> {
  const url = `${TWITTER_USERINFO_URL}?user.fields=profile_image_url,name,verified`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[Twitter OAuth] User info fetch failed:", response.status, errorText);
    throw new Error(`Twitter user info fetch failed: ${response.status}`);
  }

  const json = await response.json();

  // Twitter API v2 wraps data in "data" object
  const data = json.data;
  if (!data?.id) {
    throw new Error("Invalid Twitter user info response");
  }

  return {
    id: String(data.id),
    username: data.username || "",
    name: data.name || data.username || "",
    profileImageUrl: data.profile_image_url?.replace("_normal", "_400x400"),
    verified: data.verified || false,
    email: data.email || null,
  };
}

// ─── Callback URL（单一来源） ───

/**
 * Twitter 回调路径的**单一来源**。
 *
 * 为什么必须收敛：授权请求里的 `redirect_uri` 与换取令牌时的 `redirect_uri`
 * 按 RFC 6749 §4.1.3 **必须完全一致**，否则 Twitter 会拒绝换取令牌，
 * 而且报错发生在用户**已经点完授权之后** —— 表现为"授权成功却登录失败"，
 * 极易被误判成网络或 scope 问题。
 *
 * 本仓库历史上有多处各自拼接 `redirect_uri`，其中
 * `/api/auth/twitter/signin` 授权时声明的是 `/api/auth/oauth/twitter/callback`，
 * 而它最终落到的那条回调换取令牌时却用了 `/api/auth/twitter/callback`
 * —— 两者不一致，该链路**永远换不到令牌**。
 *
 * 现在所有拼接都经本函数。若要与 Twitter 开发者后台登记的地址对齐，
 * 只需设置环境变量 `TWITTER_OAUTH_CALLBACK_PATH`（例如
 * `/api/auth/twitter/callback`），无需改代码。
 */
export const DEFAULT_TWITTER_CALLBACK_PATH = '/api/auth/oauth/twitter/callback';

/** 解析当前生效的 Twitter 回调路径（env 优先；非法值静默回落默认）。 */
export function twitterCallbackPath(): string {
  const raw = process.env.TWITTER_OAUTH_CALLBACK_PATH?.trim();
  if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return DEFAULT_TWITTER_CALLBACK_PATH;
}

/**
 * 拼出完整的 Twitter 回调 URL。
 * 授权请求与换取令牌**都必须**用这一个函数的结果。
 */
export function twitterCallbackUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${twitterCallbackPath()}`;
}

// ─── Config validation ───

export function getTwitterConfig(): { clientId: string; clientSecret: string; valid: boolean } {
  const clientId = process.env.TWITTER_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.TWITTER_CLIENT_SECRET?.trim() || "";
  // Only require clientId — clientSecret is optional for some flows
  const valid = clientId.length > 0;
  return { clientId, clientSecret, valid };
}
