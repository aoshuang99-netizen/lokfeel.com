/**
 * Server-Side Auth Guard for Dashboard Routes
 *
 * This runs in Node.js runtime (NOT Edge/middleware),
 * so it can properly decrypt NextAuth v5's JWE session tokens.
 */
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";

export default async function DashboardAuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login?callbackUrl=/dashboard");
  }

  return <>{children}</>;
}
