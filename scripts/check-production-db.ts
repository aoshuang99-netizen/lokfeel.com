import { createClient } from '@libsql/client';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config({ path: '.env' });

const DATABASE_URL = process.env.DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!DATABASE_URL || !TURSO_AUTH_TOKEN) {
  console.error('Missing DATABASE_URL or TURSO_AUTH_TOKEN in .env');
  process.exit(1);
}

const client = createClient({
  url: DATABASE_URL,
  authToken: TURSO_AUTH_TOKEN,
});

async function runQueries() {
  console.log('=== LokFeel Production Database Check ===\n');
  console.log(`Database: ${DATABASE_URL}\n`);

  try {
    // Query 1: Total users
    console.log('1. Total users:');
    const totalUsers = await client.execute('SELECT COUNT(*) as total FROM User');
    console.log(`   ${JSON.stringify(totalUsers.rows[0])}\n`);

    // Query 2: Bot users
    console.log('2. Bot users:');
    const bots = await client.execute('SELECT COUNT(*) as bots FROM User WHERE isBot = 1');
    console.log(`   ${JSON.stringify(bots.rows[0])}\n`);

    // Query 3: Real users
    console.log('3. Real users (non-bot):');
    const realUsers = await client.execute('SELECT COUNT(*) as real_users FROM User WHERE isBot = 0 OR isBot IS NULL');
    console.log(`   ${JSON.stringify(realUsers.rows[0])}\n`);

    // Query 4: Gender distribution
    console.log('4. Gender distribution:');
    const genderDist = await client.execute('SELECT gender, COUNT(*) as count FROM Profile GROUP BY gender');
    if (genderDist.rows.length === 0) {
      console.log('   No profiles found\n');
    } else {
      genderDist.rows.forEach(row => {
        console.log(`   ${JSON.stringify(row)}`);
      });
      console.log();
    }

    // Query 5: Profile status distribution
    console.log('5. Profile status distribution:');
    const profileStatusDist = await client.execute('SELECT profileStatus, COUNT(*) as count FROM Profile GROUP BY profileStatus');
    if (profileStatusDist.rows.length === 0) {
      console.log('   No profiles found\n');
    } else {
      profileStatusDist.rows.forEach(row => {
        console.log(`   ${JSON.stringify(row)}`);
      });
      console.log();
    }

    // Query 6: Onboarding step distribution
    console.log('6. Onboarding step distribution:');
    const onboardingDist = await client.execute('SELECT onboardingStep, COUNT(*) as count FROM Profile GROUP BY onboardingStep');
    if (onboardingDist.rows.length === 0) {
      console.log('   No profiles found\n');
    } else {
      onboardingDist.rows.forEach(row => {
        console.log(`   ${JSON.stringify(row)}`);
      });
      console.log();
    }

    // Query 7: Users with missing profiles (bots only as per query)
    console.log('7. Bot users with missing profiles:');
    const missingProfiles = await client.execute(`
      SELECT COUNT(*) as count 
      FROM User u 
      LEFT JOIN Profile p ON u.id = p.userId 
      WHERE p.id IS NULL AND u.isBot = 1
    `);
    console.log(`   ${JSON.stringify(missingProfiles.rows[0])}\n`);

    // Query 8: Duplicate emails
    console.log('8. Duplicate emails:');
    const duplicateEmails = await client.execute(`
      SELECT email, COUNT(*) as c 
      FROM User 
      GROUP BY email 
      HAVING c > 1
    `);
    if (duplicateEmails.rows.length === 0) {
      console.log('   No duplicate emails found\n');
    } else {
      duplicateEmails.rows.forEach(row => {
        console.log(`   ${JSON.stringify(row)}`);
      });
      console.log();
    }

    console.log('=== Database Check Complete ===');

  } catch (error) {
    console.error('Error running queries:', error);
  } finally {
    await client.close();
  }
}

runQueries();
