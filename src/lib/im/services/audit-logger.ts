/**
 * Audit Logger — Immutable audit trail with hash chain
 * Based on POWER_BOARD_RULE_ENGINE_SPEC.md §Audit
 * 
 * Features:
 * - Hash chain linking (prevHash → entryHash)
 * - Tamper detection
 * - Structured logging per action type
 */

import { db } from '@/lib/db';
import crypto from 'crypto';

export interface AuditLogEntry {
  userId: string;
  conversationId?: string;
  action: AuditAction;
  actorId?: string;
  targetId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  deviceId?: string;
}

export type AuditAction =
  | 'boundary_changed'
  | 'consent_requested'
  | 'consent_granted'
  | 'consent_denied'
  | 'consent_revoked'
  | 'message_blocked'
  | 'rule_violation'
  | 'security_event'
  | 'message_sent'
  | 'conversation_created'
  | 'conversation_blocked'
  | 'conversation_expired'
  | 'vault_extended'
  | 'vault_revoked'
  | 'screenshot_detected';

export class AuditLogger {
  /**
   * Record an audit log entry with hash chain
   */
  async record(entry: AuditLogEntry): Promise<string> {
    // Get previous entry hash
    const lastEntry = await db.auditLog.findFirst({
      where: { userId: entry.userId },
      orderBy: { createdAt: 'desc' },
      select: { entryHash: true },
    });

    const prevHash = lastEntry?.entryHash || 'genesis';

    // Calculate this entry's hash
    const entryData = JSON.stringify({
      ...entry,
      prevHash,
      timestamp: Date.now(),
    });
    const entryHash = crypto
      .createHash('sha256')
      .update(entryData)
      .digest('hex');

    // Store in DB
    const record = await db.auditLog.create({
      data: {
        userId: entry.userId,
        conversationId: entry.conversationId,
        action: entry.action,
        actorId: entry.actorId,
        targetId: entry.targetId,
        details: entry.details ? JSON.stringify(entry.details) : null,
        prevHash,
        entryHash,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        deviceId: entry.deviceId,
      },
    });

    return record.id;
  }

  /**
   * Verify hash chain integrity for a user
   * Returns true if chain is intact
   */
  async verifyChain(userId: string): Promise<{ valid: boolean; brokenAt?: string }> {
    const entries = await db.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, prevHash: true, entryHash: true, action: true },
    });

    let prevHash = 'genesis';
    for (const entry of entries) {
      if (entry.prevHash !== prevHash) {
        return { valid: false, brokenAt: entry.id };
      }
      prevHash = entry.entryHash;
    }

    return { valid: true };
  }

  /**
   * Get audit log entries for a user/conversation
   */
  async getEntries(
    userId: string,
    options?: {
      conversationId?: string;
      action?: AuditAction;
      from?: Date;
      to?: Date;
      limit?: number;
    }
  ) {
    const where: any = { userId };
    if (options?.conversationId) where.conversationId = options.conversationId;
    if (options?.action) where.action = options.action;
    if (options?.from || options?.to) {
      where.createdAt = {};
      if (options?.from) where.createdAt.gte = options.from;
      if (options?.to) where.createdAt.lte = options.to;
    }

    return db.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: options?.limit || 50,
    });
  }
}

// Singleton
export const auditLogger = new AuditLogger();
