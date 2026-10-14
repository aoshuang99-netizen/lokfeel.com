#!/usr/bin/env node
/**
 * `check:ui-invariants` 的**变异自证**（Living Connection OS）
 * ------------------------------------------------------------
 * 为什么需要它：门禁"通过"只能说明**没有报警**，不能说明**规则真的生效**。
 * 万一正则写错、SCOPES 配错、或 stripComments 把代码吃掉了，门禁会**静默失效**，
 * 而"绿色"看起来仍然一切正常 —— 这比报错危险得多。
 *
 * 做法（刻意不改动真实文件）：
 *   1. 在**被扫描目录内**临时写入一个只违反**单条**规则的文件；
 *   2. 跑一次门禁 → 必须 exit 1 且输出里出现对应的 `[R<n>]`；
 *   3. 再写一个**不违反任何规则**的对照文件 → 门禁必须仍然 exit 0（负向对照，
 *      证明"变红"确实来自那条违反，而不是脚本本身坏掉）；
 *   4. 无论成功失败都在 `finally` 里删掉临时文件。
 *
 * 用法：node scripts/qa/verify-ui-invariants-mutation.mjs
 * 退出码：0 = 全部规则被证明生效；1 = 有规则未被证明（视为门禁失效）。
 *
 * ⚠️ **不得与其它扫描型任务并行**（`tsc` / `jest` / `next build`）：本脚本会往
 *    `src/` 临时写入 `__mutant-*`。并行时对方可能读到"半截文件"，或读到随后被删掉的
 *    文件 → 报出与被测逻辑无关的**假失败**（本仓实测：与 `tsc` 并行 → `TS6053`）。
 *    判据是"**这个任务是否写源码树**"，而不是"它重不重"。
 *    （好消息：本脚本只**新建**文件、不就地改写已有源文件 ⇒ 被中断时最坏是留下
 *      `__mutant-*`，而门禁 **R0** 会主动把它报出来。与 `verify:workspace-drift`
 *      不同 —— 那个是就地改写，中断后残留的是"看起来像正常代码"的源文件。)
 *
 * ⚠️ R8 的变异文件**必须写在 `src/components/living/` 根**（不在 `field/` 子目录内），
 *    否则它自己就落在白名单里，规则当然不会报 —— 那样证明的是"白名单被绕过了"。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')
const CHECKER = path.join(ROOT, 'scripts', 'check-ui-invariants.mjs')
const SCOPE_DIR = path.join(ROOT, 'src', 'components', 'living')

const MUTANT_PREFIX = '__mutant-check-'

/** 只违反单条规则的最小文件。 */
const MUTANTS = [
  {
    rule: 'R1',
    body: `export const x = () => setTimeout(() => {}, 0)\n`,
  },
  {
    rule: 'R2',
    body: `export const B = () => <button type="button">点了没反应</button>\n`,
  },
  {
    rule: 'R3',
    body: `import * as three from 'three'\nexport const T = three\n`,
  },
  {
    rule: 'R4',
    body: `export const nav = { key: 'x', label: 'X', hint: 'h', ready: false }\n`,
  },
  {
    rule: 'R5',
    body: `export const data = { mockData: [1, 2, 3] }\n`,
  },
  {
    rule: 'R6',
    // T09 落地后 R6 已改为"不得**无源**"：这个变异体正是"无源"的形态 ——
    // 有 agent 节点却没有 `runs`（真实端点数据）⇒ 必须被拦。
    body: `export const node = { id: 'a', type: 'agent', title: '自动执行', data: {} }\n`,
  },
  {
    rule: 'R7',
    body: `export const Danger = ({ html }: { html: string }) => <div dangerouslySetInnerHTML={{ __html: html }} />\n`,
  },
  {
    rule: 'R8',
    // 写在 `living/` 根（不在白名单目录 `living/field/` 内）⇒ 必须被 R8 拦下。
    body: `import { ReactFlow } from '@xyflow/react'\nexport const X = ReactFlow\n`,
  },
  {
    rule: 'R9',
    // 会进界面的字符串里带 markdown 强调标记 ⇒ 必须被 R9 拦下。
    body: `export const note = '这是一条**重点**说明'\n`,
  },
  {
    rule: 'R10',
    // 值导入服务端桶文件 ⇒ 会把 Prisma/守卫拖进客户端 bundle，必须被拦。
    // （`import type` 的合法写法在负向对照里，用来证明"只禁值导入"而不是"禁一切导入"。）
    body: `import { decodeDisclosure } from '@/lib/connection'\nexport const F = decodeDisclosure\n`,
  },
]

/**
 * 负向对照：不违反任何规则，门禁必须保持 exit 0。
 *
 * 刻意包含两类"看起来像违规、其实合法"的写法，用来证明规则**没有过宽**：
 *   - `import type { ... } from '@/lib/connection'` —— 零运行时，R10 必须放行；
 *   - `import { DISCLOSURE_FIELDS } from '@/lib/connection/field-catalog'` —— 白名单。
 */
const CONTROL_BODY = [
  `import type { CandidateList } from '@/lib/connection'`,
  `import { DISCLOSURE_FIELDS } from '@/lib/connection/field-catalog'`,
  `export type C = CandidateList`,
  `export const ok = { key: 'a', label: 'A', hint: 'h', ready: true, fieldCount: DISCLOSURE_FIELDS.length }`,
  ``,
].join('\n')

function runChecker() {
  return spawnSync(process.execPath, [CHECKER], {
    cwd: ROOT,
    encoding: 'utf8',
    // 告诉门禁"这是自证的一部分" → 允许 `__mutant-*` 文件存在（否则 R0 会把它自己判失败）。
    env: { ...process.env, LF_INVARIANT_SELF_TEST: '1' },
  })
}

function writeTmp(name, body) {
  const p = path.join(SCOPE_DIR, name)
  fs.writeFileSync(p, body, 'utf8')
  return p
}

const created = []
function cleanup() {
  for (const p of created) {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p)
    } catch (err) {
      console.error(`⚠️  临时文件删除失败（请手动删除）：${p} — ${err.message}`)
    }
  }
}

const failures = []

try {
  if (!fs.existsSync(SCOPE_DIR)) {
    console.error(`❌ 扫描目录不存在：${SCOPE_DIR}`)
    process.exit(1)
  }

  const baseline = runChecker()
  console.log(`基线（无变异）：exit=${baseline.status}`)
  if (baseline.status !== 0) {
    console.error('❌ 基线就不通过 —— 请先修好真实代码，再来做变异自证。')
    console.error(baseline.stdout)
    console.error(baseline.stderr)
    process.exit(1)
  }

  // ── 负向对照 ──
  const controlPath = writeTmp(`${MUTANT_PREFIX}control.tsx`, CONTROL_BODY)
  created.push(controlPath)
  const control = runChecker()
  const controlSaw = control.stdout.includes(path.basename(controlPath))
  if (control.status !== 0 || !controlSaw) {
    failures.push(
      `[对照] 不违反规则的文件被误报，或没有被扫描到（exit=${control.status}, 被扫到=${controlSaw}）`,
    )
  } else {
    console.log('✅ 负向对照：合法文件未误报，且确实被扫描到')
  }
  fs.unlinkSync(controlPath)
  created.splice(created.indexOf(controlPath), 1)

  // ── 逐条变异 ──
  for (const m of MUTANTS) {
    const name = `${MUTANT_PREFIX}${m.rule.toLowerCase()}.tsx`
    const p = writeTmp(name, m.body)
    created.push(p)

    const res = runChecker()
    const output = `${res.stdout}\n${res.stderr}`
    const fired = output.includes(`[${m.rule}]`)
    const scanned = res.stdout.includes(name)

    if (!scanned) {
      failures.push(`[${m.rule}] 变异文件未被扫描到（SCOPES/扩展名配置有问题？）`)
    }
    if (res.status !== 1) {
      failures.push(`[${m.rule}] 注入违反后退出码为 ${res.status}（应为 1）—— 规则未生效`)
    }
    if (!fired) {
      failures.push(`[${m.rule}] 注入违反后输出中没有 [${m.rule}] 标记 —— 规则未命中`)
    }
    if (scanned && fired && res.status === 1) {
      console.log(`✅ ${m.rule} 变异被捕获（exit=1，命中 [${m.rule}]）`)
    }

    fs.unlinkSync(p)
    created.splice(created.indexOf(p), 1)
  }
} finally {
  cleanup()
  // 收尾复验：临时文件都删干净后，门禁必须重新变绿。
  const after = runChecker()
  console.log(`\n收尾复验（清理后）：exit=${after.status}`)
  if (after.status !== 0) {
    failures.push('清理临时文件后门禁仍未通过 —— 可能残留了变异文件')
  }
}

if (failures.length > 0) {
  console.error(`\n❌ 变异自证未通过（${failures.length} 项）：`)
  for (const f of failures) console.error(`  · ${f}`)
  process.exit(1)
}

console.log(
  `\n✅ 变异自证通过：${MUTANTS.length} 条规则（${MUTANTS.map((m) => m.rule).join(' / ')}）全部被证明生效；合法文件未误报；临时文件已清理。`,
)
