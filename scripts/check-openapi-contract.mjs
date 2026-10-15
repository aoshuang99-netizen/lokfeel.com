#!/usr/bin/env node
/**
 * T11 · 契约 ↔ 实现 **同源核对**（AC-22 的静态一半）
 *
 * 为什么需要它：OpenAPI 契约只要没人核对，就会在第一次改动后开始腐烂 ——
 * 而腐烂的方式是**静默**的（契约说 403，实现变成 404；或路径改了但契约没改）。
 * 本脚本把「契约声明」与「实现事实」逐条对上：
 *
 *   ① 契约里每条操作的**路径**在实现里存在（`src/app/api/v1/**\/route.ts`）
 *   ② 该 route 文件里 `withTenant(...)` 声明的**能力**与契约 `x-required-capability` **逐字一致**
 *   ③ 契约用到的每个能力名都存在于 `capabilities.ts`（权限的唯一来源）——
 *      防止契约里写出一个**根本不存在的能力**（那种契约"看着很严谨"却执法不了）
 *   ④ 每条操作都有 `x-required-capability`（缺失 = 契约无法用于越权核对）
 *
 * 反向（实现里有、契约没收录）作为**警告**输出，不计失败 ——
 * 本契约刻意只覆盖 6 大业务面（missions/intents/connections/outcomes/agents/bridges）。
 *
 * 退出码：0 全绿 / 1 有失败 / 2 契约文件缺失（未核对）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CONTRACT =
  process.env.LF_OPENAPI_CONTRACT || path.join(ROOT, 'contracts', 'connection.openapi.yaml')
const API_DIR = path.join(ROOT, 'src', 'app', 'api', 'v1')
const CAPS_TS = path.join(ROOT, 'src', 'lib', 'tenancy', 'capabilities.ts')
const METHODS = ['get', 'post', 'patch', 'put', 'delete']

let pass = 0
let fail = 0
const fails = []
const warns = []
function ck(label, ok, extra = '') {
  if (ok) {
    pass += 1
    console.log(`  ✅ ${label}${extra ? `  ${extra}` : ''}`)
  } else {
    fail += 1
    fails.push(label)
    console.log(`  ❌ ${label}${extra ? `  ${extra}` : ''}`)
  }
}

// 契约路径 → 实现文件：`/missions/{missionId}` → `src/app/api/v1/missions/[missionId]/route.ts`
function pathToFile(p) {
  const segs = p
    .split('/')
    .filter(Boolean)
    .map((s) => s.replace(/^\{(.+)\}$/, '[$1]'))
  return path.join(API_DIR, ...segs, 'route.ts')
}

// 从文件里取「本方法声明的能力」（可能多个 export；按方法名精确定位）
function capabilityOf(source, method) {
  const re = new RegExp(
    `export\\s+const\\s+${method}\\s*=\\s*withTenant\\(\\s*(\\[[^\\]]*\\]|'[^']+')\\s*\\)`,
  )
  const m = source.match(re)
  if (!m) return null
  const raw = m[1].trim()
  if (raw.startsWith('[')) {
    return raw
      .slice(1, -1)
      .split(',')
      .map((s) => s.trim().replace(/^'|'$/g, ''))
      .filter(Boolean)
  }
  return [raw.replace(/^'|'$/g, '')]
}

// ── 0. 读契约 ──────────────────────────────────────────────────
if (!fs.existsSync(CONTRACT)) {
  console.error(`❌ 找不到契约文件：${CONTRACT}`)
  console.error('   用 LF_OPENAPI_CONTRACT=<path> 指定，或把契约放回 contracts/connection.openapi.yaml')
  process.exit(2)
}
const doc = parseYaml(fs.readFileSync(CONTRACT, 'utf8'))

console.log(`契约：${path.relative(ROOT, CONTRACT)}（openapi ${doc.openapi} / v${doc.info?.version}）\n`)

const ops = []
for (const [p, item] of Object.entries(doc.paths ?? {})) {
  for (const [m, op] of Object.entries(item)) {
    if (!METHODS.includes(m)) continue
    ops.push({ method: m.toUpperCase(), p, cap: op['x-required-capability'], file: pathToFile(p) })
  }
}

// ── 1. capabilities.ts 的能力全集 ───────────────────────────────
const capsSrc = fs.readFileSync(CAPS_TS, 'utf8')
const listMatch = capsSrc.match(
  /export const TENANT_CAPABILITIES[^=]*=\s*\[([\s\S]*?)\]\s*as const/,
)
if (!listMatch) {
  console.error('❌ 无法从 capabilities.ts 提取 TENANT_CAPABILITIES —— 本脚本的锚点是它，先修锚点。')
  process.exit(1)
}
const KNOWN_CAPS = new Set(
  [...listMatch[1].matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map((m) => m[1]),
)

console.log(`── ① 结构（共 ${ops.length} 条操作）`)
ck('契约至少含 1 条操作', ops.length > 0, `operations=${ops.length}`)
const missingCap = ops.filter((o) => !o.cap)
ck('每条操作都有 x-required-capability', missingCap.length === 0, missingCap.map((o) => `${o.method} ${o.p}`).join(', ') || '无缺失')

console.log(`\n── ② 路径 ↔ 实现文件（能力唯一来源：${path.relative(ROOT, CAPS_TS)}，共 ${KNOWN_CAPS.size} 个能力）`)
const notFound = []
const capMismatch = []
const capUnknown = []
for (const o of ops) {
  if (!fs.existsSync(o.file)) {
    notFound.push(`${o.method} ${o.p}`)
    continue
  }
  const src = fs.readFileSync(o.file, 'utf8')
  const impl = capabilityOf(src, o.method)
  if (!impl) {
    capMismatch.push(`${o.method} ${o.p} —— 实现里没有 withTenant(${o.method})`)
    continue
  }
  if (!impl.includes(o.cap)) {
    capMismatch.push(`${o.method} ${o.p} —— 契约=${o.cap} 实现=${impl.join('|')}`)
  }
  if (o.cap && !KNOWN_CAPS.has(o.cap)) capUnknown.push(`${o.method} ${o.p} —— ${o.cap}`)
}
ck(`契约的每条路径在实现里都存在（${ops.length - notFound.length}/${ops.length}）`, notFound.length === 0, notFound.join(' · '))
ck('契约能力与实现 withTenant 逐字一致', capMismatch.length === 0, capMismatch.join(' · '))
ck('契约里的能力名都在 capabilities.ts 中（不存在"幽灵能力"）', capUnknown.length === 0, capUnknown.join(' · '))

// ── 3. 反向：实现里有、契约未收录（仅警告）──────────────────────
console.log('\n── ③ 反向覆盖（仅警告：契约刻意只覆盖 6 大业务面）')
const implRoutes = []
;(function walk(dir) {
  if (!fs.existsSync(dir)) return
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full)
    else if (e.name === 'route.ts') implRoutes.push(full)
  }
})(API_DIR)

const contractPathSet = new Set(ops.map((o) => o.p))
const implPaths = new Set()
for (const f of implRoutes) {
  const rel = path.relative(API_DIR, path.dirname(f))
  const p = '/' + rel.split(path.sep).map((s) => s.replace(/^\[(.+)\]$/, '{$1}')).join('/')
  implPaths.add(p === '/' ? '/' : p)
}
const uncovered = [...implPaths].filter((p) => !contractPathSet.has(p)).sort()
if (uncovered.length) {
  warns.push(`${uncovered.length} 条已实现路径未收录进契约`)
  console.log(`  ⚠️  ${uncovered.length} 条已实现路径未收录（待补，不影响本轮）：`)
  for (const p of uncovered) console.log(`      · ${p}`)
} else {
  console.log('  ✅ 实现的 v1 路径已全部收录')
}

// ── 汇总 ────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`)
if (fail === 0) {
  console.log(`✅ 契约 ↔ 实现 同源核对通过：${pass} 项断言全绿（${ops.length} 条操作 / ${KNOWN_CAPS.size} 个候选能力）`)
  if (warns.length) console.log(`   （${warns.join('；')} —— 仅提示）`)
  process.exit(0)
}
console.error(`❌ 契约 ↔ 实现 核对失败：${fail} 项`)
for (const f of fails) console.error(`   · ${f}`)
process.exit(1)
