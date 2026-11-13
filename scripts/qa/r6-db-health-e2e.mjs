#!/usr/bin/env node
/**
 * V20.7 GA · R6-T8 —— 健康检查 / 数据库基线 **在干净环境里真跑**
 *
 * ── 它回答什么 ────────────────────────────────────────────────────────
 *   「`/api/health` 的 200 是真的连上了库，还是没连上也回 200」。
 *   上一轮本地 E2E 的 ①（健康检查 + DB）之所以 FAIL，是因为本地没有 CI 的
 *   sqlite 基线库 —— 那条用例本身没错，错在**本地复现不了 CI 的前置条件**。
 *   于是"本地全绿、CI 红"与"本地红、说不清是不是自己的问题"交替出现。
 *
 * ── 它怎么做（三步都不许跳）────────────────────────────────────────────
 *   ① 建一个**临时** sqlite 库：prisma db push + 两批自定义迁移（与 ci.yml 同命令）；
 *   ② 用这个库起真实构建产物，健康检查必须 200 / status=healthy / dbLatency 有限；
 *      连续轮询 3 次，证明不是"第一次侥幸"；
 *   ③ **负向对照**：再把 DATABASE_URL 指到一个建不出来的路径重新起服务，
 *      健康检查必须 503 且 status≠healthy。
 *      —— 没有第 ③ 步，"健康检查通过"这句话无法区分"真连上了"和"恒回 200"。
 *
 * ── 它自己的失效条件 ───────────────────────────────────────────────────
 *   ① 需要已有 `.next` 构建产物（本脚本不构建，避免把 T8 变成构建测试）；
 *   ② 临时库放在 `.r6-tmp/` 下，跑完删除；**绝不指向 .env.local 里的库**；
 *   ③ 端口占用会让它 FAIL（不是 SKIP）—— 静默跳过正是上一轮的问题。
 *
 * 用法：
 *   node scripts/qa/r6-db-health-e2e.mjs
 *   node scripts/qa/r6-db-health-e2e.mjs --port=3210 --evil-port=3211 --out=docs/.../t8.json
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const args = {}
for (const a of process.argv.slice(2)) {
  if (!a.startsWith('--')) continue
  const i = a.indexOf('=')
  if (i === -1) args[a.slice(2)] = 'true'
  else args[a.slice(2, i)] = a.slice(i + 1)
}

const ROOT = path.resolve(import.meta.dirname, '../..')
const PORT = Number(args.port || 3210)
const EVIL_PORT = Number(args['evil-port'] || 3211)
const TMP = path.join(ROOT, '.r6-tmp')
const DB_FILE = path.join(TMP, `health-${Date.now()}.db`)
const DB_URL = `file:${DB_FILE}`
const EVIL_URL = `file:${path.join(TMP, 'missing-dir', 'nope.db')}`

const results = []
const record = (name, pass, detail, extra = {}) => {
  results.push({ name, pass, detail, ...extra })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
  return pass
}

function run(cmd, argv, env) {
  return spawnSync(cmd, argv, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 240_000,
  })
}

async function waitForServer(port, ms = 90_000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(5000) })
      await r.text()
      return true
    } catch {
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
  return false
}

function startServer(port, dbUrl, logFile) {
  const out = fs.openSync(logFile, 'a')
  const child = spawn('npx', ['next', 'start', '-p', String(port)], {
    cwd: ROOT,
    env: { ...process.env, NODE_OPTIONS: '', DATABASE_URL: dbUrl, TURSO_AUTH_TOKEN: '', DATABASE_AUTH_TOKEN: '' },
    stdio: ['ignore', out, out],
    detached: true,
  })
  return child
}

function killServer(child) {
  if (!child || child.killed) return
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {
      /* 已退出 */
    }
  }
}

async function health(port) {
  const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(15_000) })
  let body = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  return { status: r.status, body }
}

/** 表数量：优先 node:sqlite（Node ≥22.5），否则退回 sqlite3 CLI；都没有就返回 null（不算 PASS）。 */
function tableCount(file) {
  const viaNode = run(process.execPath, [
    '-e',
    `const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(${JSON.stringify(file)});const r=d.prepare("select count(*) c from sqlite_master where type='table'").get();process.stdout.write(String(r.c))`,
  ])
  if (viaNode.status === 0 && /^\d+$/.test((viaNode.stdout || '').trim())) return Number(viaNode.stdout.trim())
  const viaCli = spawnSync('sqlite3', [file, "select count(*) from sqlite_master where type='table';"], { encoding: 'utf8' })
  if (viaCli.status === 0 && /^\d+$/.test((viaCli.stdout || '').trim())) return Number(viaCli.stdout.trim())
  return null
}

async function main() {
  const started = new Date().toISOString()

  if (!fs.existsSync(path.join(ROOT, '.next', 'BUILD_ID'))) {
    console.error('缺少 .next 构建产物：先 npm run build（本脚本不负责构建）')
    process.exit(2)
  }

  fs.mkdirSync(TMP, { recursive: true })
  const log = path.join(TMP, `health-${PORT}.log`)

  // ── ① 干净库：与 ci.yml 完全同序 ──
  const push = run('npx', ['prisma', 'db', 'push', '--accept-data-loss'], { DATABASE_URL: DB_URL })
  record('db push（基线 schema）', push.status === 0, `exit=${push.status}`, { tail: (push.stdout || '').slice(-400) })
  const tenancy = run('node', ['scripts/tenancy/migrate.mjs', 'apply', '--batch=ALL', '--yes'], { DATABASE_URL: DB_URL })
  record('tenancy 迁移（ALL）', tenancy.status === 0, `exit=${tenancy.status}`)
  const conn = run('node', ['scripts/connection/migrate.mjs', 'apply', '--batch=ALL', '--yes'], { DATABASE_URL: DB_URL })
  record('connection 迁移（ALL）', conn.status === 0, `exit=${conn.status}`)

  const tables = tableCount(DB_FILE)
  record('库里真有表（不是空文件）', typeof tables === 'number' && tables > 20, `tables=${tables ?? 'unknown'}`)

  // ── ② 真连上：200 + healthy + 连续 3 次 ──
  let good = null
  let evil = null
  try {
    good = startServer(PORT, DB_URL, log)
    const up = await waitForServer(PORT)
    record('服务就绪（真构建产物）', up, up ? `port=${PORT}` : `90s 未就绪，见 ${path.relative(ROOT, log)}`)

    const rounds = []
    for (let i = 0; i < 3; i++) {
      try {
        rounds.push(await health(PORT))
      } catch (e) {
        rounds.push({ status: 0, body: null, error: String(e && e.message) })
      }
      if (i < 2) await new Promise((r) => setTimeout(r, 1500))
    }
    const codes = rounds.map((r) => r.status)
    record('健康检查连续 3 次 200', codes.every((c) => c === 200), `codes=${codes.join(',')}`)
    const bodies = rounds.map((r) => r.body || {})
    record(
      'status=healthy 且 dbLatency 为有限数',
      bodies.every((b) => b.status === 'healthy' && Number.isFinite(b.dbLatency)),
      `latency=${bodies.map((b) => b.dbLatency).join(',')}`,
    )
    const commits = [...new Set(bodies.map((b) => b.commit).filter(Boolean))]
    record('health 能报出构建提交（可追溯）', commits.length === 1, `commit=${commits.join('|') || 'none'}`)

    // ── ③ 负向对照：库建不出来时必须 503 ──
    evil = startServer(EVIL_PORT, EVIL_URL, path.join(TMP, `evil-${EVIL_PORT}.log`))
    const evilUp = await waitForServer(EVIL_PORT)
    record('负向服务就绪', evilUp, evilUp ? `port=${EVIL_PORT}` : '未就绪')
    let bad = { status: 0, body: null }
    try {
      bad = await health(EVIL_PORT)
    } catch (e) {
      bad = { status: 0, body: { error: String(e && e.message) } }
    }
    record(
      '负向对照：库不可用 → 503 且不谎报 healthy',
      bad.status === 503 && (bad.body?.status || '') !== 'healthy',
      `status=${bad.status} bodyStatus=${bad.body?.status}`,
    )
  } finally {
    killServer(good)
    killServer(evil)
  }

  const failed = results.filter((r) => !r.pass)
  const out = {
    startedAt: started,
    finishedAt: new Date().toISOString(),
    environment: { node: process.version, dbUrl: 'file:<tmp>', ports: [PORT, EVIL_PORT] },
    tables,
    criteria: results,
    verdict: failed.length === 0 ? 'PASS' : 'FAIL',
    failed: failed.map((f) => f.name),
  }
  console.log(`\nT8 判定：${out.verdict}（${results.length - failed.length}/${results.length}）`)
  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true })
    fs.writeFileSync(args.out, JSON.stringify(out, null, 2) + '\n')
    console.log(`写出 ${args.out}`)
  }
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(3)
})
