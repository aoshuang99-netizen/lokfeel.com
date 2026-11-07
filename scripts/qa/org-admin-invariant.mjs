#!/usr/bin/env node
/**
 * 「每个在用组织至少一名在用管理员」体检 + 修复（D-12）
 *
 * 为什么需要这个脚本：
 *   产品里**没有**组织创建入口，也没有成员写入口（`GET /api/v1/members` 只读）。
 *   生产 `default` 组织因此出现了「零 ADMIN」状态 —— 审批（agent.approve）与
 *   结果核验（outcome.verify）都要求 ADMIN，于是这两个能力在生产**无人可用**。
 *   这是一个**只有直连数据库才能修**的缺口，所以修法必须显式、可审计、可复现。
 *
 * 用法：
 *   node scripts/qa/org-admin-invariant.mjs                      # 只读体检（全部组织）
 *   node scripts/qa/org-admin-invariant.mjs --org=default        # 只读体检（单个）
 *   node scripts/qa/org-admin-invariant.mjs --json               # 机器可读输出
 *   node scripts/qa/org-admin-invariant.mjs --apply --org=default --user=a@b.c
 *   node scripts/qa/org-admin-invariant.mjs --apply --add-membership --org=default --user=a@b.c
 *   node scripts/qa/org-admin-invariant.mjs --apply ... --dry-run     # 只打印计划，不写库
 *   node scripts/qa/org-admin-invariant.mjs --self-test          # 无数据库的纯逻辑自检
 *
 * 退出码：
 *   0  全部 ACTIVE 组织都有 ≥1 名 ACTIVE 管理员（或 --apply 成功）
 *   1  存在「零管理员」的在用组织（**只读模式下这是发现，不是失败**，但仍以 1 退出，
 *      以便 CI/巡检把它当红灯）
 *   2  用法/参数错误
 *   3  --apply 被拒绝（目标是 OWNER 组织 / 用户不是该组织成员 / 用户不存在）
 *
 * 🔴 --apply 的边界（刻意保守）：
 *   - 默认**只提升该组织已有成员**。要把一个**非成员**的运维账号拉进来，必须再加
 *     `--add-membership` —— 那改变的是"谁能进这个组织"，比"谁有管理权"危险一档，
 *     因此单独开关、单独判定、单独审计事件（`membership.added`）。
 *   - 只把角色设为 ADMIN，不碰 OWNER（所有权只有组织所有者自己能转移）。
 *   - 写入后**立即回读**校验，不是"UPDATE 没报错就算成功"。
 *   - 同时写一条 TenantAuditEvent，让你事后查得到"这次提权是谁、什么时候、从哪来"。
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createClient } from '@libsql/client'

const root = path.resolve(import.meta.dirname, '../..')

function parseEnv(file) {
  const out = {}
  if (!fs.existsSync(file)) return out
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
  }
  return out
}

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const value = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}

const ADMIN_ROLES = ['OWNER', 'ADMIN']

// ───────────────────────────────────────────────────────────────────────────
// 纯逻辑（可离线自检）
// ───────────────────────────────────────────────────────────────────────────

/** 由「角色 × 状态 → 人数」的分组行算出管理员体检结论。 */
export function evaluateOrg(org, rows) {
  let activeAdmins = 0
  let activeMembers = 0
  for (const r of rows) {
    const n = Number(r.n)
    if (r.status !== 'ACTIVE') continue
    activeMembers += n
    if (ADMIN_ROLES.includes(r.role)) activeAdmins += n
  }
  return {
    organizationId: org.id,
    slug: org.slug,
    status: org.status,
    activeAdmins,
    activeMembers,
    missingAdmin: org.status === 'ACTIVE' && activeAdmins === 0,
  }
}

/** 找到「在用但零管理员」的组织。 */
export function findViolations(results) {
  return results.filter((r) => r.missingAdmin)
}

/**
 * 是否允许把一个**尚不是成员**的运维账号加入组织并授 ADMIN（`--add-membership`）。
 *
 * 这条路径比 `--apply` 危险一档：它改变的是"谁能进这个组织"，不只是"谁有管理权"。
 * 因此单独判定、单独开关、单独审计事件。
 */
export function planOperatorGrant({ orgStatus, existingRole, userExists }) {
  if (!userExists) return { ok: false, code: 'USER_NOT_FOUND' }
  if (orgStatus !== 'ACTIVE') return { ok: false, code: 'ORG_INACTIVE' }
  if (existingRole) return { ok: false, code: 'ALREADY_MEMBER' }
  return { ok: true }
}

function selfTest() {
  const cases = []
  const org = { id: 'o1', slug: 'default', status: 'ACTIVE' }

  const zero = evaluateOrg(org, [{ role: 'OPERATOR', status: 'ACTIVE', n: 2 }])
  cases.push(['全员 OPERATOR ⇒ missingAdmin', zero.missingAdmin === true && zero.activeAdmins === 0])

  const oneAdmin = evaluateOrg(org, [
    { role: 'OPERATOR', status: 'ACTIVE', n: 1 },
    { role: 'ADMIN', status: 'ACTIVE', n: 1 },
  ])
  cases.push(['一名 ADMIN ⇒ 合规', oneAdmin.missingAdmin === false && oneAdmin.activeMembers === 2])

  const ownerCounts = evaluateOrg(org, [{ role: 'OWNER', status: 'ACTIVE', n: 1 }])
  cases.push(['OWNER 计入管理员', ownerCounts.missingAdmin === false])

  const suspended = evaluateOrg(org, [
    { role: 'ADMIN', status: 'SUSPENDED', n: 1 },
    { role: 'MEMBER', status: 'ACTIVE', n: 1 },
  ])
  cases.push(['SUSPENDED 的 ADMIN 不算', suspended.missingAdmin === true])

  const invited = evaluateOrg(org, [{ role: 'ADMIN', status: 'INVITED', n: 1 }])
  cases.push(['INVITED 的 ADMIN 不算', invited.missingAdmin === true])

  const suspendedOrg = evaluateOrg({ ...org, status: 'SUSPENDED' }, [])
  cases.push(['停用组织不报缺（不服务流量）', suspendedOrg.missingAdmin === false])

  const empty = evaluateOrg(org, [])
  cases.push(['空组织（ACTIVE）⇒ missingAdmin', empty.missingAdmin === true])

  cases.push([
    'findViolations 只挑缺管理员的',
    findViolations([
      { slug: 'a', missingAdmin: true },
      { slug: 'b', missingAdmin: false },
    ]).length === 1,
  ])

  cases.push([
    'planOperatorGrant：非成员 + ACTIVE 组织 ⇒ 允许',
    planOperatorGrant({ orgStatus: 'ACTIVE', existingRole: null, userExists: true }).ok === true,
  ])
  cases.push([
    'planOperatorGrant：已是成员 ⇒ 拒绝（走 --apply 提权）',
    planOperatorGrant({ orgStatus: 'ACTIVE', existingRole: 'OPERATOR', userExists: true }).code ===
      'ALREADY_MEMBER',
  ])
  cases.push([
    'planOperatorGrant：用户不存在 ⇒ 拒绝',
    planOperatorGrant({ orgStatus: 'ACTIVE', existingRole: null, userExists: false }).code ===
      'USER_NOT_FOUND',
  ])
  cases.push([
    'planOperatorGrant：停用组织 ⇒ 拒绝',
    planOperatorGrant({ orgStatus: 'SUSPENDED', existingRole: null, userExists: true }).code ===
      'ORG_INACTIVE',
  ])

  let failed = 0
  for (const [name, ok] of cases) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
    if (!ok) failed += 1
  }
  console.log(`\nself-test: ${cases.length - failed}/${cases.length} PASS`)
  process.exit(failed === 0 ? 0 : 1)
}

if (flag('self-test')) {
  selfTest()
}

// ───────────────────────────────────────────────────────────────────────────
// 数据库体检
// ───────────────────────────────────────────────────────────────────────────

const env = { ...parseEnv(path.join(root, '.env')), ...parseEnv(path.join(root, '.env.local')) }
const url = env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL 未配置（.env / .env.local）')
  process.exit(2)
}

const db = createClient({ url, authToken: env.TURSO_AUTH_TOKEN })
const isRemote = url.startsWith('libsql://') || url.startsWith('https://')
console.log(`数据库: ${isRemote ? '远端（Turso）' : url}`)

async function rowsOfOrganizations() {
  const target = value('org')
  const sql = target
    ? 'SELECT id, slug, status FROM "Organization" WHERE id = ? OR slug = ? ORDER BY createdAt ASC'
    : 'SELECT id, slug, status FROM "Organization" ORDER BY createdAt ASC'
  const res = await db.execute(target ? { sql, args: [target, target] } : sql)
  return res.rows
}

async function groupRows(organizationId) {
  const res = await db.execute({
    sql: `SELECT role, status, COUNT(*) AS n FROM "Membership"
          WHERE organizationId = ? GROUP BY role, status`,
    args: [organizationId],
  })
  return res.rows
}

async function main() {
  const orgs = await rowsOfOrganizations()
  if (orgs.length === 0) {
    console.error(value('org') ? `组织不存在: ${value('org')}` : '库中没有任何组织')
    process.exit(2)
  }

  const results = []
  for (const org of orgs) {
    results.push(evaluateOrg(org, await groupRows(org.id)))
  }

  if (flag('json')) {
    console.log(JSON.stringify({ database: isRemote ? 'remote' : 'local', results }, null, 2))
  } else {
    console.log('')
    console.log('组织'.padEnd(22), '状态'.padEnd(10), '成员', '管理员', '结论')
    for (const r of results) {
      console.log(
        `${r.slug} (${r.organizationId.slice(0, 6)}…)`.padEnd(22),
        r.status.padEnd(10),
        String(r.activeMembers).padStart(4),
        String(r.activeAdmins).padStart(6),
        r.missingAdmin ? '  ❌ 零管理员' : r.activeAdmins === 0 ? '  · 停用/空' : '  ✅'
      )
    }
  }

  const violations = findViolations(results)

  if (!flag('apply')) {
    if (violations.length > 0) {
      console.error(
        `\n发现 ${violations.length} 个在用组织没有任何 ACTIVE 管理员：${violations.map((v) => v.slug).join(', ')}`
      )
      console.error('修复（只提升该组织**已有成员**）：')
      for (const v of violations) {
        console.error(
          `  node scripts/qa/org-admin-invariant.mjs --apply --org=${v.slug} --user=<email|userId>`
        )
      }
      process.exit(1)
    }
    console.log('\n全部在用组织都有 ≥1 名 ACTIVE 管理员。')
    process.exit(0)
  }

  // ── apply ──────────────────────────────────────────────────────────────
  const orgKey = value('org')
  const userKey = value('user')
  if (!orgKey || !userKey) {
    console.error('--apply 需要同时给出 --org=<slug|id> 与 --user=<email|userId>')
    process.exit(2)
  }
  if (orgs.length !== 1) {
    console.error(`--org=${orgKey} 必须唯一匹配一个组织，实际匹配 ${orgs.length} 个`)
    process.exit(2)
  }
  const org = orgs[0]

  const userRes = await db.execute({
    sql: 'SELECT id, email FROM "User" WHERE id = ? OR email = ?',
    args: [userKey, userKey],
  })
  if (userRes.rows.length !== 1) {
    console.error(`用户不存在或不唯一: ${userKey}（匹配 ${userRes.rows.length} 条）`)
    process.exit(3)
  }
  const user = userRes.rows[0]

  const memberRes = await db.execute({
    sql: 'SELECT id, role, status FROM "Membership" WHERE organizationId = ? AND userId = ?',
    args: [org.id, user.id],
  })

  const dryRun = flag('dry-run')

  // ── 路径 A：用户已是成员 → 提权（--apply） ──
  if (memberRes.rows.length > 0) {
    const membership = memberRes.rows[0]
    if (ADMIN_ROLES.includes(membership.role)) {
      console.log(`已满足：${user.email} 在 ${org.slug} 的角色已是 ${membership.role}`)
      process.exit(0)
    }

    if (dryRun) {
      console.log(
        `[dry-run] 将把 ${user.email} 在 ${org.slug} 的角色 ${membership.role} → ADMIN（membership ${membership.id}）`
      )
      process.exit(0)
    }

    const now = new Date().toISOString()
    await db.execute({
      sql: 'UPDATE "Membership" SET role = ?, updatedAt = ? WHERE id = ?',
      args: ['ADMIN', now, membership.id],
    })

    // 回读校验：UPDATE 不报错 ≠ 改成功（触发器/软删除扩展都可能让它静默变成 0 行）。
    const verify = await db.execute({
      sql: 'SELECT role FROM "Membership" WHERE id = ?',
      args: [membership.id],
    })
    if (verify.rows[0]?.role !== 'ADMIN') {
      console.error(`写入后回读失败：期望 ADMIN，实际 ${verify.rows[0]?.role}`)
      process.exit(3)
    }

    await db.execute({
      sql: `INSERT INTO "TenantAuditEvent"
              (id, organizationId, actorId, eventType, resourceType, resourceId, safeMetadata)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        crypto.randomUUID(),
        org.id,
        null, // 系统触发（运维脚本），不是某个用户的决定
        'membership.role_changed',
        'membership',
        membership.id,
        JSON.stringify({ from: membership.role, to: 'ADMIN', via: 'ops-script:org-admin-invariant' }),
      ],
    })

    console.log(
      `\n✅ ${user.email} 在 ${org.slug} 的角色 ${membership.role} → ADMIN（membership ${membership.id}）`
    )
    console.log('已写审计 membership.role_changed（actorId=null，via=ops-script:org-admin-invariant）')

    const after = evaluateOrg(org, await groupRows(org.id))
    console.log(`复检：${org.slug} 现有 ${after.activeAdmins} 名 ACTIVE 管理员`)
    process.exit(after.missingAdmin ? 3 : 0)
  }

  // ── 路径 B：用户不是成员 → 只有显式 --add-membership 才建关系 ──
  if (!flag('add-membership')) {
    console.error(
      `拒绝：${user.email} 不是组织 ${org.slug} 的成员。这不等于"危险操作失败" —— 它是一条需要你显式表态的边界。`
    )
    console.error(
      '若确实要把它作为运维账号加入本组织并授 ADMIN，请显式加 --add-membership：\n' +
        `  node scripts/qa/org-admin-invariant.mjs --apply --add-membership --org=${org.slug} --user=${user.email}`
    )
    process.exit(3)
  }

  const plan = planOperatorGrant({
    orgStatus: org.status,
    existingRole: null,
    userExists: true,
  })
  if (!plan.ok) {
    console.error(`拒绝：${plan.code}`)
    process.exit(3)
  }

  if (dryRun) {
    console.log(`[dry-run] 将新建成员关系：${user.email} 加入 ${org.slug}，角色 ADMIN`)
    process.exit(0)
  }

  const membershipId = crypto.randomUUID()
  const now = new Date().toISOString()
  await db.execute({
    sql: `INSERT INTO "Membership" (id, organizationId, userId, role, status, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [membershipId, org.id, user.id, 'ADMIN', 'ACTIVE', now, now],
  })

  const verify = await db.execute({
    sql: 'SELECT role, status FROM "Membership" WHERE id = ?',
    args: [membershipId],
  })
  if (verify.rows[0]?.role !== 'ADMIN' || verify.rows[0]?.status !== 'ACTIVE') {
    console.error(`写入后回读失败：${JSON.stringify(verify.rows[0] ?? null)}`)
    process.exit(3)
  }

  await db.execute({
    sql: `INSERT INTO "TenantAuditEvent"
            (id, organizationId, actorId, eventType, resourceType, resourceId, safeMetadata)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      crypto.randomUUID(),
      org.id,
      null,
      'membership.added',
      'membership',
      membershipId,
      JSON.stringify({ role: 'ADMIN', via: 'ops-script:org-admin-invariant' }),
    ],
  })

  console.log(`\n✅ 已新建成员关系：${user.email} 加入 ${org.slug}，角色 ADMIN（membership ${membershipId}）`)
  console.log('已写审计 membership.added（actorId=null，via=ops-script:org-admin-invariant）')

  const after = evaluateOrg(org, await groupRows(org.id))
  console.log(`复检：${org.slug} 现有 ${after.activeAdmins} 名 ACTIVE 管理员`)
  process.exit(after.missingAdmin ? 3 : 0)
}

main().catch((err) => {
  console.error('执行失败:', err?.message ?? err)
  process.exit(2)
})
