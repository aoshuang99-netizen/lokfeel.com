const { createClient } = require('@libsql/client');
const db = createClient({
  url: process.env.DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

async function migrate() {
  const cols = [
    "ALTER TABLE Profile ADD COLUMN domSubRole TEXT;",
    "ALTER TABLE Profile ADD COLUMN preferredRole TEXT;",
    "ALTER TABLE Profile ADD COLUMN kinkExperienceLevel TEXT;",
    "ALTER TABLE Profile ADD COLUMN kinkInterests TEXT DEFAULT '[]';",
    "ALTER TABLE Profile ADD COLUMN hardLimits TEXT DEFAULT '[]';",
  ];
  for (const sql of cols) {
    try {
      await db.execute(sql);
      console.log('OK:', sql.slice(0, 60));
    } catch (e) {
      console.log('SKIP:', e.message.slice(0, 80));
    }
  }
  const result = await db.execute('PRAGMA table_info(Profile)');
  const newCols = result.rows.filter(r =>
    ['domSubRole','preferredRole','kinkExperienceLevel','kinkInterests','hardLimits'].includes(r.name)
  );
  console.log('\nNew columns verified:', newCols.length);
  newCols.forEach(c => console.log('  -', c.name, c.type));
  await db.close();
}

migrate().catch(console.error);
