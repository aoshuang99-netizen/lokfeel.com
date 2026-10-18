/**
 * 零依赖 Turso 客户端（HTTP pipeline）
 *
 * WHY 不用 `@libsql/client`：
 *   本机 node_modules 是**残缺树**（沙箱里装不完），`@libsql/client` 很可能不在。
 *   而「上线预检」这种脚本恰恰最需要在**任意一台机器**上能跑起来 —— 它不该
 *   被一个可选依赖卡住。Turso 的 `/v2/pipeline` 是公开 HTTP 协议，fetch 就够。
 *
 * 形状（libsql hrana 协议）：
 *   POST {base}/v2/pipeline
 *   { requests: [ { type:'execute', stmt:{ sql, args:[{type,value}] } }, … , {type:'close'} ] }
 *   响应 results[i].response.result.{ cols, rows }
 *
 * 值编码：text / integer / float / null / blob(base64)。
 * 回读时 `rows` 是二维数组，每格 `{ type, value }`（字符串化的）。
 *
 * 用法：
 *   import { createTurso } from './lib/turso-http.mjs'
 *   const db = createTurso()                     // 读 .env / .env.local
 *   const rows = await db.query('select id from User limit 1')
 *   await db.exec('delete from X where id = ?', ['abc'])
 *
 * 安全：本模块**不打印**任何凭据；错误信息只带 HTTP 状态与 SQL 片段尾（不含参数值）。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../../..')

/** 解析 KEY=VALUE 形式的 env 文件（不 export 到 process.env，避免污染子进程） */
export function parseEnvFile(file) {
  const out = {}
  if (!fs.existsSync(file)) return out
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    // 去掉成对引号；保留内部内容原样
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    out[m[1]] = v
  }
  return out
}

/** 合并读取：先 .env 再 .env.local（后者覆盖前者），最后叠加 process.env */
export function loadEnv(files = ['.env', '.env.local']) {
  const merged = {}
  for (const f of files) Object.assign(merged, parseEnvFile(path.join(ROOT, f)))
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && v !== '') merged[k] = v
  }
  return merged
}

function toHrana(v) {
  if (v === null || v === undefined) return { type: 'null' }
  if (typeof v === 'number') {
    return Number.isInteger(v)
      ? { type: 'integer', value: String(v) }
      : { type: 'float', value: v }
  }
  if (typeof v === 'boolean') return { type: 'integer', value: v ? '1' : '0' }
  if (v instanceof Uint8Array) return { type: 'blob', base64: Buffer.from(v).toString('base64') }
  return { type: 'text', value: String(v) }
}

function fromHrana(cell) {
  if (!cell) return null
  switch (cell.type) {
    case 'null':
      return null
    case 'integer':
      return Number(cell.value)
    case 'float':
      return Number(cell.value)
    case 'blob':
      return Buffer.from(cell.base64 || '', 'base64')
    default:
      return cell.value
  }
}

let __idSeq = 0

export function createTurso(opts = {}) {
  const env = opts.env || loadEnv()
  const rawUrl = opts.url || env.DATABASE_URL
  const token = opts.token || env.TURSO_AUTH_TOKEN

  if (!rawUrl || !token) {
    throw new Error('缺少 DATABASE_URL 或 TURSO_AUTH_TOKEN（.env / .env.local）')
  }

  // libsql://xxx.turso.io → https://xxx.turso.io
  const base = rawUrl
    .replace(/^libsql:\/\//, 'https://')
    .replace(/^wss:\/\//, 'https://')
    .replace(/\/+$/, '')
  const endpoint = `${base}/v2/pipeline`

  async function pipeline(requests, { tolerateErrors = false } = {}) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ requests: [...requests, { type: 'close' }] }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Turso HTTP ${res.status}: ${text.slice(0, 200)}`)
    }

    const json = await res.json()
    // results 与 requests 一一对应（末尾 close 也有一条）
    const out = []
    for (const r of json.results || []) {
      if (r.type === 'error') {
        const msg = r.error?.message || 'unknown'
        if (tolerateErrors) {
          out.push({ __error: msg })
          continue
        }
        throw new Error(`Turso SQL 错误: ${msg}`)
      }
      out.push(r.response?.result ?? r.response ?? null)
    }
    return out
  }

  /** 返回对象数组；列名来自 cols */
  async function query(sql, args = []) {
    const [result] = await pipeline([
      { type: 'execute', stmt: { sql, args: args.map(toHrana) } },
    ])
    const cols = (result?.cols || []).map((c) => c.name)
    return (result?.rows || []).map((row) => {
      const obj = {}
      row.forEach((cell, i) => {
        obj[cols[i]] = fromHrana(cell)
      })
      return obj
    })
  }

  /** 单值读（第一行第一列），便于 count(*) 这类断言 */
  async function scalar(sql, args = []) {
    const rows = await query(sql, args)
    if (!rows.length) return null
    return rows[0][Object.keys(rows[0])[0]]
  }

  /** 写操作；返回受影响行数 */
  async function exec(sql, args = []) {
    const [result] = await pipeline([
      { type: 'execute', stmt: { sql, args: args.map(toHrana) } },
    ])
    return result?.affected_row_count ?? 0
  }

  /**
   * 一批语句顺序执行（同一个 HTTP 往返）。
   * 注意：**不是**事务 —— 每条语句独立提交。需要原子性时显式写 BEGIN/COMMIT，
   * 但那在 pipeline 里同样不能保证中途失败回滚，所以清理逻辑用「多轮重试」兜底。
   */
  async function batch(statements) {
    const results = await pipeline(
      statements.map((s) =>
        typeof s === 'string'
          ? { type: 'execute', stmt: { sql: s, args: [] } }
          : { type: 'execute', stmt: { sql: s.sql, args: (s.args || []).map(toHrana) } },
      ),
    )
    return results.map((r) => r?.affected_row_count ?? 0)
  }

  /**
   * 容错批量：逐条返回 `{ ok, count }` 或 `{ ok:false, error }`。
   *
   * WHY 需要：清理时要一次发出「删 32 张子表」的语句，其中大部分表本来就没有
   * 该用户的行（甚至有些因 RESTRICT 而失败）。`batch()` 遇到第一个错误就抛，
   * 会把「预期内的失败」变成脚本崩溃。这里把错误降级成数据。
   */
  async function batchTolerant(statements) {
    const results = await pipeline(
      statements.map((s) =>
        typeof s === 'string'
          ? { type: 'execute', stmt: { sql: s, args: [] } }
          : { type: 'execute', stmt: { sql: s.sql, args: (s.args || []).map(toHrana) } },
      ),
      { tolerateErrors: true },
    )
    return results.map((r) => {
      if (!r) return { ok: true, count: 0 }
      if (r.__error) return { ok: false, error: r.__error }
      return { ok: true, count: r.affected_row_count ?? 0 }
    })
  }

  /** 探活：返回 SQLite 版本，用于区分「连不上」与「SQL 写错」 */
  async function ping() {
    return scalar('select sqlite_version() as v')
  }

  return { query, scalar, exec, batch, batchTolerant, ping, endpoint }
}

/**
 * 枚举所有指向某表的**外键**（表名 + 列名）。
 *
 * WHY 需要：生产库 `PRAGMA foreign_keys=1` 且外键是 RESTRICT，删主表前必须先删
 * 依赖行；依赖表有 30+ 张，硬编码清单一定会漏（而且 schema 会变）。
 */
export async function foreignKeysTo(db, targetTable) {
  const tables = await db.query(
    "select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '_prisma%'",
  )
  const fks = []

  // 并发查（表数量 ~65；串行要 20s，并发 8 路约 3s）
  const CONCURRENCY = 8
  for (let i = 0; i < tables.length; i += CONCURRENCY) {
    const slice = tables.slice(i, i + CONCURRENCY)
    const rowsList = await Promise.all(
      slice.map((t) => db.query(`pragma foreign_key_list('${t.name}')`)),
    )
    slice.forEach((t, k) => {
      for (const r of rowsList[k]) {
        if (r.table === targetTable) {
          fks.push({ table: t.name, column: r.from, onDelete: r.on_delete })
        }
      }
    })
  }
  return fks
}

/**
 * 按外键依赖删除某个 User 及其全部子行。
 *
 * 策略：多轮「尝试删除所有子表中的匹配行」，直到某一轮没有任何删除发生；
 * 每轮不依赖顺序 —— 因为 RESTRICT 会让「父还在」的删除直接失败，下一轮自然跳过。
 * 最后删 User 本身。返回每一轮的统计，便于证明「确实删干净了」。
 */
export async function deleteUserCascade(db, userId, { fks, maxRounds = 12 } = {}) {
  const list = fks || (await foreignKeysTo(db, 'User'))
  const rounds = []

  // 直接挂在 userId 上的子行：外键列名多为 userId / *Id，统一按「列值 = userId」删
  for (let round = 0; round < maxRounds; round++) {
    // 一轮 = 一个 HTTP 往返（32 条语句并发进同一条 pipeline）
    const outcomes = await db.batchTolerant(
      list.map((fk) => ({
        sql: `delete from "${fk.table}" where "${fk.column}" = ?`,
        args: [userId],
      })),
    )
    const deleted = outcomes.reduce((n, o) => n + (o.ok ? o.count : 0), 0)
    const errors = outcomes.filter((o) => !o.ok).length
    rounds.push({ deleted, errors })
    if (deleted === 0) break
  }

  const userDeleted = await db.exec('delete from User where id = ?', [userId])
  return { rounds, userDeleted, fkCount: list.length, tables: list.map((f) => f.table) }
}

export const __internal = { toHrana, fromHrana, __idSeq }
