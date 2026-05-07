const path = require('path');
const fs = require('fs');
const { PrismaClient } = require(path.join(__dirname, '..', 'src', 'generated', 'client'));
const { PrismaLibSql } = require('@prisma/adapter-libsql');

const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const envVars = {};
envContent.split('\n').forEach(line => {
  const [key, ...rest] = line.split('=');
  if (key && rest.length) envVars[key.trim()] = rest.join('=').trim();
});

const rawUrl = (envVars.DATABASE_URL || '').trim();
const authToken = (envVars.TURSO_AUTH_TOKEN || '').trim();

try {
  const parsed = new URL(rawUrl);
  ['sslmode','ssl','channel_binding','connect_timeout','statement_timeout','application_name','options'].forEach(p => parsed.searchParams.delete(p));
  const url = parsed.toString();
  const adapter = new PrismaLibSql({ url, authToken: authToken || undefined });
  const prisma = new PrismaClient({ adapter });

  (async () => {
    const total = await prisma.user.count({ where: { email: { startsWith: 'ue-test-' } } });
    const m = await prisma.user.count({ where: { email: { startsWith: 'ue-test-m' } } });
    const f = await prisma.user.count({ where: { email: { startsWith: 'ue-test-f' } } });
    console.log('UE Test Users: total=' + total + ' male=' + m + ' female=' + f);
    await prisma.$disconnect();
  })();
} catch(e) {
  console.error('Error:', e.message);
}
