/**
 * GET /api/admin/rbac/users — List all admin users with their roles
 * POST /api/admin/rbac/users — Assign a role to a user
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withPermission, clearPermissionCache } from "@/lib/with-permission";
import { success, badRequest, conflict, serverError } from "@/lib/api-response";
import { auditRoleChange } from "@/lib/admin-audit";

const assignRoleSchema = z.object({
  userId: z.string().min(1, "userId is required"),
  role: z.enum(["SUPER_ADMIN", "ADMIN", "MODERATOR", "ANALYST", "SUPPORT", "CREATIVE", "VIP_AGENT"]),
  customRoleId: z.string().optional(),
  department: z.string().optional(),
  title: z.string().optional(),
  expiresAt: z.string().optional(), // ISO date string
  reason: z.string().optional(),
});

export const GET = withPermission("rbac.role.view")(async () => {
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

  return success(adminUsers);
});

export const POST = withPermission("rbac.user.assign", { dangerous: true })(async (request: NextRequest, { userId: adminId }) => {
  const body = await request.json();

  const parseResult = assignRoleSchema.safeParse(body);
  if (!parseResult.success) {
    return badRequest("Invalid role assignment data", parseResult.error.issues);
  }

  const { userId: targetUserId, role, customRoleId, department, title, expiresAt, reason } = parseResult.data;

  // Verify target user exists
  const targetUser = await db.user.findUnique({ where: { id: targetUserId } });
  if (!targetUser) {
    return badRequest("Target user not found");
  }

  // Prevent self-modification
  if (targetUserId === adminId) {
    return badRequest("Cannot modify your own role assignment");
  }

  // Check if role already assigned
  const existing = await db.adminUserRole.findUnique({
    where: { userId_role: { userId: targetUserId, role } },
  });

  if (existing) {
    return conflict(`User already has the ${role} role`);
  }

  // Validate custom role if provided
  if (customRoleId) {
    const customRole = await db.customRole.findUnique({ where: { id: customRoleId } });
    if (!customRole) {
      return badRequest("Custom role not found");
    }
  }

  // Create role assignment
  const assignment = await db.adminUserRole.create({
    data: {
      userId: targetUserId,
      role,
      customRoleId,
      department,
      title,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      grantedBy: adminId,
    },
  });

  // Clear permission cache for this user
  clearPermissionCache(targetUserId);

  // Unified audit log
  await auditRoleChange(adminId, "grant_role", targetUserId, role, reason || `Role ${role} assigned`, request);

  return success(assignment, undefined, 201);
});
