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
 *   ② 对四处镜像各施加一次**真实**变异（补一个旧猜测值 / 删一个真实值 /
 *      换成一个从未存在的值），每次跑 `tsc` 必须 **exit != 0**；
 *   ③ 还原 → 再跑一次 `tsc` 必须 **exit 0**（证明还原干净、且结论可复现）。
 *
 * 🔴 **中断安全 —— 本脚本特有的风险，必须知道**：
 *   它是本仓**唯一**会**就地改写已存在源文件**的自证脚本（`verify:ui-invariants`
 *   只**新建** `__mutant-*` 文件，残留能被门禁 R0 扫出来）。而 node 在
 *   SIGINT / SIGTERM 下**不执行 `finally`** ⇒ 被打断时 `schema.ts` 会**留在半改状态**，
 *   而且它看起来就是"我写的代码" —— 除了 `git diff`，没有任何东西会提示你。
 *
 *   本仓实测（2026-10-14）：一次被 SIGTERM 打断的自证把镜像里的 `CANCELLED`
 *   删掉后没还原，随即造成两个**错误结论**看起来成立：
 *     · "镜像丢了一个取值"（其实是我自己刚删的）；
 *     · "`tsc --noEmit` 的 `incremental` 会假绿"（受控对照 A/B 已**证伪**：
 *       陈旧 buildinfo + 漂移源码 → tsc 照样 exit 2）。
 *   对策（本文件已实现）：启动期**锚点自检** + SIGINT/SIGTERM 还原后再退出。
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
 * 四处真实变异。每条的 `from` 都必须在源码里**唯一命中**（命中数 != 1 直接失败，
 * 避免"变异没打上，于是 exit 0 被误读成守卫失效/生效"）。
 *
 * ⚠️ 新增镜像（`AGENT_*`）时**必须同时加一条变异**：只挂守卫不证守卫，等于
 *    把"守卫接错线"（镜像比对的是另一个服务端类型）这个错法留成静默的。
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
  {
    // P2 Slice 2 新增的镜像。真实服务端取值域见 `src/lib/agent/skills.ts:26`
    // （`SkillKey = 'INTENT_EXTRACTION' | 'INTRO_DRAFT' | 'COORDINATION_ADVICE'`）。
    name: 'agent：把真实值 COORDINATION_ADVICE 换成从未存在的 OUTCOME_NARRATIVE',
    from:
      "export const AGENT_SKILLS = ['INTENT_EXTRACTION', 'INTRO_DRAFT', 'COORDINATION_ADVICE'] as const",
    to:
      "export const AGENT_SKILLS = ['INTENT_EXTRACTION', 'INTRO_DRAFT', 'OUTCOME_NARRATIVE'] as const",
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
  // 🔴 必须取**首尾**守卫，而不是两个具名守卫。曾经的写法是
  //   `_DriftGuardConsent` → `_DriftGuardOutcomeLevel`，于是区间被钉在 148–150；
  //   P2 Slice 2 新增的 3 条 Agent 守卫（151–153）就**落在区间之外** ——
  //   一旦有变异指向它们，报错行号会被判成"不在守卫行"而**假失败**。
  //   教训：归因用的边界不能引用**可能被追加的列表**里的具体元素，
  //   否则每次追加都要回来同步一处不显眼的硬编码。
  const idx = lines
    .map((l, i) => (l.includes('export type _DriftGuard') ? i : -1))
    .filter((i) => i !== -1)
  if (idx.length === 0) return null
  return { start: idx[0] + 1, end: idx[idx.length - 1] + 1 }
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
  console.error('❌ 未能在源码里定位漂移守卫声明（`export type _DriftGuard*`）—— 归因判据失效。')
  process.exit(1)
}

// 🔴 启动期锚点自检：每个变异锚点都必须**恰好命中一次**。
//    上一次被中断的自证会把源码留在半改状态 ⇒ 对应锚点变成 0 次命中。
//    必须在这里就把它变成一条**指名道姓**的报错 —— 否则症状会退化成
//    "基线 tsc exit != 0"，而那句话看起来像"守卫恒失败"，与真相毫无关系。
const anchorMisses = MUTATIONS.filter((m) => countOccurrences(original, m.from) !== 1).map(
  (m) => `${m.name}（命中 ${countOccurrences(original, m.from)} 次，应为 1 次）`,
)
if (anchorMisses.length > 0) {
  console.error(
    '❌ 变异锚点未能在源码中唯一命中。\n' +
      '   最可能的原因：**上一次自证被中断（SIGTERM / Ctrl-C / OOM），源码被留在半改状态**。\n' +
      '   ⇒ 先执行 `git diff src/lib/workspace-spec/schema.ts` 确认它没有被半改，再重跑本脚本。\n' +
      anchorMisses.map((p) => `   · ${p}`).join('\n'),
  )
  process.exit(1)
}

// 🔴 中断安全：本脚本就地改写已有源文件，而 node 默认在 SIGINT/SIGTERM 下
//    **不执行 finally** ⇒ 源码会被留在半改状态。故显式接管信号，先还原再退出。
let alreadyRestored = false
function restoreAndExit(signal) {
  if (alreadyRestored) return
  alreadyRestored = true
  try {
    fs.writeFileSync(SCHEMA, original)
    if (fs.existsSync(PROBE_TS_CONFIG)) fs.unlinkSync(PROBE_TS_CONFIG)
    console.error(`\n⚠️ 收到 ${signal} —— 已还原 ${path.basename(SCHEMA)} 并清理探针配置后再退出。`)
  } catch (err) {
    console.error(
      `\n🔴 收到 ${signal}，但还原失败：${err?.message}\n` +
        `   请手动恢复：git checkout -- src/lib/workspace-spec/schema.ts`,
    )
  }
  process.exit(130)
}
process.on('SIGINT', () => restoreAndExit('SIGINT'))
process.on('SIGTERM', () => restoreAndExit('SIGTERM'))

fs.writeFileSync(PROBE_TS_CONFIG, PROBE_CONFIG_SOURCE)

console.log('\n枚举漂移守卫 · 变异自证\n')

try {
  // ── ① 基线 ──
  console.log('── ① 基线（未变异）')
  const baseline = runProbeTsc()
  ck('未变异的源码 → tsc exit 0', baseline.code === 0, `exit=${baseline.code}`)
  if (baseline.code !== 0) {
    console.log(baseline.out.split('\n').slice(0, 12).join('\n'))
    // 基线失败只有两种原因，必须分清：
    //   ① 守卫本身恒失败（检查坏了）—— 走到这里基本就是它（半改状态已被启动期
    //      锚点自检拦下）；
    //   ② 源码处于半改状态（上一次被中断）—— 那种情况下**下面每一条"被捕获"都
    //      不构成证据**，因为失败早在变异之前就存在了。
    console.log('    ⚠️ 基线即失败 ⇒ 下面每条"漂移被 tsc 捕获"都不构成证据（不是变异造成的）。')
  }

  // ── ② 逐条变异（MUTATIONS 的长度即轮数）──
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
