import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { success } from "@/lib/api-response";
import { ALL_PERMISSION_CODES } from "@/lib/admin-permissions";
import { ROLE_PERMISSIONS } from "@/lib/admin-roles";
import { withPermission } from "@/lib/with-permission";
import { getAdminSession } from "@/lib/admin-auth";

export const GET = withPermission("rbac.role.view")(async (req: NextRequest, { userId }) => {
  const db = getDb();

  // Get role directly from admin session (handles both demo and real users)
  const adminSession = await getAdminSession(req);

  // 1. Build roles array from session + database
  const roles: string[] = [];

  // From admin session cookie (demo admin or NextAuth fallback)
  if (adminSession?.role) {
    roles.push(adminSession.role);
  }

  // From database (real users with AdminUserRole records)
  if (!userId.startsWith("demo:")) {
    const userRoles = await db.adminUserRole.findMany({
      where: {
        userId,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      select: {
        role: true,
        customRole: {
          select: { permissions: true },
        },
      },
    });

    for (const ur of userRoles) {
      if (!roles.includes(ur.role)) {
        roles.push(ur.role);
      }
    }
  }

  const isSuperAdmin = roles.includes("SUPER_ADMIN");
  const permissionSet = new Set<string>();

  // 2. Build permission set from roles
  if (isSuperAdmin) {
    for (const perm of ALL_PERMISSION_CODES) {
      permissionSet.add(perm);
    }
  } else {
    // For non-SUPER_ADMIN roles, collect permissions from role definitions + custom roles
    if (!userId.startsWith("demo:")) {
      const userRolesData = await db.adminUserRole.findMany({
        where: {
          userId,
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } },
          ],
        },
        select: {
          role: true,
          customRole: {
            select: { permissions: true },
          },
        },
      });

      for (const userRole of userRolesData) {
        const rolePerms = ROLE_PERMISSIONS[userRole.role as keyof typeof ROLE_PERMISSIONS];
        if (rolePerms) {
          for (const perm of rolePerms) {
            permissionSet.add(perm);
          }
        }

        if (userRole.customRole?.permissions) {
          try {
            const customPerms: string[] = JSON.parse(userRole.customRole.permissions);
            for (const perm of customPerms) {
              permissionSet.add(perm);
            }
          } catch {
            // Invalid JSON
          }
        }
      }
    } else if (adminSession?.role) {
      // Demo non-SUPER_ADMIN: use session role
      const demoRolePerms = ROLE_PERMISSIONS[adminSession.role as keyof typeof ROLE_PERMISSIONS];
      if (demoRolePerms) {
        for (const perm of demoRolePerms) {
          permissionSet.add(perm);
        }
      }
    }
  }

  return success({
    permissions: Array.from(permissionSet),
    roles,
    isSuperAdmin,
  });
});
