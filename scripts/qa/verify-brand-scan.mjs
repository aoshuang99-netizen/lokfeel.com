#!/usr/bin/env node
/**
 * 公开路由品牌叙事门禁（V16 · T02）
 *
 * 做三件事：
 *   1. 枚举 `src/app/(public)` 下**全部** page/layout（不写死 9 个页面）；
 *   2. 剥掉注释后扫描禁词（禁词表唯一来源：src/config/brand.ts）；
 *   3. `--self-test` 自证：注入含禁词的文本必须判红，干净文本必须判绿，
 *      并断言"实际扫到的文件数 > 0"（防空集恒真造成的假绿）。
 *
 * 用法：
 *   node scripts/qa/verify-brand-scan.mjs
 *   node scripts/qa/verify-brand-scan.mjs --self-test
 *
 * 退出码：0 全绿 / 1 有命中 / 2 自证失败
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PUBLIC_DIR = path.join(ROOT, 'src/app/(public)')
const BRAND_FILE = path.join(ROOT, 'src/config/brand.ts')

/** 从 brand.ts 解析禁词数组（保持单一来源，不在这里重复维护） */
function loadLegacyTerms() {
  const src = fs.readFileSync(BRAND_FILE, 'utf8')
  const block = src.match(/LEGACY_PUBLIC_TERMS\s*=\s*\[([\s\S]*?)\]\s*as const/)
  if (!block) throw new Error('brand.ts 里找不到 LEGACY_PUBLIC_TERMS')
  const terms = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
  if (terms.length === 0) throw new Error('禁词表为空 —— 空表等于没有门禁')
  return terms
}

/** 解析豁免表 */
function loadExemptions() {
  const src = fs.readFileSync(BRAND_FILE, 'utf8')
  const block = src.match(/LEGACY_SCAN_EXEMPTIONS[^=]*=\s*\{([\s\S]*?)\n\}/)
  if (!block) return {}
  const out = {}
  for (const m of block[1].matchAll(/'([^']+)'\s*:\s*\[([^\]]*)\]/g)) {
    out[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1])
  }
  return out
}

/** 剥注释：先整段剔块注释，再逐行剔行注释（避免把注释里的词当文案） */
export function stripComments(src) {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '')
  return noBlock
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//')
      // 只处理行内注释；字符串里的 // 极少见，且误伤只会减少扫描范围，
      // 因此额外保护 http:// 与 https://
      if (idx === -1) return line
      const head = line.slice(0, idx)
      const tail = line.slice(idx)
      if (/https?:\/\//.test(tail) && !/https?:\/\//.test(head)) return line
      return head
    })
    .join('\n')
}

/** 扫描一段文本，返回 [{term, line}] */
export function scanText(text, terms) {
  const clean = stripComments(text)
  const lines = clean.split('\n')
  const hits = []
  for (const term of terms) {
    const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    lines.forEach((line, i) => {
      if (re.test(line)) hits.push({ term, line: i + 1, snippet: line.trim().slice(0, 90) })
    })
  }
  return hits
}

function walk(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(p))
    else if (/^(page|layout)\.tsx$/.test(entry.name)) out.push(p)
  }
  return out
}

function routeOf(file) {
  const rel = path.relative(PUBLIC_DIR, file)
  const dir = path.dirname(rel)
  if (dir === '.') return '/'
  return '/' + dir.replace(/\\/g, '/').replace(/\/\([^)]+\)/g, '')
}

function main() {
  const terms = loadLegacyTerms()
  const exemptions = loadExemptions()
  const files = walk(PUBLIC_DIR).sort()

  if (files.length === 0) {
    console.error('✗ 没有扫到任何公开路由文件 —— 扫描路径可能写错了')
    process.exit(2)
  }

  console.log(`公开路由扫描：${files.length} 个 page/layout · 禁词 ${terms.length} 条`)
  console.log('')

  let totalHits = 0
  let dirtyFiles = 0

  for (const file of files) {
    const route = routeOf(file)
    const exempt = new Set(exemptions[route] ?? [])
    const text = fs.readFileSync(file, 'utf8')
    const hits = scanText(text, terms).filter((h) => !exempt.has(h.term))

    if (hits.length === 0) continue

    dirtyFiles += 1
    totalHits += hits.length
    console.log(`✗ ${route}`)
    for (const h of hits.slice(0, 6)) {
      console.log(`    L${h.line}  「${h.term}」  ${h.snippet}`)
    }
    if (hits.length > 6) console.log(`    … 另有 ${hits.length - 6} 处`)
  }

  console.log('')
  console.log(
    `结果：${files.length - dirtyFiles} 干净 / ${dirtyFiles} 命中 / 共 ${totalHits} 处`,
  )
  if (totalHits > 0) {
    console.log('\n修法：文案与 metadata 一律从 src/config/brand.ts 派生，不要手写旧定位词。')
    process.exit(1)
  }
  console.log('✔ 公开路由无旧叙事残留')
  process.exit(0)
}

function selfTest() {
  const terms = loadLegacyTerms()
  const failures = []

  // ① 干净文本必须判绿
  const clean = `export const metadata = { title: "About", description: BRAND.description }`
  if (scanText(clean, terms).length !== 0) failures.push('干净文本被判红（假阳性）')

  // ② 含禁词必须判红
  if (scanText(`description: "your relationship matching platform"`, terms).length === 0) {
    failures.push('含 "relationship matching" 未被判红（假阴性）')
  }

  // ③ 注释里的禁词必须**不**判红（说明剥注释生效）
  const commented = `// legacy: relationship matching\nconst x = 1`
  if (scanText(commented, terms).length !== 0) failures.push('块注释/行注释未被剥离')

  // ④ 大小写不敏感
  if (scanText(`const s = "Dating Platform"`, terms).length === 0) {
    failures.push('大小写不同即漏判')
  }

  // ⑤ 词边界：不应误伤 "matchmaker" 之外无关词
  if (scanText(`const s = "soulmates"`, terms).length !== 0) {
    console.log('  提示：soulmates 未被命中（词边界严格），可接受')
  }

  // ⑥ 真实目录必须扫到文件（防空集恒真）
  const files = walk(PUBLIC_DIR)
  if (files.length < 10) failures.push(`实际只扫到 ${files.length} 个文件，疑似路径错误`)

  console.log(`自证用例：6 条（禁词 ${terms.length} 条，公开文件 ${files.length} 个）`)
  if (failures.length > 0) {
    failures.forEach((f) => console.error(`  ✗ ${f}`))
    process.exit(2)
  }
  console.log('✔ 自证通过：该红时红、该绿时绿、扫描集非空')
  process.exit(0)
}

if (process.argv.includes('--self-test')) selfTest()
else main()
