/**
 * LokFeel Admin — Unified Audit Logger
 *
 * Provides writeAudit() for recording all admin operations to AdminAudit table.
 * Used by withPermission middleware and can be called manually from any API route.
 */

import { getDb } from "@/lib/db";

// ============================================================================
// Audit Write Options
// ============================================================================

export type AuditCategory = "USER" | "MATCH" | "CHAT" | "PAYMENT" | "CONTENT" | "BOT" | "AI_CREATIVE" | "AI_SUPPORT" | "VIP" | "ANALYTICS" | "SYSTEM" | "RBAC";

export interface AuditWriteOptions {
  actorId: string;
  category: AuditCategory;
  action: string;           // "create" | "update" | "delete" | "ban" | "grant_role" | ...
  targetType?: string;      // "User" | "Match" | "Payment" | "AdminRole" | "API"
  targetId?: string;        // ID of the affected resource
  changes?: { before?: unknown; after?: unknown };
  reason?: string;
  request?: { headers?: Headers; method?: string; url?: string };
}

// ============================================================================
// Audit Logger
// ============================================================================

/**
 * Write an audit log entry. Non-blocking — errors are swallowed to avoid
 * blocking the main API response.
 */
export async function writeAudit(options: AuditWriteOptions): Promise<void> {
  const {
    actorId,
    category,
    action,
    targetType,
    targetId,
    changes,
    reason,
    request,
  } = options;

  // Extract IP and User-Agent from request
  let ipAddress: string | undefined;
  let userAgent: string | undefined;

  if (request?.headers) {
    ipAddress =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      undefined;
    userAgent = request.headers.get("user-agent") || undefined;
  }

  try {
    const db = getDb();
    await db.adminAudit.create({
      data: {
        actorId,
        category,
        action,
        targetType: targetType || null,
        targetId: targetId || null,
        changes: changes ? JSON.stringify(changes) : null,
        details: reason || null,
        ipAddress,
        userAgent,
      },
    });
  } catch (error) {
    // Audit logging should never block the main operation
    // but we still log the failure for debugging
    console.error("[Audit] Failed to write audit log:", {
      actorId,
      category,
      action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ============================================================================
// Convenience Audit Helpers
// ============================================================================

/** Log a user-related admin action (ban, delete, edit, etc.) */
export function auditUserAction(
  actorId: string,
  action: string,
  targetUserId: string,
  changes?: { before?: unknown; after?: unknown },
  reason?: string,
  request?: AuditWriteOptions["request"]
) {
  return writeAudit({
    actorId,
    category: "USER",
    action,
    targetType: "User",
    targetId: targetUserId,
    changes,
    reason,
    request,
  });
}

/** Log a role assignment/revocation */
export function auditRoleChange(
  actorId: string,
  action: "grant_role" | "revoke_role",
  targetUserId: string,
  role: string,
  reason?: string,
  request?: AuditWriteOptions["request"]
) {
  return writeAudit({
    actorId,
    category: "RBAC",
    action,
    targetType: "AdminUserRole",
    targetId: targetUserId,
    changes: { after: { role } },
    reason,
    request,
  });
}

/** Log a system configuration change */
export function auditSystemChange(
  actorId: string,
  action: string,
  configKey: string,
  changes?: { before?: unknown; after?: unknown },
  reason?: string,
  request?: AuditWriteOptions["request"]
) {
  return writeAudit({
    actorId,
    category: "SYSTEM",
    action,
    targetType: "SystemConfig",
    targetId: configKey,
    changes,
    reason,
    request,
  });
}

/** Log a match operation */
export function auditMatchAction(
  actorId: string,
  action: string,
  matchId: string,
  changes?: { before?: unknown; after?: unknown },
  reason?: string,
  request?: AuditWriteOptions["request"]
) {
  return writeAudit({
    actorId,
    category: "MATCH",
    action,
    targetType: "Match",
    targetId: matchId,
    changes,
    reason,
    request,
  });
}

/** Log a payment operation (refund, subscription change) */
export function auditPaymentAction(
  actorId: string,
  action: string,
  paymentId: string,
  changes?: { before?: unknown; after?: unknown },
  reason?: string,
  request?: AuditWriteOptions["request"]
) {
  return writeAudit({
    actorId,
    category: "PAYMENT",
    action,
    targetType: "Payment",
    targetId: paymentId,
    changes,
    reason,
    request,
  });
}
