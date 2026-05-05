export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withPermission } from "@/lib/with-permission";
import { success, paginated, badRequest, serverError } from "@/lib/api-response";
import { createMeta } from "@/lib/api-response";
import { auditUserAction } from "@/lib/admin-audit";

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  role: z.enum(["USER", "ADMIN", "SUPER_ADMIN"]).optional(),
  status: z.enum(["DRAFT", "PENDING_REVIEW", "APPROVED", "REJECTED", "DEACTIVATED", "BANNED"]).optional(),
});

export const GET = withPermission('user.view')(async (request: NextRequest, { userId }) => {
  const { searchParams } = new URL(request.url);

  const parseResult = querySchema.safeParse({
    page: searchParams.get("page") || undefined,
    pageSize: searchParams.get("pageSize") || searchParams.get("limit") || undefined,
    search: searchParams.get("search") || undefined,
    role: searchParams.get("role") || undefined,
    status: searchParams.get("status") || undefined,
  });

  if (!parseResult.success) {
    return badRequest("Invalid query parameters", parseResult.error.issues);
  }

  const { page, pageSize, search, role, status } = parseResult.data;
  const skip = (page - 1) * pageSize;

  // Build where clause
  const whereClause: Record<string, unknown> = {};

  if (role) {
    whereClause.role = role;
  }

  if (search) {
    whereClause.OR = [
      { name: { contains: search } },
      { email: { contains: search } },
    ];
  }

  if (status) {
    whereClause.profile = {
      profileStatus: status,
    };
  }

  const [users, total] = await Promise.all([
    db.user.findMany({
      where: whereClause,
      include: {
        profile: {
          select: {
            id: true,
            displayName: true,
            profileStatus: true,
            isApproved: true,
            avatar: true,
          },
        },
        _count: {
          select: {
            sentMatches: true,
            receivedMatches: true,
            messages: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
    db.user.count({ where: whereClause }),
  ]);

  return paginated(users, createMeta(page, pageSize, total));
});

const updateUserSchema = z.object({
  userId: z.string().min(1, "userId is required"),
  role: z.enum(["USER", "ADMIN", "SUPER_ADMIN"]).optional(),
  status: z.enum(["DRAFT", "PENDING_REVIEW", "APPROVED", "REJECTED", "DEACTIVATED", "BANNED"]).optional(),
  adminNotes: z.string().optional(),
});

export const PATCH = withPermission('user.edit')(async (request: NextRequest, { userId: adminId }) => {

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return NextResponse.json({ success: false, error: { message: "Invalid JSON in request body" } }, { status: 400 });
  }

  const parseResult = updateUserSchema.safeParse(body);
  if (!parseResult.success) {
    return badRequest("Invalid request body", parseResult.error.issues);
  }

  const { userId, role, status, adminNotes } = parseResult.data;

  // Prevent self-modification of role
  if (userId === adminId && role) {
    return badRequest("Cannot modify your own role");
  }

  // Verify target user exists
  const targetUser = await db.user.findUnique({ where: { id: userId }, include: { profile: true } });
  if (!targetUser) {
    return badRequest("User not found");
  }

  const changes: { before?: unknown; after: unknown } = {
    before: { role: targetUser.role, status: targetUser.profile?.profileStatus },
    after: { role, status, adminNotes },
  };

  // Prepare update data
  const updateData: Record<string, unknown> = {};
  if (role !== undefined) {
    updateData.role = role;
  }

  if (status !== undefined || adminNotes !== undefined) {
    await db.profile.updateMany({
      where: { userId },
      data: {
        ...(status && { profileStatus: status }),
        ...(adminNotes && { adminNotes }),
      },
    });
  }

  if (Object.keys(updateData).length > 0) {
    await db.user.update({
      where: { id: userId },
      data: updateData,
    });
  }

  // Unified audit log
  await auditUserAction(adminId, "user.update", userId, changes, undefined, request);

  // Get updated user
  const updatedUser = await db.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  });

  return success(updatedUser);
});
