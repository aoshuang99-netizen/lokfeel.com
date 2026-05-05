import { cookies } from "next/headers";
import { Buffer } from "buffer";
import type { NextRequest } from "next/server";

export interface AdminSession {
  username?: string;
  userId?: string;
  email?: string;
  role: string;
  exp: number;
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

  try {
    // Decode base64 cookie
    const decoded = Buffer.from(sessionCookieValue, "base64").toString();
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
