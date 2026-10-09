/**
 * 性别词表一致性门禁
 *
 * 用法：`npm run verify:gender`（退出码 0 = 通过，1 = 有断言失败）
 *
 * ## 为什么需要它
 *
 * `Profile.gender` 是 TEXT 列，历史上并存两套词表：
 *   历史写法：MALE / FEMALE（生产约 1.19 万行）
 *   现行写法：MAN / WOMAN / NON_BINARY / TRANSGENDER_*（新注册与后台写入）
 *
 * 只要有一处代码做**原始字符串比较**，两套词表就会被判为不同：
 *   · 在匹配过滤里 → 符合偏好的候选人被**静默丢弃**（发现页看不到人，无报错）
 *   · 在评分里     → 正确候选人被**错误扣分**（排序被压低，无报错）
 *   · 在查询 where 里 → 查不到人（例如 `gender: 'FEMALE'` 漏掉所有 WOMAN）
 *
 * 这类缺陷不会抛异常，只会悄悄改变结果，所以必须靠断言钉住。
 *
 * @module scripts/verify-gender-vocab
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isMaleGender,
  isFemaleGender,
  normalizeGender,
  getOppositeGenders,
  getTargetGenders,
} from '../src/lib/gender-utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra !== undefined ? ` → ${String(extra)}` : ''}`);
  }
}

// ─── A. 判别函数必须同时覆盖两套词表 ────────────────────────────────

console.log('\nA. 判别函数覆盖两套词表');

for (const g of ['MALE', 'MAN', 'TRANSGENDER_MAN']) {
  ok(`isMaleGender(${g})`, isMaleGender(g) === true);
}
for (const g of ['FEMALE', 'WOMAN', 'TRANSGENDER_WOMAN']) {
  ok(`isFemaleGender(${g})`, isFemaleGender(g) === true);
}
for (const g of ['NON_BINARY', 'OTHER', '', null, undefined]) {
  ok(`isMaleGender/isFemaleGender 对 ${JSON.stringify(g)} 均为 false`,
    isMaleGender(g) === false && isFemaleGender(g) === false);
}

// ─── B. 归一化：两套写法必须收敛到同一结果 ──────────────────────────

console.log('\nB. normalizeGender 归一化');

ok('MALE → MAN', normalizeGender('MALE') === 'MAN');
ok('FEMALE → WOMAN', normalizeGender('FEMALE') === 'WOMAN');
ok('小写 male → MAN（大小写不敏感）', normalizeGender('male') === 'MAN');
ok('MAN 保持不变', normalizeGender('MAN') === 'MAN');
ok('NON_BINARY 保持不变', normalizeGender('NON_BINARY') === 'NON_BINARY');
ok('空值 → OTHER', normalizeGender(null) === 'OTHER' && normalizeGender('') === 'OTHER');

// 核心不变量：历史写法与现行写法归一到同一值，否则比较必然出错
console.log('\n  核心不变量（跨词表等价）：');
ok('normalizeGender(MALE) === normalizeGender(MAN)',
  normalizeGender('MALE') === normalizeGender('MAN'));
ok('normalizeGender(FEMALE) === normalizeGender(WOMAN)',
  normalizeGender('FEMALE') === normalizeGender('WOMAN'));
ok('normalizeGender(FEMALE) !== normalizeGender(MALE)（不能把男女归一成同一类）',
  normalizeGender('FEMALE') !== normalizeGender('MALE'));

// ─── C. 查询辅助函数必须返回两套词表 ────────────────────────────────

console.log('\nC. 查询辅助函数返回两套词表');

const maleTargets = getOppositeGenders('MAN');
ok('男性视角的反向集合含 FEMALE 与 WOMAN',
  maleTargets.includes('FEMALE') && maleTargets.includes('WOMAN'), maleTargets.join(','));

const femaleTargets = getOppositeGenders('WOMAN');
ok('女性视角的反向集合含 MALE 与 MAN',
  femaleTargets.includes('MALE') && femaleTargets.includes('MAN'), femaleTargets.join(','));

const prefWomen = getTargetGenders('FEMALE');
ok('偏好 FEMALE 时目标集合含 WOMAN（不能只查历史写法）',
  !!prefWomen && prefWomen.includes('WOMAN') && prefWomen.includes('FEMALE'),
  prefWomen ? prefWomen.join(',') : 'null');

const prefMen = getTargetGenders('MALE');
ok('偏好 MALE 时目标集合含 MAN',
  !!prefMen && prefMen.includes('MAN') && prefMen.includes('MALE'),
  prefMen ? prefMen.join(',') : 'null');

ok('偏好 EVERYONE 时不过滤（返回 null）',
  getTargetGenders('EVERYONE') === null && getTargetGenders('ANY') === null);

// ─── D. 静态：禁止绕过归一化的原始性别比较 ──────────────────────────

console.log('\nD. 禁止原始性别字符串比较');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'generated' || entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** 唯一允许实现比较逻辑的文件（归一化工具本体）。 */
const CANONICAL = path.join('src', 'lib', 'gender-utils.ts');

// 形如 `xxx.toUpperCase() === yyy.gender.toUpperCase()` / `pref !== userB.gender.toUpperCase()`
const RAW_COMPARE =
  /(?:gender|Gender)[A-Za-z]*\.toUpperCase\(\)\s*(?:===|!==)|(?:===|!==)\s*[A-Za-z_.]*gender[A-Za-z_.]*\.toUpperCase\(\)/;

const offenders = [];
for (const file of walk(SRC)) {
  const rel = path.relative(ROOT, file);
  if (rel === CANONICAL) continue;
  const text = fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  if (RAW_COMPARE.test(text)) offenders.push(rel);
}

ok(
  '没有文件用原始字符串比较性别（必须经 normalizeGender）',
  offenders.length === 0,
  offenders.join(', ')
);

// 反证：检测式确实能命中历史上的坏写法
ok(
  '（自检）检测式可命中历史坏写法',
  RAW_COMPARE.test('if (pref !== userB.gender.toUpperCase()) score -= 30;')
);

// ─── 汇总 ─────────────────────────────────────────────────────────

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) {
  process.exit(1);
}
