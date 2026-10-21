#!/usr/bin/env node
/**
 * V17 · 租户作用域静态审计（WB17-01 / SEC-01 ~ SEC-06 的防回归锁）
 *
 * 它回答一个问题：**多租户面上每一次对"带 organizationId 的模型"的查询，
 * 有没有把 organizationId 放进 where？**
 *
 * 为什么需要它：`withTenant` 只保证"调用者属于某个租户"，它**不保证**后续 SQL 带了
 * 租户谓词。少了谓词就是跨租户读/写 —— 单测很难发现，因为 mock 不会拒绝。
 *
 * 判定分级（不做"一刀切判红"，否则全是噪声）：
 *   scoped        调用文本里出现 organizationId（含 `ctx.organizationId`）
 *   via-variable  where 指向一个同函数内定义、且该字面量含 organizationId 的变量
 *   follow-up     先做了带租户谓词的读，再用结果主键更新（安全的二次操作）
 *   public-share  按 shareToken 读取（公开分享路径，另需 status/expiry 校验）
 *   unknown       以上都不匹配 → 需要人工判定并进 baseline
 *
 * 用法：
 *   node scripts/qa/tenant-scoping-audit.mjs                 # 报告
 *   node scripts/qa/tenant-scoping-audit.mjs --strict        # 有未登记项则 exit 1（CI 用）
 *   node scripts/qa/tenant-scoping-audit.mjs --self-test     # 自证（含变异对照）
 *   node scripts/qa/tenant-scoping-audit.mjs --json          # 机器可读
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOTS = [
  'src/lib/connection',
  'src/lib/outcome',
  'src/lib/bridges',
  'src/lib/agents',
  'src/lib/workflow',
  'src/lib/billing',
  'src/lib/tenancy',
  'src/lib/interop',
  'src/app/api/v1',
]

const BASELINE_PATH = 'scripts/qa/tenant-scoping-baseline.json'

/** Prisma 客户端把模型名首字母小写：Mission → mission。 */
function lowerFirst(s) {
  return s.charAt(0).toLowerCase() + s.slice(1)
}

export function orgModelsFromSchema(schemaTexts) {
  const models = new Set()
  const foreign = new Map() // 无 organizationId 但有双主体字段的模型 → 字段名
  for (const text of schemaTexts) {
    for (const m of text.matchAll(/model (\w+) \{([\s\S]*?)\n\}/g)) {
      const [, name, body] = m
      if (/^\s*organizationId\s/m.test(body)) {
        models.add(lowerFirst(name))
      } else if (/^\s*(initiatorOrgId|recipientOrgId)\s/m.test(body)) {
        const fields = ['initiatorOrgId', 'recipientOrgId'].filter((f) =>
          new RegExp(`^\\s*${f}\\s`, 'm').test(body)
        )
        foreign.set(lowerFirst(name), fields)
      }
    }
  }
  return { models, foreign }
}

function walk(dir, acc = []) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (e.name.endsWith('.ts')) acc.push(p)
  }
  return acc
}

/** 从 openIndex（指向 '(' 之后）开始，返回配对 ')' 的下标。 */
function balancedEnd(src, openIndex) {
  let depth = 1
  for (let i = openIndex; i < src.length; i += 1) {
    const c = src[i]
    if (c === '(') depth += 1
    else if (c === ')') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

/** 找 `const <name> ... = {` 的对象字面量并返回其文本。 */
function resolveVariableLiteral(src, name, beforeIndex) {
  const head = src.slice(0, beforeIndex)
  const re = new RegExp(`(?:const|let)\\s+${name}\\b[^=]*=\\s*\\{`, 'g')
  let last = null
  for (const m of head.matchAll(re)) last = m
  if (!last) return null
  const start = last.index + last[0].length - 1 // 指向 '{'
  let depth = 0
  for (let i = start; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  return null
}

function classify(src, callStart, args, orgField) {
  if (new RegExp(`\\b${orgField}\\b`).test(args)) return 'scoped'

  const explicit = args.match(/where:\s*([A-Za-z_$][\w$]*)\s*[,}]/)
  // `{ where }` 简写形态（R4 的常见写法），同样要跟着变量走
  const shorthand = args.match(/[{,]\s*where\s*[,}]/)
  const whereIdent = explicit ? explicit[1] : shorthand ? 'where' : null
  if (whereIdent) {
    const literal = resolveVariableLiteral(src, whereIdent, callStart)
    if (literal && new RegExp(`\\b${orgField}\\b`).test(literal)) return 'via-variable'
  }

  if (/shareToken/.test(args)) return 'public-share'

  // 前 40 行内是否有同模型的带租户谓词读（update/delete by id 的常见安全形状）
  const window = src.slice(Math.max(0, callStart - 2200), callStart)
  if (new RegExp(`db\\.\\w+\\.(findFirst|findUnique|findMany|count)\\([\\s\\S]{0,400}${orgField}`).test(window)) {
    return 'follow-up'
  }

  return 'unknown'
}

export function analyzeSources(sources, schemaTexts) {
  const { models, foreign } = orgModelsFromSchema(schemaTexts)
  const findings = []
  let scanned = 0

  for (const { file, text } of sources) {
    const re = /db\.(\w+)\.(findUnique|findFirst|findMany|findUniqueOrThrow|update|updateMany|delete|deleteMany|create|createMany|upsert|count|aggregate)\(/g
    for (const m of text.matchAll(re)) {
      const model = m[1]
      const op = m[2]
      const isForeign = foreign.has(model)
      if (!models.has(model) && !isForeign) continue

      const openParen = m.index + m[0].length
      const end = balancedEnd(text, openParen)
      if (end < 0) continue
      const args = text.slice(openParen, end)
      scanned += 1

      // 双主体模型（CommunityBridge）：任一当事方字段即可，两个都算 scoped
      if (isForeign) {
        const fields = foreign.get(model)
        const direct = fields.some((f) => new RegExp(`\\b${f}\\b`).test(args))
        let viaVar = false
        if (!direct) {
          const explicit = args.match(/where:\s*([A-Za-z_$][\w$]*)\s*[,}]/)
          const shorthand = args.match(/[{,]\s*where\s*[,}]/)
          const ident = explicit ? explicit[1] : shorthand ? 'where' : null
          if (ident) {
            const literal = resolveVariableLiteral(text, ident, m.index)
            if (literal) viaVar = fields.some((f) => new RegExp(`\\b${f}\\b`).test(literal))
          }
        }
        if (direct || viaVar) continue
        findings.push({
          file,
          line: text.slice(0, m.index).split('\n').length,
          model,
          op,
          kind: 'unknown',
          snippet: args.replace(/\s+/g, ' ').slice(0, 120),
        })
        continue
      }

      if (op === 'create' || op === 'createMany') {
        // 创建：data 里必须有 organizationId（否则写入的行没有租户归属）
        if (/\borganizationId\b/.test(args)) continue
        findings.push({
          file,
          line: text.slice(0, m.index).split('\n').length,
          model,
          op,
          kind: 'unknown',
          snippet: args.replace(/\s+/g, ' ').slice(0, 120),
        })
        continue
      }

      const kind = classify(text, m.index, args, 'organizationId')
      if (kind === 'scoped' || kind === 'via-variable' || kind === 'follow-up' || kind === 'public-share') {
        continue
      }
      findings.push({
        file,
        line: text.slice(0, m.index).split('\n').length,
        model,
        op,
        kind,
        snippet: args.replace(/\s+/g, ' ').slice(0, 120),
      })
    }
  }

  return { findings, scanned, models: [...models], foreign: [...foreign.keys()] }
}

function loadBaseline() {
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
  } catch {
    return []
  }
}

function baselineKey(f) {
  return `${f.file}|${f.model}|${f.op}`
}

function main() {
  const args = new Set(process.argv.slice(2))

  if (args.has('--self-test')) {
    selfTest()
    return
  }

  const sources = []
  for (const root of ROOTS) {
    for (const file of walk(root)) sources.push({ file, text: fs.readFileSync(file, 'utf8') })
  }
  const schemaTexts = fs
    .readdirSync('prisma/schema')
    .filter((f) => f.endsWith('.prisma'))
    .map((f) => fs.readFileSync(path.join('prisma/schema', f), 'utf8'))

  const { findings, scanned, models, foreign } = analyzeSources(sources, schemaTexts)

  // 先证前置非空：扫了 0 条查询的"全绿"是假绿
  if (scanned === 0) {
    console.error('[tenant-scoping] FAIL: 扫描到 0 条租户模型查询 —— 正则或路径失效（空集恒真）')
    process.exit(1)
  }

  const baseline = loadBaseline()
  const allow = new Set(baseline.map(baselineKey))
  const unregistered = findings.filter((f) => !allow.has(baselineKey(f)))
  const stale = baseline.filter((b) => !findings.some((f) => baselineKey(f) === baselineKey(b)))

  const summary = {
    scannedQueries: scanned,
    orgModels: models.length,
    foreignModels: foreign.length,
    findings: findings.length,
    unregistered: unregistered.length,
    staleBaseline: stale.length,
  }

  if (args.has('--json')) {
    console.log(JSON.stringify({ summary, findings, unregistered, stale }, null, 2))
  } else {
    console.log(`扫描文件 ${sources.length} 个｜租户模型查询 ${scanned} 条｜org 模型 ${models.length} 个｜双主体模型 ${foreign.length} 个`)
    console.log(`需人工判定 ${findings.length} 条｜未登记 ${unregistered.length} 条｜baseline 失效 ${stale.length} 条`)
    for (const f of unregistered) {
      console.log(`  ✗ ${f.file}:${f.line}  db.${f.model}.${f.op}  ${f.snippet}`)
    }
    for (const s of stale) {
      console.log(`  ⚠ baseline 已失效（查询已消失或已加谓词）：${baselineKey(s)}`)
    }
    if (unregistered.length === 0) console.log('✅ 无未登记的跨租户风险查询')
  }

  if (args.has('--strict') && unregistered.length > 0) {
    console.error('\n[tenant-scoping] FAIL: 存在未登记的查询，必须补租户谓词或写入 baseline 说明理由')
    process.exit(1)
  }
}

function selfTest() {
  const schema = [
    'model Mission {',
    '  id String @id',
    '  organizationId String',
    '}',
    'model CommunityBridge {',
    '  id String @id',
    '  initiatorOrgId String',
    '  recipientOrgId String',
    '}',
  ].join('\n')

  const good = `
    export async function a(ctx) {
      return db.mission.findMany({ where: { organizationId: ctx.organizationId } })
    }
  `
  const viaVar = `
    export async function b(ctx) {
      const where = { organizationId: ctx.organizationId, status: 'ACTIVE' }
      return db.mission.findMany({ where })
    }
  `
  const violation = `
    export async function c(id) {
      return db.mission.findUnique({ where: { id } })
    }
  `
  const bridgeOk = `
    export async function d(org) {
      return db.communityBridge.findMany({ where: { OR: [{ initiatorOrgId: org }, { recipientOrgId: org }] } })
    }
  `
  const bridgeBad = `
    export async function e(id) {
      return db.communityBridge.findUnique({ where: { id } })
    }
  `

  const cases = [
    { name: 'scoped 直写 → 不报', text: good, expect: 0 },
    { name: 'where 变量内含谓词 → 不报', text: viaVar, expect: 0 },
    { name: '🔴 变异：去掉 organizationId → 必须报 1 条', text: violation, expect: 1 },
    { name: '双主体模型用 OR 当事方 → 不报', text: bridgeOk, expect: 0 },
    { name: '🔴 变异：双主体模型只按 id → 必须报 1 条', text: bridgeBad, expect: 1 },
  ]

  let failed = 0
  for (const c of cases) {
    const { findings, scanned } = analyzeSources([{ file: 'fixture.ts', text: c.text }], [schema])
    const ok = findings.length === c.expect && scanned > 0
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}｜findings=${findings.length} 期望=${c.expect}｜scanned=${scanned}`)
    if (!ok) failed += 1
  }

  // 反向对照：把 schema 里的 organizationId 删掉，扫描数必须变 0 —— 证明"全绿"不是恒真
  const emptySchema = ['model Mission {', '  id String @id', '}'].join('\n')
  const { scanned: emptyScanned } = analyzeSources([{ file: 'fixture.ts', text: violation }], [emptySchema])
  const meaningless = emptyScanned === 0
  console.log(`${meaningless ? 'PASS' : 'FAIL'}  反向对照：模型无租户字段时扫描数 = 0（说明报 0 条必须配合 scanned > 0 才有效）`)
  if (!meaningless) failed += 1

  if (failed) {
    console.error(`\n自测失败 ${failed} 项`)
    process.exit(1)
  }
  console.log('\n自测全部通过（5 条规则 + 1 条反向对照）')
}

if (import.meta.url === `file://${process.argv[1]}`) main()
