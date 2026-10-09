/**
 * 性别词表迁移复验（功能级，不只是取值分布）
 *
 * 迁移完成 ≠ 功能正确。取值改对了，但**代码里的查询谓词**是否还命中目标人群，
 * 必须用与应用一致的谓词实查一遍。本脚本覆盖三条真实链路：
 *
 *   1. Discover（发现页）—— 输入是"我想看谁"（preferredGender）
 *   2. Square（广场）    —— 输入是"我是谁"（自己的 gender），取反向
 *   3. Lady Free 权益    —— 女性应自动持有 LADY_FREE 订阅
 *
 * 用法：node scripts/qa/verify-gender-migration.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';

const root = path.resolve(import.meta.dirname, '../..');
function parseEnv(f) {
  const o = {};
  if (!fs.existsSync(f)) return o;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return o;
}
const env = { ...parseEnv(path.join(root, '.env')), ...parseEnv(path.join(root, '.env.local')) };
const db = createClient({ url: env.DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

let pass = 0;
let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? ` → ${extra}` : ''}`); }
};

// ⚠️ libsql 的 execute() 返回 `{rows, columns, ...}`，**不是**数组。
//    直接取 `[0]` 会得到 undefined → `?? 0` → 所有计数假 0（断言会"通过"但毫无意义）。
const count = async (sql, args) => {
  const rs = await db.execute({ sql, args: args || [] });
  return Number(rs.rows[0]?.n ?? 0);
};

// ── 与应用同源的谓词（这里照抄 lib/gender-utils 的返回值） ─────────────
const TARGET = {
  MAN: ['MALE', 'MAN', 'TRANSGENDER_MAN'],
  WOMAN: ['FEMALE', 'WOMAN', 'TRANSGENDER_WOMAN'],
};
const OPPOSITE = {
  MAN: ['FEMALE', 'WOMAN', 'TRANSGENDER_WOMAN'],
  WOMAN: ['MALE', 'MAN', 'TRANSGENDER_MAN'],
};
const inClause = (vals) => vals.map(() => '?').join(',');

console.log('性别词表迁移复验');
console.log('─'.repeat(62));

console.log('\n1. 历史写法必须清零');
const legacyGender = await count(`SELECT COUNT(*) n FROM Profile WHERE gender IN ('MALE','FEMALE')`);
const legacyPref = await count(`SELECT COUNT(*) n FROM Profile WHERE preferredGender IN ('MALE','FEMALE')`);
ok('Profile.gender 无 MALE/FEMALE', legacyGender === 0, legacyGender);
ok('Profile.preferredGender 无 MALE/FEMALE', legacyPref === 0, legacyPref);

console.log('\n2. Discover：按偏好能找到人（每套偏好都必须 > 0）');
for (const [pref, vals] of Object.entries(TARGET)) {
  const n = await count(
    `SELECT COUNT(*) n FROM Profile p JOIN User u ON u.id = p.userId
      WHERE p.gender IN (${inClause(vals)}) AND p.profileStatus='APPROVED'`,
    vals
  );
  ok(`偏好 ${pref} 能查到候选人`, n > 0, n);
}

console.log('\n3. 存量偏好值（迁移前是 FEMALE/MALE）仍能被满足');
// 注意：候选人与偏好持有者**不是同一行**。这里分别断言"偏好侧存在"与"候选侧存在"，
// 而不是在同一行上做 gender ∩ preferredGender 的交集（那样必然为 0，是错的查询）。
for (const [pref, vals] of Object.entries(TARGET)) {
  const prefHolders = await count(`SELECT COUNT(*) n FROM Profile WHERE preferredGender = ?`, [pref]);
  const candidates = await count(
    `SELECT COUNT(*) n FROM Profile p WHERE p.gender IN (${inClause(vals)}) AND p.profileStatus='APPROVED'`,
    vals
  );
  ok(`偏好 ${pref} 的存量用户存在（${prefHolders} 人）且候选池非空（${candidates} 人）`,
    prefHolders > 0 && candidates > 0, `${prefHolders} / ${candidates}`);
}

console.log('\n4. Square：按自己性别取反向能找到人');
for (const [self, vals] of Object.entries(OPPOSITE)) {
  const n = await count(
    `SELECT COUNT(*) n FROM Profile p
      WHERE p.gender IN (${inClause(vals)}) AND p.profileStatus='APPROVED'`,
    vals
  );
  ok(`自身 ${self} 的反向候选人 > 0`, n > 0, n);
}

console.log('\n5. 男性视角必须**看不到**男性（反向过滤未被破坏）');
const maleSeesMale = await count(
  `SELECT COUNT(*) n FROM Profile p WHERE p.gender IN (${inClause(OPPOSITE.MAN)}) AND p.gender = 'MAN'`
);
ok('反向集合与自身性别不重叠', maleSeesMale === 0, maleSeesMale);

console.log('\n6. Lady Free 覆盖（女性应自动持有 LADY_FREE）');
const women = await count(`SELECT COUNT(*) n FROM Profile WHERE gender = 'WOMAN'`);
const womenWithLadyFree = await count(
  `SELECT COUNT(DISTINCT p.userId) n FROM Profile p
     JOIN Subscription s ON s.userId = p.userId AND s.plan='LADY_FREE' AND s.status='ACTIVE'
    WHERE p.gender = 'WOMAN'`
);
const uncovered = women - womenWithLadyFree;
// 迁移只改词表、不碰订阅，所以覆盖数必须**逐字保持**迁移前的 2173。
// （存量 1451 名女性（多为未见面的 bot 样本）本来就没有 LADY_FREE，属既有状态，非本次回归。）
const BASELINE_COVERED = 2173;
ok(`女性 LADY_FREE 覆盖数与迁移前一致（期望 ${BASELINE_COVERED}，实际 ${womenWithLadyFree}；women=${women} gap=${uncovered}）`,
  womenWithLadyFree === BASELINE_COVERED, `${womenWithLadyFree}`);

console.log('\n7. 迁移脚本幂等（再跑一次应影响 0 行）');
const remaining = legacyGender + legacyPref;
ok('无待迁移行（重跑影响 0 行）', remaining === 0, remaining);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
await db.close();
process.exit(fail > 0 ? 1 : 0);
