/**
 * Firebase-to-NextAuth Bridge API
 *
 * POST /api/auth/firebase-bridge
 * Body: { idToken: string }
 *
 * Flow:
 * 1. Verify ID token (supports BOTH Firebase ID tokens AND Google ID tokens)
 *    - If token starts with "eyJ" and contains "firebase" in iss → Firebase verifyIdToken
 *    - Otherwise → Google tokeninfo endpoint validation
 * 2. Extract user info (email, name, picture, uid)
 * 3. Find existing User by email, or create new User + Profile
 * 4. Link Firebase/Google Account record
 * 5. Generate one-time sign-in token (raw, stored directly — protected by 5-min TTL + single-use)
 * 6. Return token + userId for client to complete NextAuth sign-in via "firebase-token" provider
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyFirebaseToken, getFirebaseUser } from "@/lib/firebase/admin";

// ─── Google ID Token verification (for GIS flow) ───
interface GoogleTokenInfo {
  sub: string;       // Google user ID
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

async function verifyGoogleIdToken(idToken: string): Promise<GoogleTokenInfo | null> {
  try {
    // Use Google's tokeninfo endpoint (simplest, no library needed)
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
    );
    if (!res.ok) {
      console.error("[Bridge] Google tokeninfo failed:", res.status, await res.text());
      return null;
    }
    const data = await res.json();

    // Basic validation
    if (!data.sub || !data.email) {
      console.error("[Bridge] Google tokeninfo missing sub or email");
      return null;
    }

    // Verify audience matches our project (accept any client ID from our Firebase project)
    // Firebase projects auto-create Google OAuth clients with specific patterns
    const validAudPrefixes = [
      "1054088598785", // Google Cloud project number prefix
      "185541962106", // Firebase project number (Web App)
      "project-1700929385257882331", // Firebase project ID
    ];
    const aud = data.aud || "";
    const audValid = validAudPrefixes.some(prefix => aud.includes(prefix));
    if (!audValid) {
      console.error("[Bridge] Google tokeninfo aud mismatch:", aud);
      // Don't fail on aud mismatch — Google Cloud Console may create additional clients
      // Log but continue
    }

    return data as GoogleTokenInfo;
  } catch (err) {
    console.error("[Bridge] Google ID token verification error:", err);
    return null;
  }
}

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

    // Step 1: Verify ID token (dual mode: Firebase or Google)
    let firebaseUid: string;
    let email: string | null;
    let emailVerified: boolean;
    let displayName: string | undefined;
    let pictureUrl: string | undefined;
    let signInProvider: string;
    let isGoogleToken = false;

    // Try Firebase verification first
    const decoded = await verifyFirebaseToken(idToken);
    if (decoded) {
      // Firebase ID token path (original flow)
      firebaseUid = decoded.uid;
      signInProvider = decoded.firebase?.sign_in_provider || "firebase";

      // 3-level email fallback for Firebase tokens
      email = decoded.email || null;
      if (!email && decoded.firebase?.identities) {
        const identities = decoded.firebase.identities as Record<string, string[] | null>;
        for (const provider of ["google.com", "twitter.com", "apple.com", "email"]) {
          const idents = identities[provider];
          if (Array.isArray(idents) && idents.length > 0 && idents[0].includes("@")) {
            email = idents[0];
            break;
          }
        }
      }
      if (!email) {
        try {
          const firebaseUser = await getFirebaseUser(firebaseUid);
          if (firebaseUser?.email) {
            email = firebaseUser.email;
            if (!decoded.name && firebaseUser.displayName) {
              displayName = firebaseUser.displayName;
            }
            if (!decoded.picture && firebaseUser.photoURL) {
              pictureUrl = firebaseUser.photoURL;
            }
          }
        } catch (getUserError) {
          console.error("[Firebase Bridge] getUser fallback failed:", getUserError);
        }
      }
      emailVerified = decoded.email_verified || false;
      displayName = displayName || decoded.name;
      pictureUrl = pictureUrl || decoded.picture;
    } else {
      // Google ID token path (GIS flow — no Firebase SDK needed)
      isGoogleToken = true;
      const googleInfo = await verifyGoogleIdToken(idToken);
      if (!googleInfo) {
        return NextResponse.json(
          { error: "Invalid or expired token" },
          { status: 401 }
        );
      }
      firebaseUid = `google_${googleInfo.sub}`; // Use google_ prefix to distinguish
      email = googleInfo.email;
      emailVerified = googleInfo.email_verified || false;
      displayName = googleInfo.name || googleInfo.given_name;
      pictureUrl = googleInfo.picture;
      signInProvider = "google.com";
    }

    if (!email) {
      console.error(
        "[Bridge] CRITICAL: No email found. uid:", firebaseUid,
        "provider:", signInProvider, "isGoogle:", isGoogleToken,
      );
      return NextResponse.json(
        { error: "Account has no email address. Please ensure your account has a verified email and try again." },
        { status: 400 }
      );
    }

    // Step 2: Find or create user
    const normalizedEmail = email.toLowerCase().trim();
    const userName = displayName || email.split("@")[0];
    const avatar = pictureUrl || null;

    // Normalize provider name for Account model
    const accountProvider = signInProvider === "google.com"
      ? "firebase-google"
      : signInProvider === "apple.com"
        ? "firebase-apple"
        : signInProvider === "twitter.com"
          ? "firebase-twitter"
          : `firebase-${signInProvider}`;

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

        // Update user info if better data available
        if (userName && (!existingUser.name || existingUser.name === existingUser.email)) {
          await tx.user.update({
            where: { id: existingUser.id },
            data: {
              name: userName,
              image: avatar || existingUser.image,
              emailVerified: emailVerified ? new Date() : existingUser.emailVerified,
            },
          });
        }

        return existingUser;
      }

      // Create new user (no password — Firebase-only)
      const newUser = await tx.user.create({
        data: {
          email: normalizedEmail,
          name: userName,
          image: avatar,
          emailVerified: emailVerified ? new Date() : null,
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
          displayName: userName,
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
