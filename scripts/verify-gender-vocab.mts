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

// ─── E. 写入口不得再产出历史写法 ──────────────────────────────────────
//
// D 节只拦"原始比较"（读取侧）。但即使读取侧全都归化了，只要**写入侧**还在往
// 库里写 MALE/FEMALE，双词表就会持续再生 —— 数据迁移（scripts/qa/migrate-gender-vocab.mjs）
// 会被下一次注册/导入/后台操作重新污染。所以写入侧必须单独钉住。

console.log('\nE. 写入口不得再产出历史写法');

/** 直接往 gender/preferredGender 字段写历史字面量 */
const WRITE_LEGACY = /(?:gender|preferredGender)\s*:\s*['"](?:MALE|FEMALE)['"]/;
/** 把历史字面量作为表单选项暴露出去（用户选中后即落库） */
const OPTION_LEGACY = /value\s*=\s*['"](?:MALE|FEMALE)['"]/;
/** 三元表达式成对产出历史值：cond ? 'FEMALE' : 'MALE' */
const TERNARY_LEGACY = /\?\s*['"](?:MALE|FEMALE)['"]\s*:\s*['"](?:MALE|FEMALE)['"]/;

const writeOffenders: string[] = [];
for (const file of walk(SRC)) {
  const rel = path.relative(ROOT, file);
  const text = fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  if (WRITE_LEGACY.test(text) || OPTION_LEGACY.test(text) || TERNARY_LEGACY.test(text)) {
    writeOffenders.push(rel);
  }
}
ok('src 内没有代码往性别字段写历史写法 MALE/FEMALE', writeOffenders.length === 0, writeOffenders.join(', '));

// 冷启动写入路径（prisma/seed.ts、prisma/init-admin.ts）同样必须用现行词表：
// 否则"重建库 / 初始化管理员"会把双词表原样种回去，迁移成果被下一次 seed 抹掉。
const PRISMA_DIR = path.join(ROOT, 'prisma');
const seedOffenders: string[] = [];
if (fs.existsSync(PRISMA_DIR)) {
  for (const file of walk(PRISMA_DIR)) {
    const rel = path.relative(ROOT, file);
    const text = fs
      .readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    if (WRITE_LEGACY.test(text) || TERNARY_LEGACY.test(text)) seedOffenders.push(rel);
  }
}
ok('prisma/ 种子与初始化脚本使用现行词表（重建库不回退）', seedOffenders.length === 0, seedOffenders.join(', '));

// scripts/qa 的造数/夹具脚本同样是"活跃写入口"：QA 账号建出来是历史写法，
// 之后任何按现行词表的断言都会被带偏（且会重新污染迁移成果）。
const QA_DIR = path.join(ROOT, 'scripts', 'qa');
const qaOffenders: string[] = [];
if (fs.existsSync(QA_DIR)) {
  for (const file of fs.readdirSync(QA_DIR)) {
    if (!/\.(mjs|mts|ts|js)$/.test(file)) continue;
    const text = fs
      .readFileSync(path.join(QA_DIR, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    if (WRITE_LEGACY.test(text) || TERNARY_LEGACY.test(text)) qaOffenders.push(path.join('scripts', 'qa', file));
  }
}
ok('scripts/qa 夹具脚本使用现行词表（造数不回退）', qaOffenders.length === 0, qaOffenders.join(', '));

ok('（自检）三条写侧检测式均可命中', 
  WRITE_LEGACY.test("data: { gender: 'FEMALE' }") &&
  OPTION_LEGACY.test('<option value="MALE">Male</option>') &&
  TERNARY_LEGACY.test("const g = r < 0.6 ? 'FEMALE' : 'MALE'")
);

// 标签映射必须认得现行写法（迁移后数据是 MAN/WOMAN，只列历史写法会显示原始枚举值）
const profileDetail = fs.readFileSync(
  path.join(SRC, 'app', '(dashboard)', 'dashboard', 'profile', '[id]', 'page.tsx'),
  'utf8'
);
ok(
  'getGenderLabel 的标签表含现行写法 WOMAN/MAN',
  /labels[\s\S]{0,200}WOMAN/.test(profileDetail) && /labels[\s\S]{0,200}MAN/.test(profileDetail)
);

// ─── F. 数据迁移脚本必须存在且默认 dry-run ────────────────────────────

console.log('\nF. 数据迁移脚本约束');

const migrationPath = path.join(ROOT, 'scripts', 'qa', 'migrate-gender-vocab.mjs');
ok('迁移脚本存在', fs.existsSync(migrationPath));

if (fs.existsSync(migrationPath)) {
  const mig = fs.readFileSync(migrationPath, 'utf8');
  ok('默认 dry-run（必须显式 --apply 才落库）', /APPLY\s*=\s*process\.argv\.includes\('--apply'\)/.test(mig) && /if \(!APPLY\)/.test(mig));
  ok('落库前先备份受影响行', /backup|\.json/.test(mig) && /writeFileSync/.test(mig));
  ok('幂等：只匹配 IN (\'MALE\',\'FEMALE\')', /gender IN \('MALE','FEMALE'\)/.test(mig));
  ok('不触碰 updatedAt（避免污染"最近更新"语义）', !/updatedAt\s*=/.test(mig));
}

// ─── 汇总 ─────────────────────────────────────────────────────────

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) {
  process.exit(1);
}
