/**
 * LokFeel RBAC Seed Script
 *
 * Creates:
 * - 61 AdminPermission records
 * - 7 system roles with AdminRolePermission associations
 * - SUPER_ADMIN role for Frank's user
 *
 * Usage:
 *   npx tsx prisma/seed-rbac.ts
 */

import 'dotenv/config';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = require('../src/generated/index.js');

const db = new PrismaClient();

// ============================================================================
// 61 Permission Definitions
// ============================================================================

const PERMISSIONS = [
  // User Management (8)
  { code: 'user.view',          name: 'View User List',         category: 'USER',        dangerous: false },
  { code: 'user.view_detail',   name: 'View User Detail',       category: 'USER',        dangerous: false },
  { code: 'user.edit',          name: 'Edit User Profile',      category: 'USER',        dangerous: false },
  { code: 'user.ban',           name: 'Ban/Unban User',         category: 'USER',        dangerous: true  },
  { code: 'user.delete',        name: 'Delete User',            category: 'USER',        dangerous: true, critical: true },
  { code: 'user.tag',           name: 'Manage User Tags',       category: 'USER',        dangerous: false },
  { code: 'user.export',        name: 'Export User Data',       category: 'USER',        dangerous: true  },
  { code: 'user.tracking',      name: 'View User Tracking',     category: 'USER',        dangerous: false },
  // Match Management (5)
  { code: 'match.view',         name: 'View Match List',        category: 'MATCHING',    dangerous: false },
  { code: 'match.view_detail',  name: 'View Match Detail',      category: 'MATCHING',    dangerous: false },
  { code: 'match.manual',       name: 'Create Manual Match',    category: 'MATCHING',    dangerous: true  },
  { code: 'match.cancel',       name: 'Cancel Match',           category: 'MATCHING',    dangerous: true  },
  { code: 'match.engine',       name: 'Config Match Engine',    category: 'MATCHING',    dangerous: true  },
  // Chat Management (4)
  { code: 'chat.view',          name: 'View Chat List',         category: 'CHAT',        dangerous: false },
  { code: 'chat.view_detail',   name: 'View Chat Detail',       category: 'CHAT',        dangerous: false },
  { code: 'chat.message_delete',name: 'Delete Message',         category: 'CHAT',        dangerous: true  },
  { code: 'chat.sensitive',     name: 'View Sensitive Hits',    category: 'CHAT',        dangerous: false },
  // Payment Management (4)
  { code: 'payment.view',       name: 'View Payment Data',      category: 'PAYMENT',     dangerous: false },
  { code: 'payment.refund',     name: 'Execute Refund',         category: 'PAYMENT',     dangerous: true, critical: true },
  { code: 'payment.subscription', name: 'Manage Subscription',  category: 'PAYMENT',     dangerous: true  },
  { code: 'payment.config',     name: 'Config Payment Params',  category: 'PAYMENT',     dangerous: true, critical: true },
  // Content Moderation (4)
  { code: 'content.report.view',  name: 'View Reports',        category: 'CONTENT',     dangerous: false },
  { code: 'content.report.action', name: 'Process Report',     category: 'CONTENT',     dangerous: true  },
  { code: 'content.consent',      name: 'Manage Consent',     category: 'CONTENT',     dangerous: true  },
  { code: 'content.rule',         name: 'Config Rule Engine', category: 'CONTENT',     dangerous: true  },
  // Bot System (4)
  { code: 'bot.view',           name: 'View Bot List',          category: 'BOT',         dangerous: false },
  { code: 'bot.edit',           name: 'Edit Bot Config',        category: 'BOT',         dangerous: true  },
  { code: 'bot.learning',       name: 'Manage Bot Learning',    category: 'BOT',         dangerous: true  },
  { code: 'bot.delete',         name: 'Delete Bot',             category: 'BOT',         dangerous: true, critical: true },
  // AI Creative (5)
  { code: 'ai_creative.view',   name: 'View Creatives',         category: 'AI_CREATIVE', dangerous: false },
  { code: 'ai_creative.template', name: 'Manage Templates',    category: 'AI_CREATIVE', dangerous: true  },
  { code: 'ai_creative.generate', name: 'Trigger Generation',  category: 'AI_CREATIVE', dangerous: true  },
  { code: 'ai_creative.abtest', name: 'Manage A/B Tests',       category: 'AI_CREATIVE', dangerous: true  },
  { code: 'ai_creative.asset',  name: 'Manage Assets',          category: 'AI_CREATIVE', dangerous: true  },
  // AI Support (5)
  { code: 'ai_support.view',    name: 'View AI Support',        category: 'AI_SUPPORT',  dangerous: false },
  { code: 'ai_support.template',  name: 'Manage Templates',     category: 'AI_SUPPORT',  dangerous: true  },
  { code: 'ai_support.knowledge',  name: 'Manage Knowledge',    category: 'AI_SUPPORT',  dangerous: true  },
  { code: 'ai_support.routing', name: 'Config Routing',         category: 'AI_SUPPORT',  dangerous: true  },
  { code: 'ai_support.qa',      name: 'QA & Performance',       category: 'AI_SUPPORT',  dangerous: false },
  // VIP Management (7)
  { code: 'vip.view',           name: 'View VIP Inbox',         category: 'VIP',         dangerous: false },
  { code: 'vip.reply',          name: 'Reply VIP Message',      category: 'VIP',         dangerous: true  },
  { code: 'vip.grant',          name: 'Grant VIP Status',       category: 'VIP',         dangerous: true  },
  { code: 'vip.revoke',         name: 'Revoke VIP Status',      category: 'VIP',         dangerous: true  },
  { code: 'vip.user',           name: 'Manage VIP Users',       category: 'VIP',         dangerous: true  },
  { code: 'vip.ticket',         name: 'Manage Tickets',         category: 'VIP',         dangerous: true  },
  { code: 'vip.performance',    name: 'View Performance',       category: 'VIP',         dangerous: false },
  // Analytics (3)
  { code: 'analytics.view',     name: 'View Analytics',         category: 'ANALYTICS',   dangerous: false },
  { code: 'analytics.export',   name: 'Export Reports',         category: 'ANALYTICS',   dangerous: true  },
  { code: 'analytics.funnel',   name: 'View Funnels',           category: 'ANALYTICS',   dangerous: false },
  // System (4)
  { code: 'system.config.view', name: 'View System Config',     category: 'SYSTEM',      dangerous: false },
  { code: 'system.config.edit', name: 'Edit System Config',     category: 'SYSTEM',      dangerous: true  },
  { code: 'system.audit',       name: 'View Audit Logs',        category: 'SYSTEM',      dangerous: false },
  { code: 'system.health',      name: 'View System Health',     category: 'SYSTEM',      dangerous: false },
  // RBAC (8)
  { code: 'rbac.role.view',     name: 'View Roles',             category: 'RBAC',        dangerous: false },
  { code: 'rbac.role.create',   name: 'Create Role',            category: 'RBAC',        dangerous: true  },
  { code: 'rbac.role.edit',     name: 'Edit Role',              category: 'RBAC',        dangerous: true  },
  { code: 'rbac.role.delete',   name: 'Delete Role',            category: 'RBAC',        dangerous: true, critical: true },
  { code: 'rbac.user.assign',   name: 'Assign Admin Role',      category: 'RBAC',        dangerous: true, critical: true },
  { code: 'rbac.user.revoke',   name: 'Revoke Admin Role',      category: 'RBAC',        dangerous: true, critical: true },
  { code: 'rbac.permission.view', name: 'View Permissions',    category: 'RBAC',        dangerous: false },
  { code: 'rbac.permission.edit', name: 'Edit Permissions',    category: 'RBAC',        dangerous: true, critical: true },
];

// ============================================================================
// Role → Permission Mapping
// ============================================================================

const ROLE_PERMS: Record<string, string[]> = {
  ADMIN: [
    'user.view', 'user.view_detail', 'user.edit', 'user.ban', 'user.tag', 'user.export', 'user.tracking',
    'match.view', 'match.view_detail', 'match.manual', 'match.cancel', 'match.engine',
    'chat.view', 'chat.view_detail', 'chat.message_delete',
    'payment.view', 'payment.refund', 'payment.subscription',
    'content.report.view', 'content.report.action', 'content.consent', 'content.rule',
    'bot.view', 'bot.edit', 'bot.learning',
    'ai_creative.view', 'ai_creative.template', 'ai_creative.generate', 'ai_creative.abtest', 'ai_creative.asset',
    'ai_support.view', 'ai_support.template', 'ai_support.knowledge', 'ai_support.routing', 'ai_support.qa',
    'vip.view', 'vip.reply', 'vip.grant', 'vip.revoke', 'vip.user', 'vip.ticket', 'vip.performance',
    'analytics.view', 'analytics.export', 'analytics.funnel',
    'system.config.view', 'system.config.edit', 'system.health',
  ],
  MODERATOR: [
    'user.view', 'user.view_detail', 'user.ban', 'user.tag', 'user.tracking',
    'match.view', 'match.view_detail',
    'chat.view', 'chat.view_detail', 'chat.sensitive',
    'content.report.view', 'content.report.action', 'content.consent',
    'bot.view',
    'system.health',
  ],
  ANALYST: [
    'user.view', 'user.view_detail',
    'match.view', 'match.view_detail',
    'payment.view',
    'bot.view',
    'analytics.view', 'analytics.export', 'analytics.funnel',
    'system.health',
  ],
  SUPPORT: [
    'user.view', 'user.view_detail',
    'content.report.view',
    'ai_support.view', 'ai_support.qa',
    'vip.view', 'vip.reply', 'vip.ticket', 'vip.performance',
    'system.config.view', 'system.health',
  ],
  CREATIVE: [
    'ai_creative.view', 'ai_creative.template', 'ai_creative.generate', 'ai_creative.abtest', 'ai_creative.asset',
    'analytics.view',
    'system.health',
  ],
  VIP_AGENT: [
    'user.view', 'user.view_detail',
    'vip.view', 'vip.reply', 'vip.grant', 'vip.revoke', 'vip.user', 'vip.ticket', 'vip.performance',
    'analytics.view',
    'system.health',
  ],
};

// SUPER_ADMIN gets ALL permissions (handled separately)

// ============================================================================
// Seed Function
// ============================================================================

async function main() {
  console.log('🔐 Seeding RBAC data...');

  // ─── Step 1: Create 61 AdminPermission records ─────────────────────────

  console.log(`  📝 Creating ${PERMISSIONS.length} permission records...`);

  let created = 0;
  let skipped = 0;

  for (const perm of PERMISSIONS) {
    try {
      await db.adminPermission.upsert({
        where: { code: perm.code },
        update: {
          name: perm.name,
          category: perm.category as any,
          isDangerous: perm.dangerous,
        },
        create: {
          code: perm.code,
          name: perm.name,
          category: perm.category as any,
          isDangerous: perm.dangerous,
        },
      });
      created++;
    } catch (error) {
      console.log(`    ⚠️  Failed to create permission ${perm.code}:`, error);
      skipped++;
    }
  }

  console.log(`  ✅ Permissions: ${created} created/updated, ${skipped} skipped`);

  // ─── Step 2: Create AdminRolePermission for each role ──────────────────

  console.log('  🎭 Creating role-permission associations...');

  const allRoles = ['SUPER_ADMIN', 'ADMIN', 'MODERATOR', 'ANALYST', 'SUPPORT', 'CREATIVE', 'VIP_AGENT'];

  for (const role of allRoles) {
    const permCodes = role === 'SUPER_ADMIN'
      ? PERMISSIONS.map(p => p.code) // All permissions
      : ROLE_PERMS[role] || [];

    let roleCreated = 0;

    for (const code of permCodes) {
      try {
        // Find the permission record
        const permission = await db.adminPermission.findUnique({ where: { code } });
        if (!permission) continue;

        await db.adminRolePermission.upsert({
          where: {
            roleId_permissionId: {
              roleId: role as any,
              permissionId: permission.id,
            },
          },
          create: {
            roleId: role as any,
            permissionId: permission.id,
          },
          update: {},
        });
        roleCreated++;
      } catch {
        // Ignore duplicates
      }
    }

    console.log(`    ✅ ${role}: ${roleCreated} permissions`);
  }

  // ─── Step 3: Assign SUPER_ADMIN to Frank's user ───────────────────────

  console.log('  👑 Assigning SUPER_ADMIN to Frank...');

  const frankEmail = process.env.FRANK_EMAIL || process.env.ADMIN_EMAIL || 'admin@nexus.app';

  try {
    const frank = await db.user.findUnique({ where: { email: frankEmail } });

    if (!frank) {
      console.log(`    ⚠️  User not found with email: ${frankEmail}`);
      console.log(`    💡 Set FRANK_EMAIL env variable to assign SUPER_ADMIN`);
    } else {
      await db.adminUserRole.upsert({
        where: {
          id: `superadmin_${frank.id}`,
        },
        create: {
          id: `superadmin_${frank.id}`,
          userId: frank.id,
          role: 'SUPER_ADMIN',
          department: 'Executive',
          title: 'Founder',
          grantedAt: new Date(),
          grantedBy: frank.id,
        },
        update: {},
      });

      console.log(`    ✅ SUPER_ADMIN assigned to ${frank.email} (${frank.id})`);

      // Also write audit log
      await db.adminAudit.create({
        data: {
          actorId: frank.id,
          category: 'RBAC',
          action: 'grant_role',
          targetType: 'AdminUserRole',
          targetId: frank.id,
          changes: JSON.stringify({ after: { role: 'SUPER_ADMIN' } }),
          reason: 'Initial RBAC seed',
        },
      });
    }
  } catch (error) {
    console.log(`    ⚠️  Failed to assign SUPER_ADMIN:`, error);
  }

  // ─── Summary ───────────────────────────────────────────────────────────

  const totalPermissions = await db.adminPermission.count();
  const totalRolePerms = await db.adminRolePermission.count();
  const totalUserRoles = await db.adminUserRole.count();

  console.log('\n🔐 RBAC Seed Complete!');
  console.log(`  📝 AdminPermission records: ${totalPermissions}`);
  console.log(`  🔗 AdminRolePermission records: ${totalRolePerms}`);
  console.log(`  👤 AdminUserRole records: ${totalUserRoles}`);
}

// ============================================================================
// Execute
// ============================================================================

main()
  .catch((error) => {
    console.error('❌ RBAC Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
