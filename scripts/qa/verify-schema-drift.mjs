#!/usr/bin/env node
/**
 * Schema ↔ 生产库「直连漂移」比对（零依赖，不需要 prisma CLI）
 *
 * ## 为什么不用 `prisma migrate diff`
 * 它需要 prisma CLI 与引擎二进制；本机 node_modules 是残缺树（沙箱装不完），
 * `prisma` 直接不在。而「上线前 schema 与生产库差在哪」是必答题，不能因为工具缺席
 * 就跳过 —— 跳过会变成"看起来验过了"。
 *
 * ## 比对什么（只比**列名**，不比类型/索引）
 *   · schema 有表、库没有        → **FAIL**：迁移没跑，页面会 500
 *   · schema 有列、库没有        → **FAIL**：同上
 *   · 库有列、schema 没有        → **WARN**：`prisma db push` 会**删掉**这些列
 *     （这正是「11 张表 organizationId 未建模」的风险面，必须显式列出来而不是沉默）
 *   · 库有表、schema 没有        → **WARN**：历史遗留表
 *
 * 关系字段（`User`、`Profile?`、`Match[]`、带 `@relation` 的）**不产出列**，要跳过，
 * 否则会把每条关系都误报成"缺列"。
 *
 * 退出码：0 = 无 FAIL（可能有 WARN）· 1 = 有 FAIL · 2 = 连不上库
 *
 * 用法：
 *   node scripts/qa/verify-schema-drift.mjs
 *   node scripts/qa/verify-schema-drift.mjs --json out.json --verbose
 */
import fs from 'node:fs'
import path from 'node:path'
import { createTurso, loadEnv } from './lib/turso-http.mjs'

const ROOT = path.resolve(import.meta.dirname, '../..')
const argv = process.argv.slice(2)
const argOf = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : d
}
const VERBOSE = argv.includes('--verbose')
const JSON_OUT = argOf('json', '')

// ─── 解析 prisma schema ────────────────────────────────────────────────
function parseSchema() {
  const dir = path.join(ROOT, 'prisma/schema')
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.prisma'))
  const models = new Map() // tableName -> Set(columnName)
  const enums = new Set()

  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8')
    for (const m of src.matchAll(/^enum\s+(\w+)\s*\{/gm)) enums.add(m[1])
  }

  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8')
    const lines = src.split('\n')
    let current = null
    let buffer = []

    for (const raw of lines) {
      const line = raw.replace(/\r$/, '')
      const open = line.match(/^model\s+(\w+)\s*\{\s*$/)
      if (open) {
        current = open[1]
        buffer = []
        continue
      }
      if (current && /^\}\s*$/.test(line)) {
        const tableMap = buffer.join('\n').match(/@@map\(\s*"([^"]+)"\s*\)/)
        const table = tableMap ? tableMap[1] : current
        const cols = new Set()
        for (const bl of buffer) {
          const t = bl.trim()
          if (!t || t.startsWith('//') || t.startsWith('///') || t.startsWith('@@')) continue
          const fm = t.match(/^(\w+)\s+([A-Za-z_][\w.]*)(\[\])?(\?)?/)
          if (!fm) continue
          const [, fieldName, typeName, list] = fm
          // 列表（关系数组）不是列；枚举**是**列（SQLite 存 TEXT），不能跳过。
          // 关系字段（类型是另一个 model）稍后统一过滤 —— 见下方二次过滤。
          if (list) continue
          const colMap = t.match(/@map\(\s*"([^"]+)"\s*\)/)
          cols.add(colMap ? colMap[1] : fieldName)
        }
        models.set(table, { model: current, cols, fields: buffer })
        current = null
        buffer = []
        continue
      }
      if (current) buffer.push(line)
    }
  }

  // 二次过滤：把「类型名等于某个 model 名」的字段删掉（Prisma 关系字段不产出列）
  const modelNames = new Set([...models.values()].map((v) => v.model))
  for (const [, info] of models) {
    const relationFields = new Set()
    for (const bl of info.fields) {
      const t = bl.trim()
      if (!t || t.startsWith('//') || t.startsWith('///') || t.startsWith('@@')) continue
      const fm = t.match(/^(\w+)\s+([A-Za-z_]\w*)(\[\])?(\?)?/)
      if (!fm) continue
      const [, fieldName, typeName] = fm
      if (modelNames.has(typeName)) relationFields.add(fieldName)
    }
    for (const rf of relationFields) {
      // 若该字段显式 @map 了，说明它确实是列（少见），保守保留
      const hasMap = info.fields.some((bl) => new RegExp(`^\\s*${rf}\\s+.*@map\\(`).test(bl))
      if (!hasMap) info.cols.delete(rf)
    }
  }

  return models
}

// ─── 主流程 ────────────────────────────────────────────────────────────
const results = []
const ck = (label, ok, detail = '') => {
  results.push({ label, ok, detail })
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? '  → ' + detail : ''}`)
}
const warn = (label, detail = '') => {
  results.push({ label, ok: true, warning: true, detail })
  console.log(`  ⚠️  ${label}${detail ? '  → ' + detail : ''}`)
}

async function main() {
  console.log('\n━━━ Schema ↔ 生产库 漂移（直连比对）━━━\n')
  const models = parseSchema()
  ck('解析 prisma schema', models.size > 0, `${models.size} 个模型`)

  let db
  try {
    db = createTurso()
    await db.ping()
  } catch (e) {
    results.push({ label: '连不上库', ok: false, detail: e.message })
    return 2
  }
  ck('生产库可读', true, '')

  const tables = (await db.query("select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '_prisma%'")).map((r) => r.name)
  const dbTables = new Set(tables)
  ck('库中存在表', dbTables.size > 0, `${dbTables.size} 张`)

  // 逐模型比对
  const missingTables = []
  const missingCols = []
  const extraCols = []
  const CONCURRENCY = 8
  const entries = [...models.entries()]

  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const slice = entries.slice(i, i + CONCURRENCY)
    const infos = await Promise.all(
      slice.map(([table]) => (dbTables.has(table) ? db.query(`pragma table_info('${table}')`) : Promise.resolve(null))),
    )
    slice.forEach(([table, info], k) => {
      if (!dbTables.has(table)) {
        missingTables.push(table)
        return
      }
      const actual = new Set(infos[k].map((c) => c.name))
      for (const col of info.cols) {
        if (!actual.has(col)) missingCols.push(`${table}.${col}`)
      }
      for (const col of actual) {
        if (!info.cols.has(col)) extraCols.push(`${table}.${col}`)
      }
    })
  }

  ck('schema 里的表在生产库都存在', missingTables.length === 0, missingTables.length ? `缺 ${missingTables.length} 张：${missingTables.slice(0, 6).join(', ')}` : `${models.size} 张全在`)
  ck('schema 里的列在生产库都存在', missingCols.length === 0, missingCols.length ? `缺 ${missingCols.length} 列：${missingCols.slice(0, 8).join(', ')}` : '无缺列')

  if (extraCols.length) {
    warn(`库里有 ${extraCols.length} 列未在 schema 中建模（\`db push\` 会删列）`, extraCols.slice(0, 12).join(', ') + (extraCols.length > 12 ? ' …' : ''))
    if (VERBOSE) for (const c of extraCols) console.log(`      · ${c}`)
  } else {
    ck('库中没有 schema 之外的列', true, '')
  }

  const dbOnlyTables = [...dbTables].filter((t) => !models.has(t))
  if (dbOnlyTables.length) warn(`库里有 ${dbOnlyTables.length} 张表未在 schema 中建模`, dbOnlyTables.slice(0, 8).join(', '))

  return missingTables.length || missingCols.length ? 1 : 0
}

;(async () => {
  let code = 0
  try {
    code = (await main()) ?? 0
  } catch (e) {
    results.push({ label: '未预期异常', ok: false, detail: e.message })
    code = 1
  }
  const failed = results.filter((r) => !r.ok)
  const warned = results.filter((r) => r.warning)
  console.log('')
  if (failed.length) {
    console.log(`结论：${failed.length} 项失败（共 ${results.length} 项）`)
    for (const f of failed) console.log(`   ❌ ${f.label}${f.detail ? ' → ' + f.detail : ''}`)
    code = code || 1
  } else {
    console.log(`结论：${results.length}/${results.length} 通过${warned.length ? `（${warned.length} 条告警，见上）` : ''}`)
  }
  console.log('')
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ at: new Date().toISOString(), code, results }, null, 2))
  process.exit(code)
})()
