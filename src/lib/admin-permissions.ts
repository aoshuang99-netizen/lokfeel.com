/**
 * LokFee! Admin RBAC — 61 Permission Codes
 *
 * Permission format: {module}.{action}
 * Modules: user | match | chat | payment | content | bot |
 *          ai_creative | ai_support | vip | analytics | system | rbac
 * Actions: view | create | edit | delete | export | action_special
 */

// ============================================================================
// Permission Code Constants
// ============================================================================

export const PERMISSIONS = {
  // User Management (8)
  'user.view':          { name: 'View User List',         category: 'USER',        dangerous: false },
  'user.view_detail':   { name: 'View User Detail',       category: 'USER',        dangerous: false },
  'user.edit':          { name: 'Edit User Profile',      category: 'USER',        dangerous: false },
  'user.ban':           { name: 'Ban/Unban User',         category: 'USER',        dangerous: true  },
  'user.delete':        { name: 'Delete User',            category: 'USER',        dangerous: true, critical: true },
  'user.tag':           { name: 'Manage User Tags',       category: 'USER',        dangerous: false },
  'user.export':        { name: 'Export User Data',       category: 'USER',        dangerous: true  },
  'user.tracking':      { name: 'View User Tracking',     category: 'USER',        dangerous: false },

  // Match Management (5)
  'match.view':         { name: 'View Match List',        category: 'MATCHING',    dangerous: false },
  'match.view_detail':  { name: 'View Match Detail',      category: 'MATCHING',    dangerous: false },
  'match.manual':       { name: 'Create Manual Match',    category: 'MATCHING',    dangerous: true  },
  'match.cancel':       { name: 'Cancel Match',           category: 'MATCHING',    dangerous: true  },
  'match.engine':       { name: 'Config Match Engine',    category: 'MATCHING',    dangerous: true  },

  // Chat Management (4)
  'chat.view':          { name: 'View Chat List',         category: 'CHAT',        dangerous: false },
  'chat.view_detail':   { name: 'View Chat Detail',       category: 'CHAT',        dangerous: false },
  'chat.message_delete':{ name: 'Delete Message',         category: 'CHAT',        dangerous: true  },
  'chat.sensitive':     { name: 'View Sensitive Hits',    category: 'CHAT',        dangerous: false },

  // Payment Management (4)
  'payment.view':       { name: 'View Payment Data',      category: 'PAYMENT',     dangerous: false },
  'payment.refund':     { name: 'Execute Refund',         category: 'PAYMENT',     dangerous: true, critical: true },
  'payment.subscription':{ name: 'Manage Subscription',  category: 'PAYMENT',     dangerous: true  },
  'payment.config':     { name: 'Config Payment Params',  category: 'PAYMENT',     dangerous: true, critical: true },

  // Content Moderation (4)
  'content.report.view':  { name: 'View Reports',         category: 'CONTENT',     dangerous: false },
  'content.report.action':{ name: 'Process Report',      category: 'CONTENT',     dangerous: true  },
  'content.consent':      { name: 'Manage Consent',      category: 'CONTENT',     dangerous: true  },
  'content.rule':         { name: 'Config Rule Engine',  category: 'CONTENT',     dangerous: true  },

  // Bot System (4)
  'bot.view':           { name: 'View Bot List',          category: 'BOT',         dangerous: false },
  'bot.edit':           { name: 'Edit Bot Config',        category: 'BOT',         dangerous: true  },
  'bot.learning':       { name: 'Manage Bot Learning',    category: 'BOT',         dangerous: true  },
  'bot.delete':         { name: 'Delete Bot',             category: 'BOT',         dangerous: true, critical: true },

  // AI Creative (5)
  'ai_creative.view':   { name: 'View Creatives',         category: 'AI_CREATIVE', dangerous: false },
  'ai_creative.template':{ name: 'Manage Templates',     category: 'AI_CREATIVE', dangerous: true  },
  'ai_creative.generate':{ name: 'Trigger Generation',   category: 'AI_CREATIVE', dangerous: true  },
  'ai_creative.abtest': { name: 'Manage A/B Tests',       category: 'AI_CREATIVE', dangerous: true  },
  'ai_creative.asset':  { name: 'Manage Assets',          category: 'AI_CREATIVE', dangerous: true  },

  // AI Support (5)
  'ai_support.view':    { name: 'View AI Support',        category: 'AI_SUPPORT',  dangerous: false },
  'ai_support.template':{ name: 'Manage Templates',       category: 'AI_SUPPORT',  dangerous: true  },
  'ai_support.knowledge':{ name: 'Manage Knowledge',     category: 'AI_SUPPORT',  dangerous: true  },
  'ai_support.routing': { name: 'Config Routing',         category: 'AI_SUPPORT',  dangerous: true  },
  'ai_support.qa':      { name: 'QA & Performance',       category: 'AI_SUPPORT',  dangerous: false },

  // VIP Management (7)
  'vip.view':           { name: 'View VIP Inbox',         category: 'VIP',         dangerous: false },
  'vip.reply':          { name: 'Reply VIP Message',      category: 'VIP',         dangerous: true  },
  'vip.grant':          { name: 'Grant VIP Status',       category: 'VIP',         dangerous: true  },
  'vip.revoke':         { name: 'Revoke VIP Status',      category: 'VIP',         dangerous: true  },
  'vip.user':           { name: 'Manage VIP Users',       category: 'VIP',         dangerous: true  },
  'vip.ticket':         { name: 'Manage Tickets',         category: 'VIP',         dangerous: true  },
  'vip.performance':    { name: 'View Performance',       category: 'VIP',         dangerous: false },

  // Analytics (3)
  'analytics.view':     { name: 'View Analytics',         category: 'ANALYTICS',   dangerous: false },
  'analytics.export':   { name: 'Export Reports',         category: 'ANALYTICS',   dangerous: true  },
  'analytics.funnel':   { name: 'View Funnels',           category: 'ANALYTICS',   dangerous: false },

  // System (4)
  'system.config.view': { name: 'View System Config',     category: 'SYSTEM',      dangerous: false },
  'system.config.edit': { name: 'Edit System Config',     category: 'SYSTEM',      dangerous: true  },
  'system.audit':       { name: 'View Audit Logs',        category: 'SYSTEM',      dangerous: false },
  'system.health':      { name: 'View System Health',     category: 'SYSTEM',      dangerous: false },

  // RBAC (8)
  'rbac.role.view':     { name: 'View Roles',             category: 'RBAC',        dangerous: false },
  'rbac.role.create':   { name: 'Create Role',            category: 'RBAC',        dangerous: true  },
  'rbac.role.edit':     { name: 'Edit Role',              category: 'RBAC',        dangerous: true  },
  'rbac.role.delete':   { name: 'Delete Role',            category: 'RBAC',        dangerous: true, critical: true },
  'rbac.user.assign':   { name: 'Assign Admin Role',      category: 'RBAC',        dangerous: true, critical: true },
  'rbac.user.revoke':   { name: 'Revoke Admin Role',      category: 'RBAC',        dangerous: true, critical: true },
  'rbac.permission.view':{ name: 'View Permissions',      category: 'RBAC',        dangerous: false },
  'rbac.permission.edit':{ name: 'Edit Permissions',      category: 'RBAC',        dangerous: true, critical: true },
} as const;

// All permission codes as a tuple type
export type PermissionCode = keyof typeof PERMISSIONS;

// All permission codes as an array
export const ALL_PERMISSION_CODES = Object.keys(PERMISSIONS) as PermissionCode[];

// Grouped permissions by category
export const PERMISSION_CATEGORIES = {
  USER:        ALL_PERMISSION_CODES.filter(p => PERMISSIONS[p].category === 'USER'),
  MATCHING:    ALL_PERMISSION_CODES.filter(p => PERMISSIONS[p].category === 'MATCHING'),
  CHAT:        ALL_PERMISSION_CODES.filter(p => PERMISSIONS[p].category === 'CHAT'),
  PAYMENT:     ALL_PERMISSION_CODES.filter(p => PERMISSIONS[p].category === 'PAYMENT'),
  CONTENT:     ALL_PERMISSION_CODES.filter(p => PERMISSIONS[p].category === 'CONTENT'),
  BOT:         ALL_PERMISSION_CODES.filter(p => PERMISSIONS[p].category === 'BOT'),
  AI_CREATIVE: ALL_PERMISSION_CODES.filter(p => PERMISSIONS[p].category === 'AI_CREATIVE'),
  AI_SUPPORT:  ALL_PERMISSION_CODES.filter(p => PERMISSIONS[p].category === 'AI_SUPPORT'),
  VIP:         ALL_PERMISSION_CODES.filter(p => PERMISSIONS[p].category === 'VIP'),
  ANALYTICS:   ALL_PERMISSION_CODES.filter(p => PERMISSIONS[p].category === 'ANALYTICS'),
  SYSTEM:      ALL_PERMISSION_CODES.filter(p => PERMISSIONS[p].category === 'SYSTEM'),
  RBAC:        ALL_PERMISSION_CODES.filter(p => PERMISSIONS[p].category === 'RBAC'),
} as const;

// Dangerous permissions that need confirmation
export const DANGEROUS_PERMISSIONS = ALL_PERMISSION_CODES.filter(
  p => PERMISSIONS[p].dangerous
);

// Critical permissions that require typed confirmation
export const CRITICAL_PERMISSIONS = ALL_PERMISSION_CODES.filter(
  p => 'critical' in PERMISSIONS[p] && PERMISSIONS[p].critical === true
);
