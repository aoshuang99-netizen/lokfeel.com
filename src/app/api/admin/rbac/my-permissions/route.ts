import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { success, unauthorized } from "@/lib/api-response";
import { ALL_PERMISSION_CODES } from "@/lib/admin-permissions";
import { ROLE_PERMISSIONS } from "@/lib/admin-roles";
import { requireAuth } from "@/lib/auth/auth";
import { handleApiError } from "@/lib/api-handler";

export async function GET(req: NextRequest) {
  return handleApiError(async () => {
    const { user } = await requireAuth();
    const userId = user.id;
    const db = getDb();

    // 1. Get user's admin roles
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

    const roles = userRoles.map((ur: any) => ur.role);
    const permissionSet = new Set<string>();
    const isSuperAdmin = roles.includes("SUPER_ADMIN");

    for (const userRole of userRoles as any[]) {
      if (userRole.role === "SUPER_ADMIN") {
        // All permissions
        for (const perm of ALL_PERMISSION_CODES) {
          permissionSet.add(perm);
        }
        break;
      }

      const rolePerms = ROLE_PERMISSIONS[userRole.role];
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

    return success({
      permissions: Array.from(permissionSet),
      roles,
      isSuperAdmin,
    });
  });
}
