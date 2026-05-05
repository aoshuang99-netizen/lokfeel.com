/**
 * Admin Trash API — Soft Deleted Users
 *
 * GET  /api/admin/users/trash        → List soft-deleted users
 * POST /api/admin/users/trash/restore → Restore a user
 * DELETE /api/admin/users/trash/:id  → Permanently delete
 */

export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withPermission } from "@/lib/with-permission";
import { success, badRequest, serverError, createMeta } from "@/lib/api-response";
import { auditUserAction } from "@/lib/admin-audit";

/**
 * GET /api/admin/users/trash — List soft-deleted users
 */
export const GET = withPermission("user.view")(async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const pageSize = Math.min(parseInt(searchParams.get("pageSize") || "20", 10), 100);
    const skip = (page - 1) * pageSize;

    // Access raw Prisma client (without soft-delete extension) to find deleted records
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawClient = (db as any)._baseClient || db;

    const [deletedUsers, total] = await Promise.all([
      rawClient.user.findMany({
        where: {
          deletedAt: { not: null },
        },
        include: {
          profile: { select: { name: true, avatarUrl: true } },
        },
        orderBy: { deletedAt: "desc" },
        skip,
        take: pageSize,
      }),
      rawClient.user.count({
        where: { deletedAt: { not: null } },
      }),
    ]);

    return NextResponse.json(success({
      users: deletedUsers,
      meta: createMeta(page, pageSize, total),
    }));
  } catch (error) {
    console.error("[admin/users/trash GET]", error);
    return NextResponse.json(serverError(), { status: 500 });
  }
});

const restoreSchema = z.object({
  userId: z.string().min(1),
});

/**
 * POST /api/admin/users/trash/restore — Restore a soft-deleted user
 */
export const POST = withPermission("user.edit", { dangerous: true })(async (request: NextRequest, { userId: adminId }) => {
  try {
    const body = await request.json();
    const { userId } = restoreSchema.parse(body);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawClient = (db as any)._baseClient || db;

    const user = await rawClient.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return NextResponse.json(badRequest("User not found"), { status: 404 });
    }

    const restored = await rawClient.user.update({
      where: { id: userId },
      data: { deletedAt: null },
    });

    await auditUserAction(adminId, "restore_user", userId, {
      before: { deletedAt: user.deletedAt },
      after: { deletedAt: null },
    });

    return NextResponse.json(success(restored));
  } catch (error) {
    if (error instanceof z.ZodError) {
      const message = error.issues[0]?.message || "Validation error";
      return NextResponse.json(badRequest(message), { status: 400 });
    }
    console.error("[admin/users/trash/restore POST]", error);
    return NextResponse.json(serverError(), { status: 500 });
  }
});
