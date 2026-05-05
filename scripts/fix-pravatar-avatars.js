/**
 * Fix broken pravatar.cc avatar URLs in Turso DB
 * Replaces all i.pravatar.cc URLs with randomuser.me equivalents
 * Uses batch transactions for speed
 */

const { createClient } = require('@libsql/client');
const fs = require('fs');
const path = require('path');

// Read auth token from .env.local
const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const tokenMatch = envContent.match(/TURSO_AUTH_TOKEN=(.+)/);
const token = tokenMatch ? tokenMatch[1].trim() : '';

if (!token) {
  console.error('TURSO_AUTH_TOKEN not found in .env.local');
  process.exit(1);
}

const client = createClient({
  url: 'libsql://lokfeelcom-lokfeelboss.aws-us-east-1.turso.io',
  authToken: token,
});

/**
 * Convert pravatar URL to randomuser.me URL
 * i.pravatar.cc/512?img=4 → randomuser.me/api/portraits/women/4.jpg
 */
function convertPravatarUrl(pravatarUrl) {
  const match = pravatarUrl.match(/img=(\d+)/);
  if (!match) return null;
  
  const imgNum = parseInt(match[1]);
  // Use women for 1-99, men for 100+ (as original pravatar did)
  const gender = imgNum <= 100 ? 'women' : 'men';
  const index = imgNum <= 100 ? imgNum : imgNum - 100;
  
  return `https://randomuser.me/api/portraits/${gender}/${index}.jpg`;
}

async function fixAvatars() {
  console.log('Fetching profiles with pravatar URLs...');
  
  // Get all profiles with pravatar URLs
  const result = await client.execute(
    "SELECT userId, avatar FROM Profile WHERE avatar LIKE '%i.pravatar.cc%'"
  );
  
  console.log(`Found ${result.rows.length} profiles to update`);
  
  // Build update list
  const updates = [];
  for (const row of result.rows) {
    const newAvatar = convertPravatarUrl(row.avatar);
    if (newAvatar) {
      updates.push({ userId: row.userId, avatar: newAvatar });
    }
  }
  
  console.log(`Prepared ${updates.length} valid conversions`);
  
  // Batch update with transactions
  const batchSize = 200;
  let updated = 0;
  
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    
    try {
      // Use executeBatch for maximum speed
      const stmts = batch.map(item => ({
        sql: 'UPDATE Profile SET avatar = ? WHERE userId = ?',
        args: [item.avatar, item.userId]
      }));
      
      await client.batch(stmts, 'write');
      updated += batch.length;
      
      if (updated % 1000 === 0 || updated === updates.length) {
        console.log(`Progress: ${updated}/${updates.length}`);
      }
    } catch (e) {
      console.error(`Batch failed at ${i}:`, e.message);
    }
  }
  
  console.log(`\nProfile update done! Updated: ${updated}`);
  
  // Also update User.image field if it references pravatar
  const userResult = await client.execute(
    "SELECT id, image FROM User WHERE image LIKE '%i.pravatar.cc%'"
  );
  
  console.log(`\nFound ${userResult.rows.length} User records with pravatar image`);
  
  if (userResult.rows.length > 0) {
    let userUpdated = 0;
    const userBatchSize = 200;
    const userUpdates = [];
    
    for (const row of userResult.rows) {
      const newAvatar = convertPravatarUrl(row.image);
      if (newAvatar) {
        userUpdates.push({ id: row.id, image: newAvatar });
      }
    }
    
    for (let i = 0; i < userUpdates.length; i += userBatchSize) {
      const batch = userUpdates.slice(i, i + userBatchSize);
      const stmts = batch.map(item => ({
        sql: 'UPDATE User SET image = ? WHERE id = ?',
        args: [item.image, item.id]
      }));
      
      try {
        await client.batch(stmts, 'write');
        userUpdated += batch.length;
        console.log(`User progress: ${userUpdated}/${userUpdates.length}`);
      } catch (e) {
        console.error('User batch failed:', e.message);
      }
    }
    
    console.log(`User image updated: ${userUpdated}`);
  }
  
  // Verify
  const verifyResult = await client.execute(
    "SELECT COUNT(*) as count FROM Profile WHERE avatar LIKE '%i.pravatar.cc%'"
  );
  console.log(`\nRemaining pravatar URLs in Profile: ${verifyResult.rows[0].count}`);
  
  const verifyUserResult = await client.execute(
    "SELECT COUNT(*) as count FROM User WHERE image LIKE '%i.pravatar.cc%'"
  );
  console.log(`Remaining pravatar URLs in User: ${verifyUserResult.rows[0].count}`);
}

fixAvatars()
  .then(() => {
    console.log('\n✅ All done!');
    process.exit(0);
  })
  .catch(e => {
    console.error('\n❌ Script failed:', e);
    process.exit(1);
  });
