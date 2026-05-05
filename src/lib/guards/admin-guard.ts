/**
 * LokFeel Admin — Server-Side Admin Guard
 *
 * Used in admin layout / page server components to enforce RBAC at the page level.
 * Throws a redirect to /admin/403 if the user lacks the required admin role.
 */

import { auth } from "@/lib/auth/auth";
import { getDb } from "@/lib/db";
import { redirect } from "next/navigation";
import { AdminRole } from "@/generated/index";

// ============================================================================
// Types
// ============================================================================

interface AdminGuardResult {
  userId: string;
  userEmail: string;
  userName: string | null;
  roles: AdminRole[];
  isSuperAdmin: boolean;
}

// ============================================================================
// requireAdminAccess
// ============================================================================

/**
 * Server-side guard: verify the current user has at least one admin role.
 * Call this at the top of admin page components or layouts.
 *
 * @returns AdminGuardResult with user info and roles
 * @throws Redirect to /admin/403 if not an admin
 *
 * @example
 * // In an admin page server component:
 * export default async function AdminUsersPage() {
 *   const admin = await requireAdminAccess();
 *   return <div>Welcome, {admin.userName}</div>;
 * }
 */
export async function requireAdminAccess(): Promise<AdminGuardResult> {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/admin");
  }

  const userId = session.user.id as string;
  const db = getDb();

  // Check for active admin roles
  const userRoles = await db.adminUserRole.findMany({
    where: {
      userId,
      isActive: true,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
    select: {
      role: true,
    },
  });

  if (userRoles.length === 0) {
    redirect("/admin/403");
  }

  const roles = userRoles.map(ur => ur.role);
  const isSuperAdmin = roles.includes("SUPER_ADMIN");

  // Get user basic info
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  });

  return {
    userId,
    userEmail: user?.email || "",
    userName: user?.name || null,
    roles: roles as AdminRole[],
    isSuperAdmin,
  };
}

// ============================================================================
// requireAdminRole
// ============================================================================

/**
 * Server-side guard: require a specific admin role.
 *
 * @param requiredRole - The minimum role required (SUPER_ADMIN > ADMIN > MODERATOR > ...)
 * @throws Redirect to /admin/403 if insufficient role
 */
export async function requireAdminRole(requiredRole: AdminRole): Promise<AdminGuardResult> {
  const admin = await requireAdminAccess();

  const roleHierarchy: Record<AdminRole, number> = {
    SUPPORT: 1,
    CREATIVE: 1,
    ANALYST: 2,
    MODERATOR: 3,
    ADMIN: 4,
    SUPER_ADMIN: 5,
    VIP_AGENT: 1,
  };

  const requiredLevel = roleHierarchy[requiredRole];
  const userMaxLevel = Math.max(...admin.roles.map(r => roleHierarchy[r] || 0));

  if (userMaxLevel < requiredLevel) {
    redirect("/admin/403");
  }

  return admin;
}

// ============================================================================
// getAdminUsers (for RBAC management page)
// ============================================================================

/**
 * Fetch all users who have admin roles, with their role assignments.
 * Only accessible to SUPER_ADMIN or users with rbac.role.view permission.
 */
export async function getAdminUsers() {
  const db = getDb();

  const adminUsers = await db.adminUserRole.findMany({
    where: {
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
        },
      },
      customRole: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: { grantedAt: "desc" },
  });

  return adminUsers;
}
