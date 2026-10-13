#!/usr/bin/env node
/**
 * P1 收口 · 契约枚举漂移守卫的**变异自证**
 *
 * 守卫本身（`src/lib/workspace-spec/schema.ts` 的 `AssertTrue<Exact<镜像, 服务端>>`）
 * 只在"镜像与服务端不一致"时才报错。而**一个从不报错的守卫和一个不存在的守卫
 * 完全一样** —— 所以必须自证它会报错。
 *
 * 做法（每条都自证"变异确实发生"）：
 *   ① 基线：未变异的源码 → `tsc` 必须 **exit 0**（否则说明检查恒失败，下面的
 *      "被捕获"就是巧合，不是证据）；
 *   ② 对三处镜像各施加一次**真实**变异（补一个旧猜测值 / 删一个真实值 /
 *      换成一个从未存在的值），每次跑 `tsc` 必须 **exit != 0**；
 *   ③ 还原 → 再跑一次 `tsc` 必须 **exit 0**（证明还原干净、且结论可复现）。
 *
 * 为什么用定向 tsconfig（`tsconfig.drift-probe.json`，只含 workspace-spec 两个文件）：
 * 全量 `tsc` 约 2.5 分钟 × 5 轮 = 十几分钟；定向后每轮约 50 秒，且**判据强度不变**
 * —— 漂移守卫是**类型层**断言，只依赖 schema.ts 自身的类型图。
 *
 * 用法：node scripts/qa/verify-workspace-spec-drift.mjs
 * 退出码 0 = 守卫有牙齿且还原干净。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')

const SCHEMA = path.join(ROOT, 'src/lib/workspace-spec/schema.ts')
const PROBE_TS_CONFIG = path.join(ROOT, 'tsconfig.drift-probe.json')

const PROBE_CONFIG_SOURCE = `{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "incremental": false,
    "noEmit": true
  },
  "include": ["src/lib/workspace-spec/schema.ts", "src/lib/workspace-spec/assemble.ts"],
  "exclude": ["node_modules", "tests", "scripts"]
}
`

/**
 * 三处真实变异。每条的 `from` 都必须在源码里**唯一命中**（命中数 != 1 直接失败，
 * 避免"变异没打上，于是 exit 0 被误读成守卫失效/生效"）。
 */
const MUTATIONS = [
  {
    name: 'consent：把旧猜测值 PENDING 加回镜像',
    from: "export const CONSENT_STATES = [\n  'CONSENT_PENDING',",
    to: "export const CONSENT_STATES = [\n  'PENDING',\n  'CONSENT_PENDING',",
  },
  {
    name: 'action：从镜像里删掉真实值 CANCELLED',
    from: "  'TAKEN_OVER',\n  'CANCELLED',\n] as const\nexport type ActionJobStatus",
    to: "  'TAKEN_OVER',\n] as const\nexport type ActionJobStatus",
  },
  {
    name: 'outcome：把真实值 EXTERNALLY_VERIFIED 换成从未存在的 EVIDENCE_BACKED',
    from: "  'EXTERNALLY_VERIFIED',\n] as const\nexport type OutcomeLevel",
    to: "  'EVIDENCE_BACKED',\n] as const\nexport type OutcomeLevel",
  },
]

let pass = 0
let fail = 0
const ck = (label, ok, extra = '') => {
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? '✅' : '❌'} ${label}${extra ? `  ${extra}` : ''}`)
}

/** 跑定向 tsc，返回 { code, out }。 */
function runProbeTsc() {
  try {
    const out = execFileSync('npx', ['tsc', '-p', PROBE_TS_CONFIG], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, out }
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

function countOccurrences(haystack, needle) {
  let count = 0
  let idx = haystack.indexOf(needle)
  while (idx !== -1) {
    count += 1
    idx = haystack.indexOf(needle, idx + needle.length)
  }
  return count
}

/**
 * 守卫块的行号区间（未变异源码上算）。
 *
 * 为什么要按**行号区间**归因，而不只是"输出里有 TS2344"：
 * 变异可能因为**别的原因**（例如数组字面量被改坏）导致编译失败，那种情况下
 * "exit != 0" 会被误读成"守卫生效"。只有报错**精确落在守卫声明那几行**、
 * 且错误码是 TS2344（`Type 'false' does not satisfy the constraint 'true'`），
 * 才能说这是守卫在响。
 */
function guardLineRange(source) {
  const lines = source.split('\n')
  const start = lines.findIndex((l) => l.includes('export type _DriftGuardConsent'))
  const end = lines.findIndex((l) => l.includes('export type _DriftGuardOutcomeLevel'))
  return start === -1 || end === -1 ? null : { start: start + 1, end: end + 1 }
}

/** 从 tsc 输出里取出"指向守卫块"的 TS2344 报错行号。 */
function guardHits(output, range) {
  if (!range) return []
  const hits = []
  const re = /schema\.ts\((\d+),\d+\): error TS2344:/g
  let m
  while ((m = re.exec(output)) !== null) {
    const line = Number(m[1])
    if (line >= range.start && line <= range.end) hits.push(line)
  }
  return hits
}

if (!fs.existsSync(SCHEMA)) {
  console.error(`❌ 找不到 ${SCHEMA}`)
  process.exit(1)
}
// 残留探测：上次被中断留下的探针配置会让本轮结论不可信。
if (fs.existsSync(PROBE_TS_CONFIG)) {
  console.error(`❌ 发现残留的 ${path.basename(PROBE_TS_CONFIG)}（上次被中断？）—— 删除它再跑。`)
  process.exit(1)
}

const original = fs.readFileSync(SCHEMA, 'utf8')
const guardRange = guardLineRange(original)
if (!guardRange) {
  console.error('❌ 未能在源码里定位漂移守卫声明（`_DriftGuardConsent` / `_DriftGuardOutcomeLevel`）—— 归因判据失效。')
  process.exit(1)
}
fs.writeFileSync(PROBE_TS_CONFIG, PROBE_CONFIG_SOURCE)

console.log('\n枚举漂移守卫 · 变异自证\n')

try {
  // ── ① 基线 ──
  console.log('── ① 基线（未变异）')
  const baseline = runProbeTsc()
  ck('未变异的源码 → tsc exit 0', baseline.code === 0, `exit=${baseline.code}`)
  if (baseline.code !== 0) {
    console.log(baseline.out.split('\n').slice(0, 12).join('\n'))
  }

  // ── ② 三次变异 ──
  for (const m of MUTATIONS) {
    console.log(`── ② ${m.name}`)
    const hits = countOccurrences(original, m.from)
    if (hits !== 1) {
      ck('变异锚点在源码中唯一命中', false, `命中 ${hits} 次 —— 变异未按预期施加，本轮结论无效`)
      continue
    }
    const mutated = original.replace(m.from, m.to)
    fs.writeFileSync(SCHEMA, mutated)

    // 🔴 自证"变异确实发生"：回读磁盘，确认被改的正是预期内容。
    const onDisk = fs.readFileSync(SCHEMA, 'utf8')
    const wrote = onDisk.includes(m.to) && !onDisk.includes(m.from)
    ck('变异已真正写入磁盘（自证）', wrote)
    if (!wrote) continue

    const r = runProbeTsc()
    ck('漂移被 tsc 捕获（exit != 0）', r.code !== 0, `exit=${r.code}`)
    if (r.code === 0) {
      console.log('    ⚠️ 守卫没有牙齿：镜像与服务端枚举不一致，但 tsc 仍然通过。')
      continue
    }
    const guardErrs = guardHits(r.out, guardRange)
    ck(
      `报错精确落在守卫声明行（${guardRange.start}–${guardRange.end}）且为 TS2344`,
      guardErrs.length > 0,
      guardErrs.length > 0
        ? `line=${guardErrs.join(',')}`
        : `输出首行：${r.out.split('\n').find((l) => l.includes('error')) ?? '(无 error 行)'}`,
    )
    // 恢复现场，供下一轮使用
    fs.writeFileSync(SCHEMA, original)
  }
} finally {
  // ── ③ 还原 + 复验 ──
  fs.writeFileSync(SCHEMA, original)
  const final = runProbeTsc()
  console.log('── ③ 还原后复验')
  ck('源码已还原 → tsc exit 0', final.code === 0, `exit=${final.code}`)
  ck('源码与最初逐字一致', fs.readFileSync(SCHEMA, 'utf8') === original)

  try {
    fs.unlinkSync(PROBE_TS_CONFIG)
    ck('临时探针配置已清理', !fs.existsSync(PROBE_TS_CONFIG))
  } catch (err) {
    ck('临时探针配置已清理', false, `删除失败：${err?.message}`)
  }
}

console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══\n`)
process.exit(fail === 0 ? 0 : 1)
