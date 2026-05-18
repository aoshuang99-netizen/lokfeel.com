/**
 * Dashboard Layout — Server Component (Auth Guard + Client UI)
 *
 * Architecture:
 * - This file is a SERVER COMPONENT → can use auth() to check session
 * - Fetches session ONCE and passes it to DashboardUI for SessionProvider preloading
 * - This eliminates the client-side /api/auth/session waterfall on dashboard pages
 */
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import DashboardUI from "./dashboard-ui";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login?callbackUrl=/dashboard");
  }

  // Pass server-side session to client — SessionProvider will use it
  // as initial data, skipping the /api/auth/session fetch entirely
  return (
    <DashboardUI session={session}>{children}</DashboardUI>
  );
}
