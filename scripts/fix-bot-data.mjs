/**
 * Fix Bot User Data Issues
 * 1. preferredGender lowercase -> uppercase
 * 2. Missing profiles for bot users
 */

import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env') });

const require = createRequire(import.meta.url);
const { createClient } = require('@libsql/client');

const turso = createClient({ 
  url: process.env.DATABASE_URL, 
  authToken: process.env.TURSO_AUTH_TOKEN 
});

async function main() {
  console.log('=== LokFeel Bot User Data Fix ===\n');

  // ═══ Fix 1: preferredGender lowercase ═══
  console.log('1. Fixing preferredGender format...');
  
  const before = await turso.execute("SELECT preferredGender, COUNT(*) as count FROM Profile WHERE userId IN (SELECT id FROM User WHERE isBot = 1) GROUP BY preferredGender");
  console.log('  Before:');
  before.rows.forEach(r => console.log(`    ${r.preferredGender}: ${r.count}`));

  const result = await turso.execute("UPDATE Profile SET preferredGender = UPPER(preferredGender) WHERE preferredGender IN ('male', 'female')");
  console.log(`  Updated: ${result.rowsAffected} rows`);

  const after = await turso.execute("SELECT preferredGender, COUNT(*) as count FROM Profile WHERE userId IN (SELECT id FROM User WHERE isBot = 1) GROUP BY preferredGender");
  console.log('  After:');
  after.rows.forEach(r => console.log(`    ${r.preferredGender}: ${r.count}`));

  // ═══ Fix 2: Missing profiles ═══
  console.log('\n2. Checking for bot users with missing profiles...');
  
  const missingProfiles = await turso.execute(`
    SELECT u.id, u.email, u.name, u.createdAt 
    FROM User u 
    LEFT JOIN Profile p ON u.id = p.userId 
    WHERE u.isBot = 1 AND p.id IS NULL
  `);
  
  console.log(`  Found ${missingProfiles.rows.length} bot users with missing profiles:`);
  missingProfiles.rows.forEach(r => console.log(`    ${r.email} (${r.name})`));

  // ═══ Fix 3: Verify onboardingStep ═══
  console.log('\n3. Checking onboardingStep distribution...');
  
  const steps = await turso.execute(`
    SELECT onboardingStep, COUNT(*) as count 
    FROM Profile 
    WHERE userId IN (SELECT id FROM User WHERE isBot = 1) 
    GROUP BY onboardingStep
  `);
  steps.rows.forEach(r => console.log(`    Step ${r.onboardingStep}: ${r.count} users`));

  // Fix any step < 8
  const fixSteps = await turso.execute(`
    UPDATE Profile SET onboardingStep = 8 
    WHERE userId IN (SELECT id FROM User WHERE isBot = 1) 
    AND onboardingStep < 8
  `);
  console.log(`  Fixed onboardingStep: ${fixSteps.rowsAffected} rows`);

  // ═══ Fix 4: Verify profileStatus ═══
  console.log('\n4. Checking profileStatus distribution...');
  
  const statuses = await turso.execute(`
    SELECT profileStatus, COUNT(*) as count 
    FROM Profile 
    WHERE userId IN (SELECT id FROM User WHERE isBot = 1) 
    GROUP BY profileStatus
  `);
  statuses.rows.forEach(r => console.log(`    ${r.profileStatus}: ${r.count} users`));

  // Fix any non-APPROVED
  const fixStatuses = await turso.execute(`
    UPDATE Profile SET profileStatus = 'APPROVED' 
    WHERE userId IN (SELECT id FROM User WHERE isBot = 1) 
    AND profileStatus != 'APPROVED'
  `);
  console.log(`  Fixed profileStatus: ${fixStatuses.rowsAffected} rows`);

  // ═══ Summary ═══
  console.log('\n=== Fix Summary ===');
  console.log(`preferredGender fixed: ${result.rowsAffected} rows`);
  console.log(`Missing profiles: ${missingProfiles.rows.length} (need manual fix)`);
  console.log(`onboardingStep fixed: ${fixSteps.rowsAffected} rows`);
  console.log(`profileStatus fixed: ${fixStatuses.rowsAffected} rows`);

  await turso.close();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
