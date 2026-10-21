#!/usr/bin/env node
/**
 * 证据透镜门禁（WB17-07）
 *
 * 目的：防止 `07_EVIDENCE_LENS.md` 退化成散文。
 *
 * 它守的是四件事：
 *   1. 覆盖：验收矩阵里的每一条（SEC/PAY/UX/OPS/BIZ）在透镜里都有对应行，
 *      且透镜里不许多出矩阵没有的条目 —— 双向集合相等。
 *   2. 一致：同一条 ID 在两份文档里的判定必须完全相同。
 *      （矩阵写 PASS、透镜写 BLOCKED，是最典型的一种自欺，必须红。）
 *   3. 可复跑：判定为 PASS/FAIL 的行，命令必须**真实存在**
 *      （npm script 在 package.json 里、脚本文件在盘上）。
 *      判定为 BLOCKED 的行，命令必须是 `—` ——
 *      不许给一条"跑了会绿但其实证明不了这条"的命令来凑数。
 *   4. 可判：期望输出不得是"应该没问题"这类无法机器判读的话。
 *
 * 用法：
 *   node scripts/qa/verify-evidence-lens.mjs
 *   node scripts/qa/verify-evidence-lens.mjs --self-test   # 变异自证
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const MATRIX = 'docs/implementation/v17/15_ACCEPTANCE_MATRIX_V17.md';
const LENS = 'docs/implementation/v17/07_EVIDENCE_LENS.md';

const VERDICTS = ['PASS', 'FAIL', 'BLOCKED', 'NOT_APPLICABLE'];
const VAGUE = ['应该', '大概', '基本', '差不多', '看起来', '似乎', '可能没问题', '估计', '应该是'];
const ID_RE = /^(?:SEC|PAY|UX|OPS|BIZ)-\d{2}$/;

function cells(line) {
  // 去掉首尾竖线后按 | 切分；表格行才处理
  const t = line.trim();
  if (!t.startsWith('|')) return null;
  const parts = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((s) => s.trim());
  return parts;
}

function firstVerdict(text) {
  const up = String(text || '').toUpperCase();
  for (const v of VERDICTS) {
    if (up.startsWith(v)) return v;
  }
  return null;
}

/** 从矩阵解析 ID → 判定 */
export function parseMatrix(text) {
  const out = new Map();
  const dup = [];
  for (const line of text.split('\n')) {
    const c = cells(line);
    if (!c || c.length < 4) continue;
    if (!ID_RE.test(c[0])) continue;
    const verdict = firstVerdict(c[2].replace(/\*/g, '').trim());
    if (!verdict) continue;
    if (out.has(c[0])) dup.push(c[0]);
    out.set(c[0], { verdict, claim: c[1] });
  }
  return { map: out, dup };
}

/** 从透镜解析行 */
export function parseLens(text) {
  const rows = [];
  const dup = [];
  const seen = new Set();
  for (const line of text.split('\n')) {
    const c = cells(line);
    if (!c || c.length < 6) continue;
    if (!ID_RE.test(c[0])) continue;
    if (seen.has(c[0])) dup.push(c[0]);
    seen.add(c[0]);
    rows.push({
      id: c[0],
      claim: c[1],
      command: c[2],
      expected: c[3],
      current: c[4],
      failure: c[5],
    });
  }
  return { rows, dup };
}

/** 命令是否真实存在（离线可判，不联网） */
export function commandResolves(command, rooted = true) {
  const root = rooted ? ROOT : process.cwd();
  const chunks = String(command)
    // markdown 行内代码的反引号只是排版，不参与命令解析
    .replace(/`/g, '')
    .split(' + ')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!chunks.length) return { ok: false, why: '命令为空' };

  for (const chunk of chunks) {
    // 允许前置环境变量（`E2E_BASE_URL=... npm run verify:payment:off`）
    const words = chunk.split(/\s+/).filter(Boolean);
    while (words.length && /^[A-Z][A-Z0-9_]*=\S*$/.test(words[0])) words.shift();
    if (!words.length) return { ok: false, why: `只有环境变量没有命令：${chunk}` };
    const head = words[0];
    let target = null;

    if (head === 'npm') {
      const runIdx = words.indexOf('run');
      const name = runIdx >= 0 ? words[runIdx + 1] : words[1];
      if (!name) return { ok: false, why: `npm 命令缺脚本名：${chunk}` };
      let pkg;
      try {
        pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
      } catch {
        return { ok: false, why: '读不到 package.json' };
      }
      const script = pkg.scripts?.[name];
      if (!script) return { ok: false, why: `package.json 里没有脚本 "${name}"` };
      // 脚本自身指向的文件（若有）也要存在
      const m = script.match(/(?:node|tsx|bash)\s+([\w./-]+\.(?:mjs|js|cjs|mts|ts|sh))/);
      if (m) {
        target = m[1];
      }
    } else if (head === 'node' || head === 'npx' || head === 'bash' || head === 'sh') {
      const file = words.find((w, i) => i > 0 && /\.(?:mjs|js|cjs|mts|ts|sh)$/.test(w));
      if (!file) {
        // npx <pkg> 形式（如 npx jest <dir>）需要路径参数
        const probe = words.find((w, i) => i > 1 && /^[\w./-]+$/.test(w) && w.includes('/'));
        if (probe) target = probe;
        else return { ok: false, why: `无法从命令里解析出脚本路径：${chunk}` };
      } else {
        target = file;
      }
    } else if (head === 'gh' || head === 'curl') {
      // 联网取证：无法离线判存在性，但必须显式标注期望
      continue;
    } else if (head === '—' || head === '-') {
      return { ok: false, why: '该行没有命令' };
    } else {
      return { ok: false, why: `不认识的前缀 "${head}"（允许：npm / node / npx / bash / gh / curl）` };
    }

    if (target) {
      const abs = path.isAbsolute(target) ? target : path.join(root, target);
      if (!fs.existsSync(abs)) return { ok: false, why: `路径不存在：${target}` };
    }
  }
  return { ok: true };
}

function hasVague(text) {
  const s = String(text || '');
  return VAGUE.find((w) => s.includes(w)) || null;
}

/** 核心分析：返回问题列表 */
export function analyze(matrixText, lensText, opts = {}) {
  const rooted = opts.rooted !== false;
  const problems = [];
  const { map: matrix, dup: mDup } = parseMatrix(matrixText);
  const { rows, dup: lDup } = parseLens(lensText);

  for (const id of mDup) problems.push(`${id}：矩阵里重复出现`);
  for (const id of lDup) problems.push(`${id}：透镜里重复出现`);

  if (matrix.size === 0) problems.push('矩阵里一条 ID 都没解析到（解析失效，等于没守卫）');
  if (rows.length === 0) problems.push('透镜里一条 ID 都没解析到（解析失效，等于没守卫）');

  const lensIds = new Set(rows.map((r) => r.id));
  for (const id of matrix.keys()) if (!lensIds.has(id)) problems.push(`${id}：矩阵有，透镜缺`);
  for (const id of lensIds) if (!matrix.has(id)) problems.push(`${id}：透镜有，矩阵缺`);

  for (const row of rows) {
    const m = matrix.get(row.id);
    const want = m ? m.verdict : null;
    const got = firstVerdict(row.current);

    if (!got) {
      problems.push(`${row.id}：当前实测列必须以判定词开头（PASS/FAIL/BLOCKED/NOT_APPLICABLE）`);
    } else if (want && got !== want) {
      problems.push(`${row.id}：判定不一致（矩阵=${want}，透镜=${got}）`);
    }

    const cmd = row.command.trim();
    if (got === 'BLOCKED' || got === 'NOT_APPLICABLE') {
      if (cmd !== '—' && cmd !== '-' && cmd !== '') {
        problems.push(`${row.id}：${got} 行不许给命令（"跑了会绿但证明不了这条"就是假绿），应为 "—"`);
      }
    } else if (got) {
      if (cmd === '—' || cmd === '-' || cmd === '') {
        problems.push(`${row.id}：${got} 行必须给出可复跑命令`);
      } else {
        const r = commandResolves(cmd, rooted);
        if (!r.ok) problems.push(`${row.id}：命令不可复跑 —— ${r.why}`);
      }
    }

    for (const [col, val] of [
      ['期望输出', row.expected],
      ['当前实测', row.current],
      ['可证伪的句子', row.claim],
    ]) {
      const w = hasVague(val);
      if (w) problems.push(`${row.id}：${col} 出现不可判读的措辞「${w}」`);
      if (!val || !val.trim()) problems.push(`${row.id}：${col} 为空`);
    }

    if (!row.failure || !row.failure.trim()) {
      problems.push(`${row.id}：失效形态为空（说不出"什么改动会让它变红"= 没有判据）`);
    }
  }

  return { problems, matrixCount: matrix.size, lensCount: rows.length };
}

/* ---------------------------------- 自证 --------------------------------- */

function selfTest() {
  const results = [];
  const ok = (name, cond, detail = '') => results.push({ name, pass: !!cond, detail });

  const matrixFor = (verdict = 'PASS') =>
    [
      '| ID | 判据 | 判定 | 层级 | 证据 |',
      '|---|---|---|---|---|',
      `| SEC-01 | 租户谓词 | **${verdict}** | 代码 | x |`,
      `| PAY-02 | 首购入账 | **${'BLOCKED'}** | — | 缺凭据 |`,
    ].join('\n');

  const lensRow = (o = {}) => {
    const r = {
      id: 'SEC-01',
      claim: '每个 org 查询都带租户谓词',
      command: 'npm run audit:tenancy',
      expected: 'exit 0 且「未登记 0 条」',
      current: 'PASS · 未登记 0 条',
      failure: '新增不带租户谓词的查询',
      ...o,
    };
    return `| ${r.id} | ${r.claim} | ${r.command} | ${r.expected} | ${r.current} | ${r.failure} |`;
  };
  const lensFor = (rows) =>
    ['| ID | 句子 | 命令 | 期望 | 当前 | 失效形态 |', '|---|---|---|---|---|---|', ...rows].join('\n');

  // 0. 正例：两条对齐必须通过
  {
    const lens = lensFor([
      lensRow(),
      lensRow({ id: 'PAY-02', claim: '首购入账正确', command: '—', expected: '需真实 checkout', current: 'BLOCKED · 缺 4 凭据', failure: '拿到凭据后仍不入账' }),
    ]);
    const r = analyze(matrixFor('PASS'), lens);
    ok('正例通过（矩阵 2 条 = 透镜 2 条）', r.problems.length === 0, r.problems.join(' / '));
  }

  // 1. 漏条目
  {
    const r = analyze(matrixFor('PASS'), lensFor([lensRow()]));
    ok('变异①：矩阵有、透镜缺 → 红', r.problems.some((p) => p.includes('PAY-02：矩阵有，透镜缺')));
  }

  // 2. 多条目
  {
    const r = analyze(matrixFor('PASS'), lensFor([lensRow(), lensRow({ id: 'SEC-09' })]));
    ok('变异②：透镜有、矩阵缺 → 红', r.problems.some((p) => p.includes('SEC-09：透镜有，矩阵缺')));
  }

  // 3. 判定不一致（矩阵 PASS / 透镜 BLOCKED）
  {
    const lens = lensFor([
      lensRow({ command: '—', current: 'BLOCKED · 未验' }),
      lensRow({ id: 'PAY-02', command: '—', current: 'BLOCKED · 缺 4 凭据' }),
    ]);
    const r = analyze(matrixFor('PASS'), lens);
    ok('变异③：判定不一致 → 红', r.problems.some((p) => p.includes('SEC-01：判定不一致')));
  }

  // 4. 命令不存在
  {
    const lens = lensFor([
      lensRow({ command: 'npm run no-such-script' }),
      lensRow({ id: 'PAY-02', command: '—', current: 'BLOCKED · 缺 4 凭据' }),
    ]);
    const r = analyze(matrixFor('PASS'), lens);
    ok('变异④：命令不存在 → 红', r.problems.some((p) => p.includes('no-such-script')));
  }

  // 5. BLOCKED 行塞命令（假绿来源）
  {
    const lens = lensFor([
      lensRow(),
      lensRow({ id: 'PAY-02', command: 'npm run audit:tenancy', current: 'BLOCKED · 缺 4 凭据' }),
    ]);
    const r = analyze(matrixFor('PASS'), lens);
    ok('变异⑤：BLOCKED 行给了命令 → 红', r.problems.some((p) => p.includes('不许给命令')));
  }

  // 6. 模糊措辞
  {
    const lens = lensFor([
      lensRow({ expected: '应该没问题' }),
      lensRow({ id: 'PAY-02', command: '—', current: 'BLOCKED · 缺 4 凭据' }),
    ]);
    const r = analyze(matrixFor('PASS'), lens);
    ok('变异⑥：期望输出写「应该没问题」→ 红', r.problems.some((p) => p.includes('不可判读')));
  }

  // 7. 当前列没有判定词
  {
    const lens = lensFor([
      lensRow({ current: '18/18 通过' }),
      lensRow({ id: 'PAY-02', command: '—', current: 'BLOCKED · 缺 4 凭据' }),
    ]);
    const r = analyze(matrixFor('PASS'), lens);
    ok('变异⑦：当前列不以判定词开头 → 红', r.problems.some((p) => p.includes('必须以判定词开头')));
  }

  // 8. 失效形态留空
  {
    const lens = lensFor([
      lensRow({ failure: '' }),
      lensRow({ id: 'PAY-02', command: '—', current: 'BLOCKED · 缺 4 凭据' }),
    ]);
    const r = analyze(matrixFor('PASS'), lens);
    ok('变异⑧：失效形态为空 → 红', r.problems.some((p) => p.includes('失效形态为空')));
  }

  // 9. 解析失效（空文档）必须红，不能"零条=通过"
  {
    const r = analyze('', '');
    ok('变异⑨：两份文档都解析出 0 条 → 红（空集恒真防线）', r.problems.length >= 2);
  }

  // 10. 负数对照：不存在的脚本确实被判定为不存在
  ok('负数对照：真脚本可解析', commandResolves('npm run audit:tenancy').ok);
  ok('负数对照：假脚本拒绝', !commandResolves('npm run __no_such_script__').ok);

  const failed = results.filter((r) => !r.pass);
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  console.log(`\n自证：${results.length - failed.length}/${results.length} 通过`);
  return failed.length === 0 ? 0 : 1;
}

/* ---------------------------------- 主流程 -------------------------------- */

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) {
    process.exit(selfTest());
  }
  const mp = path.join(ROOT, MATRIX);
  const lp = path.join(ROOT, LENS);
  for (const p of [mp, lp]) {
    if (!fs.existsSync(p)) {
      console.error(`🔴 缺文档：${path.relative(ROOT, p)}`);
      process.exit(1);
    }
  }
  const { problems, matrixCount, lensCount } = analyze(
    fs.readFileSync(mp, 'utf8'),
    fs.readFileSync(lp, 'utf8'),
  );
  console.log(`矩阵条目 ${matrixCount} 条 · 透镜条目 ${lensCount} 条`);
  if (problems.length) {
    for (const p of problems) console.error(`  🔴 ${p}`);
    console.error(`\n证据透镜不合格：${problems.length} 处问题`);
    process.exit(1);
  }
  console.log('✅ 证据透镜合格：覆盖双向相等、判定一致、命令可复跑、无不可判读措辞');
}
