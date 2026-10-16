#!/usr/bin/env node
/**
 * AC-24 · SLO 校验器
 *
 * ── 它做什么 ────────────────────────────────────────────────────────
 *   把「SLO 定义」（`docs/implementation/slo.json`）与「实测基线」
 *   （`docs/implementation/perf-baseline.json`）对账，逐条判 PASS / FAIL。
 *
 * ── 为什么不是「跑一次压测然后看着数字点头」─────────────────────────
 *   口头 SLO 会腐烂：下次谁改坏了，没人知道。所以 SLO 必须**可机器判定**，
 *   且基线必须**留档可比** —— 这跟 lint/依赖/漂移三道棘轮是同一个思路
 *   （见 CI_GATES.md §2）。区别只有一个，也是本文件最关键的取舍：
 *
 *   ⚠️ **性能阈值不能进 CI 硬门禁**（共享 runner 抖动大 ⇒ 会退化成恒红假门禁）。
 *      所以本校验器用来做「**人工/发版前的对账**」，而不是 push 触发的阻断门禁。
 *      要防的是「SLO 只是一句口号」，而不是「在噪声上抓红」。
 *
 * ── 防「假门禁」的三条硬约束 ────────────────────────────────────────
 *   ① 规则**匹配不到任何数据** ⇒ 判红（缺数据 ≠ 通过）。
 *      否则删掉一个端点就能让 SLO "全绿"。
 *   ② 基线文件缺失 / 空 / 非法 JSON ⇒ 判红。
 *   ③ 自证（`--self-test`）必须同时含：
 *        · 「判红有牙齿」—— 篡改超标必须 FAIL
 *        · 「不是恒红」  —— 阈值放宽必须 PASS
 *      只证前者会得到一个永远红的校验器，那比没有校验器更糟。
 *
 * 用法：
 *   node scripts/perf/slo-check.mjs [--baseline=<json>] [--slo=<json>]
 *   node scripts/perf/slo-check.mjs --self-test
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const DEFAULT_SLO = 'docs/implementation/slo.json'
const DEFAULT_BASELINE = 'docs/implementation/perf-baseline.json'

// ══════════════════════════════════════════════════════════════════════
// 参数
// ══════════════════════════════════════════════════════════════════════

function parseArgs(argv) {
  const out = {}
  for (const a of argv) {
    if (!a.startsWith('--')) continue
    const [k, v] = a.slice(2).split('=')
    out[k] = v === undefined ? 'true' : v
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const SELF_TEST = args['self-test'] === 'true'
const SLO_PATH = args.slo || DEFAULT_SLO
const EXPLICIT_BASELINE = args.baseline || ''

// ══════════════════════════════════════════════════════════════════════
// 读取（严格 —— 缺文件/坏 JSON 一律判红，不静默跳过）
// ══════════════════════════════════════════════════════════════════════

function readJson(relPath, label) {
  const abs = path.isAbsolute(relPath) ? relPath : path.join(ROOT, relPath)
  if (!fs.existsSync(abs)) return { error: `${label} 不存在：${relPath}` }
  const raw = fs.readFileSync(abs, 'utf8')
  if (raw.trim() === '') return { error: `${label} 是空文件：${relPath}` }
  try {
    return { value: JSON.parse(raw), abs }
  } catch (err) {
    return { error: `${label} 不是合法 JSON：${err instanceof Error ? err.message : String(err)}` }
  }
}

// ══════════════════════════════════════════════════════════════════════
// 取值
// ══════════════════════════════════════════════════════════════════════

const LATENCY_METRICS = new Set(['min', 'p50', 'p90', 'p95', 'p99', 'max', 'mean'])

function metricValue(target, metric) {
  if (LATENCY_METRICS.has(metric)) return target?.latencyMs?.[metric] ?? null
  if (metric === 'errorRate') return target?.errorRate ?? null
  if (metric === 'rps') return target?.rps ?? null
  return null
}

// ══════════════════════════════════════════════════════════════════════
// 对账
// ══════════════════════════════════════════════════════════════════════

/**
 * @returns {{ results: Array, failures: Array, error: string|null }}
 */
function evaluate(baselineDoc, sloDoc) {
  if (!sloDoc || !Array.isArray(sloDoc.rules)) {
    return { results: [], failures: [], error: 'SLO 定义缺少 rules 数组' }
  }
  if (!baselineDoc || !Array.isArray(baselineDoc.levels)) {
    return { results: [], failures: [], error: '基线缺少 levels 数组' }
  }

  const results = []

  for (const rule of sloDoc.rules) {
    const levelSel = rule.level === '*' ? '*' : Number(rule.level)
    const matchedLevels = baselineDoc.levels.filter((lv) =>
      levelSel === '*' ? true : lv.concurrency === levelSel,
    )

    // target 选择器：支持字符串（`*` 或单名）与数组（多目标同阈值）
    const targetSel = rule.targets ?? (rule.target ? [rule.target] : ['*'])
    const wild = targetSel.includes('*')

    let pairs = []
    for (const lv of matchedLevels) {
      const targets = lv.targets.filter((t) => wild || targetSel.includes(t.name))
      for (const t of targets) pairs.push({ lv, t })
    }

    if (pairs.length === 0) {
      // 约束 ①：匹配不到数据 ⇒ 判红（删掉端点就能"全绿"是不允许的）
      results.push({
        id: rule.id,
        ok: false,
        detail: `规则未匹配到任何数据（targets=${targetSel.join('|')} level=${rule.level}）—— 缺数据不等于通过`,
      })
      continue
    }

    for (const { lv, t } of pairs) {
      const value = metricValue(t, rule.metric)
      const bound = rule.max !== undefined ? rule.max : rule.min
      const direction = rule.max !== undefined ? 'max' : 'min'

      if (value === null || value === undefined) {
        results.push({
          id: rule.id,
          ok: false,
          detail: `${t.name}@${lv.concurrency} 的 ${rule.metric} 无数据`,
        })
        continue
      }

      const ok = direction === 'max' ? value <= bound : value >= bound
      results.push({
        id: rule.id,
        ok,
        detail:
          `${t.name}@${lv.concurrency} ${rule.metric}=${value}` +
          `${direction === 'max' ? ' ≤ ' : ' ≥ '}${bound}` +
          `${ok ? '' : '  ❌ 越界'}`,
      })
    }
  }

  const failures = results.filter((r) => !r.ok)
  return { results, failures, error: null }
}

function report(result) {
  if (result.error) {
    console.log(`\n🔴 ${result.error}`)
    return 1
  }
  const byRule = new Map()
  for (const r of result.results) {
    if (!byRule.has(r.id)) byRule.set(r.id, [])
    byRule.get(r.id).push(r)
  }

  console.log('\n══════ SLO 对账 ══════')
  for (const [id, rs] of byRule) {
    const bad = rs.filter((r) => !r.ok)
    const head = bad.length === 0 ? '✅' : '🔴'
    console.log(`\n${head} ${id}  (${rs.length - bad.length}/${rs.length} 通过)`)
    const show = bad.length > 0 ? bad : rs
    for (const r of show.slice(0, 6)) console.log(`     ${r.ok ? '·' : '✗'} ${r.detail}`)
    if (show.length > 6) console.log(`     … 另有 ${show.length - 6} 条`)
  }

  console.log(
    `\n${result.failures.length === 0 ? '✅ 全部通过' : `🔴 ${result.failures.length} 条越界`}` +
      `（共 ${result.results.length} 条断言）`,
  )
  return result.failures.length === 0 ? 0 : 1
}

// ══════════════════════════════════════════════════════════════════════
// 自证 —— 证明这个校验器「判红有牙齿」且「不是恒红」
// ══════════════════════════════════════════════════════════════════════

function selfTest() {
  const checks = []
  const add = (label, passed, detail) => checks.push({ label, passed, detail })

  const sloRead = readJson(SLO_PATH, 'SLO 定义')
  const baseRead = readJson(EXPLICIT_BASELINE || DEFAULT_BASELINE, '基线')
  if (sloRead.error) {
    console.log(`🔴 自证无法进行：${sloRead.error}`)
    return 1
  }
  if (baseRead.error) {
    console.log(`🔴 自证无法进行：${baseRead.error}`)
    return 1
  }
  const slo = sloRead.value
  const base = baseRead.value

  // 1) 基线对自身 → 必须 PASS
  add('基线对自身应通过', evaluate(base, slo).failures.length === 0, '')

  // 2) 篡改一条被覆盖的 p95 至超阈 → 必须 FAIL
  const clone1 = JSON.parse(JSON.stringify(base))
  const anyLatRule = slo.rules.find((r) => LATENCY_METRICS.has(r.metric) && r.max !== undefined)
  if (anyLatRule) {
    const sel = anyLatRule.targets ?? [anyLatRule.target ?? '*']
    const lv = clone1.levels.find((l) => anyLatRule.level === '*' || l.concurrency === Number(anyLatRule.level))
    const t = lv.targets.find((x) => sel.includes('*') || sel.includes(x.name))
    t.latencyMs[anyLatRule.metric] = Number(anyLatRule.max) + 1000
    const r = evaluate(clone1, slo)
    add('篡改 p95 超标应判红', r.failures.length > 0, `id=${anyLatRule.id}`)
  } else {
    add('篡改 p95 超标应判红', false, '夹具不足：slo.json 里没有带 max 的延迟规则')
  }

  // 3) 篡改一条 errorRate 至超阈 → 必须 FAIL
  const clone2 = JSON.parse(JSON.stringify(base))
  const errRule = slo.rules.find((r) => r.metric === 'errorRate' && r.max !== undefined)
  if (errRule) {
    const lv = clone2.levels.find((l) => errRule.level === '*' || l.concurrency === Number(errRule.level))
    for (const t of lv.targets) t.errorRate = Number(errRule.max) + 0.5
    const r = evaluate(clone2, slo)
    add('篡改错误率超标应判红', r.failures.length > 0, `id=${errRule.id}`)
  } else {
    add('篡改错误率超标应判红', false, '夹具不足：slo.json 里没有 errorRate 规则')
  }

  // 4) 删掉整个层级（数据缺失）→ 必须 FAIL（约束 ①）
  const clone3 = JSON.parse(JSON.stringify(base))
  const lastLevel = slo.rules.find((r) => r.level !== '*')
  if (lastLevel && clone3.levels.length > 1) {
    clone3.levels = clone3.levels.filter((l) => l.concurrency !== Number(lastLevel.level))
    const r3 = evaluate(clone3, slo)
    add('删除层级（缺数据）应判红', r3.failures.length > 0, `移除 concurrency=${lastLevel.level}`)
  } else {
    add('删除层级（缺数据）应判红', false, '夹具不足：SLO 无按层级的规则')
  }

  // 5) 阈值放宽到无穷 → 必须 PASS（证明不是恒红的校验器）
  const looseSlo = {
    rules: slo.rules.map((r) => (r.max !== undefined ? { ...r, max: Number.MAX_SAFE_INTEGER } : { ...r, min: -1 })),
  }
  add('阈值放宽应通过（非恒红对照）', evaluate(base, looseSlo).failures.length === 0, '')

  // 6) 非法基线 → 必须由 readJson 判红
  const badRead = readJson('docs/implementation/__nope__.json', '基线')
  add('缺失/非法基线应判红', Boolean(badRead.error), '')

  console.log('\n══════ 自证（SLO 校验器）══════')
  for (const c of checks) {
    console.log(`${c.passed ? '✅' : '🔴'} ${c.label}${c.detail ? `  —— ${c.detail}` : ''}`)
  }
  const failed = checks.filter((c) => !c.passed).length
  console.log(`\n${failed === 0 ? '✅' : '🔴'} ${checks.length - failed}/${checks.length} 通过`)
  return failed === 0 ? 0 : 1
}

// ══════════════════════════════════════════════════════════════════════

if (SELF_TEST) process.exit(selfTest())

const sloRead = readJson(SLO_PATH, 'SLO 定义')
if (sloRead.error) {
  console.error(`🔴 ${sloRead.error}`)
  process.exit(1)
}
const basePath = EXPLICIT_BASELINE || sloRead.value.baselineFile || DEFAULT_BASELINE
const baseRead = readJson(basePath, '基线')
if (baseRead.error) {
  console.error(`🔴 ${baseRead.error}`)
  process.exit(1)
}

console.log(`SLO：  ${sloRead.abs}`)
console.log(`基线： ${baseRead.abs}（生成于 ${baseRead.value.generatedAt ?? 'unknown'}）`)
process.exit(report(evaluate(baseRead.value, sloRead.value)))
