/**
 * 性别词表迁移：把历史写法收敛到现行写法。
 *
 *   Profile.gender        MALE / FEMALE  →  MAN / WOMAN
 *   Profile.preferredGender  MALE / FEMALE  →  MAN / WOMAN
 *
 * ## 为什么
 *
 * `enum Gender` 里同时挂着两套值（`prisma/schema/core.prisma`）：
 *   · 现行：MAN / WOMAN / NON_BINARY / TRANSGENDER_* / …
 *   · 历史（标注 Legacy）：MALE / FEMALE
 *
 * 新注册走 `api/auth/register` 落现行写法，但存量数据（生产约 1.19 万行）是历史写法。
 * 代码层已用 `lib/gender-utils` 的 `isFemaleGender/normalizeGender` 兼容两套，
 * 所以**不迁也不会坏**；但两套并存意味着任何一处漏用 helper 的原始比较都会静默失效。
 * 本脚本把数据侧收敛掉，让"两套并存"从根上消失。
 *
 * ## 安全性
 *
 * · 默认 **dry-run**，只打印不写库；必须显式 `--apply` 才落库。
 * · 落库前先把受影响行完整导出到 `.gender-migration-backup-<ts>.json`（可回滚）。
 * · 幂等：只匹配 `IN ('MALE','FEMALE')`，重复跑第二次影响 0 行。
 * · NON_BINARY / TRANSGENDER_* / OTHER 一律不动。
 *
 * 用法：
 *   node scripts/qa/migrate-gender-vocab.mjs            # 预演
 *   node scripts/qa/migrate-gender-vocab.mjs --apply    # 落库
 */

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';

const root = path.resolve(import.meta.dirname, '../..');
const APPLY = process.argv.includes('--apply');

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
if (!env.DATABASE_URL) {
  console.error('缺少 DATABASE_URL（检查 .env / .env.local）');
  process.exit(2);
}

const db = createClient({ url: env.DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

const LEGACY = ['MALE', 'FEMALE'];
const MAP = { MALE: 'MAN', FEMALE: 'WOMAN' };

const q = async (sql, args) => (await db.execute({ sql, args: args || [] })).rows;

async function distribution(label) {
  const rows = await q(
    `SELECT gender, preferredGender, COUNT(*) n FROM Profile
      GROUP BY gender, preferredGender ORDER BY n DESC`
  );
  console.log(`\n=== ${label} ===`);
  for (const r of rows) console.log(`  gender=${r.gender}  preferredGender=${r.preferredGender}  n=${r.n}`);
  return rows;
}

const line = (n = 62) => console.log('─'.repeat(n));

console.log(`性别词表迁移  ${APPLY ? '【 APPLY 落库 】' : '【 DRY-RUN 预演 】'}`);
line();

await distribution('迁移前：Profile 取值分布');

// ── 1. 取受影响行（gender 或 preferredGender 为历史写法） ──────────────
const affected = await q(
  `SELECT id, userId, gender, preferredGender FROM Profile
    WHERE gender IN ('MALE','FEMALE') OR preferredGender IN ('MALE','FEMALE')`
);
console.log(`\n受影响行数：${affected.length}`);

const genderRows = affected.filter((r) => LEGACY.includes(r.gender));
const prefRows = affected.filter((r) => LEGACY.includes(r.preferredGender));
console.log(`  · gender 需改：${genderRows.length}`);
console.log(`  · preferredGender 需改：${prefRows.length}`);
console.log(`  · 样例：`);
for (const r of affected.slice(0, 5)) {
  console.log(`      ${r.id}  ${r.gender} → ${MAP[r.gender] || r.gender}   pref ${r.preferredGender} → ${MAP[r.preferredGender] || r.preferredGender}`);
}

// ── 2. 备份 ────────────────────────────────────────────────────────────
if (APPLY && affected.length > 0) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(root, `.gender-migration-backup-${ts}.json`);
  fs.writeFileSync(
    backup,
    JSON.stringify({ ts, count: affected.length, rows: affected.map((r) => ({ ...r })) }, null, 1)
  );
  console.log(`\n✅ 备份已写入：${path.basename(backup)}（回滚：按 id 把 gender/preferredGender 写回原值）`);
}

if (!APPLY) {
  console.log('\n（预演结束，未改动任何数据。加 --apply 落库。）');
  await db.close();
  process.exit(0);
}

// ── 3. 落库（两条 UPDATE，幂等） ───────────────────────────────────────
// ⚠️ 刻意**不动 `updatedAt`**：词表归一不是"用户改了资料"，改 updatedAt 会污染
//    以"最近更新"为依据的排序/统计（且很可能触发无关的缓存失效）。
line();
const r1 = await db.execute(
  `UPDATE Profile SET gender = CASE gender WHEN 'MALE' THEN 'MAN' WHEN 'FEMALE' THEN 'WOMAN' END
    WHERE gender IN ('MALE','FEMALE')`
);
console.log(`gender           更新行数：${r1.rowsAffected}`);
const r2 = await db.execute(
  `UPDATE Profile SET preferredGender = CASE preferredGender WHEN 'MALE' THEN 'MAN' WHEN 'FEMALE' THEN 'WOMAN' END
    WHERE preferredGender IN ('MALE','FEMALE')`
);
console.log(`preferredGender  更新行数：${r2.rowsAffected}`);

// ── 4. 复验 ────────────────────────────────────────────────────────────
await distribution('迁移后：Profile 取值分布');

const check = await q(
  `SELECT (SELECT COUNT(*) FROM Profile WHERE gender IN ('MALE','FEMALE')) legacyGender,
          (SELECT COUNT(*) FROM Profile WHERE preferredGender IN ('MALE','FEMALE')) legacyPref,
          (SELECT COUNT(*) FROM Profile WHERE gender IN ('MAN','WOMAN')) modernGender`
);
console.log(`\n复验：legacy gender=${check[0].legacyGender}  legacy pref=${check[0].legacyPref}  modern gender=${check[0].modernGender}`);
const pass = Number(check[0].legacyGender) === 0 && Number(check[0].legacyPref) === 0;
console.log(pass ? '✅ 迁移完成：历史写法已清零' : '❌ 仍有历史写法残留');
await db.close();
process.exit(pass ? 0 : 1);
