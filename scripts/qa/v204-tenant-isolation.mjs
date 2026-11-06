/**
 * V20.4 · Batch 5 · 跨租户隔离**运行时**实测
 *
 * `npm run audit:tenancy` 是静态审计（扫源码里查询是否带 orgId 约束）。
 * 它能证明"没有未登记的跨租户查询"，但证不了"运行时真的拦住了"。
 * 本脚本补后者，且刻意设计成**含反例**：
 *
 *   ① 恶意写：body 里塞别人组织的 `organizationId` → 服务端必须忽略，
 *      落库归属必须是调用者自己的组织（不是 403 就完事，而是"按我的租户落"）；
 *   ② 正常写：同样请求但干净 body → 必须成功（否则"①通过"可能只是接口根本不可用）；
 *   ③ 列表读：GET 返回的每一条都必须是本租户；
 *   ④ 清理：硬删本次创建的探针 mission，不留垃圾。
 *
 * 事实基线（实测，非推断）：
 *   · `parseMissionCreate()` 的返回类型 `ParsedMissionCreate` **不包含 organizationId**，
 *     route 里写死 `organizationId: tenant.organizationId` —— 客户端指定租户在解析阶段就被丢弃；
 *   · 现有两个组织：`org_default`（qa.male/qa.female）与 `757eee19-…`（admin/test.female）。
 *
 * 用法：
 *   node scripts/qa/v204-tenant-isolation.mjs --base=http://127.0.0.1:3099
 *   node scripts/qa/v204-tenant-isolation.mjs --base=https://app.lokfeel.com --dry-run   # 只读
 *
 * 退出码：0 = 全 PASS；1 = 有 FAIL；2 = 前置失败。
 */
import { createClient } from '@libsql/client'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const argv = process.argv.slice(2)
const arg = (k, d = '') => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`))
  return hit ? hit.slice(k.length + 3) : d
}
const BASE = arg('base', 'http://127.0.0.1:3099').replace(/\/$/, '')
const DRY = argv.includes('--dry-run')
const EMAIL = arg('email', 'qa.male@lokfeel.com')
const PWD = fs.readFileSync(arg('pwd-file', '/tmp/v204_qa_pwd'), 'utf8').trim()
const ROOT = path.resolve(import.meta.dirname, '../..')

/** 已知的另一个组织（LokFeel Preview）；用于构造"别人的 organizationId" */
const FOREIGN_ORG = '757eee19-3d36-4682-be35-2005fa0d13d3'

function loadEnv() {
  const out = {}
  // 先 `.env` 再 `.env.local`：local 必须覆盖；且去引号（`.env` 里 DATABASE_URL 带引号）
  for (const f of ['.env', '.env.local']) {
    const p = path.join(ROOT, f)
    if (!fs.existsSync(p)) continue
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      if (!/^[A-Z0-9_]+=/.test(line)) continue
      const i = line.indexOf('=')
      let v = line.slice(i + 1).trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      out[line.slice(0, i)] = v
    }
  }
  return out
}

const env = loadEnv()
const db = createClient({ url: env.DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ email: EMAIL, password: PWD }),
    redirect: 'manual',
  })
  if (!res.ok) throw new Error(`login ${res.status}`)
  return res.headers.getSetCookie().find((x) => /session-token/i.test(x)).split(';')[0]
}

function missionBody(extra = {}) {
  return {
    goal: 'V204 租户隔离探针：验证服务端忽略客户端指定的 organizationId',
    offer: '测试提供物',
    successCriteria: '断言落库 organizationId 等于调用者所属组织',
    publish: false,
    ...extra,
  }
}

async function createMission(cookie, body, idem) {
  const res = await fetch(`${BASE}/api/v1/missions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie,
      Origin: BASE,
      'Idempotency-Key': idem,
    },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

const cookie = await login()
console.log(`✓ 登录 ${EMAIL} @ ${BASE}\n`)

// ── 当前租户 ──
const orgRes = await fetch(`${BASE}/api/v1/org`, { headers: { cookie, Origin: BASE } })
const orgJson = await orgRes.json().catch(() => ({}))
const myOrg = orgJson?.data?.organization?.id
check('读到当前组织', orgRes.status === 200 && Boolean(myOrg), `status=${orgRes.status} org=${myOrg}`)
check('目标组织与探针组织不同', myOrg !== FOREIGN_ORG, `mine=${myOrg} foreign=${FOREIGN_ORG}`)

if (!DRY) {
  // ── ① 恶意写：指定别人的 organizationId ──
  // 🔴 实测响应结构：POST 返回 `data` **直接就是 mission 对象**（不是 `data.mission`）。
  //    第一版按 `data.mission` 解析，把 ③ 列表断言读成空数组 —— 空集恒真，等于假绿。
  const evil = await createMission(cookie, missionBody({ organizationId: FOREIGN_ORG }), randomUUID())
  const evilId = evil.json?.data?.id ?? evil.json?.data?.mission?.id ?? null
  const evilOrg = evil.json?.data?.organizationId ?? evil.json?.data?.mission?.organizationId ?? null
  check(
    '恶意 organizationId 被忽略（落库归属=自己的租户）',
    (evil.status === 200 || evil.status === 201) && evilOrg === myOrg,
    `status=${evil.status} landedOrg=${evilOrg} expect=${myOrg}`,
  )

  // ── ② 反例：同租户正常写必须成功 ──
  const clean = await createMission(cookie, missionBody(), randomUUID())
  const cleanId = clean.json?.data?.id ?? clean.json?.data?.mission?.id ?? null
  check(
    '同租户正常创建成功（证明接口可用，非一律拒绝）',
    (clean.status === 200 || clean.status === 201) && Boolean(cleanId),
    `status=${clean.status} id=${cleanId}`,
  )

  // ── ③ 列表读：必须先证明列表非空，再断言无跨租户 ──
  const listRes = await fetch(`${BASE}/api/v1/missions?pageSize=50`, { headers: { cookie, Origin: BASE } })
  const listJson = await listRes.json().catch(() => ({}))
  // 实测结构：GET 的 `data` **是数组本身**
  const items = Array.isArray(listJson?.data)
    ? listJson.data
    : (listJson?.data?.missions ?? listJson?.data?.items ?? [])
  const nonEmpty = items.length >= 1
  check(
    '列表前置非空（否则"不含他人数据"是空集恒真）',
    nonEmpty,
    `status=${listRes.status} items=${items.length}`,
  )
  const foreign = items.filter((m) => m.organizationId && m.organizationId !== myOrg)
  check(
    '列表不含其他组织的数据',
    listRes.status === 200 && nonEmpty && foreign.length === 0,
    `items=${items.length} foreign=${foreign.length} orgs=${[...new Set(items.map((m) => m.organizationId))].join(',')}`,
  )

  // ── ④ 清理：硬删本次探针 mission ──
  let cleaned = 0
  for (const id of [evilId, cleanId].filter(Boolean)) {
    try {
      await db.execute({ sql: 'DELETE FROM Mission WHERE id = ?', args: [id] })
      cleaned++
    } catch (e) {
      console.log(`  ! 清理 ${id} 失败：${String(e.message).slice(0, 80)}`)
    }
  }
  console.log(`\n[清理] 已删除探针 mission ${cleaned}/${[evilId, cleanId].filter(Boolean).length}`)
} else {
  console.log('\n（--dry-run：跳过写入与清理）')
}

const fails = results.filter((r) => !r.ok)
console.log(`\n=== ${results.length - fails.length} PASS / ${fails.length} FAIL（共 ${results.length} 项）===`)
if (fails.length) process.exit(1)
process.exit(0)
