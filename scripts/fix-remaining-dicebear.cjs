#!/usr/bin/env node
// fix-remaining-dicebear.cjs
// Correctly parses Turso response format (verified via curl)
// Response: [{"results": {"columns":[...],"rows":[[...]],...}}]

const fs = require('fs');
const https = require('https');
const env = fs.readFileSync('.env', 'utf8').split('\n').reduce((o, l) => {
  const i = l.indexOf('='); if (i > 0) o[l.slice(0,i).trim()] = l.slice(i+1).trim();
  return o;
}, {});

const DB = env.DATABASE_URL, TOKEN = env.TURSO_AUTH_TOKEN;

console.log('🔧 Fixing remaining DiceBear URLs in database...\n');

function getPhotoUrl(seed, gender) {
  const female = (gender||'').toUpperCase() === 'FEMALE' || (gender||'').toUpperCase() === 'WOMAN';
  let hash = 0;
  for (let i = 0; i < (seed||'x').length; i++) hash = ((hash<<5)-hash+(seed||'x').charCodeAt(i))|0;
  const idx = (Math.abs(hash) % 99) + 1;
  return `https://randomuser.me/api/portraits/${female?'women':'men'}/${idx}.jpg`;
}

function tursoRequest(sql, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ statements: [{ q: sql, params }] });
    const url = new URL(DB);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + TOKEN,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const r = JSON.parse(d);
          if (r.errors) { reject(new Error(JSON.stringify(r.errors))); return; }
          // Correct format: [{"results": {"columns":[...],"rows":[[...]]}}]
          if (Array.isArray(r) && r[0] && r[0].results) {
            resolve(r[0].results);
          } else {
            reject(new Error('Unknown format: ' + d.slice(0, 200)));
          }
        } catch(e) { reject(new Error('Parse error: ' + d.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function tursoBatch(statements) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ statements });
    const url = new URL(DB);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + TOKEN,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const r = JSON.parse(d);
          if (r.errors) { reject(new Error(JSON.stringify(r.errors))); return; }
          // Each statement result is in r[n].results
          const results = (Array.isArray(r) ? r : []).map(x => x.results || null);
          resolve(results);
        } catch(e) { reject(new Error('Parse batch: ' + d.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  // 1. Query all remaining DiceBear profiles
  console.log('📊 Querying profiles with DiceBear URLs...');
  const result = await tursoRequest(
    `SELECT id, displayName, gender FROM profile WHERE avatar LIKE ? LIMIT 10000`,
    ['%dicebear.com%']
  );
  const rows = result.rows || [];
  console.log(`   Found ${rows.length} profiles to fix\n`);
  
  if (!rows.length) { console.log('✅ No DiceBear URLs remaining!'); return; }

  // 2. Batch update (100 per request)
  console.log('🔄 Batch updating (100 per request)...');
  let updated = 0, errors = 0;
  const BATCH = 100;
  
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const statements = batch.map(([id, name, gender]) => ({
      q: `UPDATE profile SET avatar = ?, "avatarType" = ? WHERE id = ?`,
      params: [getPhotoUrl(name || id, gender), 'photo', id]
    }));
    
    try {
      await tursoBatch(statements);
      updated += batch.length;
      if (updated % 1000 === 0 || updated === rows.length) {
        console.log(`   Progress: ${updated}/${rows.length} (${(updated/rows.length*100).toFixed(1)}%)`);
      }
    } catch(e) {
      errors += batch.length;
      if (errors <= 500) console.error(`   ❌ Batch failed: ${e.message.slice(0,80)}`);
    }
  }
  
  console.log(`\n✅ Done! Updated: ${updated}, Errors: ${errors}\n`);

  // 3. Verify
  console.log('🔍 Verifying...');
  const check = await tursoRequest(`SELECT COUNT(*) FROM profile WHERE avatar LIKE ?`, ['%dicebear.com%']);
  const remaining = check.rows[0][0];
  console.log(`   Remaining DiceBear URLs: ${remaining}`);
  if (remaining === 0) console.log('🎉 All DiceBear URLs have been replaced with real photos!');
  else console.log(`⚠️  ${remaining} DiceBear URLs still remain`);
}

main().then(() => process.exit(0)).catch(e => { console.error('❌', e.message); process.exit(1); });
