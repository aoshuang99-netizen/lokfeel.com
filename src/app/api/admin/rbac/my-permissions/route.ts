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
  const sessionRole = adminSession?.role;

  // DEBUG: Return all info for debugging
  return success({
    debug: {
      hasAdminSession: !!adminSession,
      adminSessionType: adminSession ? typeof adminSession : 'null',
      adminSessionKeys: adminSession ? Object.keys(adminSession) : [],
      adminSession: adminSession,
      sessionRole,
      userId,
    },
    permissions: [],
    roles: [],
    isSuperAdmin: false,
  });

  // 1. Build roles array
  const roles: string[] = [];
  if (sessionRole) {
    roles.push(sessionRole);
  } else {
    // Fallback: check if adminSession itself has role
    if (adminSession && 'role' in adminSession) {
      roles.push(adminSession.role);
    }
  }

  // 2. For real users (not demo), also check database for additional roles
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

  const permissionSet = new Set<string>();
  const isSuperAdmin = roles.includes("SUPER_ADMIN");

  // 3. Build permission set from roles
  if (isSuperAdmin) {
    // SUPER_ADMIN gets all permissions
    for (const perm of ALL_PERMISSION_CODES) {
      permissionSet.add(perm);
    }
  } else {
    // For other roles, need to get from database
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
    } else {
      // Demo non-SUPER_ADMIN: use session role
      const demoRolePerms = ROLE_PERMISSIONS[sessionRole as keyof typeof ROLE_PERMISSIONS];
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
