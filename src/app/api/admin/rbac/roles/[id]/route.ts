/**
 * GET /api/admin/rbac/roles/[id] — Get a custom role by ID
 * PATCH /api/admin/rbac/roles/[id] — Update a custom role
 * DELETE /api/admin/rbac/roles/[id] — Delete a custom role
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withPermission } from "@/lib/with-permission";
import { success, notFound, badRequest, conflict } from "@/lib/api-response";
import { auditRoleChange } from "@/lib/admin-audit";

export const GET = withPermission("rbac.role.view")(async (request: NextRequest, { params }) => {
  const { id } = await params;

  const role = await db.customRole.findUnique({
    where: { id },
    include: {
      _count: {
        select: { userRoles: true },
      },
    },
  });

  if (!role) {
    return notFound("Role not found");
  }

  let permissions: string[] = [];
  try {
    permissions = JSON.parse(role.permissions);
  } catch { /* invalid JSON */ }

  return success({
    ...role,
    permissions,
  });
});

const updateRoleSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  description: z.string().max(200).optional(),
  permissions: z.array(z.string()).optional(),
});

export const PATCH = withPermission("rbac.role.edit", { dangerous: true })(async (request: NextRequest, { params, userId: adminId }) => {
  const { id } = await params;
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return badRequest("Invalid JSON in request body");
  }

  const parseResult = updateRoleSchema.safeParse(body);
  if (!parseResult.success) {
    return badRequest("Invalid role data", parseResult.error.issues);
  }

  const role = await db.customRole.findUnique({ where: { id } });
  if (!role) {
    return notFound("Role not found");
  }

  if (role.isSystem) {
    return badRequest("System roles cannot be modified");
  }

  const updates: Record<string, unknown> = {};
  if (parseResult.data.name) updates.name = parseResult.data.name;
  if (parseResult.data.description !== undefined) updates.description = parseResult.data.description;
  if (parseResult.data.permissions) {
    // Validate permission codes
    const { ALL_PERMISSION_CODES } = await import("@/lib/admin-permissions");
    const validPerms = new Set(ALL_PERMISSION_CODES as string[]);
    const invalidPerms = parseResult.data.permissions.filter(p => !validPerms.has(p));
    if (invalidPerms.length > 0) {
      return badRequest(`Invalid permission codes: ${invalidPerms.join(", ")}`);
    }
    updates.permissions = JSON.stringify(parseResult.data.permissions);
  }

  // Check name uniqueness if changing name
  if (updates.name && updates.name !== role.name) {
    const existing = await db.customRole.findUnique({ where: { name: updates.name as string } });
    if (existing) {
      return conflict("Role with this name already exists");
    }
  }

  const updatedRole = await db.customRole.update({
    where: { id },
    data: updates,
  });

  // Audit log
  await auditRoleChange(adminId, "grant_role", "system", role.name, `Custom role updated`, request);

  return success(updatedRole);
});

export const DELETE = withPermission("rbac.role.delete", { dangerous: true })(async (request: NextRequest, { params, userId: adminId }) => {
  const { id } = await params;

  const role = await db.customRole.findUnique({
    where: { id },
    include: {
      _count: {
        select: { userRoles: true },
      },
    },
  });

  if (!role) {
    return notFound("Role not found");
  }

  if (role.isSystem) {
    return badRequest("System roles cannot be deleted");
  }

  if (role._count.userRoles > 0) {
    return conflict("Cannot delete role with assigned users. Revoke role assignments first.");
  }

  await db.customRole.delete({ where: { id } });

  // Audit log
  await auditRoleChange(adminId, "revoke_role", "system", role.name, "Custom role deleted", request);

  return success({ message: "Role deleted successfully" });
});
