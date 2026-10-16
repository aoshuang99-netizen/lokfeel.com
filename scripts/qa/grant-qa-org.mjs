#!/usr/bin/env node
/**
 * 把 QA 账号加入组织（`org_default`），使它们具备租户域能力 —— **默认 dry-run**
 *
 * 用法：
 *   node scripts/qa/grant-qa-org.mjs                     # 只盘点，不写库
 *   node scripts/qa/grant-qa-org.mjs --apply             # 建/更新成员关系（role=OPERATOR）
 *   node scripts/qa/grant-qa-org.mjs --role=ADMIN --apply
 *   node scripts/qa/grant-qa-org.mjs --revoke --apply    # 撤销（删成员关系）
 *
 * ## 为什么需要它
 * `create-qa-accounts.mjs` 只建 `User` + `Profile`，**不建 `Membership`**。
 * 而租户域端点（含 `GET /api/v1/agents/diagnostics/connectivity`，能力 `agent.execute`）
 * 要求调用者**属于某个组织**；`Membership = 0` 时一律 403 ⇒ A1 的
 * 「生产侧出口连通性」取证**取不到会话**。
 *
 * ## 为什么 role 默认 OPERATOR
 * `agent.execute` 在 `src/lib/tenancy/capabilities.ts` 里属 **OPERATOR 及以上**
 * （注释：executor 会再判一次该能力，纵深防御）。
 * ⚠️ 刻意**不用 ADMIN/OWNER**：`agent.approve` 是 ADMIN 门槛，而 AC-08 的制度设计是
 * 「能跑不能批」——把 QA 账号直接提成 ADMIN 会**抹掉这条分离**，让后续校验分不清对错。
 *
 * ## 幂等与成对撤销
 * - 同一 `(organizationId, userId)` 唯一（库级 `@@unique`），存在则**更新** role/status；
 * - 撤销删的是 `Membership` 行本身（`User` 仍由 `cleanup-qa-accounts.mjs` 负责）；
 *   即使漏了本步，删 `User` 时 `Membership` 也会按 `onDelete: Cascade` 级联消失。
 *
 * ## 安全设计
 * - 默认 dry-run；`--apply` 才写库；
 * - 只认 email 前缀 `qa.`，不做模糊匹配；
 * - 写库前打印「将要做什么」，写库后**回读复验**。
 *
 * @module scripts/qa/grant-qa-org
 */

import { createClient } from '@libsql/client'
import * as dotenv from 'dotenv'
import crypto from 'node:crypto'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const APPLY = process.argv.includes('--apply')
const REVOKE = process.argv.includes('--revoke')
const roleArg = process.argv.find((a) => a.startsWith('--role='))
const ROLE = roleArg ? roleArg.slice('--role='.length).toUpperCase() : 'OPERATOR'
const SLUG = (process.argv.find((a) => a.startsWith('--slug=')) || '--slug=default').slice('--slug='.length)
const PREFIX = 'qa.'
const VALID_ROLES = ['OWNER', 'ADMIN', 'OPERATOR', 'MEMBER']

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

const db = createClient({ url, authToken })
const rows = async (sql, args = []) => (await db.execute({ sql, args })).rows

async function main() {
  console.log(`\n目标库：${String(url).replace(/\/\/.*@/, '//***@')}`)
  console.log(`模式  ：${APPLY ? (REVOKE ? '撤销 (--revoke --apply)' : '写入 (--apply)') : '只盘点 (dry-run)'}`)
  console.log(`组织  ：slug=${SLUG}   角色：${REVOKE ? '(删除成员关系)' : ROLE}\n`)

  const orgs = await rows('SELECT id, name, slug FROM Organization WHERE slug = ?', [SLUG])
  if (orgs.length === 0) {
    console.error(`✗ 找不到 slug=${SLUG} 的组织。现有组织：`)
    for (const o of await rows('SELECT slug, name FROM Organization')) console.error(`   · ${o.slug} (${o.name})`)
    process.exit(1)
  }
  const org = orgs[0]
  console.log(`组织  ：${org.id}  (${org.name})\n`)

  const qaUsers = await rows(`SELECT id, email FROM User WHERE email LIKE ? ORDER BY email`, [`${PREFIX}%`])
  if (qaUsers.length === 0) {
    console.error(`✗ 库里没有 ${PREFIX}* 账号 —— 先跑 node scripts/qa/create-qa-accounts.mjs`)
    process.exit(1)
  }

  const existing = await rows('SELECT id, userId, role, status FROM Membership WHERE organizationId = ?', [org.id])
  const byUser = new Map(existing.map((m) => [m.userId, m]))

  console.log('── QA 账号 × 当前成员关系 ──')
  for (const u of qaUsers) {
    const m = byUser.get(u.id)
    console.log(
      `  ${u.email.padEnd(26)} ${u.id}  →  ${m ? `${m.role} / ${m.status}` : '（无成员关系）'}`,
    )
  }

  if (!APPLY) {
    console.log('\n（dry-run：未写任何数据。加 --apply 执行）\n')
    return
  }

  console.log('\n── 执行 ──')
  if (REVOKE) {
    let n = 0
    for (const u of qaUsers) {
      const m = byUser.get(u.id)
      if (!m) {
        console.log(`  · ${u.email} 本无成员关系，跳过`)
        continue
      }
      await db.execute({ sql: 'DELETE FROM Membership WHERE id = ?', args: [m.id] })
      console.log(`  − ${u.email} 已移除成员关系（原 ${m.role}）`)
      n += 1
    }
    console.log(`\n共移除 ${n} 条。`)
  } else {
    const now = new Date().toISOString()
    for (const u of qaUsers) {
      const m = byUser.get(u.id)
      if (m) {
        await db.execute({
          sql: 'UPDATE Membership SET role = ?, status = ?, updatedAt = ? WHERE id = ?',
          args: [ROLE, 'ACTIVE', now, m.id],
        })
        console.log(`  ↻ ${u.email} 更新为 ${ROLE} / ACTIVE（原 ${m.role} / ${m.status}）`)
      } else {
        await db.execute({
          sql: `INSERT INTO Membership (id, organizationId, userId, role, status, createdAt, updatedAt)
                VALUES (?,?,?,?,?,?,?)`,
          args: [crypto.randomUUID(), org.id, u.id, ROLE, 'ACTIVE', now, now],
        })
        console.log(`  + ${u.email} 加入组织（${ROLE} / ACTIVE）`)
      }
    }
  }

  // ── 回读复验（"返 200" ≠ 写成功）──
  console.log('\n── 回读复验 ──')
  const after = await rows(
    `SELECT m.userId, u.email, m.role, m.status
       FROM Membership m JOIN User u ON u.id = m.userId
      WHERE m.organizationId = ? AND u.email LIKE ? ORDER BY u.email`,
    [org.id, `${PREFIX}%`],
  )
  if (after.length === 0) {
    console.log('  （无成员关系）')
  }
  for (const r of after) console.log(`  ✅ ${r.email.padEnd(26)} ${r.role} / ${r.status}`)
  const total = await rows('SELECT COUNT(*) AS n FROM Membership WHERE organizationId = ?', [org.id])
  console.log(`\n组织 ${org.slug} 成员总数：${total[0].n}`)
  console.log(REVOKE ? '\n✅ 撤销完成。\n' : `\n✅ 授权完成（role=${ROLE}）。\n`)
}

main().catch((e) => {
  console.error('💥 脚本崩溃：', e?.message || e)
  process.exit(2)
})
