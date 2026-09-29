/**
 * Admin Test Harness — Server Component Auth Guard
 *
 * `src/app/admin-test/page.tsx` is a client-side QA harness that exercises the
 * `/api/admin/*` surface. It is not linked from any navigation, but as a plain
 * route it was reachable by anonymous visitors in production (HTTP 200).
 *
 * This layout mirrors `src/app/(admin)/layout.tsx`: it gates the harness behind
 * an admin session so operators keep the tool without exposing it publicly.
 * No new auth mechanism is introduced — the exact same two-step check is reused
 * (admin_session cookie first, NextAuth session as fallback).
 */
import { auth } from "@/lib/auth/auth";
import { getAdminSession } from "@/lib/admin-auth";
import { redirect } from "next/navigation";
import { ReactNode } from "react";

export default async function AdminTestLayout({
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
