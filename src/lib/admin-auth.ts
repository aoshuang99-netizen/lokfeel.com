import { cookies } from "next/headers";
import { Buffer } from "buffer";
import { createHmac, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

export interface AdminSession {
  username?: string;
  userId?: string;
  email?: string;
  role: string;
  exp: number;
}

const ADMIN_SECRET = () => process.env.AUTH_SECRET || process.env.ADMIN_SECRET || "";

/**
 * Create HMAC-SHA256 signature for admin session cookie.
 * Format: base64(payload).hex(signature)
 */
function signSession(payload: string): string {
  const secret = ADMIN_SECRET();
  if (!secret) {
    throw new Error("AUTH_SECRET or ADMIN_SECRET must be set for admin session signing");
  }
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  const encoded = Buffer.from(payload).toString("base64url");
  return `${encoded}.${signature}`;
}

/**
 * Verify and decode admin session cookie.
 * Returns null if signature is invalid or session is expired.
 */
function verifySession(cookieValue: string): AdminSession | null {
  try {
    const secret = ADMIN_SECRET();
    if (!secret) return null;

    const dotIndex = cookieValue.lastIndexOf(".");
    if (dotIndex === -1) return null;

    const encoded = cookieValue.substring(0, dotIndex);
    const providedSig = cookieValue.substring(dotIndex + 1);

    // Verify signature using timing-safe comparison
    const expectedSig = createHmac("sha256", secret)
      .update(Buffer.from(encoded, "base64url").toString())
      .digest("hex");

    const expectedBuf = Buffer.from(expectedSig, "hex");
    const providedBuf = Buffer.from(providedSig, "hex");

    if (expectedBuf.length !== providedBuf.length) return null;
    if (!timingSafeEqual(expectedBuf, providedBuf)) return null;

    // Decode payload
    const decoded = Buffer.from(encoded, "base64url").toString();
    const session = JSON.parse(decoded);

    // Check expiration
    if (session.exp < Date.now()) {
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

/**
 * Create a signed admin session cookie value.
 */
export function createAdminSession(session: AdminSession): string {
  return signSession(JSON.stringify(session));
}

/**
 * Get admin session from cookie.
 * Supports both direct NextRequest usage and cookies() API.
 */
export async function getAdminSession(request?: NextRequest): Promise<AdminSession | null> {
  let sessionCookieValue: string | undefined;

  // Method 1: Use request.cookies if available (preferred for API routes)
  if (request) {
    const cookie = request.cookies.get("admin_session");
    sessionCookieValue = cookie?.value;
  }

  // Method 2: Fallback to cookies() from next/headers
  if (!sessionCookieValue) {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get("admin_session");
    sessionCookieValue = sessionCookie?.value;
  }

  if (!sessionCookieValue) {
    return null;
  }

  return verifySession(sessionCookieValue);
}

export async function requireAdminSession(): Promise<AdminSession | null> {
  const session = await getAdminSession();

  if (!session) {
    return null;
  }

  // Role hierarchy: SUPER_ADMIN > ADMIN > MODERATOR > ANALYST > SUPPORT
  const validRoles = ["SUPER_ADMIN", "ADMIN", "MODERATOR", "ANALYST", "SUPPORT"];
  if (!validRoles.includes(session.role)) {
    return null;
  }

  return session;
}
