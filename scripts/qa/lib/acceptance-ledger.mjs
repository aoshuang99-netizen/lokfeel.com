/**
 * 验收台账的**唯一**生成逻辑（矩阵 → 台账）
 * ═══════════════════════════════════════════════════════════════════
 * 为什么要有这个模块
 * ------------------
 * 2026-10-22（V18 D1）实测发现：`15_ACCEPTANCE_MATRIX_V17.md` 的**逐行**状态是
 * 29 PASS / 13 BLOCKED，而同一份文件顶部的**汇总表**写的是 25 PASS / 17 BLOCKED。
 * 差的 4 项不是笔误 —— 是增量修改只改了行、没改汇总：
 *
 *   PAY-04 续费入账       BLOCKED → PASS（WB17-02 交付后）
 *   PAY-05 乱序降级       BLOCKED → PASS（同上）
 *   PAY-06 事件目录完整   BLOCKED → PASS（同上）
 *   UX-07  动效降级       BLOCKED → PASS（WB17-07 加 R11 后）
 *
 * 于是"项目还有多少没验"这件事，取决于你读的是表格哪一行。这正是
 * `07_EVIDENCE_LENS.md` 里记的第 3 类腐烂：**判定与证据脱钩**。
 *
 * 所以台账不手写：它是从矩阵**算**出来的。手写的汇总数字一定会再漂。
 *
 * 设计约束
 * --------
 * · **确定性输出**：不带时间戳。"最后核验时间"用 `git log -1 -- <file>` 取，
 *   而不是"生成即刷新"的假新鲜度 —— 重新生成不等于重新验证。
 * · **不复制命令**：台账只给 `07 · <ID>` 指针。命令的真相源只有 `07`，
 *   抄一份进台账就又多了一个会漂的副本。
 * · **汇总必须等于重算值**：`--check` 模式下不等就红，且打印差在哪几条。
 */

/** 组定义（顺序即输出顺序） */
export const GROUPS = [
  { key: 'SEC', label: '安全与隔离' },
  { key: 'PAY', label: '支付与订阅' },
  { key: 'UX', label: '十三屏与体验' },
  { key: 'OPS', label: '运维与可观测' },
  { key: 'BIZ', label: '商业与合规' },
];

export const VERDICTS = ['PASS', 'FAIL', 'BLOCKED', 'NOT_APPLICABLE'];
const ID_RE = /^(SEC|PAY|UX|OPS|BIZ)-(\d{2})$/;

function cells(line) {
  const t = String(line).trim();
  if (!t.startsWith('|')) return null;
  return t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((s) => s.trim());
}

/**
 * 解析矩阵：逐行（判定 + 层级 + 证据），以及顶部汇总表。
 * 返回 { rows, summary, problems }
 */
export function parseMatrixFull(text) {
  const rows = [];
  const problems = [];
  const seen = new Set();

  for (const line of text.split('\n')) {
    const c = cells(line);
    if (!c || c.length < 5) continue;
    const m = c[0].match(ID_RE);
    if (!m) continue;
    const verdict = (c[2].replace(/\*/g, '').match(/^(PASS|FAIL|BLOCKED|NOT_APPLICABLE)/) || [])[1];
    if (!verdict) {
      problems.push(`${c[0]}：判定列读不出状态（"${c[2].slice(0, 24)}"）`);
      continue;
    }
    if (seen.has(c[0])) problems.push(`${c[0]}：在矩阵里出现两次`);
    seen.add(c[0]);
    rows.push({ id: c[0], group: m[1], seq: Number(m[2]), claim: c[1], verdict, tier: c[3], evidence: c[4] });
  }

  // 顶部汇总表：| SEC（安全与隔离） | 8 | 8 | 0 | 0 | 0 |
  const summary = new Map();
  let total = null;
  for (const line of text.split('\n')) {
    const c = cells(line);
    if (!c || c.length < 6) continue;
    const g = c[0].replace(/\*/g, '').trim();
    const nums = c.slice(1, 6).map((x) => Number(x.replace(/\*/g, '').trim()));
    if (nums.some((n) => !Number.isFinite(n))) continue;
    const hit = GROUPS.find((x) => g.startsWith(x.key));
    if (hit) {
      summary.set(hit.key, {
        count: nums[0], pass: nums[1], fail: nums[2], blocked: nums[3], na: nums[4],
      });
    } else if (/合计/.test(g)) {
      total = { count: nums[0], pass: nums[1], fail: nums[2], blocked: nums[3], na: nums[4] };
    }
  }

  return { rows, summary, total, problems };
}

/** 由逐行数据重算计数 */
export function tally(rows) {
  const byGroup = new Map();
  for (const g of GROUPS) byGroup.set(g.key, { count: 0, PASS: 0, FAIL: 0, BLOCKED: 0, NOT_APPLICABLE: 0 });
  for (const r of rows) {
    const b = byGroup.get(r.group);
    if (!b) continue;
    b.count += 1;
    b[r.verdict] += 1;
  }
  const total = { count: rows.length, PASS: 0, FAIL: 0, BLOCKED: 0, NOT_APPLICABLE: 0 };
  for (const b of byGroup.values()) {
    total.PASS += b.PASS;
    total.FAIL += b.FAIL;
    total.BLOCKED += b.BLOCKED;
    total.NOT_APPLICABLE += b.NOT_APPLICABLE;
  }
  return { byGroup, total };
}

/**
 * 汇总表 vs 重算值：逐组逐列比对。
 * 这是本模块存在的**主要理由** —— 它能抓出"只改行不改汇总"。
 */
export function checkSummary(matrix) {
  const { byGroup, total } = tally(matrix.rows);
  const problems = [];

  for (const g of GROUPS) {
    const declared = matrix.summary.get(g.key);
    const actual = byGroup.get(g.key);
    if (!declared) {
      if (actual.count > 0) problems.push(`${g.key}：汇总表里没有这一组，但逐行有 ${actual.count} 条`);
      continue;
    }
    const pairs = [
      ['项数', declared.count, actual.count],
      ['PASS', declared.pass, actual.PASS],
      ['FAIL', declared.fail, actual.FAIL],
      ['BLOCKED', declared.blocked, actual.BLOCKED],
      ['N/A', declared.na, actual.NOT_APPLICABLE],
    ];
    for (const [name, d, a] of pairs) {
      if (d !== a) problems.push(`${g.key} 的 ${name}：汇总表写 ${d}，逐行重算 ${a}`);
    }
  }

  if (matrix.total) {
    const pairs = [
      ['项数', matrix.total.count, total.count],
      ['PASS', matrix.total.pass, total.PASS],
      ['FAIL', matrix.total.fail, total.FAIL],
      ['BLOCKED', matrix.total.blocked, total.BLOCKED],
      ['N/A', matrix.total.na, total.NOT_APPLICABLE],
    ];
    for (const [name, d, a] of pairs) {
      if (d !== a) problems.push(`合计的 ${name}：汇总表写 ${d}，逐行重算 ${a}`);
    }
  } else if (matrix.rows.length) {
    problems.push('汇总表里没有「合计」行');
  }

  return { problems, byGroup, total };
}

/** 定长补齐（Markdown 表格对齐；纯 ASCII/中文混排按字符数即可读） */
function pad(s, n) {
  const v = String(s ?? '');
  return v.length >= n ? v : v + ' '.repeat(n - v.length);
}

/**
 * 渲染台账正文。**必须确定性**：同一输入两次调用输出逐字节相同。
 * @param {{matrix:object, lensRows:Map<string,object>, baseline:string}} input
 */
export function renderLedger({ matrix, lensRows, baseline }) {
  const { byGroup, total } = tally(matrix.rows);
  const L = [];

  L.push('# ACCEPTANCE_LEDGER · 验收台账');
  L.push('');
  L.push('> **本文件是生成物，不要手改。** 重新生成：`npm run ledger:acceptance`；一致性由 `npm run check:evidence` 强制。');
  L.push('>');
  L.push('> **真相源**：判定来自 `docs/implementation/v17/15_ACCEPTANCE_MATRIX_V17.md` 的逐行数据；');
  L.push('> 可复跑命令只存在于 `docs/implementation/v17/07_EVIDENCE_LENS.md`（本文件只给指针，不复制命令 ——');
  L.push('> 复制就会多一份会漂的副本）。');
  L.push('>');
  L.push('> **本文件没有时间戳，这是刻意的。** 「最后核验时间」用 `git log -1 -- <证据文件>` 取：');
  L.push('> 重新生成 ≠ 重新验证，给生成物盖一个"刚刚"的时间戳只会伪造新鲜度。');
  L.push('');
  L.push(`**台账基线**：\`${baseline}\``);
  L.push('');
  L.push('---');
  L.push('');
  L.push('## 1. 计数（由逐行数据重算，不是从汇总表抄的）');
  L.push('');
  L.push('| 组 | 项数 | PASS | FAIL | BLOCKED | N/A | 完成度 |');
  L.push('|---|---|---|---|---|---|---|');
  for (const g of GROUPS) {
    const b = byGroup.get(g.key);
    const done = b.count ? Math.round(((b.PASS + b.NOT_APPLICABLE) / b.count) * 100) : 0;
    L.push(
      `| ${g.key}（${g.label}） | ${b.count} | ${b.PASS} | ${b.FAIL} | ${b.BLOCKED} | ${b.NOT_APPLICABLE} | ${done}% |`,
    );
  }
  const pct = total.count ? Math.round(((total.PASS + total.NOT_APPLICABLE) / total.count) * 100) : 0;
  L.push(
    `| **合计** | **${total.count}** | **${total.PASS}** | **${total.FAIL}** | **${total.BLOCKED}** | **${total.NOT_APPLICABLE}** | **${pct}%** |`,
  );
  L.push('');
  L.push('> 「完成度」= (PASS + N/A) / 项数。**BLOCKED 不算完成**，也不折算成半分 —— 没验就是没验。');
  L.push('');
  L.push('---');
  L.push('');
  L.push('## 2. 逐条');
  L.push('');
  L.push('| ID | 组 | 判据 | 判定 | 层级 | 证据 | 命令 | 失效形态 |');
  L.push('|---|---|---|---|---|---|---|---|');

  for (const g of GROUPS) {
    const rows = matrix.rows.filter((r) => r.group === g.key).sort((a, b) => a.seq - b.seq);
    for (const r of rows) {
      const lens = lensRows.get(r.id);
      // 单格内不允许出现竖线（会破表格）；换行折成空格
      const clean = (s, max = 120) => {
        const v = String(s ?? '—').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
        return v.length > max ? `${v.slice(0, max - 1)}…` : v;
      };
      L.push(
        `| ${r.id} | ${r.group} | ${clean(r.claim, 60)} | **${r.verdict}** | ${clean(r.tier, 12)} | ${clean(r.evidence, 70)} | ${lens ? `\`07 · ${r.id}\`` : '—'} | ${clean(lens?.failure, 60)} |`,
      );
    }
  }

  L.push('');
  L.push('---');
  L.push('');
  L.push('## 3. 未验条目（BLOCKED）与解除条件');
  L.push('');
  const blocked = matrix.rows.filter((r) => r.verdict === 'BLOCKED');
  L.push(`共 **${blocked.length}** 条。逐条解除条件以矩阵 §5 为准（本文件不复制，理由同上）。`);
  L.push('');
  L.push('| ID | 判据 | 卡在哪 |');
  L.push('|---|---|---|');
  for (const r of blocked) {
    const clean = (s, max = 90) => {
      const v = String(s ?? '—').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
      return v.length > max ? `${v.slice(0, max - 1)}…` : v;
    };
    L.push(`| ${r.id} | ${clean(r.claim, 48)} | ${clean(r.evidence, 90)} |`);
  }
  L.push('');
  L.push('---');
  L.push('');
  L.push('## 4. 这份台账守不住什么');
  L.push('');
  L.push('1. **它不判断对错，只判断一致。** 矩阵写 PASS 而证据其实不成立时，台账照样显示 PASS；');
  L.push('   承重的是 `07` 里那条命令能不能跑红，不是本文件的数字。');
  L.push('2. **层级不升级。** 代码级 PASS 不会因为时间流逝变成生产级 PASS；要升级只能真跑一遍并改矩阵。');
  L.push('3. **BLOCKED 的解除条件不在本文件。** 它是矩阵 §5 的文本，台账只汇总「卡在哪」一句话。');
  L.push('');
  L.push(`_（${total.count} 条：${total.PASS} PASS / ${total.FAIL} FAIL / ${total.BLOCKED} BLOCKED / ${total.NOT_APPLICABLE} N/A）_`);
  L.push('');

  return L.join('\n');
}

/** 比较磁盘上的台账与重算结果（用于 --check） */
export function compareLedger(onDisk, expected) {
  if (onDisk === expected) return [];
  const a = onDisk.split('\n').map((s) => s.trimEnd());
  const b = expected.split('\n').map((s) => s.trimEnd());
  const problems = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (a[i] !== b[i]) {
      problems.push(
        `第 ${i + 1} 行不一致：\n    盘上：${(a[i] ?? '（缺行）').slice(0, 140)}\n    应为：${(b[i] ?? '（多行）').slice(0, 140)}`,
      );
      if (problems.length >= 6) {
        problems.push('…（差异超过 6 处，已截断）');
        break;
      }
    }
  }
  return problems;
}

export { pad };
