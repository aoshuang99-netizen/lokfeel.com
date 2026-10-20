#!/usr/bin/env node
/**
 * 为「预览/盘点」授予组织身份 —— 幂等、默认 dry-run、可成对撤销
 *
 * 背景：`/console/*`（组织态）要求账号属于某个 ACTIVE 组织，否则渲染「未加入社群」
 * 空状态。QA 账号清空后，预览截图拿不到真实控制台界面。
 *
 * 与 grant-qa-org.mjs 的差别：
 *   - 该脚本只给 `qa.` 前缀账号加成员关系，且要求组织**已存在**；
 *   - 本脚本面向产品预览：组织不存在时**先建**（slug 可指定），账号按 email 显式列出
 *     （不搞前缀批量，避免误伤），写库前后都回读。
 *
 * 用法：
 *   node scripts/qa/grant-preview-org.mjs                     # dry-run
 *   node scripts/qa/grant-preview-org.mjs --apply             # 建 org + 加成员（默认 ADMIN）
 *   node scripts/qa/grant-preview-org.mjs --apply --role=OPERATOR
 *   node scripts/qa/grant-preview-org.mjs --revoke --apply    # 撤销成员关系（组织保留）
 *
 * 默认账号：admin@lokfeel.com（ADMIN，能看全后台联动）与
 *           test.female@lokfeel.com（OPERATOR，普通运营视角）。
 *
 * @module scripts/qa/grant-preview-org
 */
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'



// node_modules 半装（dotenv 不可用）——手写最小 .env 读取（不覆盖已有环境变量）
for (const f of ['.env.local', '.env']) {
  try {
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z_0-9]+)=(.*)$/)
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^"|"$/g, '')
      }
    }
  } catch { /* 文件不存在，忽略 */ }
}

const APPLY = process.argv.includes('--apply')
const REVOKE = process.argv.includes('--revoke')
const roleArg = process.argv.find((a) => a.startsWith('--role='))
const ROLE = roleArg ? roleArg.slice('--role='.length).toUpperCase() : 'ADMIN'
const SLUG = (process.argv.find((a) => a.startsWith('--slug=')) || '--slug=preview').slice('--slug='.length)
const VALID_ROLES = ['OWNER', 'ADMIN', 'OPERATOR', 'MEMBER']

const EMAILS = [
  'admin@lokfeel.com',
  'test.female@lokfeel.com',
]

const url = process.env.DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN
if (!url || !authToken) {
  console.error('✗ 缺少 DATABASE_URL 或 TURSO_AUTH_TOKEN')
  process.exit(1)
}
if (!VALID_ROLES.includes(ROLE)) {
  console.error(`✗ 非法 role=${ROLE}（可选：${VALID_ROLES.join(' / ')}）`)
  process.exit(1)
}

/**
 * 直连 Turso HTTP API（node_modules 半装，@libsql/client 不保证可用；
 * libsql:// 的主机名即 HTTPS API 主机名，鉴权用 TURSO_AUTH_TOKEN bearer）。
 */
const httpBase = String(url)
  .replace(/^libsql:\/\//, 'https://')
  .replace(/\/$/, '')

async function execute(sql, args = []) {
  const body = {
    requests: [
      { type: 'execute', stmt: { sql, args: args.map((a) => (a == null ? { type: 'null' } : { type: 'text', value: String(a) })) } },
      { type: 'close' },
    ],
  }
  const resp = await fetch(`${httpBase}/v2/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    throw new Error(`Turso HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`)
  }
  const data = await resp.json()
  const result = data.results?.[0]
  if (result?.type === 'error') {
    throw new Error(`SQL error: ${result.error?.message || JSON.stringify(result.error).slice(0, 300)}`)
  }
  const cols = result?.response?.result?.cols || []
  const rrows = result?.response?.result?.rows || []
  return rrows.map((r) => Object.fromEntries(cols.map((c, i) => [c.name, r[i]?.value])))
}
const rows = execute

async function main() {
  console.log(`\n目标库：${String(url).replace(/\/\/.*@/, '//***@')}`)
  console.log(`模式  ：${APPLY ? (REVOKE ? '撤销成员关系 (--revoke --apply)' : '写入 (--apply)') : '只盘点 (dry-run)'}`)
  console.log(`组织  ：slug=${SLUG}   新成员角色：${REVOKE ? '(删除)' : ROLE}\n`)

  // ── 1. 组织：不存在则建（幂等）──
  let orgs = await rows('SELECT id, name, slug, status FROM Organization WHERE slug = ?', [SLUG])
  if (orgs.length === 0) {
    console.log(`组织 slug=${SLUG} 不存在 → 将创建（name=LokFeel Preview）`)
    if (APPLY) {
      const now = new Date().toISOString()
      await execute("INSERT INTO Organization (id, name, slug, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?)", [crypto.randomUUID(), 'LokFeel Preview', SLUG, 'ACTIVE', now, now])
      orgs = await rows('SELECT id, name, slug, status FROM Organization WHERE slug = ?', [SLUG])
      console.log(`  + 组织已创建：${orgs[0].id}`)
    }
  } else {
    console.log(`组织已存在：${orgs[0].id} (${orgs[0].name} / ${orgs[0].status})`)
  }
  const org = orgs[0]

  // ── 2. 目标账号 ──
  const targets = []
  for (const email of EMAILS) {
    const us = await rows('SELECT id, email FROM User WHERE email = ?', [email])
    if (us.length === 0) {
      console.log(`⚠ 账号不存在，跳过：${email}`)
      continue
    }
    targets.push(us[0])
  }

  const existing = org
    ? await rows('SELECT id, userId, role, status FROM Membership WHERE organizationId = ?', [org.id])
    : []
  const byUser = new Map(existing.map((m) => [m.userId, m]))

  console.log('\n── 账号 × 当前成员关系 ──')
  for (const u of targets) {
    const m = byUser.get(u.id)
    console.log(`  ${u.email.padEnd(28)} →  ${m ? `${m.role} / ${m.status}` : '（无成员关系）'}`)
  }

  if (!APPLY) {
    console.log('\n（dry-run：未写任何数据。加 --apply 执行）\n')
    return
  }

  console.log('\n── 执行 ──')
  const now = new Date().toISOString()
  if (REVOKE) {
    let n = 0
    for (const u of targets) {
      const m = byUser.get(u.id)
      if (!m) {
        console.log(`  · ${u.email} 本无成员关系，跳过`)
        continue
      }
      await execute('DELETE FROM Membership WHERE id = ?', [m.id])
      console.log(`  − ${u.email} 已移除成员关系（原 ${m.role}）`)
      n += 1
    }
    console.log(`\n共移除 ${n} 条（组织保留，如需删组织请手动处理 slug=${SLUG}）。`)
  } else {
    for (const u of targets) {
      const m = byUser.get(u.id)
      if (m) {
        await execute('UPDATE Membership SET role = ?, status = ?, updatedAt = ? WHERE id = ?', [ROLE, 'ACTIVE', now, m.id])
        console.log(`  ↻ ${u.email} 更新为 ${ROLE} / ACTIVE（原 ${m.role} / ${m.status}）`)
      } else {
        await execute('INSERT INTO Membership (id, organizationId, userId, role, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?)', [crypto.randomUUID(), org.id, u.id, ROLE, 'ACTIVE', now, now])
        console.log(`  + ${u.email} 加入组织 ${SLUG}（${ROLE} / ACTIVE）`)
      }
    }
  }

  // ── 3. 回读复验 ──
  console.log('\n── 回读复验 ──')
  const after = await rows(
    `SELECT m.userId, u.email, m.role, m.status
       FROM Membership m JOIN User u ON u.id = m.userId
      WHERE m.organizationId = ?`,
    [org.id],
  )
  for (const r of after) console.log(`  · ${r.email} = ${r.role} / ${r.status}`)
  console.log('')
}

main().catch((e) => {
  console.error('✗', e)
  process.exit(1)
})
