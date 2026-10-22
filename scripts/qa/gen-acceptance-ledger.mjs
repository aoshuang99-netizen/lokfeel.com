#!/usr/bin/env node
/**
 * 生成 / 校验 `docs/implementation/ACCEPTANCE_LEDGER.md`
 * ═══════════════════════════════════════════════════════════════════
 * 用法：
 *   node scripts/qa/gen-acceptance-ledger.mjs            # 重新生成
 *   node scripts/qa/gen-acceptance-ledger.mjs --check    # 只校验（CI 用）
 *   node scripts/qa/gen-acceptance-ledger.mjs --self-test # 变异自证
 *
 * 退出码：0 一致 / 1 不一致（或自证失败） / 2 读不到真相源
 *
 * 顺手抓的一类真实缺陷
 * --------------------
 * 2026-10-22 实测：矩阵顶部汇总表写 25 PASS / 17 BLOCKED，逐行重算是 29 / 13。
 * 差的是 PAY-04/05/06 与 UX-07 —— 它们交付后行了、汇总没跟。
 * 本脚本每次都把「汇总表」与「逐行重算」对一遍，不等就红并打印差在哪组哪列。
 * 注意：**校验的是矩阵自身的自洽性**，与台账是否最新是两件事，两者都查。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseMatrixFull,
  checkSummary,
  renderLedger,
  compareLedger,
} from './lib/acceptance-ledger.mjs';
import { parseLens } from './verify-evidence-lens.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

export const MATRIX = 'docs/implementation/v17/15_ACCEPTANCE_MATRIX_V17.md';
export const LENS = 'docs/implementation/v17/07_EVIDENCE_LENS.md';
export const LEDGER = 'docs/implementation/ACCEPTANCE_LEDGER.md';

const arg = (n) => process.argv.includes(`--${n}`);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const digest = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 8);

/** 输入 → 期望的台账正文（纯函数，供 --check 与自证共用） */
export function build(matrixText, lensText) {
  const matrix = parseMatrixFull(matrixText);
  if (matrix.rows.length === 0) {
    return { ok: false, why: '矩阵里一条 ID 都没解析到（解析失效 = 台账会变成空文件）' };
  }
  const lens = parseLens(lensText);
  const lensRows = new Map(lens.rows.map((r) => [r.id, r]));
  const summary = checkSummary(matrix);
  const baseline = `${digest(matrixText)}@15 · ${digest(lensText)}@07`;
  const text = renderLedger({ matrix, lensRows, baseline });
  return { ok: true, text, matrix, lens, summary };
}

function main() {
  let matrixText;
  let lensText;
  try {
    matrixText = read(MATRIX);
    lensText = read(LENS);
  } catch (e) {
    console.error(`✗ 读不到真相源：${e.message}`);
    process.exit(2);
  }

  const built = build(matrixText, lensText);
  if (!built.ok) {
    console.error(`✗ ${built.why}`);
    process.exit(1);
  }

  const { matrix, summary, text } = built;

  // ① 矩阵自身：汇总表必须等于逐行重算
  if (summary.problems.length) {
    console.error('✗ 矩阵汇总表与逐行数据不一致（这就是"只改行不改汇总"）：');
    for (const p of summary.problems) console.error(`   · ${p}`);
    console.error('\n  修法：改矩阵顶部汇总表；或若逐行判定本来就错，改逐行。两者必须相等。');
    process.exit(1);
  }

  // ② 台账：盘上必须等于重算
  const abs = path.join(ROOT, LEDGER);
  const onDisk = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';

  if (arg('check')) {
    const problems = compareLedger(onDisk, text);
    if (problems.length) {
      console.error(`✗ ${LEDGER} 不是最新的（或被人手改过）：`);
      for (const p of problems) console.error(`   · ${p}`);
      console.error('\n  修法：npm run ledger:acceptance');
      process.exit(1);
    }
    const { total } = summary;
    console.log(
      `✅ 台账一致：${total.count} 条 = ${total.PASS} PASS / ${total.FAIL} FAIL / ${total.BLOCKED} BLOCKED / ${total.NOT_APPLICABLE} N/A`,
    );
    process.exit(0);
  }

  fs.writeFileSync(abs, text);
  const { byGroup, total } = summary;
  console.log(`✅ 已生成 ${LEDGER}`);
  for (const [k, v] of byGroup) {
    console.log(`   ${k}  ${String(v.count).padStart(2)} 项 → ${v.PASS} PASS / ${v.FAIL} FAIL / ${v.BLOCKED} BLOCKED`);
  }
  console.log(`   合计 ${total.count} = ${total.PASS} PASS / ${total.FAIL} FAIL / ${total.BLOCKED} BLOCKED`);
}

/* ────────────────────────────── 自证 ────────────────────────────── */

function selfTest() {
  const cases = [];
  const ok = (name, cond, detail = '') => {
    cases.push({ name, ok: Boolean(cond), detail });
    console.log(`${cond ? '✓' : '✗'} ${name}${detail && !cond ? ` — ${detail}` : ''}`);
  };

  // 合成夹具：3 条，SEC 2 PASS、PAY 1 BLOCKED；汇总表刻意写错一格
  const FIX_MATRIX = [
    '# 夹具',
    '',
    '| 组 | 项数 | PASS | FAIL | BLOCKED | N/A |',
    '|---|---|---|---|---|---|',
    '| SEC（安全与隔离） | 2 | 2 | 0 | 0 | 0 |',
    '| PAY（支付与订阅） | 1 | 0 | 0 | 1 | 0 |',
    '| **合计** | **3** | **2** | **0** | **1** | **0** |',
    '',
    '### 2.1 SEC',
    '| ID | 判据 | 判定 | 层级 | 证据 |',
    '|---|---|---|---|---|',
    '| SEC-01 | 甲 | **PASS** | 代码 | e1 |',
    '| SEC-02 | 乙 | **PASS** | 代码 | e2 |',
    '| PAY-01 | 丙 | **BLOCKED** | — | 无 |',
    '',
  ].join('\n');

  const FIX_LENS = [
    '| ID | 可被证伪的句子 | 复跑命令 | 期望输出 | 当前实测 | 失效形态 |',
    '|---|---|---|---|---|---|',
    '| SEC-01 | 甲 | `npm run a` | exit 0 | PASS | 甲坏了 |',
    '| SEC-02 | 乙 | `npm run b` | exit 0 | PASS | 乙坏了 |',
    '| PAY-01 | 丙 | — | 需真付款 | BLOCKED | 假单 |',
    '',
  ].join('\n');

  // ① 正常夹具：能生成，且合计正确
  {
    const r = build(FIX_MATRIX, FIX_LENS);
    ok('夹具可生成台账', r.ok && r.text.includes('| **合计** | **3**'));
    ok('夹具计数 3 = 2 PASS / 1 BLOCKED', r.ok && r.summary.total.count === 3 && r.summary.total.PASS === 2 && r.summary.total.BLOCKED === 1);
    ok('BLOCKED 行不给命令指针', r.ok && /PAY-01 \|[^\n]*\| — \|/.test(r.text), '台账应把 PAY-01 的命令列写成 —');
  }

  // ② 变异①：汇总表少算一个 PASS ⇒ 必须判不一致
  {
    const bad = FIX_MATRIX.replace('| 2 | 2 | 0 | 0 | 0 |', '| 2 | 1 | 0 | 1 | 0 |').replace(
      '| **3** | **2** | **0** | **1** | **0** |',
      '| **3** | **1** | **0** | **2** | **0** |',
    );
    const r = build(bad, FIX_LENS);
    ok('变异①：汇总表写错 ⇒ 判红', r.summary.problems.length >= 2, JSON.stringify(r.summary.problems));
  }

  // ③ 变异②：矩阵里删掉一条 ⇒ 合计对不上 ⇒ 必须判红（否则"删行凑数"能过）
  {
    const bad = FIX_MATRIX.replace('| SEC-02 | 乙 | **PASS** | 代码 | e2 |\n', '');
    const r = build(bad, FIX_LENS);
    ok('变异②：删掉一行但不改合计 ⇒ 判红', r.summary.problems.some((p) => p.includes('合计的 项数')));
  }

  // ④ 变异③：矩阵解析出 0 条 ⇒ 必须判红（空集恒真防线）
  {
    const r = build('| 组 | 项数 | PASS | FAIL | BLOCKED | N/A |\n|---|---|---|---|---|---|\n', FIX_LENS);
    ok('变异③：一条都解析不到 ⇒ 判红', r.ok === false);
  }

  // ⑤ 变异④：台账被手改一个字 ⇒ compareLedger 必须报出来
  {
    const r = build(FIX_MATRIX, FIX_LENS);
    const tampered = r.text.replace('| **PASS** | 代码 | e1 |', '| **PASS** | 生产 | e1 |');
    const d = compareLedger(tampered, r.text);
    ok('变异④：手改台账一个字段 ⇒ 校验报差异', d.length >= 1, `diff=${d.length}`);
  }

  // ⑥ 负数对照：完全相同的文本不得报差异（否则门禁恒红）
  {
    const r = build(FIX_MATRIX, FIX_LENS);
    ok('对照：文本相同 ⇒ 无差异', compareLedger(r.text, r.text).length === 0);
  }

  // ⑦ 确定性：同一输入两次输出逐字节相同（否则 --check 永远红）
  {
    const a = build(FIX_MATRIX, FIX_LENS).text;
    const b = build(FIX_MATRIX, FIX_LENS).text;
    ok('对照：输出确定性（两次逐字节相同）', a === b);
  }

  const failed = cases.filter((c) => !c.ok);
  console.log(`\n${failed.length ? '✗' : '✅'} 自证 ${cases.length} 条：${cases.length - failed.length} 通过 / ${failed.length} 失败`);
  process.exit(failed.length ? 1 : 0);
}

if (arg('self-test')) selfTest();
else main();
