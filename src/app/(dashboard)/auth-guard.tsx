/**
 * Server-Side Auth Guard for Dashboard Routes
 *
 * This runs in Node.js runtime (NOT Edge/middleware),
 * so it can properly decrypt NextAuth v5's JWE session tokens.
 *
 * Guest sessions (JWT with guest: true) are ALLOWED through
 * but the dashboard will render in read-only mode.
 */
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";

export default async function DashboardAuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  // No session at all → redirect to login
  if (!session?.user) {
    redirect("/login?callbackUrl=/dashboard");
  }

  // Guest session → allow through (dashboard shows read-only mode)
  const isGuest = (session.user as any)?.guest === true;
  if (isGuest) {
    return <>{children}</>;
  }

  // Normal authenticated user → allow
  return <>{children}</>;
}
