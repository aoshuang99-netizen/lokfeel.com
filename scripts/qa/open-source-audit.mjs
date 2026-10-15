#!/usr/bin/env node
/**
 * T11 · 开源合规审计 —— AC-22 的「开源准备」面
 *
 * 两段，各自独立可读：
 *
 *  ① **许可证审计**：读 dependencies（分发面）与 devDependencies（仅开发面）的
 *     `license` 字段并按风险分级。判据：
 *       · 分发面出现 **强 copyleft**（GPL / AGPL / SSPL / BUSL …）⇒ ❌ 失败
 *         （它们会传染性地约束我们的分发方式 —— 这是「开源仓」的真实法律风险）
 *       · 分发面出现 **未知许可证** ⇒ ❌ 失败（未知 ≠ 安全）
 *       · 弱 copyleft（LGPL / MPL / EPL）⇒ ⚠️ 提示（可用，但要保持"可替换"）
 *     devDependencies 只警告，不判失败（不随产品分发）。
 *
 *  ② **凭据泄漏扫描**：对 **git 跟踪的文件**扫高危密钥形态
 *     （Netlify / OpenAI / GitHub / AWS / 私钥块），并区分
 *     「真实形态」与「占位/示例」（`sk-test`、`your-`、`<...>`、`xxxx`）。
 *     铁律：**开源仓无凭据** —— 命中即 ❌。
 *
 * 退出码：0 全绿 / 1 有 ❌
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

let pass = 0
let fail = 0
const fails = []
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

// ────────────────────────────────────────────────────────────────
// ① 许可证审计
// ────────────────────────────────────────────────────────────────
const ALLOWED = [
  /^MIT$/i, /^MIT-0$/i, /^ISC$/i, /^Apache-2\.0$/i, /^BSD-2-Clause$/i, /^BSD-3-Clause$/i,
  /^0BSD$/i, /^Unlicense$/i, /^CC0-1\.0$/i, /^CC-BY-4\.0$/i, /^zlib$/i, /^WTFPL$/i,
  /^Python-2\.0$/i, /^BlueOak-1\.0\.0$/i, /^Public Domain$/i, /^Unicode-3\.0$/i,
  /^Artistic-2\.0$/i, /^OFL-1\.1$/i, /^UPL-1\.0$/i, /^X11$/i,
]
const WEAK = [/^LGPL/i, /^MPL-/i, /^EPL-/i, /^CDDL/i, /^CECILL-C$/i]
const STRONG = [/^GPL/i, /^AGPL/i, /^SSPL/i, /^BUSL/i, /^Commons-Clause/i, /^Elastic-2\.0$/i]

function licenseText(pkg) {
  const l = pkg.license
  if (typeof l === 'string') return l
  if (l && typeof l === 'object' && typeof l.type === 'string') return l.type
  if (Array.isArray(pkg.licenses)) {
    return pkg.licenses.map((x) => (typeof x === 'string' ? x : x?.type)).filter(Boolean).join(' OR ')
  }
  return ''
}

/** 把 SPDX 表达式收敛为一个风险等级。OR = 可选（取最宽松）；AND = 同时满足（取最严）。 */
function classify(expr) {
  const text = (expr || '').trim()
  if (!text) return 'UNKNOWN'
  const hasOr = /\bOR\b/i.test(text)
  const tokens = text
    .replace(/[()]/g, ' ')
    .split(/\s+(?:OR|AND)\s+/i)
    .map((t) => t.trim())
    .filter(Boolean)
  if (!tokens.length) return 'UNKNOWN'
  const rank = (t) => {
    if (ALLOWED.some((r) => r.test(t))) return 'ALLOWED'
    if (STRONG.some((r) => r.test(t))) return 'STRONG'
    if (WEAK.some((r) => r.test(t))) return 'WEAK'
    return 'UNKNOWN'
  }
  const ranks = tokens.map(rank)
  if (hasOr && ranks.includes('ALLOWED')) return 'ALLOWED'
  if (ranks.includes('STRONG')) return 'STRONG'
  if (ranks.includes('WEAK')) return 'WEAK'
  if (ranks.every((r) => r === 'ALLOWED')) return 'ALLOWED'
  return 'UNKNOWN'
}

function auditDeps(manifest, section) {
  const deps = Object.keys(manifest[section] ?? {})
  const buckets = { ALLOWED: [], WEAK: [], STRONG: [], UNKNOWN: [] }
  const missing = []
  for (const name of deps) {
    const pj = path.join(ROOT, 'node_modules', name, 'package.json')
    if (!fs.existsSync(pj)) {
      missing.push(name)
      continue
    }
    const pkg = JSON.parse(fs.readFileSync(pj, 'utf8'))
    const level = classify(licenseText(pkg))
    buckets[level].push(`${name}@${pkg.version ?? '?'}: ${licenseText(pkg) || '(未声明)'}`)
  }
  return { deps, buckets, missing }
}

console.log('══ ① 许可证审计 ══\n')
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

for (const section of ['dependencies', 'devDependencies']) {
  const isProd = section === 'dependencies'
  const { deps, buckets, missing } = auditDeps(manifest, section)
  console.log(`── ${section}（${deps.length} 个${isProd ? '，随产品分发' : '，仅开发面'}）`)
  console.log(
    `   分布：允许 ${buckets.ALLOWED.length} · 弱 copyleft ${buckets.WEAK.length} · 强 copyleft ${buckets.STRONG.length} · 未知 ${buckets.UNKNOWN.length}` +
      (missing.length ? ` · 未安装 ${missing.length}` : ''),
  )
  if (buckets.STRONG.length) {
    console.log('   ⛔ 强 copyleft：')
    for (const x of buckets.STRONG) console.log(`      · ${x}`)
  }
  if (buckets.WEAK.length) {
    console.log('   ⚠️  弱 copyleft：')
    for (const x of buckets.WEAK) console.log(`      · ${x}`)
  }
  if (buckets.UNKNOWN.length) {
    console.log('   ❓ 未知许可证：')
    for (const x of buckets.UNKNOWN) console.log(`      · ${x}`)
  }
  if (missing.length) console.log(`   ⚠️  未安装（无法判定）：${missing.join(', ')}`)

  if (isProd) {
    ck(`${section} 无强 copyleft`, buckets.STRONG.length === 0)
    ck(`${section} 无未知许可证`, buckets.UNKNOWN.length === 0)
    ck(`${section} 全部已安装（可判定）`, missing.length === 0)
  } else {
    ck(`${section} 无强 copyleft（仅提示，不随分发）`, buckets.STRONG.length === 0)
  }
  console.log('')
}

// ────────────────────────────────────────────────────────────────
// ② 凭据泄漏扫描
// ────────────────────────────────────────────────────────────────
console.log('══ ② 凭据泄漏扫描（git 跟踪文件）══\n')

const PATTERNS = [
  { name: 'Netlify token', re: /\bnfp_[A-Za-z0-9]{20,}\b/g },
  { name: 'OpenAI key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'GitHub token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: '私钥块', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { name: 'Turso/libSQL token', re: /\beyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{30,}\b/g },
]
// 占位/示例形态：出现这些词就不算真实凭据
const PLACEHOLDER = /(example|placeholder|your[-_]|xxx+|redacted|test[-_]?key|dummy|sample|fake|\.\.\.|<[a-z_-]+>|\$\{|process\.env)/i

const SKIP_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.avif', '.svg',
  '.woff', '.woff2', '.ttf', '.otf', '.eot', '.pdf', '.zip', '.gz',
  '.mp4', '.mp3', '.wasm', '.node', '.db', '.sqlite', '.lock',
])
const MAX_BYTES = 1_000_000

let tracked = []
try {
  // 🔴 必须同时列 `--others --exclude-standard`：只用 `git ls-files` 会**漏掉未跟踪的新文件**
  //    （`git add` 之前它们不在 index 里）。而"新写的文件"恰恰是最可能带进凭据的东西 ——
  //    旧文件早被历次扫描覆盖过。漏掉它们会让审计给出**看起来通过、实际有盲区**的结论。
  //    `--exclude-standard` 保证 .gitignore 覆盖的产物（.env.local、node_modules…）仍被排除。
  tracked = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean)
} catch (err) {
  console.error(`❌ 无法列出 git 跟踪文件：${err.message}`)
  process.exit(1)
}

const hits = []
let scanned = 0
let skipped = 0
for (const rel of tracked) {
  const ext = path.extname(rel).toLowerCase()
  if (SKIP_EXT.has(ext)) {
    skipped += 1
    continue
  }
  const full = path.join(ROOT, rel)
  let st
  try {
    st = fs.statSync(full)
  } catch {
    continue
  }
  if (!st.isFile() || st.size > MAX_BYTES) {
    skipped += 1
    continue
  }
  let text
  try {
    text = fs.readFileSync(full, 'utf8')
  } catch {
    skipped += 1
    continue
  }
  scanned += 1
  for (const { name, re } of PATTERNS) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(text))) {
      const lineStart = text.lastIndexOf('\n', m.index) + 1
      const lineEnd = text.indexOf('\n', m.index)
      const line = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd)
      if (PLACEHOLDER.test(line)) continue
      const lineNo = text.slice(0, m.index).split('\n').length
      // 测试目录里的命中降级为提示：测试夹具**必然**含假凭据
      //（否则测不了「报告里没有 key 明文」这类断言）。真实风险在**非测试**文件。
      const isTest = /(^|\/)(tests?|__tests__)\//.test(rel)
      hits.push({ rel, lineNo, name, sample: m[0].slice(0, 12) + '…', isTest })
    }
  }
}

const realHits = hits.filter((h) => !h.isTest)
const testHits = hits.filter((h) => h.isTest)

console.log(`  扫描 ${scanned} 个文本文件（跳过 ${skipped} 个二进制/大文件/锁文件）`)
if (realHits.length) {
  console.log(`  ⛔ **非测试**文件命中 ${realHits.length} 处高危形态（未识别为占位）：`)
  for (const h of realHits) console.log(`      · ${h.rel}:${h.lineNo}  [${h.name}]  ${h.sample}`)
} else {
  console.log('  ✅ 非测试文件未命中任何高危密钥形态')
}
if (testHits.length) {
  console.log(`  ⚠️  测试文件命中 ${testHits.length} 处（夹具假值，仅提示）：`)
  for (const h of testHits) console.log(`      · ${h.rel}:${h.lineNo}  [${h.name}]  ${h.sample}`)
}
ck('非测试文件中无未识别的高危凭据形态', realHits.length === 0)

// ────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`)
if (fail === 0) {
  console.log(`✅ 开源合规审计通过：${pass} 项断言全绿`)
  console.log('   注：许可证分级为启发式（SPDX 表达式按 OR=取宽松 / AND=取严 收敛），最终以法务判读为准。')
  process.exit(0)
}
console.error(`❌ 开源合规审计失败：${fail} 项`)
for (const f of fails) console.error(`   · ${f}`)
process.exit(1)
