#!/usr/bin/env node
/**
 * 依赖审计棘轮门禁（AC-23 · CI 可信化 · 供应链）
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 要解决的问题
 * ═══════════════════════════════════════════════════════════════════════
 *
 * CI 的 `dependency-audit` job 标着 `continue-on-error: true`，等于**没门禁**。
 * 实测（2026-10-16）：`npm audit --audit-level=high` → **34 high / 3 critical**，
 * 其中**生产可达**（`--omit=dev`）26 high / 2 critical。恒红 ⇒ 被忽略。
 *
 * 三条常见的错误解法：
 *   ✗ 一直 `continue-on-error` —— 等于没有供应链门禁。
 *   ✗ `npm audit fix --force` 一把梭 —— 实测会动 162 个包、含 `undici 7→8`、
 *     `deepmerge-ts 7→8` 这类**主版本跃迁**，且**一条高危都没消掉**。
 *   ✗ 只把阈值调到 `critical` —— 34 条 high 直接消失，属于自欺。
 *
 * 本脚本走第四条路：**生产可达高危的棘轮 + 强制书面豁免**。
 *
 *   · **只冻结生产可达**（`--omit=dev`）—— 开发工具链的高危另算，不混进来。
 *   · 每条被接受的高危**必须有登记理由**（`exemptions`），否则判红。
 *   · 有**复核期限**（`reviewBy`），到期判红 —— 不允许「永久豁免」。
 *   · 出现**基线之外**的新高危 → 判红（这才是门禁真正在拦的东西）。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 为什么 dev 依赖不阻断
 * ═══════════════════════════════════════════════════════════════════════
 *
 * devDependencies 不进生产运行时（Netlify 构建产物不含它们）。
 * 把它们和 prod 混在一个门槛里，结果就是 37 条里 9 条来自 jest / ts-jest /
 * eslint-config-next —— 真正该拦的生产漏洞被这堆噪音淹掉。
 * 所以本门禁把 dev 部分降为**非阻断报告**（仍会打印，仍会被看见）。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 用法
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   npm run check:deps                 生产可达高危棘轮（CI 阻断门禁）
 *   npm run check:deps:baseline        重写冻结快照（**不会**动 exemptions）
 *   npm run verify:check:deps          自证：注入新高危/到期豁免必须判红
 *
 *   node scripts/ci/dependency-ratchet.mjs --report=<npm-audit.json>  复用已有报告
 *   node scripts/ci/dependency-ratchet.mjs --full                     附打印 dev 部分
 *
 * 退出码：0 = 零新增；1 = 有新增 / 豁免到期 / 未登记理由；2 = 环境错误
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const BASELINE_PATH = path.join(ROOT, 'docs', 'implementation', 'dependency-baseline.json')
const RISK_DOC = 'docs/implementation/DEPENDENCY_RISK.md'

const argv = process.argv.slice(2)
const UPDATE = argv.includes('--update')
const SELF_TEST = argv.includes('--self-test')
const SHOW_FULL = argv.includes('--full')
const reportArgv = argv.find((a) => a.startsWith('--report='))
const REPORT_PATH = reportArgv ? path.resolve(ROOT, reportArgv.slice('--report='.length)) : null

/** 阻断级别的严重度。moderate/low 不阻断（但会打印）。 */
const BLOCKING = new Set(['high', 'critical'])
const SEVERITY_RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 }

// ─────────────────────────────────────────────────────────────────────
// 采集
// ─────────────────────────────────────────────────────────────────────

/** 跑 `npm audit --json`。`omitDev` 决定是否只要生产依赖。 */
function runAudit(omitDev) {
  const args = ['audit', '--json']
  if (omitDev) args.push('--omit=dev')
  const r = spawnSync('npm', args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env },
  })
  if (r.error) fail(`npm 启动失败：${r.error.message}`)
  const out = r.stdout || ''
  let parsed = null
  try {
    parsed = JSON.parse(out)
  } catch {
    parsed = null
  }
  if (!parsed || !parsed.vulnerabilities) {
    fail(
      `npm audit 未返回可解析结果（退出码 ${r.status}）。` +
        `这通常意味着**拿不到 registry**（离线/代理问题），门禁无法判定 —— 宁可不判绿。\n` +
        `stderr: ${(r.stderr || '(空)').slice(0, 800)}`
    )
  }
  return parsed
}

/**
 * 审计报告 → 按包名聚合的阻断级条目。
 * 每条含 severity + 命中的 advisory 摘要（title/url），便于写豁免理由时有据可依。
 */
function collectBlocking(audit) {
  const out = new Map()
  for (const v of Object.values(audit.vulnerabilities || {})) {
    if (!BLOCKING.has(v.severity)) continue
    const advisories = (v.via || [])
      .filter((x) => typeof x === 'object')
      .map((x) => ({ title: x.title || x.name || '(无标题)', url: x.url || '', severity: x.severity }))
    out.set(v.name, {
      severity: v.severity,
      range: v.range || '',
      direct: Boolean(v.isDirect),
      advisories,
      // via 里的字符串是**传导链上级**的包名，说明这条是从谁引进来的
      introducedVia: (v.via || []).filter((x) => typeof x === 'string'),
    })
  }
  return out
}

function severitySummary(audit) {
  return audit.metadata?.vulnerabilities || {}
}

// ─────────────────────────────────────────────────────────────────────
// 比对（纯函数 —— 自证直接复用）
// ─────────────────────────────────────────────────────────────────────

/**
 * @param {object} baselineDoc  已登记的基线文档
 * @param {Map<string,object>} current  当前阻断级条目
 * @param {string} today  'YYYY-MM-DD'
 * @returns {{added:string[], worsened:Array<{name:string,from:string,to:string}>,
 *            resolved:string[], unregistered:string[], expired:Array<{name:string,reviewBy:string}>}}
 */
function diffAgainstBaseline(baselineDoc, current, today) {
  const frozen = baselineDoc.frozen || {}
  const exemptions = baselineDoc.exemptions || {}

  const added = []
  const worsened = []
  const unregistered = []
  const expired = []

  for (const [name, cur] of current) {
    const base = frozen[name]
    if (!base) {
      added.push(name)
      continue
    }
    const from = SEVERITY_RANK[base.severity] ?? -1
    const to = SEVERITY_RANK[cur.severity] ?? -1
    if (to > from) worsened.push({ name, from: base.severity, to: cur.severity })

    const ex = exemptions[name]
    if (!ex || !ex.reason || !ex.disposition) {
      unregistered.push(name)
    } else if (!ex.reviewBy) {
      unregistered.push(name)
    } else if (ex.reviewBy < today) {
      expired.push({ name, reviewBy: ex.reviewBy })
    }
  }

  const resolved = Object.keys(frozen).filter((n) => !current.has(n))
  return { added, worsened, resolved, unregistered, expired }
}

// ─────────────────────────────────────────────────────────────────────
// 输出
// ─────────────────────────────────────────────────────────────────────

function fail(msg) {
  console.error(`\n🔴 ${msg}`)
  process.exit(2)
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function npmVersion() {
  const r = spawnSync('npm', ['--version'], { cwd: ROOT, encoding: 'utf8' })
  return (r.stdout || 'unknown').trim()
}

function printEntries(title, names, current, limit = 30) {
  if (names.length === 0) return
  console.log(`\n${title}`)
  for (const n of names.slice(0, limit)) {
    const v = current.get(n)
    const adv = v && v.advisories && v.advisories[0] ? ` —— ${v.advisories[0].title}` : ''
    console.log(`  ${n}  [${v ? v.severity : '?'}]${adv}`)
    if (v && v.advisories && v.advisories[0] && v.advisories[0].url) {
      console.log(`      ${v.advisories[0].url}`)
    }
  }
  if (names.length > limit) console.log(`  … 另有 ${names.length - limit} 条`)
}

function emitAnnotations(names, current) {
  if (!process.env.CI) return
  for (const n of names.slice(0, 50)) {
    const v = current.get(n)
    console.log(`::error::依赖棘轮：出现未登记的生产高危 ${n}（${v ? v.severity : '?'}）`)
  }
}

// ─────────────────────────────────────────────────────────────────────
// 自证
// ─────────────────────────────────────────────────────────────────────

function selfTest(baselineDoc) {
  console.log('依赖审计棘轮门禁 · 自证\n')
  const failures = []
  const check = (name, ok, detail) => {
    console.log(`  ${ok ? '✅' : '🔴'} ${name}${detail ? '  —— ' + detail : ''}`)
    if (!ok) failures.push(name)
  }
  const today = todayISO()
  const frozen = baselineDoc.frozen || {}
  const names = Object.keys(frozen)
  const base = new Map(names.map((n) => [n, frozen[n]]))

  // ① 基线对自身 → 零新增（前提：每条都已登记豁免）
  const d0 = diffAgainstBaseline(baselineDoc, base, today)
  check('基线对自身：0 新增', d0.added.length === 0, `新增 ${d0.added.length}`)

  // ② 出现基线外的新高危 → 判红
  const withNew = new Map(base)
  withNew.set('__totally_new_pkg__', { severity: 'high', advisories: [] })
  const d1 = diffAgainstBaseline(baselineDoc, withNew, today)
  check('新高危包：判红', d1.added.includes('__totally_new_pkg__'))
  check('基线外新增恰好 1 条（不多报也不漏报）', d1.added.length === 1, `新增 ${d1.added.length}`)

  // ③–⑥ 必须用**合成基线**：真实快照清零后若靠 `names.length > 0` 守卫跳过，
  //     自证会假绿 —— 「严重度升级 / 缺豁免 / 豁免过期」在空集上全都恒不成立。
  //     2026-10-17 依赖清零时就是这样被发现的。
  const SYNTH = '__selftest_pkg__'
  const synthFrozen = {
    [SYNTH]: { severity: 'high', range: '<1.0.0', direct: true, advisories: [], introducedVia: [] },
  }
  const synthDoc = {
    frozen: synthFrozen,
    exemptions: { [SYNTH]: { reason: '自证用合成条目', disposition: 'accept', reviewBy: '2999-12-31' } },
  }
  const synthBase = new Map(Object.entries(synthFrozen))
  check('合成基线非空（前置）', synthBase.size === 1 && Boolean(synthDoc.exemptions[SYNTH]))

  // ③ 严重度升级（high → critical）→ 判红
  const up = new Map(synthBase)
  up.set(SYNTH, { ...synthFrozen[SYNTH], severity: 'critical' })
  const d2 = diffAgainstBaseline(synthDoc, up, today)
  check('严重度升级：判红', d2.worsened.some((w) => w.name === SYNTH), SYNTH)

  // ④ 摘掉豁免理由 → 判红（防止「冻结了但没写理由」）
  const docNoEx = { ...synthDoc, exemptions: {} }
  const d3 = diffAgainstBaseline(docNoEx, synthBase, today)
  check('缺豁免登记：判红', d3.unregistered.includes(SYNTH), SYNTH)

  // ⑤ 豁免过期 → 判红
  const docExpired = {
    ...synthDoc,
    exemptions: { [SYNTH]: { ...synthDoc.exemptions[SYNTH], reviewBy: '2000-01-01' } },
  }
  const d4 = diffAgainstBaseline(docExpired, synthBase, today)
  check('豁免过期：判红', d4.expired.some((e) => e.name === SYNTH), SYNTH)

  // ⑥ 条目消失 → 记为已解决（不判红）
  const less = new Map(synthBase)
  less.delete(SYNTH)
  const d5 = diffAgainstBaseline(synthDoc, less, today)
  check('条目消失：0 新增且记为已解决', d5.added.length === 0 && d5.resolved.includes(SYNTH))

  console.log(
    `\n自证结果：${failures.length === 0 ? '✅ 全部通过' : '🔴 ' + failures.length + ' 项失败'}`
  )
  process.exit(failures.length === 0 ? 0 : 1)
}

// ─────────────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────────────

let prodAudit
if (REPORT_PATH) {
  if (!fs.existsSync(REPORT_PATH)) fail(`报告文件不存在：${REPORT_PATH}`)
  prodAudit = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'))
} else {
  prodAudit = runAudit(true)
}
const current = collectBlocking(prodAudit)
const prodSummary = severitySummary(prodAudit)

// ── 建立/更新冻结快照 ────────────────────────────────────────────────
if (UPDATE) {
  let previous = null
  if (fs.existsSync(BASELINE_PATH)) {
    try {
      previous = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
    } catch {
      previous = null
    }
  }
  // exemptions 由人维护 —— 更新快照时**原样保留**，只增不减。
  const exemptions = (previous && previous.exemptions) || {}
  const frozen = {}
  for (const name of [...current.keys()].sort()) frozen[name] = current.get(name)

  const payload = {
    $comment:
      '生产可达（npm audit --omit=dev）高危/严重依赖的冻结快照 + 强制书面豁免（AC-23）。' +
      '`frozen` 由 `npm run check:deps:baseline` 生成；`exemptions` 由人维护，' +
      '每条必须有 reason / disposition / reviewBy —— 缺任一项门禁判红。',
    generatedAt: new Date().toISOString(),
    npmVersion: npmVersion(),
    scope: 'prod (npm audit --omit=dev)',
    totals: prodSummary,
    frozen,
    exemptions,
  }
  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true })
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8')

  console.log(`✅ 冻结快照已写入 ${path.relative(ROOT, BASELINE_PATH)}`)
  console.log(
    `   生产可达：high ${prodSummary.high || 0} · critical ${prodSummary.critical || 0} · ` +
      `moderate ${prodSummary.moderate || 0} · low ${prodSummary.low || 0}`
  )
  console.log(`   冻结条目 ${Object.keys(frozen).length} · 已登记豁免 ${Object.keys(exemptions).length}`)
  const missing = Object.keys(frozen).filter((n) => !exemptions[n])
  if (missing.length > 0) {
    console.log(
      `\n⚠️ 以下 ${missing.length} 条尚无书面豁免（门禁会判红，需在 ${RISK_DOC} 写清理由后在 ` +
        `exemptions 补登记）：`
    )
    for (const n of missing) console.log(`   · ${n}  [${frozen[n].severity}]`)
  }
  if (previous && previous.frozen) {
    const d = diffAgainstBaseline(previous, current, todayISO())
    console.log(
      `\n   相对上一版快照：新增 ${d.added.length} · 严重度升级 ${d.worsened.length} · 已消失 ${d.resolved.length}`
    )
    for (const a of d.added) console.log(`   ⚠️ 新增：${a}`)
    for (const r of d.resolved) console.log(`   👍 已消失：${r}`)
  }
  process.exit(0)
}

// ── 读基线 ───────────────────────────────────────────────────────────
if (!fs.existsSync(BASELINE_PATH)) {
  fail(
    `冻结快照不存在：${path.relative(ROOT, BASELINE_PATH)}\n` +
      `   首次建立请执行：npm run check:deps:baseline`
  )
}
let baselineDoc
try {
  baselineDoc = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
} catch (e) {
  fail(`冻结快照不是合法 JSON：${e.message}`)
}
if (SELF_TEST) selfTest(baselineDoc)

// ── 比对 ─────────────────────────────────────────────────────────────
const today = todayISO()
console.log('依赖审计棘轮门禁（生产可达）')
console.log(`  npm        : ${npmVersion()}`)
console.log(`  快照生成于 : ${baselineDoc.generatedAt || '(未知)'}`)
console.log(
  `  当前生产   : high ${prodSummary.high || 0} · critical ${prodSummary.critical || 0} · ` +
    `moderate ${prodSummary.moderate || 0} · low ${prodSummary.low || 0}`
)
console.log(`  冻结基线   : ${Object.keys(baselineDoc.frozen || {}).length} 条阻断级条目`)

const diff = diffAgainstBaseline(baselineDoc, current, today)

printEntries('🔴 基线之外的新增高危（真正的门禁信号）：', diff.added, current)
if (diff.worsened.length > 0) {
  console.log('\n🔴 严重度升级：')
  for (const w of diff.worsened) console.log(`  ${w.name}  ${w.from} → ${w.to}`)
}
if (diff.unregistered.length > 0) {
  console.log(`\n🔴 已冻结但**没有书面豁免**（${RISK_DOC}）：`)
  for (const n of diff.unregistered) console.log(`  ${n}  [${current.get(n)?.severity || '?'}]`)
}
if (diff.expired.length > 0) {
  console.log('\n🔴 豁免已到期（不允许永久豁免）：')
  for (const e of diff.expired) console.log(`  ${e.name}  复核期限 ${e.reviewBy}（已过）`)
}
if (diff.resolved.length > 0) {
  console.log(`\n👍 已消失（可从冻结快照移除）：${diff.resolved.join('、')}`)
}

if (SHOW_FULL) {
  const devAudit = runAudit(false)
  const devSum = severitySummary(devAudit)
  console.log(
    `\nℹ️ 全量（含 devDependencies，**不阻断**）：high ${devSum.high || 0} · critical ${devSum.critical || 0} · ` +
      `moderate ${devSum.moderate || 0} · low ${devSum.low || 0}`
  )
  const devOnly = Object.values(devAudit.vulnerabilities || {})
    .filter((v) => BLOCKING.has(v.severity))
    .map((v) => v.name)
    .filter((n) => !current.has(n))
  if (devOnly.length > 0) {
    console.log(`   其中仅在开发工具链出现（${devOnly.length} 条）：${devOnly.slice(0, 25).join('、')}`)
  }
}

const blocking = diff.added.length + diff.worsened.length + diff.unregistered.length + diff.expired.length
if (blocking > 0) {
  emitAnnotations(diff.added, current)
  console.log(
    `\n🔴 依赖棘轮未通过：${blocking} 项待处理（新增 ${diff.added.length} · 升级 ${diff.worsened.length} · ` +
      `无豁免 ${diff.unregistered.length} · 到期 ${diff.expired.length}）。\n` +
      `   处置路径见 ${RISK_DOC}；快照更新用 npm run check:deps:baseline（不会动 exemptions）。`
  )
  process.exit(1)
}

console.log('\n✅ 依赖棘轮通过：无新增生产高危，全部豁免在有效期内。')
// 机器可读的自报断言数：本步是「一条棘轮判定」（新增+升级+无豁免+到期 四类合判），记 1。
console.log('ASSERTIONS=1')
process.exit(0)
