/**
 * GET /api/admin/rbac/permissions — List all permissions grouped by category
 */

import { NextRequest } from "next/server";
import { withPermission } from "@/lib/with-permission";
import { success } from "@/lib/api-response";
import { PERMISSIONS, PERMISSION_CATEGORIES, DANGEROUS_PERMISSIONS, CRITICAL_PERMISSIONS, ALL_PERMISSION_CODES } from "@/lib/admin-permissions";
import { ROLE_PERMISSIONS, PERMISSION_ROLES } from "@/lib/admin-roles";

export const GET = withPermission("rbac.permission.view")(async () => {
  // Build grouped response
  const categories = Object.entries(PERMISSION_CATEGORIES).map(([category, codes]) => ({
    category,
    permissions: codes.map(code => ({
      code,
      name: PERMISSIONS[code].name,
      dangerous: PERMISSIONS[code].dangerous,
      critical: 'critical' in PERMISSIONS[code] && PERMISSIONS[code].critical,
      roles: (PERMISSION_ROLES as any)[code] || [],
    })),
  }));

  return success({
    categories,
    total: ALL_PERMISSION_CODES.length,
    dangerousCount: DANGEROUS_PERMISSIONS.length,
    criticalCount: CRITICAL_PERMISSIONS.length,
  });
});
