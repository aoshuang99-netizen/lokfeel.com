#!/usr/bin/env node
/**
 * lint 棘轮门禁（AC-23 · CI 可信化）
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 要解决的问题
 * ═══════════════════════════════════════════════════════════════════════
 *
 * CI 的 `lint` job 长期恒红：`npm run lint` 是裸 `eslint`（= `eslint .`），
 * 会扫出全仓约 1.5k 条**历史存量**债（`no-unused-vars` / `no-explicit-any` /
 * `no-require-imports` 三条占 79%）。恒红的门禁等于没有门禁 ——
 * 真回归会被淹没在存量噪音里，久而久之所有人学会忽略它。
 *
 * 两条常见的错误解法：
 *   ✗ **收敛扫描面** —— 存量债 75% 就在 `src/`，把 `src/` 排掉等于门禁失效。
 *   ✗ **降级规则 severity** —— 那是削弱，不是收敛。
 *
 * 本脚本走第三条路：**棘轮（ratchet）**。
 *   · 把「当前存量」冻结成基线 `docs/implementation/lint-baseline.json`；
 *   · 每次 CI 比对**逐文件 × 逐规则**计数；
 *   · **只有新增才判红**；持平通过；下降记为改进（债务在还）。
 *
 * 于是「红」重新等于「这次改动引入了问题」，门禁恢复可信。
 * 且**规则强度一点没降** —— 基线之外的一切照旧是 error。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 为什么是「逐文件 × 逐规则」而不是「总数」
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 只比总数时，「新加 3 条 `any`、顺手删掉 3 条旧的」会被判通过 ——
 * 这是**可被无意（也可被有意）绕过**的假门禁。逐文件逐规则比对能挡住它：
 * 任何一处的增加都必须由**同一处**的减少来抵消，否则判红。
 *
 * 代价是「搬运代码」也会判红（A 文件减 5、B 文件加 5）。这是**刻意的取舍**：
 * 真正的搬运应当在同一提交里执行 `npm run lint:baseline`，让基线变化
 * 出现在 diff 里被 review —— 而不是无声地吸收掉。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 用法
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   npm run lint:gate                       比对基线，只拦新增（CI 用）
 *   npm run lint:baseline                   用当前结果重写基线
 *   npm run verify:lint:ratchet             自证：注入回归必须被判失败
 *
 *   node scripts/ci/lint-ratchet.mjs --report=<eslint.json>   复用已有报告
 *   node scripts/ci/lint-ratchet.mjs --max-print=40           限制明细条数
 *
 * 退出码：0 = 零新增；1 = 有新增（或自证失败）；2 = 环境/配置错误
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const BASELINE_PATH = path.join(ROOT, 'docs', 'implementation', 'lint-baseline.json')
const ESLINT_BIN = path.join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js')

const argv = process.argv.slice(2)
const UPDATE = argv.includes('--update')
const SELF_TEST = argv.includes('--self-test')
const reportArgv = argv.find((a) => a.startsWith('--report='))
const REPORT_PATH = reportArgv ? path.resolve(ROOT, reportArgv.slice('--report='.length)) : null
const maxPrintArgv = argv.find((a) => a.startsWith('--max-print='))
const MAX_PRINT = maxPrintArgv ? Number(maxPrintArgv.slice('--max-print='.length)) : 25

/** 汇总键的分隔符：`<相对路径>::<规则 id>`。 */
const SEP = '::'
const FATAL_RULE = '(fatal)'

// ─────────────────────────────────────────────────────────────────────
// 采集
// ─────────────────────────────────────────────────────────────────────

/** 跑 eslint（`eslint . -f json`），返回 JSON 报告数组。 */
function runEslint() {
  if (!fs.existsSync(ESLINT_BIN)) {
    fail(`找不到 eslint 可执行文件：${ESLINT_BIN}（先 npm ci）`)
  }
  const r = spawnSync(process.execPath, [ESLINT_BIN, '.', '-f', 'json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env },
  })
  if (r.error) fail(`eslint 启动失败：${r.error.message}`)
  const out = r.stdout || ''
  if (!out.trim()) {
    fail(
      `eslint 无输出（退出码 ${r.status}）。stderr:\n${(r.stderr || '(空)').slice(0, 2000)}`
    )
  }
  let parsed
  try {
    parsed = JSON.parse(out)
  } catch (e) {
    fail(`eslint 输出不是合法 JSON：${e.message}\n前 500 字：${out.slice(0, 500)}`)
  }
  if (!Array.isArray(parsed)) fail('eslint JSON 报告不是数组')
  // 退出码 2 = eslint 自身配置/致命错误，必须硬失败（不能拿它跟基线比）
  if (r.status === 2) {
    fail(`eslint 退出码 2（配置或致命错误）：\n${(r.stderr || '').slice(0, 2000)}`)
  }
  return parsed
}

/** 报告 → Map<键, 计数>。只保留有问题的条目。 */
function collect(report) {
  const map = new Map()
  for (const file of report) {
    const rel = path.relative(ROOT, file.filePath).split(path.sep).join('/')
    for (const m of file.messages) {
      const key = rel + SEP + (m.ruleId || FATAL_RULE)
      map.set(key, (map.get(key) || 0) + 1)
    }
  }
  return map
}

/** Map → 稳定排序的普通对象（基线落盘用）。 */
function toObject(map) {
  const out = {}
  for (const key of [...map.keys()].sort()) out[key] = map.get(key)
  return out
}

/** 普通对象 → Map。 */
function fromObject(obj) {
  const map = new Map()
  for (const [k, v] of Object.entries(obj || {})) map.set(k, v)
  return map
}

// ─────────────────────────────────────────────────────────────────────
// 比对（纯函数 —— 自证直接复用，保证「测的就是跑的」）
// ─────────────────────────────────────────────────────────────────────

/**
 * @param {Map<string,number>} baseline
 * @param {Map<string,number>} current
 * @returns {{regressions: Array<{key:string,base:number,now:number,delta:number}>,
 *            improvements: Array<{key:string,base:number,now:number,delta:number}>,
 *            fixed: string[]}}
 */
function diffAgainstBaseline(baseline, current) {
  const regressions = []
  const improvements = []
  const fixed = []

  for (const [key, now] of current) {
    const base = baseline.get(key) || 0
    if (now > base) {
      regressions.push({ key, base, now, delta: now - base })
    } else if (now < base) {
      improvements.push({ key, base, now, delta: now - base })
    }
  }
  for (const key of baseline.keys()) {
    if (!current.has(key)) fixed.push(key)
  }

  const byKey = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  regressions.sort((a, b) => b.delta - a.delta || byKey(a, b))
  improvements.sort((a, b) => a.delta - b.delta || byKey(a, b))
  fixed.sort()
  return { regressions, improvements, fixed }
}

function totalsOf(map) {
  let sum = 0
  for (const v of map.values()) sum += v
  return { keys: map.size, problems: sum }
}

// ─────────────────────────────────────────────────────────────────────
// 输出
// ─────────────────────────────────────────────────────────────────────

function fail(msg) {
  console.error(`\n🔴 ${msg}`)
  process.exit(2)
}

function eslintVersion() {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(ROOT, 'node_modules', 'eslint', 'package.json'), 'utf8')
    ).version
  } catch {
    return 'unknown'
  }
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) {
    fail(
      `基线不存在：${path.relative(ROOT, BASELINE_PATH)}\n` +
        `   首次建立请执行：npm run lint:baseline`
    )
  }
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
  } catch (e) {
    fail(`基线不是合法 JSON：${e.message}`)
  }
  if (!parsed || typeof parsed.frozen !== 'object' || parsed.frozen === null) {
    fail('基线缺少 `frozen` 字段')
  }
  return parsed
}

function printList(title, items, fmt) {
  if (items.length === 0) return
  console.log(`\n${title}`)
  for (const it of items.slice(0, MAX_PRINT)) console.log('  ' + fmt(it))
  if (items.length > MAX_PRINT) {
    console.log(`  … 另有 ${items.length - MAX_PRINT} 条（用 --max-print=N 展开）`)
  }
}

/** CI 下额外发 GitHub 注解，让问题直接落在 diff 上。 */
function emitAnnotations(regressions) {
  if (!process.env.CI) return
  for (const r of regressions.slice(0, 50)) {
    const [file, rule] = r.key.split(SEP)
    console.log(
      `::error file=${file}::lint 棘轮：${rule} 由 ${r.base} 增至 ${r.now}（+${r.delta}）`
    )
  }
}

// ─────────────────────────────────────────────────────────────────────
// 自证：证明门禁真的会红（而不是「永远绿」）
// ─────────────────────────────────────────────────────────────────────

function selfTest(baselineObj) {
  console.log('lint 棘轮门禁 · 自证\n')
  const baseline = fromObject(baselineObj.frozen)
  const failures = []

  const check = (name, ok, detail) => {
    console.log(`  ${ok ? '✅' : '🔴'} ${name}${detail ? '  —— ' + detail : ''}`)
    if (!ok) failures.push(name)
  }

  // ① 完全一致 → 必须零新增
  const same = diffAgainstBaseline(baseline, new Map(baseline))
  check('基线对自身：0 新增', same.regressions.length === 0, `新增 ${same.regressions.length}`)

  // 夹具选取：**优先选计数 > 1 的条目**，否则 ④（-1 改善）与 ⑤（总数守恒位移）
  // 会因为没有富余可减而被静默跳过 —— 自证漏检比自证失败更危险。
  const ranked = [...baseline.entries()].sort((a, b) => b[1] - a[1])
  const target = (ranked.find(([, n]) => n > 1) || ranked[0] || [null])[0]
  const donor = (ranked.find(([k, n]) => k !== target && n > 1) || [null])[0]
  check('夹具充足（存在计数 > 1 的条目）', Boolean(target && baseline.get(target) > 1), String(target))
  check('夹具充足（存在第二个计数 > 1 的条目，供 ⑤ 用）', Boolean(donor), String(donor))
  if (!target || !donor) {
    console.log('\n🔴 基线过小或过于稀疏，无法完成自证 —— 这本身就不该放过')
    process.exit(1)
  }

  // ② 某条计数 +1 → 必须被抓到（这是棘轮的核心语义）
  const bump = new Map(baseline)
  bump.set(target, baseline.get(target) + 1)
  const dBump = diffAgainstBaseline(baseline, bump)
  check(
    '单条 +1：判红',
    dBump.regressions.length === 1 && dBump.regressions[0].key === target && dBump.regressions[0].delta === 1,
    target
  )

  // ③ 全新文件（基线里没有的键）→ 必须判红
  const novel = new Map(baseline)
  novel.set('src/__brand_new__' + SEP + '@typescript-eslint/no-explicit-any', 1)
  const dNovel = diffAgainstBaseline(baseline, novel)
  check(
    '全新文件的规则命中：判红',
    dNovel.regressions.some((r) => r.key.startsWith('src/__brand_new__')),
    `新增 ${dNovel.regressions.length}`
  )

  // ④ 只减不增 → 必须通过，且记为改进
  const fewer = new Map(baseline)
  fewer.set(target, baseline.get(target) - 1)
  const dFewer = diffAgainstBaseline(baseline, fewer)
  check(
    '单条 -1：0 新增且记为改进',
    dFewer.regressions.length === 0 && dFewer.improvements.some((x) => x.key === target),
    target
  )

  // ④b 整键清零 → 记为「已清零」，同样不判红
  const gone = new Map(baseline)
  gone.delete(target)
  const dGone = diffAgainstBaseline(baseline, gone)
  check(
    '整键清零：0 新增且记为已清零',
    dGone.regressions.length === 0 && dGone.fixed.includes(target),
    target
  )

  // ⑤ 总数守恒的「偷换」（A 减 1 / B 加 1）→ 必须判红
  //    这正是「只比总数」的假门禁漏掉的那一类。
  const swap = new Map(baseline)
  swap.set(donor, baseline.get(donor) + 1)
  swap.set(target, baseline.get(target) - 1)
  const dSwap = diffAgainstBaseline(baseline, swap)
  const swapNet =
    [...swap.values()].reduce((a, b) => a + b, 0) -
    [...baseline.values()].reduce((a, b) => a + b, 0)
  check(
    `总数守恒（净变化 ${swapNet}）但发生位移：仍判红`,
    swapNet === 0 && dSwap.regressions.length === 1 && dSwap.regressions[0].key === donor,
    `donor=${donor}`
  )

  console.log(
    `\n自证结果：${failures.length === 0 ? '✅ 全部通过' : '🔴 ' + failures.length + ' 项失败'}`
  )
  process.exit(failures.length === 0 ? 0 : 1)
}

// ─────────────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────────────

// ── 自证：不需要跑 eslint（纯函数级验证），因此放在采集**之前** ──────
//    否则 `npm run verify:lint:ratchet` 也要等两分半，自证就没人跑了。
if (SELF_TEST) selfTest(readBaseline())

let report
if (REPORT_PATH) {
  if (!fs.existsSync(REPORT_PATH)) fail(`报告文件不存在：${REPORT_PATH}`)
  const raw = fs.readFileSync(REPORT_PATH, 'utf8')
  if (!raw.trim()) {
    fail(
      `报告文件为空：${REPORT_PATH}\n` +
        `   说明上一步的 eslint 没有正常产出 —— 宁可不判绿，也不要用空报告糊过去。`
    )
  }
  try {
    report = JSON.parse(raw)
  } catch (e) {
    fail(`报告文件不是合法 JSON：${e.message}\n   前 500 字：${raw.slice(0, 500)}`)
  }
  if (!Array.isArray(report) || report.length === 0) {
    fail(`报告不是非空数组（${Array.isArray(report) ? '0 个文件' : typeof report}）—— 判定为采集失败`)
  }
} else {
  report = runEslint()
}
const current = collect(report)
const totals = totalsOf(current)

// ── 建立/更新基线 ────────────────────────────────────────────────────
if (UPDATE) {
  let previous = null
  if (fs.existsSync(BASELINE_PATH)) {
    try {
      previous = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
    } catch {
      previous = null
    }
  }
  const payload = {
    $comment:
      'lint 棘轮基线（AC-23）。由 `npm run lint:baseline` 生成 —— 请勿手改。' +
      '含义：这些是**已冻结的历史存量**；CI 只在**超出**它们时判红。',
    generatedAt: new Date().toISOString(),
    eslintVersion: eslintVersion(),
    scannedFiles: report.length,
    totals,
    frozen: toObject(current),
  }
  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true })
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8')

  console.log(`✅ 基线已写入 ${path.relative(ROOT, BASELINE_PATH)}`)
  console.log(`   扫描文件 ${report.length} · 命中文件×规则 ${totals.keys} · 问题总数 ${totals.problems}`)
  if (previous && previous.frozen) {
    const d = diffAgainstBaseline(fromObject(previous.frozen), current)
    console.log(
      `   相对上一版基线：新增项 ${d.regressions.length} · 改善项 ${d.improvements.length} · 清零项 ${d.fixed.length}`
    )
    printList('   ⚠️ 被基线新吸收（请确认不是把真问题冻结了）：', d.regressions, (r) => `${r.key}  ${r.base} → ${r.now}`)
    printList('   👍 已改善：', d.improvements, (r) => `${r.key}  ${r.base} → ${r.now}`)
  }
  process.exit(0)
}

const baselineDoc = readBaseline()

// ── 比对 ─────────────────────────────────────────────────────────────
console.log('lint 棘轮门禁')
console.log(`  eslint     : ${eslintVersion()}`)
console.log(`  基线生成于 : ${baselineDoc.generatedAt || '(未知)'}`)
if (baselineDoc.eslintVersion && baselineDoc.eslintVersion !== eslintVersion()) {
  console.log(
    `  ⚠️ eslint 版本与基线不同（基线 ${baselineDoc.eslintVersion} / 当前 ${eslintVersion()}）` +
      `—— 规则集变化会让基线整体失真，建议在同一提交内跑 npm run lint:baseline`
  )
}
console.log(
  `  当前全仓   : ${totals.problems} problems（${totals.keys} 个「文件×规则」命中，扫描 ${report.length} 个文件）`
)
console.log(`  冻结基线   : ${baselineDoc.totals?.problems ?? '?'} problems`)

const diff = diffAgainstBaseline(fromObject(baselineDoc.frozen), current)

printList('🔴 新增债务（本门禁判红的原因）：', diff.regressions, (r) => `${r.key}  ${r.base} → ${r.now}  (+${r.delta})`)
printList('👍 债务下降：', diff.improvements, (r) => `${r.key}  ${r.base} → ${r.now}  (${r.delta})`)
printList('✅ 已清零：', diff.fixed, (k) => String(k))

if (diff.regressions.length > 0) {
  emitAnnotations(diff.regressions)
  console.log(
    `\n🔴 lint 棘轮未通过：新增 ${diff.regressions.length} 处（合计 +${diff.regressions.reduce((a, b) => a + b.delta, 0)} 条）。` +
      `\n   修掉即可；若确为合理变更（如搬运代码），在同一提交内跑 npm run lint:baseline 并说明原因。`
  )
  process.exit(1)
}

console.log(
  `\n✅ lint 棘轮通过：零新增。` +
    (diff.improvements.length || diff.fixed.length
      ? `（债务下降 ${diff.improvements.length} 处、清零 ${diff.fixed.length} 处 —— 恭喜）`
      : '')
)
process.exit(0)
