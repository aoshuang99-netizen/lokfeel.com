import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { success, parsePagination } from "@/lib/api-response";
import { withPermission } from "@/lib/with-permission";

/**
 * GET /api/admin/audit
 *
 * Query params:
 *   - page, pageSize (pagination)
 *   - category (filter by AuditCategory)
 *   - action (filter by action type)
 *   - actorId (filter by actor)
 *   - startDate, endDate (date range, ISO format)
 */
export const GET = withPermission("system.audit")(async (req) => {
  const { searchParams } = new URL(req.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);

  // Build where clause
  const where: Record<string, unknown> = {};

  const category = searchParams.get("category");
  if (category) {
    where.category = category;
  }

  const action = searchParams.get("action");
  if (action) {
    where.action = { contains: action };
  }

  const actorId = searchParams.get("actorId");
  if (actorId) {
    where.actorId = actorId;
  }

  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  if (startDate || endDate) {
    const createdAtFilter: Record<string, unknown> = {};
    if (startDate) createdAtFilter.gte = new Date(startDate);
    if (endDate) createdAtFilter.lte = new Date(endDate);
    where.createdAt = createdAtFilter;
  }

  const db = getDb();

  const [audits, total] = await Promise.all([
    db.adminAudit.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: "desc" },
      include: {
        actor: {
          select: { id: true, name: true, email: true, image: true },
        },
      },
    }),
    db.adminAudit.count({ where }),
  ]);

  // Parse JSON changes
  const formattedAudits = audits.map((audit: any) => ({
    ...audit,
    changes: audit.changes ? JSON.parse(audit.changes) : null,
  }));

  return success(formattedAudits, {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  });
});
