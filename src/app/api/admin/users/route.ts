export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdminAuth as requireAdmin } from "@/lib/auth/auth"
import { success, badRequest, serverError } from "@/lib/api-response";
import type { PaginatedResponse } from "@/types";

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  role: z.enum(["USER", "ADMIN", "SUPER_ADMIN"]).optional(),
  status: z.enum(["DRAFT", "PENDING_REVIEW", "APPROVED", "REJECTED", "DEACTIVATED", "BANNED"]).optional(),
});

export async function GET(request: NextRequest) {
  try {
    

    const { searchParams } = new URL(request.url);

    const parseResult = querySchema.safeParse({
      page: searchParams.get("page"),
      limit: searchParams.get("limit"),
      search: searchParams.get("search"),
      role: searchParams.get("role"),
      status: searchParams.get("status"),
    });

    if (!parseResult.success) {
      return badRequest("Invalid query parameters", parseResult.error.issues);
    }

    const { page, limit, search, role, status } = parseResult.data;
    const skip = (page - 1) * limit;

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
        take: limit,
      }),
      db.user.count({ where: whereClause }),
    ]);

    const response = { success: true as const,
      data: users,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: skip + users.length < total,
      },
    };

    return success(response);
  } catch (error) {
    console.error("Error fetching users:", error);
    return serverError("Failed to fetch users");
  }
}

const updateUserSchema = z.object({
  role: z.enum(["USER", "ADMIN", "SUPER_ADMIN"]).optional(),
  status: z.enum(["DRAFT", "PENDING_REVIEW", "APPROVED", "REJECTED", "DEACTIVATED", "BANNED"]).optional(),
  adminNotes: z.string().optional(),
});

export async function PATCH(request: NextRequest) {
  try {
    

    const { user: adminUser } = await requireAdmin();
    const body = await request.json();

    const parseResult = updateUserSchema.safeParse(body);
    if (!parseResult.success) {
      return badRequest("Invalid request body", parseResult.error.issues);
    }

    const { role, status, adminNotes } = parseResult.data;
    const userId = body.userId;

    if (!userId) {
      return badRequest("userId is required");
    }

    // Prevent self-modification of role
    if (userId === adminUser?.id && role) {
      return badRequest("Cannot modify your own role");
    }

    // Prepare update data
    const updateData: Record<string, unknown> = {};

    if (role !== undefined) {
      updateData.role = role;
    }

    if (status !== undefined || adminNotes !== undefined) {
      // Update profile status
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

    // Log admin action
    await db.adminLog.create({
      data: {
        authorId: adminUser?.id,
        action: "user.update",
        targetId: userId,
        targetType: "User",
        details: JSON.stringify({ role, status, adminNotes }),
      },
    });

    // Get updated user
    const updatedUser = await db.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
      },
    });

    return success(updatedUser);
  } catch (error) {
    console.error("Error updating user:", error);
    return serverError("Failed to update user");
  }
}
