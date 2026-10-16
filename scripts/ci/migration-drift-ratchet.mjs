#!/usr/bin/env node
/**
 * schema 漂移棘轮门禁（AC-23 · 迁移可信化）
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 这个门禁是怎么来的（不是先想出来的，是**跑出来的**）
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 给 CI 加「迁移」环节时，先按常规写法试了 `prisma migrate deploy` ——
 * 在一次性 libSQL 文件库上**从零建库直接失败**：
 *     P3018 / near "DO": syntax error
 * 因为 `prisma/migrations/20250413130000_...` 是 **PostgreSQL 专有 SQL**
 * （`DO $$`、`CREATE TYPE ... AS ENUM`、`pg_type`、`information_schema`），
 * 而 `prisma.config.ts` 的 datasource provider 是 **sqlite**。
 * 顺带发现 `prisma/migrations/initial_migration.sql` 是**空文件** ——
 * 即「迁移目录」从来不是本项目的建库路径（生产库是 `db push` 建的）。
 *
 * 改用 `db push` 建库 + 跑自定义批次（M0–M2 / C0–C9）后：
 *   ✅ 批次 apply / 幂等复跑 / verify 全绿（255/255）
 *   🔴 但 `prisma migrate diff` 报 **11 张核心表「被重定义」**
 *
 * 逐层隔离（隔离脚本见 docs/implementation/CI_GATES.md）后定位到根因：
 *   `scripts/tenancy/migrate.mjs` 的 **M1 批次**给 11 张业务表
 *   （= `TENANT_SCOPED_TABLES`）加了可空 `organizationId` 列 + 索引，
 *   而 `prisma/schema/*.prisma` **刻意没有建模这些列**
 *   （`tenancy.prisma` 文件头：本文件全部为新增模型，不改动既有模型）。
 *
 * 那个取舍本身是**有意的**（纯新增、可独立回滚），但它的**后果没有被记录**：
 *   ① `prisma db push` 会**删掉**这 11 列 ⇒ 租户归属数据丢失（高危）；
 *   ② Prisma Client 读不到 `organizationId`，这 11 张表上的租户过滤只能走原生 SQL；
 *   ③ 于是任何 schema 漂移检查都会永久非空 —— 除非把它**显式冻结**。
 *
 * 本脚本就是 ③ 的落地：**冻结已知漂移（附成因与复核期限），新增漂移判红**。
 * 与 lint / 依赖两道棘轮同一套语义：**不削弱，只拦新增**。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 用法
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   node scripts/ci/migration-drift-ratchet.mjs            比对（CI 用）
 *   node scripts/ci/migration-drift-ratchet.mjs --update   重写冻结快照
 *   node scripts/ci/migration-drift-ratchet.mjs --self-test 自证
 *   node scripts/ci/migration-drift-ratchet.mjs --report=<diff.txt>  复用已有输出
 *
 * 退出码：0 = 零新增漂移；1 = 有新增漂移 / 未登记成因 / 复核到期；2 = 环境错误
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const BASELINE_PATH = path.join(ROOT, 'docs', 'implementation', 'migration-drift-baseline.json')

const argv = process.argv.slice(2)
const UPDATE = argv.includes('--update')
const SELF_TEST = argv.includes('--self-test')
const reportArgv = argv.find((a) => a.startsWith('--report='))
const REPORT_PATH = reportArgv ? path.resolve(ROOT, reportArgv.slice('--report='.length)) : null

const DIFF_ARGS = [
  'prisma',
  'migrate',
  'diff',
  '--from-config-datasource',
  '--to-schema',
  'prisma/schema',
]

// ─────────────────────────────────────────────────────────────────────
// 采集
// ─────────────────────────────────────────────────────────────────────

function runDiff() {
  const r = spawnSync('npx', DIFF_ARGS, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env },
  })
  if (r.error) fail(`npx prisma 启动失败：${r.error.message}`)
  const out = `${r.stdout || ''}\n${r.stderr || ''}`
  // 退出码 1 = 命令本身出错（配置/连接），不能当成「无漂移」
  if (r.status === 1) fail(`prisma migrate diff 执行失败（退出码 1）：\n${out.slice(0, 2000)}`)
  return out
}

/**
 * 解析人类可读 diff。行形如：
 *   [*] Redefined table `Block`
 *   [+] Added table `Foo`
 *   [-] Removed table `Foo`
 *   [*] Changed the `AgentApproval` table
 *   [*] Added column `organizationId` to `Block`
 * 取「类型 + 首个反引号标识」作为键，避免同一表的多条改动互相覆盖。
 */
function collect(text) {
  const map = new Map()
  for (const line of text.split('\n')) {
    const m = /^\[([+\-*])\]\s+(.+?)\s*$/.exec(line.trim())
    if (!m) continue
    const [, mark, rest] = m
    const ticked = /`([^`]+)`/.exec(rest)
    // 去掉反引号内容后剩下的描述作为 kind，让同表异动也能区分
    const kind = rest.replace(/`[^`]*`/g, '').replace(/\s+/g, ' ').trim() || rest
    const target = ticked ? ticked[1] : rest
    const key = `${mark} ${kind} ${target}`
    map.set(key, { mark, kind, target })
  }
  return map
}

// ─────────────────────────────────────────────────────────────────────
// 比对（纯函数）
// ─────────────────────────────────────────────────────────────────────

function diffAgainstBaseline(baselineDoc, current, today) {
  const known = baselineDoc.known || {}
  const added = []
  const removed = []
  for (const [key, cur] of current) if (!known[key]) added.push(cur)
  for (const key of Object.keys(known)) if (!current.has(key)) removed.push(known[key])

  const problems = []
  if (!baselineDoc.cause || String(baselineDoc.cause).trim().length < 10) {
    problems.push('基线缺少 `cause`（必须说明这批漂移的成因，不允许无理由冻结）')
  }
  if (!baselineDoc.reviewBy) {
    problems.push('基线缺少 `reviewBy`（不允许永久冻结）')
  } else if (baselineDoc.reviewBy < today) {
    problems.push(`基线复核期限 ${baselineDoc.reviewBy} 已过 —— 必须重新评估该漂移`)
  }
  return { added, removed, problems }
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

function prismaVersion() {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(ROOT, 'node_modules', 'prisma', 'package.json'), 'utf8')
    ).version
  } catch {
    return 'unknown'
  }
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) {
    fail(`冻结快照不存在：${path.relative(ROOT, BASELINE_PATH)}\n   首次建立：--update`)
  }
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
  } catch (e) {
    fail(`冻结快照不是合法 JSON：${e.message}`)
  }
}

// ─────────────────────────────────────────────────────────────────────
// 自证
// ─────────────────────────────────────────────────────────────────────

function selfTest(baselineDoc) {
  console.log('schema 漂移棘轮门禁 · 自证\n')
  const failures = []
  const check = (name, ok, detail) => {
    console.log(`  ${ok ? '✅' : '🔴'} ${name}${detail ? '  —— ' + detail : ''}`)
    if (!ok) failures.push(name)
  }
  const today = todayISO()
  const known = baselineDoc.known || {}
  const base = new Map(Object.entries(known).map(([k, v]) => [k, { ...v, _key: k }]))
  const baseDoc = { ...baselineDoc }
  baseDoc.known = Object.fromEntries([...base.keys()].map((k) => [k, known[k]]))

  // ① 基线对自身 → 零新增
  const d0 = diffAgainstBaseline(baseDoc, base, today)
  check('基线对自身：0 新增', d0.added.length === 0 && d0.removed.length === 0)

  // ② 出现基线外的新漂移 → 判红
  const withNew = new Map(base)
  withNew.set('* Added column organizationId to __brand_new__', {
    mark: '*',
    kind: 'Added column organizationId to',
    target: '__brand_new__',
  })
  const d1 = diffAgainstBaseline(baseDoc, withNew, today)
  check('新增漂移：判红', d1.added.length === 1, d1.added.map((a) => a.target).join(','))

  // ③ 缺 cause → 判红（不允许无理由冻结）
  const d2 = diffAgainstBaseline({ ...baseDoc, cause: '' }, base, today)
  check('缺 cause：判红', d2.problems.some((p) => p.includes('cause')))

  // ④ 缺 / 过期 reviewBy → 判红（不允许永久冻结）
  const d3 = diffAgainstBaseline({ ...baseDoc, reviewBy: '2000-01-01' }, base, today)
  check('reviewBy 过期：判红', d3.problems.some((p) => p.includes('复核期限')))

  // ⑤ 漂移消失 → 记为已解决，不判红
  const less = new Map(base)
  less.delete([...less.keys()][0])
  const d4 = diffAgainstBaseline(baseDoc, less, today)
  check('漂移消失：0 新增且记为已解决', d4.added.length === 0 && d4.removed.length === 1)

  console.log(
    `\n自证结果：${failures.length === 0 ? '✅ 全部通过' : '🔴 ' + failures.length + ' 项失败'}`
  )
  process.exit(failures.length === 0 ? 0 : 1)
}

// ─────────────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────────────

if (SELF_TEST) selfTest(readBaseline())

const text = REPORT_PATH
  ? (() => {
      if (!fs.existsSync(REPORT_PATH)) fail(`报告文件不存在：${REPORT_PATH}`)
      const raw = fs.readFileSync(REPORT_PATH, 'utf8')
      if (!raw.trim()) fail(`报告文件为空：${REPORT_PATH} —— 采集失败，不判绿`)
      return raw
    })()
  : runDiff()

const current = collect(text)

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
  const known = {}
  for (const key of [...current.keys()].sort()) known[key] = current.get(key)
  const payload = {
    $comment:
      'schema 漂移冻结快照（AC-23）。`known` 由 --update 生成；`cause` / `reviewBy` 由人维护。' +
      '成因已查明：T01 的 M1 批次给 TENANT_SCOPED_TABLES 的 11 张表加了可空 organizationId，' +
      '而 prisma/schema 刻意未建模 —— 见 scripts/ci/migration-drift-ratchet.mjs 文件头。',
    generatedAt: new Date().toISOString(),
    prismaVersion: prismaVersion(),
    toolCommand: 'npx ' + DIFF_ARGS.join(' '),
    known,
    cause: previous && previous.cause ? previous.cause : '',
    reviewBy: previous && previous.reviewBy ? previous.reviewBy : '',
  }
  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true })
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8')
  console.log(`✅ 冻结快照已写入 ${path.relative(ROOT, BASELINE_PATH)}`)
  console.log(`   冻结漂移项 ${Object.keys(known).length} 条`)
  for (const v of Object.values(known)) console.log(`   · [${v.mark}] ${v.kind} \`${v.target}\``)
  if (previous && previous.known) {
    const d = diffAgainstBaseline(previous, current, todayISO())
    console.log(`\n   相对上一版：新增 ${d.added.length} · 消失 ${d.removed.length}`)
    for (const a of d.added) console.log(`   ⚠️ 新增：${a.target}`)
    for (const r of d.removed) console.log(`   👍 消失：${r.target}`)
  }
  console.log(
    `\n⚠️ 别忘了填写 cause 与 reviewBy —— 空着的话门禁会判红（这是刻意的）。`
  )
  process.exit(0)
}

// ── 比对 ─────────────────────────────────────────────────────────────
const baselineDoc = readBaseline()
const today = todayISO()
console.log('schema 漂移棘轮门禁')
console.log(`  prisma     : ${prismaVersion()}`)
console.log(`  快照生成于 : ${baselineDoc.generatedAt || '(未知)'}`)
console.log(`  冻结漂移项 : ${Object.keys(baselineDoc.known || {}).length}`)
console.log(`  当前漂移项 : ${current.size}`)
console.log(`  冻结成因   : ${baselineDoc.cause ? baselineDoc.cause.split('\n')[0] : '(未填写)'}`)
console.log(`  复核期限   : ${baselineDoc.reviewBy || '(未填写)'}`)

const diff = diffAgainstBaseline(baselineDoc, current, today)

if (diff.added.length > 0) {
  console.log('\n🔴 新增漂移（本门禁判红的原因）：')
  for (const a of diff.added) console.log(`  [${a.mark}] ${a.kind} \`${a.target}\``)
  if (process.env.CI) {
    for (const a of diff.added.slice(0, 30)) {
      console.log(`::error::schema 漂移棘轮：出现未登记的漂移 —— ${a.kind} \`${a.target}\``)
    }
  }
}
if (diff.removed.length > 0) {
  console.log('\n👍 已消失（可从冻结快照移除）：')
  for (const r of diff.removed) console.log(`  [${r.mark}] ${r.kind} \`${r.target}\``)
}
if (diff.problems.length > 0) {
  console.log('\n🔴 冻结快照本身有问题：')
  for (const p of diff.problems) console.log(`  · ${p}`)
}

if (diff.added.length > 0 || diff.problems.length > 0) {
  console.log(
    `\n🔴 schema 漂移棘轮未通过（新增 ${diff.added.length} · 快照问题 ${diff.problems.length}）。\n` +
      `   若新增漂移是合理的，跑 --update 后**必须**填写 cause 与 reviewBy；` +
      `所有已知漂移的成因与后果见 docs/implementation/CI_GATES.md。`
  )
  process.exit(1)
}

console.log('\n✅ schema 漂移棘轮通过：无新增漂移。')
process.exit(0)
