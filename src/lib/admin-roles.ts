/**
 * LokFeel Admin RBAC — Role-Permission Matrix
 *
 * Defines which permissions each of the 7 roles has.
 * SUPER_ADMIN has all permissions (hardcoded in middleware).
 */

import { PERMISSIONS, type PermissionCode } from './admin-permissions';

// ============================================================================
// Role-Permission Assignments
// ============================================================================

/**
 * Each role maps to an array of permission codes.
 * SUPER_ADMIN is handled separately — always has ALL permissions.
 */
export const ROLE_PERMISSIONS: Record<string, PermissionCode[]> = {
  ADMIN: [
    // User (7/8 — no delete)
    'user.view', 'user.view_detail', 'user.edit', 'user.ban', 'user.tag', 'user.export', 'user.tracking',
    // Match (5/5)
    'match.view', 'match.view_detail', 'match.manual', 'match.cancel', 'match.engine',
    // Chat (3/4 — no sensitive)
    'chat.view', 'chat.view_detail', 'chat.message_delete',
    // Payment (3/4 — no config)
    'payment.view', 'payment.refund', 'payment.subscription',
    // Content (4/4)
    'content.report.view', 'content.report.action', 'content.consent', 'content.rule',
    // Bot (3/4 — no delete)
    'bot.view', 'bot.edit', 'bot.learning',
    // AI Creative (5/5)
    'ai_creative.view', 'ai_creative.template', 'ai_creative.generate', 'ai_creative.abtest', 'ai_creative.asset',
    // AI Support (5/5)
    'ai_support.view', 'ai_support.template', 'ai_support.knowledge', 'ai_support.routing', 'ai_support.qa',
    // VIP (7/7)
    'vip.view', 'vip.reply', 'vip.grant', 'vip.revoke', 'vip.user', 'vip.ticket', 'vip.performance',
    // Analytics (3/3)
    'analytics.view', 'analytics.export', 'analytics.funnel',
    // System (3/4 — no audit)
    'system.config.view', 'system.config.edit', 'system.health',
    // RBAC (0/8)
  ],

  MODERATOR: [
    // User (4/8 — view + ban + tag + tracking)
    'user.view', 'user.view_detail', 'user.ban', 'user.tag', 'user.tracking',
    // Match (2/5 — view only)
    'match.view', 'match.view_detail',
    // Chat (3/4)
    'chat.view', 'chat.view_detail', 'chat.sensitive',
    // Content (4/4)
    'content.report.view', 'content.report.action', 'content.consent',
    // Bot (1/4 — view only)
    'bot.view',
    // System (1/4 — health only)
    'system.health',
  ],

  ANALYST: [
    // User (2/8 — view only)
    'user.view', 'user.view_detail',
    // Match (2/5 — view only)
    'match.view', 'match.view_detail',
    // Payment (1/4 — view only)
    'payment.view',
    // Bot (1/4 — view only)
    'bot.view',
    // Analytics (3/3)
    'analytics.view', 'analytics.export', 'analytics.funnel',
    // System (1/4 — health only)
    'system.health',
  ],

  SUPPORT: [
    // User (2/8 — view only)
    'user.view', 'user.view_detail',
    // Content (1/4 — report view only)
    'content.report.view',
    // AI Support (2/5 — view + QA)
    'ai_support.view', 'ai_support.qa',
    // VIP (5/7)
    'vip.view', 'vip.reply', 'vip.ticket', 'vip.performance',
    // System (1/4 — config view only)
    'system.config.view',
    // System (1/4 — health only)
    'system.health',
  ],

  CREATIVE: [
    // AI Creative (5/5)
    'ai_creative.view', 'ai_creative.template', 'ai_creative.generate', 'ai_creative.abtest', 'ai_creative.asset',
    // Analytics (1/3 — view only, creative-related)
    'analytics.view',
    // System (1/4 — health only)
    'system.health',
  ],

  VIP_AGENT: [
    // User (2/8 — view only, VIP scope)
    'user.view', 'user.view_detail',
    // VIP (7/7)
    'vip.view', 'vip.reply', 'vip.grant', 'vip.revoke', 'vip.user', 'vip.ticket', 'vip.performance',
    // Analytics (1/3 — view only, VIP-related)
    'analytics.view',
    // System (1/4 — health only)
    'system.health',
  ],
};

// Build reverse lookup: permission → roles that have it
export const PERMISSION_ROLES: Record<PermissionCode, string[]> = {} as any;

for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
  for (const perm of perms) {
    if (!PERMISSION_ROLES[perm]) {
      PERMISSION_ROLES[perm] = [];
    }
    PERMISSION_ROLES[perm].push(role);
  }
}

// SUPER_ADMIN has everything
for (const perm of Object.keys(PERMISSIONS) as PermissionCode[]) {
  if (!PERMISSION_ROLES[perm]) {
    PERMISSION_ROLES[perm] = [];
  }
  if (!PERMISSION_ROLES[perm].includes('SUPER_ADMIN')) {
    PERMISSION_ROLES[perm].push('SUPER_ADMIN');
  }
}
