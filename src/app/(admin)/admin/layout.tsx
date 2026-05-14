"use client";

/**
 * Admin Dashboard Inner Layout — Client Component
 *
 * This layout wraps the admin dashboard pages (inside /admin/*).
 * Auth is handled by the outer (admin)/layout.tsx server component.
 * This component only manages client-side state like active nav highlighting
 * and logout functionality.
 *
 * NOTE: Since the outer layout already renders the sidebar and header,
 * this layout simply passes through children.
 */
import { ReactNode } from "react";

export default function AdminDashboardLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
