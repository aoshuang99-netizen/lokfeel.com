require('dotenv/config');
const { createClient } = require('@libsql/client');
const { randomUUID } = require('crypto');

const client = createClient({
  url: process.env.DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const ROLE_PERMS = {
  ADMIN: ['user.view','user.view_detail','user.edit','user.ban','user.tag','user.export','user.tracking','match.view','match.view_detail','match.manual','match.cancel','match.engine','chat.view','chat.view_detail','chat.message_delete','payment.view','payment.refund','payment.subscription','content.report.view','content.report.action','content.consent','content.rule','bot.view','bot.edit','bot.learning','ai_creative.view','ai_creative.template','ai_creative.generate','ai_creative.abtest','ai_creative.asset','ai_support.view','ai_support.template','ai_support.knowledge','ai_support.routing','ai_support.qa','vip.view','vip.reply','vip.grant','vip.revoke','vip.user','vip.ticket','vip.performance','analytics.view','analytics.export','analytics.funnel','system.config.view','system.config.edit','system.health'],
  MODERATOR: ['user.view','user.view_detail','user.ban','user.tag','user.tracking','match.view','match.view_detail','chat.view','chat.view_detail','chat.sensitive','content.report.view','content.report.action','content.consent','bot.view','system.health'],
  ANALYST: ['user.view','user.view_detail','match.view','match.view_detail','payment.view','bot.view','analytics.view','analytics.export','analytics.funnel','system.health'],
  SUPPORT: ['user.view','user.view_detail','content.report.view','ai_support.view','ai_support.qa','vip.view','vip.reply','vip.ticket','vip.performance','system.config.view','system.health'],
  CREATIVE: ['ai_creative.view','ai_creative.template','ai_creative.generate','ai_creative.abtest','ai_creative.asset','analytics.view','system.health'],
  VIP_AGENT: ['user.view','user.view_detail','vip.view','vip.reply','vip.grant','vip.revoke','vip.user','vip.ticket','vip.performance','analytics.view','system.health'],
};

async function seed() {
  console.log('Starting RBAC seed...');

  // Get all permissions
  const allPerms = await client.execute('SELECT code, id FROM AdminPermission');
  const permMap = {};
  for (const r of allPerms.rows) permMap[r.code] = r.id;
  console.log('Found', Object.keys(permMap).length, 'permissions');

  // Seed role-permission associations using batch
  const superPerms = Object.keys(permMap);
  const allRoles = { SUPER_ADMIN: superPerms, ...ROLE_PERMS };

  for (const [role, codes] of Object.entries(allRoles)) {
    const statements = [];
    for (const code of codes) {
      const pid = permMap[code];
      if (!pid) continue;
      statements.push({
        sql: 'INSERT OR IGNORE INTO AdminRolePermission (id, role, permissionId) VALUES (?, ?, ?)',
        args: [randomUUID(), role, pid]
      });
    }
    if (statements.length > 0) {
      try {
        await client.batch(statements);
        console.log('  Role', role, ':', statements.length, 'perms batched');
      } catch (e) {
        console.error('  Role', role, 'batch error:', e.message);
        // Fallback to sequential
        for (const s of statements) {
          try { await client.execute(s); } catch(e2) {}
        }
        console.log('  Role', role, ': fallback sequential done');
      }
    }
  }

  // Assign SUPER_ADMIN to admin@nexus.app
  const user = await client.execute({
    sql: 'SELECT id FROM User WHERE email = ?',
    args: ['admin@nexus.app']
  });

  if (user.rows.length > 0) {
    const uid = user.rows[0].id;
    await client.execute({
      sql: 'INSERT OR IGNORE INTO AdminUserRole (id, userId, role, department, title, grantedBy) VALUES (?, ?, ?, ?, ?, ?)',
      args: ['superadmin_' + uid, uid, 'SUPER_ADMIN', 'Executive', 'Founder', uid]
    });
    console.log('SUPER_ADMIN assigned to user:', uid);
  } else {
    console.log('WARNING: admin@nexus.app user not found!');
  }

  // Verify
  const rp = await client.execute('SELECT COUNT(*) as n FROM AdminRolePermission');
  const ur = await client.execute('SELECT COUNT(*) as n FROM AdminUserRole');
  const u = await client.execute('SELECT userId, role FROM AdminUserRole');

  console.log('\n=== RBAC Seed Summary ===');
  console.log('AdminPermission:', allPerms.rows.length);
  console.log('AdminRolePermission:', rp.rows[0].n);
  console.log('AdminUserRole:', ur.rows[0].n);
  console.log('Assignments:', JSON.stringify(u.rows));
}

seed().catch(e => { console.error('FATAL:', e); process.exit(1); });
