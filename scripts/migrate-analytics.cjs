/**
 * Analytics Migration Script
 * 
 * Migrates the existing AnalyticsEvent table and creates new tables.
 * Uses @libsql/client directly for Turso compatibility.
 * 
 * Usage: node scripts/migrate-analytics.mjs
 */

const { createClient } = require('@libsql/client');
require('dotenv').config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || process.env.DATABASE_AUTH_TOKEN || '';

const client = createClient({
  url: DATABASE_URL,
  authToken: AUTH_TOKEN,
});

async function migrate() {
  console.log('Starting analytics migration...\n');

  // 1. Check existing AnalyticsEvent table columns
  console.log('1. Checking AnalyticsEvent table...');
  try {
    const info = await client.execute("PRAGMA table_info('AnalyticsEvent')");
    const existingCols = info.rows.map(r => r.name);
    console.log('   Existing columns:', existingCols.join(', '));

    // Add missing columns
    const newCols = [
      { name: 'eventCategory', type: 'TEXT', default: "''" },
      { name: 'deviceId', type: 'TEXT', default: "''" },
      { name: 'pagePath', type: 'TEXT', default: "''" },
      { name: 'platform', type: 'TEXT', default: "'web'" },
      { name: 'appVersion', type: 'TEXT', default: "''" },
      { name: 'country', type: 'TEXT' },
      { name: 'city', type: 'TEXT' },
      { name: 'utmSource', type: 'TEXT' },
      { name: 'utmMedium', type: 'TEXT' },
      { name: 'utmCampaign', type: 'TEXT' },
      { name: 'utmContent', type: 'TEXT' },
      { name: 'utmTerm', type: 'TEXT' },
    ];

    for (const col of newCols) {
      if (!existingCols.includes(col.name)) {
        const sql = `ALTER TABLE AnalyticsEvent ADD COLUMN "${col.name}" ${col.type}${col.default ? ' DEFAULT ' + col.default : ''}`;
        try {
          await client.execute(sql);
          console.log(`   ✅ Added column: ${col.name}`);
        } catch (err) {
          console.log(`   ⚠️  Column ${col.name}: ${err.message}`);
        }
      } else {
        console.log(`   · Column ${col.name} already exists`);
      }
    }
  } catch (err) {
    if (err.message.includes('no such table')) {
      console.log('   AnalyticsEvent table does not exist yet — will be created by Prisma on next deploy');
    } else {
      console.log(`   ⚠️  ${err.message}`);
    }
  }

  // 2. Create AnalyticsEventDef table
  console.log('\n2. Creating AnalyticsEventDef table...');
  try {
    await client.execute(`
      CREATE TABLE IF NOT EXISTS AnalyticsEventDef (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        category TEXT NOT NULL,
        description TEXT DEFAULT '',
        properties TEXT DEFAULT '{}',
        isActive INTEGER DEFAULT 1,
        sampleRate REAL DEFAULT 1.0,
        createdAt TEXT DEFAULT (datetime('now')),
        updatedAt TEXT DEFAULT (datetime('now'))
      )
    `);
    console.log('   ✅ AnalyticsEventDef table ready');
  } catch (err) {
    console.log(`   ⚠️  ${err.message}`);
  }

  // 3. Create AnalyticsDailyAgg table
  console.log('\n3. Creating AnalyticsDailyAgg table...');
  try {
    await client.execute(`
      CREATE TABLE IF NOT EXISTS AnalyticsDailyAgg (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        eventName TEXT NOT NULL,
        metricName TEXT NOT NULL,
        value REAL NOT NULL,
        dimensions TEXT DEFAULT '{}',
        createdAt TEXT DEFAULT (datetime('now')),
        UNIQUE(date, eventName, metricName, dimensions)
      )
    `);
    console.log('   ✅ AnalyticsDailyAgg table ready');
  } catch (err) {
    console.log(`   ⚠️  ${err.message}`);
  }

  // 4. Create indexes
  console.log('\n4. Creating indexes...');
  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_ae_event_category ON AnalyticsEvent(eventCategory, createdAt)`,
    `CREATE INDEX IF NOT EXISTS idx_ae_session ON AnalyticsEvent(sessionId)`,
    `CREATE INDEX IF NOT EXISTS idx_ae_date ON AnalyticsEvent(createdAt)`,
    `CREATE INDEX IF NOT EXISTS idx_ada_date ON AnalyticsDailyAgg(date)`,
    `CREATE INDEX IF NOT EXISTS idx_ada_date_event ON AnalyticsDailyAgg(date, eventName)`,
  ];

  for (const idxSql of indexes) {
    try {
      await client.execute(idxSql);
      console.log(`   ✅ Index: ${idxSql.slice(0, 60)}...`);
    } catch (err) {
      console.log(`   ⚠️  ${err.message}`);
    }
  }

  // 5. Verify
  console.log('\n5. Verification...');
  const tables = await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Analytics%'");
  console.log('   Analytics tables:', tables.rows.map(r => r.name).join(', '));

  console.log('\n✅ Migration complete!');
}

migrate()
  .catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  })
  .finally(() => {
    client.close();
  });
