#!/usr/bin/env node
// fix-db-simple.cjs - 最简单正确的版本

const fs = require('fs');
const https = require('https');
const env = fs.readFileSync('.env', 'utf8').split('\n').reduce((o, l) => {
  const i = l.indexOf('='); if (i > 0) o[l.slice(0,i).trim()] = l.slice(i+1).trim(); return o;
}, {});

const DB = env.DATABASE_URL, TOKEN = env.TURSO_AUTH_TOKEN;

function getPhoto(seed, gender) {
  const f = (gender||'').toUpperCase() === 'FEMALE' || (gender||'').toUpperCase() === 'WOMAN';
  let h = 0;
  for (let i = 0; i < (seed||'x').length; i++) h = ((h<<5)-h+(seed||'x').charCodeAt(i))|0;
  return `https://randomuser.me/api/portraits/${f?'women':'men'}/${Math.abs(h)%99+1}.jpg`;
}

function ask(sql, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({statements:[{q:sql, params}]});
    const url = new URL(DB);
    const req = https.request({hostname:url.hostname,path:url.pathname,method:'POST',headers:{'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}}, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const r = JSON.parse(d);
          if (r.errors) { reject(new Error(JSON.stringify(r.errors))); return; }
          // r 是数组: [{"results": {"columns":[...],"rows":[[...]]}}]
          if (Array.isArray(r) && r[0] && r[0].results) {
            resolve(r[0].results); // {columns: [...], rows: [[...]]}
          } else {
            reject(new Error('Unknown: '+d.slice(0,200)));
          }
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

async function main() {
  console.log('🔍 查询需要修复的 profiles...');
  const r = await ask('SELECT id, displayName, gender FROM profile WHERE avatar LIKE ? LIMIT 10000', ['%dicebear.com%']);
  console.log(`  找到 ${r.rows.length} 个需要修复\n`);
  if (!r.rows.length) { console.log('✅ 无需修复！'); return; }

  console.log('🔄 开始批量更新（100个/请求）...');
  let ok = 0, err = 0;
  for (let i = 0; i < r.rows.length; i += 100) {
    const batch = r.rows.slice(i, i+100);
    const stmts = batch.map(([id, name, gender]) => ({
      q: 'UPDATE profile SET avatar = ?, "avatarType" = ? WHERE id = ?',
      params: [getPhoto(name||id, gender), 'photo', id]
    }));
    try {
      await new Promise((resolve, reject) => {
        const body = JSON.stringify({statements: stmts});
        const url = new URL(DB);
        const req = https.request({hostname:url.hostname,path:url.pathname,method:'POST',headers:{'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}}, res => {
          let d = ''; res.on('data', c => d += c);
          res.on('end', () => { try { const r = JSON.parse(d); r.errors ? reject(new Error(JSON.stringify(r.errors))) : resolve(); } catch(e) { reject(e); } });
        });
        req.on('error', reject); req.write(body); req.end();
      });
      ok += batch.length;
      if (ok % 1000 === 0 || ok === r.rows.length) console.log(`  进度: ${ok}/${r.rows.length} (${(ok/r.rows.length*100).toFixed(1)}%)`);
    } catch(e) {
      err += batch.length;
      if (err <= 500) console.error(`  ❌ 批次失败: ${e.message.slice(0,80)}`);
    }
  }
  console.log(`\n✅ 完成！更新 ${ok}，错误 ${err}\n`);

  console.log('🔍 验证结果...');
  const check = await ask('SELECT COUNT(*) FROM profile WHERE avatar LIKE ?', ['%dicebear.com%']);
  console.log(`  剩余 DiceBear URLs: ${check.rows[0][0]}`);
}

main().then(() => { console.log('\n✅ 数据库修复完成！'); process.exit(0); }).catch(e => { console.error('\n❌', e.message); process.exit(1); });
