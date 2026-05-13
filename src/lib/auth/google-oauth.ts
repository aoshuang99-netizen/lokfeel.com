/**
 * Google OAuth 2.0 + PKCE Utilities
 *
 * Implements Google OAuth 2.0 with PKCE (Proof Key for Code Exchange).
 * This bypasses NextAuth's built-in Google callback handler which throws
 * Configuration errors on Vercel cold starts.
 *
 * Flow:
 * 1. Authorization code comes from Google redirect (already handled by NextAuth signin)
 * 2. Exchange code + code_verifier for tokens (id_token + access_token)
 * 3. Decode id_token to get user profile (no API call needed)
 * 4. Find or create user in database
 * 5. Create NextAuth JWT session token directly (bypasses NextAuth callbacks)
 *
 * Env vars required (already configured in Vercel Production):
 * - GOOGLE_CLIENT_ID: OAuth 2.0 Client ID
 * - GOOGLE_CLIENT_SECRET: OAuth 2.0 Client Secret
 */

// ─── Google OAuth 2.0 endpoints ───
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

// ─── Token exchange ───

interface GoogleTokenResponse {
  access_token: string;
  id_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  refresh_token?: string;
}

/**
 * Exchange authorization code for tokens
 * Uses PKCE code_verifier from cookie
 */
export async function exchangeCodeForTokens(options: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
}): Promise<GoogleTokenResponse> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code: options.code,
    redirect_uri: options.redirectUri,
    code_verifier: options.codeVerifier,
    client_id: options.clientId,
    client_secret: options.clientSecret,
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[Google OAuth] Token exchange failed:", response.status, errorText);
    throw new Error(`Google token exchange failed: ${response.status} — ${errorText.substring(0, 200)}`);
  }

  return await response.json();
}

// ─── ID Token decoding (JWT) ───

export interface GoogleUserInfo {
  sub: string;           // Google user ID
  email: string;
  email_verified: boolean;
  name: string;
  given_name?: string;
  family_name?: string;
  picture?: string;      // Avatar URL
  locale?: string;
  hd?: string;           // Hosted domain (Google Workspace)
}

/**
 * Decode Google ID token (JWT) to extract user info
 * No API call needed — the ID token contains all user claims
 */
export function decodeIdToken(idToken: string): GoogleUserInfo {
  const parts = idToken.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid ID token format");
  }

  // Decode base64url payload
  const payload = parts[1];
  const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
  const decoded = Buffer.from(padded, "base64").toString("utf-8");
  const claims = JSON.parse(decoded);

  return {
    sub: claims.sub,
    email: claims.email || "",
    email_verified: claims.email_verified || false,
    name: claims.name || "",
    given_name: claims.given_name,
    family_name: claims.family_name,
    picture: claims.picture,
    locale: claims.locale,
    hd: claims.hd,
  };
}

// ─── Config validation ───

export function getGoogleConfig(): { clientId: string; clientSecret: string; valid: boolean } {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || "";
  const valid = clientId.length > 0 && clientSecret.length > 0;
  return { clientId, clientSecret, valid };
}
