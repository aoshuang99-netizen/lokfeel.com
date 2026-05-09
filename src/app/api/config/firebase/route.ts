/**
 * Firebase Client Config API
 *
 * GET /api/config/firebase
 *
 * Returns the Firebase client configuration from server-side environment variables.
 * This is needed because NEXT_PUBLIC_* env vars may be empty at build time on Vercel
 * (Vercel sometimes masks encrypted values during build), but the server-side env
 * vars are always available at runtime.
 *
 * Also returns googleClientId for Google Identity Services (GIS) flow.
 * GIS needs a Google OAuth 2.0 Client ID (NOT the Firebase App ID).
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "",
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "",
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "",
  };

  // Google OAuth Client ID for GIS (Google Identity Services)
  // This is different from Firebase App ID.
  // Set NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID in Vercel env.
  // Format: "1054088598785-xxxx.apps.googleusercontent.com"
  // Can be found in Google Cloud Console → APIs & Services → Credentials
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID || "";

  // Check if config is usable (at least apiKey and projectId must be set)
  const isValid = config.apiKey.length > 0 && config.projectId.length > 0;

  return NextResponse.json({
    config,
    googleClientId,
    valid: isValid,
  });
}
