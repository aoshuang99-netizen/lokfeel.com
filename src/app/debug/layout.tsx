/**
 * Debug Routes — Server Component Auth Guard
 *
 * Everything under `src/app/debug/` is an internal troubleshooting surface
 * (currently `/debug/google-oauth`, which drives `/api/auth/oauth/google/signin`
 * and `/api/debug/google-oauth-check`). It is not linked from any navigation,
 * but as a plain route it was reachable by anonymous visitors in production
 * (HTTP 200).
 *
 * This layout mirrors `src/app/(admin)/layout.tsx` so the pages remain usable
 * by operators while being closed to anonymous traffic. Same two-step check:
 * admin_session cookie first, NextAuth session as fallback.
 */
import { auth } from "@/lib/auth/auth";
import { getAdminSession } from "@/lib/admin-auth";
import { redirect } from "next/navigation";
import { ReactNode } from "react";

export default async function DebugLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Server-side auth check — check admin_session cookie FIRST
  const adminSession = await getAdminSession();

  // Fallback to NextAuth session (for database admin users logged in via OAuth/NextAuth)
  let nextAuthSession = null;
  if (!adminSession) {
    try {
      nextAuthSession = await auth();
    } catch {
      // auth() may fail in edge cases — continue with admin_session only
    }
  }

  if (!adminSession && !nextAuthSession?.user) {
    redirect("/admin-login");
  }

  return <>{children}</>;
}
