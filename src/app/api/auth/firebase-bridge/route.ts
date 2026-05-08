/**
 * Firebase-to-NextAuth Bridge API
 *
 * POST /api/auth/firebase-bridge
 * Body: { idToken: string }
 *
 * Flow:
 * 1. Verify Firebase ID token with Admin SDK
 * 2. Extract user info (email, name, picture, uid)
 * 3. Find existing User by email, or create new User + Profile
 * 4. Link Firebase Account record
 * 5. Generate one-time sign-in token (raw, stored directly — protected by 5-min TTL + single-use)
 * 6. Return token + userId for client to complete NextAuth sign-in via "firebase-token" provider
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyFirebaseToken } from "@/lib/firebase/admin";

// Simple rate limiter (in-memory, per-IP)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60_000; // 1 minute
const RATE_LIMIT_MAX = 10; // 10 requests per window

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";
    if (isRateLimited(ip)) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { idToken } = body;

    if (!idToken || typeof idToken !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid idToken" },
        { status: 400 }
      );
    }

    // Step 1: Verify Firebase ID token
    const decoded = await verifyFirebaseToken(idToken);
    if (!decoded) {
      return NextResponse.json(
        { error: "Invalid or expired Firebase token" },
        { status: 401 }
      );
    }

    const {
      uid: firebaseUid,
      email: firebaseEmail,
      email_verified,
      name: firebaseName,
      picture: firebasePicture,
      provider_data,
      firebase,
    } = decoded;

    // Resolve email with fallbacks
    // Priority: decoded.email → provider_data[0].email → firebase.identities.email[0]
    let email = firebaseEmail
      || (Array.isArray(provider_data) && provider_data[0]?.email)
      || (firebase?.identities as any)?.email?.[0]
      || null;

    if (!email) {
      // Log available fields for debugging (never log PII to client)
      console.error(
        "[Firebase Bridge] No email found in token.",
        "uid:", firebaseUid,
        "signInProvider:", firebase?.sign_in_provider,
        "hasProviderData:", !!provider_data,
        "providerCount:", Array.isArray(provider_data) ? provider_data.length : 0,
        "identities:", firebase?.identities ? JSON.stringify(Object.keys(firebase.identities)) : "none",
      );
      return NextResponse.json(
        { error: "Firebase account has no email address. Please ensure your Google/X account has a verified email." },
        { status: 400 }
      );
    }

    if (!email_verified && !firebaseEmail) {
      // Unverified email from fallback source — allow but warn
      console.warn(`[Firebase Bridge] Using unverified email from provider_data for uid=${firebaseUid}`);
    }

    // Step 2: Find or create user
    const normalizedEmail = email.toLowerCase().trim();
    const displayName = firebaseName || email.split("@")[0];
    const avatar = firebasePicture || null;

    // Determine the OAuth provider from Firebase
    const firebaseProvider = Array.isArray(provider_data) && provider_data.length > 0
      ? provider_data[0].providerId // "google.com", "twitter.com", "apple.com", etc.
      : firebase?.sign_in_provider || "firebase";

    // Normalize provider name for Account model
    const accountProvider = firebaseProvider === "google.com"
      ? "firebase-google"
      : firebaseProvider === "apple.com"
        ? "firebase-apple"
        : firebaseProvider === "twitter.com"
          ? "firebase-twitter"
          : `firebase-${firebaseProvider}`;

    // Use Prisma transaction for atomicity
    const user = await db.$transaction(async (tx) => {
      // Check if user already exists by email
      const existingUser = await tx.user.findUnique({
        where: { email: normalizedEmail },
        include: { accounts: true, profile: true },
      });

      if (existingUser) {
        // Check if this Firebase account is already linked
        const hasFirebaseAccount = existingUser.accounts.some(
          (a) => a.provider === accountProvider && a.providerAccountId === firebaseUid
        );

        if (!hasFirebaseAccount) {
          // Link Firebase account to existing user
          await tx.account.create({
            data: {
              userId: existingUser.id,
              type: "oauth",
              provider: accountProvider,
              providerAccountId: firebaseUid,
            },
          });
        }

        // Update user info from Firebase if better data available
        if (displayName && (!existingUser.name || existingUser.name === existingUser.email)) {
          await tx.user.update({
            where: { id: existingUser.id },
            data: {
              name: displayName,
              image: avatar || existingUser.image,
              emailVerified: email_verified ? new Date() : existingUser.emailVerified,
            },
          });
        }

        return existingUser;
      }

      // Create new user (no password — Firebase-only)
      const newUser = await tx.user.create({
        data: {
          email: normalizedEmail,
          name: displayName,
          image: avatar,
          emailVerified: email_verified ? new Date() : null,
        },
      });

      // Create Account record
      await tx.account.create({
        data: {
          userId: newUser.id,
          type: "oauth",
          provider: accountProvider,
          providerAccountId: firebaseUid,
        },
      });

      // Create Profile (minimal — user completes onboarding)
      await tx.profile.create({
        data: {
          userId: newUser.id,
          displayName: displayName,
          avatar: avatar,
          profileStatus: "DRAFT", // Will complete onboarding
          age: 18,
          gender: "OTHER",
          sexuality: "OTHER",
        },
      });

      return newUser;
    });

    // Step 3: Generate a cryptographically random one-time sign-in token
    const token = `fb_${user.id}_${crypto.randomUUID().replace(/-/g, "")}_${Date.now()}`;

    // Store the raw token (5-minute TTL, single-use)
    // Security: token is random, short-lived, and deleted after first use
    await db.verificationToken.create({
      data: {
        identifier: `firebase:${user.id}`,
        token: token,
        expires: new Date(Date.now() + 5 * 60 * 1000),
      },
    });

    return NextResponse.json({
      success: true,
      userId: user.id,
      email: user.email,
      name: user.name,
      signInToken: token,
    });
  } catch (error) {
    console.error("[Firebase Bridge] Error:", error);
    return NextResponse.json(
      { error: "Internal server error. Please try again." },
      { status: 500 }
    );
  }
}
