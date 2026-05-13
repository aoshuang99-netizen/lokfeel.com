/**
 * Google OAuth 2.0 + PKCE Utilities
 *
 * Implements Google OAuth 2.0 with PKCE (Proof Key for Code Exchange).
 * This bypasses NextAuth's built-in Google signin/callback handlers which
 * fail on Vercel due to JWE-encrypted PKCE cookies.
 *
 * Flow:
 * 1. /api/auth/google/signin generates our own PKCE + redirects to Google
 * 2. Google redirects back with authorization code
 * 3. Custom callback exchanges code + our code_verifier for tokens
 * 4. Decode id_token to get user profile (no API call needed)
 * 5. Find or create user in database
 * 6. Create NextAuth JWT session token directly
 *
 * Env vars required (already configured in Vercel Production):
 * - GOOGLE_CLIENT_ID: OAuth 2.0 Client ID
 * - GOOGLE_CLIENT_SECRET: OAuth 2.0 Client Secret
 */

import { createHash, randomBytes } from "crypto";

// ─── Google OAuth 2.0 endpoints ───
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

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
 * Build the Google OAuth 2.0 authorization URL with PKCE
 */
export function buildGoogleAuthorizationUrl(options: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes?: string[];
}): string {
  const scopes = options.scopes || ["openid", "email", "profile"];

  const params = new URLSearchParams({
    response_type: "code",
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    scope: scopes.join(" "),
    code_challenge: options.codeChallenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

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
 * Uses client_secret for confidential client auth (no PKCE needed)
 * codeVerifier is optional — Google accepts confidential client auth without PKCE
 */
export async function exchangeCodeForTokens(options: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  codeVerifier?: string;
}): Promise<GoogleTokenResponse> {
  const params: Record<string, string> = {
    grant_type: "authorization_code",
    code: options.code,
    redirect_uri: options.redirectUri,
    client_id: options.clientId,
    client_secret: options.clientSecret,
  };

  // Only include code_verifier if explicitly provided
  // (For Google confidential clients, PKCE is not required when client_secret is present)
  if (options.codeVerifier) {
    params.code_verifier = options.codeVerifier;
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
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
