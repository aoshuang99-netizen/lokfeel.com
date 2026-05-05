/**
 * DELETE /api/admin/rbac/users/[userId]/[role] — Revoke a role from a user
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withPermission } from "@/lib/with-permission";
import { success, notFound, badRequest } from "@/lib/api-response";
import { clearPermissionCache } from "@/lib/with-permission";
import { auditRoleChange } from "@/lib/admin-audit";

export const DELETE = withPermission("rbac.user.revoke", { dangerous: true })(async (request: NextRequest, { params, userId: adminId }) => {
  const { userId: targetUserId, role: roleName } = await params;

  // Prevent self-revocation
  if (targetUserId === adminId) {
    return badRequest("Cannot revoke your own role");
  }

  // Find the role assignment
  const assignment = await db.adminUserRole.findUnique({
    where: { userId_role: { userId: targetUserId, role: roleName } },
  });

  if (!assignment) {
    return notFound("Role assignment not found");
  }

  // Get reason from query params
  const { searchParams } = new URL(request.url);
  const reason = searchParams.get("reason") || "Role revoked by admin";

  // Delete the assignment
  await db.adminUserRole.delete({
    where: { id: assignment.id },
  });

  // Clear permission cache for this user
  clearPermissionCache(targetUserId);

  // Audit log
  await auditRoleChange(adminId, "revoke_role", targetUserId, roleName, reason, request);

  return success({ message: `Role ${roleName} revoked from user ${targetUserId}` });
});
