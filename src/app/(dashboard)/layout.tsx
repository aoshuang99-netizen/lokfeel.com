/**
 * Dashboard Layout — Server Component (Auth Guard + Client UI)
 * 
 * Architecture:
 * - This file is a SERVER COMPONENT → can use auth() to check session
 * - Wraps the actual UI in DashboardAuthGuard (redirects if not logged in)
 * - The actual dashboard UI is in dashboard-ui.tsx (client component)
 */
import DashboardAuthGuard from "./auth-guard";
import DashboardUI from "./dashboard-ui";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DashboardAuthGuard>
      <DashboardUI>{children}</DashboardUI>
    </DashboardAuthGuard>
  );
}
