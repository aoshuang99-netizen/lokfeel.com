/**
 * GET /api/admin/rbac/roles — List all roles with their permission counts
 * POST /api/admin/rbac/roles — Create a custom role
 *
 * System roles (SUPER_ADMIN, ADMIN, etc.) are read-only.
 * Custom roles can be created/edited/deleted by SUPER_ADMIN.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withPermission } from "@/lib/with-permission";
import { success, badRequest, serverError, notFound } from "@/lib/api-response";
import { auditRoleChange } from "@/lib/admin-audit";

// System roles that cannot be modified
const SYSTEM_ROLES = ["SUPER_ADMIN", "ADMIN", "MODERATOR", "ANALYST", "SUPPORT", "CREATIVE", "VIP_AGENT"];

export const GET = withPermission("rbac.role.view")(async () => {
  // Get system roles with permission counts from in-memory matrix
  const { ROLE_PERMISSIONS } = await import("@/lib/admin-roles");
  const { ALL_PERMISSION_CODES } = await import("@/lib/admin-permissions");

  const systemRoles = SYSTEM_ROLES.map(roleName => ({
    name: roleName,
    isSystem: true,
    permissionCount: roleName === "SUPER_ADMIN"
      ? ALL_PERMISSION_CODES.length
      : (ROLE_PERMISSIONS[roleName] || []).length,
  }));

  // Get custom roles from database
  const customRoles = await db.customRole.findMany({
    where: { isSystem: false },
    include: {
      _count: {
        select: { userRoles: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const customRoleData = customRoles.map(cr => {
    let permCount = 0;
    try {
      const perms = JSON.parse(cr.permissions);
      permCount = perms.length;
    } catch { /* invalid JSON */ }

    return {
      id: cr.id,
      name: cr.name,
      description: cr.description,
      isSystem: false,
      permissionCount: permCount,
      userCount: cr._count.userRoles,
      createdAt: cr.createdAt,
    };
  });

  const response = success({
    systemRoles,
    customRoles: customRoleData,
    total: systemRoles.length + customRoleData.length,
  });

  response.headers.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  return response;
});

const createRoleSchema = z.object({
  name: z.string().min(1).max(50),
  description: z.string().max(200).optional(),
  permissions: z.array(z.string()).min(1, "At least one permission is required"),
});

export const POST = withPermission("rbac.role.create", { dangerous: true })(async (request: NextRequest, { userId: adminId }) => {
  const body = await request.json();

  const parseResult = createRoleSchema.safeParse(body);
  if (!parseResult.success) {
    return badRequest("Invalid role data", parseResult.error.issues);
  }

  const { name, description, permissions } = parseResult.data;

  // Check for duplicate name
  const existing = await db.customRole.findUnique({ where: { name } });
  if (existing) {
    return badRequest("Role with this name already exists");
  }

  // Validate permission codes
  const { ALL_PERMISSION_CODES } = await import("@/lib/admin-permissions");
  const validPerms = new Set(ALL_PERMISSION_CODES as string[]);
  const invalidPerms = permissions.filter(p => !validPerms.has(p));

  if (invalidPerms.length > 0) {
    return badRequest(`Invalid permission codes: ${invalidPerms.join(", ")}`);
  }

  // Create custom role
  const role = await db.customRole.create({
    data: {
      name,
      description,
      permissions: JSON.stringify(permissions),
      isSystem: false,
    },
  });

  // Audit log
  await auditRoleChange(adminId, "grant_role", "system", role.name, `Custom role created with ${permissions.length} permissions`, request);

  return success(role, undefined, 201);
});
