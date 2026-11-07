#!/usr/bin/env node
/**
 * T07 · 组织 / 成员全生命周期 —— 端到端复验（Batch 1 验收）
 *
 * 覆盖「建组织 → 邀请 → 接受 → 加入 → 移出 → 重新加入」整条链路，
 * 每一步都同时断言 **HTTP 结果** 与 **数据库事实**。两条都要，理由：
 *   - 只看 HTTP：200 也可能是"什么也没写"（早期 D-12 就是这种形态：接口正常，库里没有管理员）。
 *   - 只看 DB：无法证明"这条路真的能从外部走通"（单测直接 import 函数，绕过路由与鉴权）。
 *
 * 断言清单（每条都能独立失败）：
 *   ── 建组织 ──────────────────────────────────────────────────────────
 *   C01 匿名 POST                    → 401
 *   C02 合法创建                     → 201，返回 role=OWNER
 *   C03 DB：恰好 1 条 ACTIVE OWNER   → 「新建组织 100% 有有效管理员」
 *   C04 GET /api/v1/org              → myRole=OWNER，capabilities 含 invite/remove/update_role
 *   C05 同 slug 重试                 → 409 SLUG_TAKEN 且**不产生第二个组织/第二条成员关系**
 *   C06 保留字 slug                  → 400 SLUG_RESERVED
 *   C07 审计                         → organization.created + membership.created 两条落库
 *   ── 邀请 ────────────────────────────────────────────────────────────
 *   I01 邀请新邮箱                   → 201 + inviteUrl + emailSent 是布尔（不撒谎）
 *   I02 DB：只存 token 的 sha256     → tokenHash === sha256(token) 且 != 明文 token
 *   I03 重复邀请同一邮箱             → 201 换票，旧票变 REVOKED（同邮箱只有一条可用链接）
 *   I04 邀请已是成员的邮箱           → 409 ALREADY_MEMBER
 *   I05 邀请 role=OWNER              → 403 OWNER_GRANT_FORBIDDEN（所有权不能靠邮件授予）
 *   I06 非法邮箱                     → 400 INVALID_EMAIL
 *   I07 非成员带 ?organizationId= 读 → 403（客户端给的 orgId 不是授权依据）
 *   ── 接受 ────────────────────────────────────────────────────────────
 *   A01 匿名 accept                  → 401
 *   A02 别人拿这条链接               → 403 EMAIL_MISMATCH 且票仍 PENDING（未被消费）
 *   A03 本人接受                     → 200；DB：membership ACTIVE + 票 ACCEPTED/acceptedAt/acceptedBy
 *   A04 同一 token 再接受             → 409 NOT_PENDING（链接只能用一次）
 *   A05 伪造 token                   → 404 INVALID_TOKEN
 *   A06 过期票                       → 409 EXPIRED 且 DB 惰性落库为 EXPIRED
 *   A07 撤销后再接受                 → 409 NOT_PENDING 且 DB 为 REVOKED
 *   ── 移出 ────────────────────────────────────────────────────────────
 *   R01 移出自己                     → 409 SELF_REMOVE
 *   R02 移出成员                     → 200
 *   R03 DB：软移出                   → status=SUSPENDED，**行还在**（审计资源可解析）
 *   R04 被移出者的下一次请求         → 403（不需要等 JWT 过期）
 *   R05 再移出一次                   → 400 NOT_ACTIVE（"成功但没改"是谎报）
 *   R06 跨租户 membershipId          → 404（不是 403：403 会泄露 id 真实存在）
 *   R07 重新邀请并接受               → 200 reactivated=true；DB 成员行数不变（恢复同一行）
 *   R08 审计                         → invitation.created/accepted、membership.removed 齐备
 *
 * 用法：
 *   本地生产构建： node scripts/qa/verify-t07-org-lifecycle.mjs --base=http://localhost:3099
 *   生产：         node scripts/qa/verify-t07-org-lifecycle.mjs --base=https://app.lokfeel.com
 *
 * 凭据：**只用 QA 人格账号**，每个密码取 `.qa-credentials.local.json`（已在 .gitignore）：
 *   test.new   → testnewPassword   （建组织者，要求当前无任何成员关系）
 *   e2e-test   → e2e-testPassword  （被邀请者）
 *   test.male  → testmalePassword  （"别人"，用于 EMAIL_MISMATCH 与跨租户越权）
 * 缺任一密码 → 相关断言记 SKIP，**不允许**因为缺凭据而算 PASS。
 *
 * 残留：默认**保留**本轮创建的组织（审计证据在库里），最后打印 slug 与清理 SQL。
 *       传 `--cleanup` 才会删掉它（仅删本轮 slug 精确匹配的组织及其成员/邀请/审计）。
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@libsql/client'

const ROOT = path.resolve(import.meta.dirname, '../..')

function parseEnvFile(file) {
  const out = {}
  if (!fs.existsSync(file)) return out
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
  }
  return out
}

const env = { ...parseEnvFile(path.join(ROOT, '.env')), ...parseEnvFile(path.join(ROOT, '.env.local')) }

const argOf = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const flag = (name) => process.argv.includes(`--${name}`)

const BASE = argOf('base', env.QA_BASE_URL || 'https://app.lokfeel.com').replace(/\/$/, '')
const CLEANUP = flag('cleanup')

// ── 凭据 ────────────────────────────────────────────────────────────────
function localCreds() {
  const f = path.join(ROOT, '.qa-credentials.local.json')
  if (!fs.existsSync(f)) return {}
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'))
  } catch {
    return {}
  }
}
const local = localCreds()
const pw = (envKey, fileKey) => process.env[envKey] || local[fileKey] || null

const WHO = {
  owner: { email: 'test.new@lokfeel.com', password: pw('TEST_NEW_PASSWORD', 'testnewPassword') },
  invitee: { email: 'e2e-test@lokfeel.com', password: pw('E2E_TEST_PASSWORD', 'e2e-testPassword') },
  stranger: { email: 'test.male@lokfeel.com', password: pw('TEST_MALE_PASSWORD', 'testmalePassword') },
}

const db = env.DATABASE_URL
  ? createClient({ url: env.DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN })
  : null

const q = async (sql, args = []) => (await db.execute({ sql, args })).rows
const one = async (sql, args = []) => (await q(sql, args))[0] ?? null

// ── 断言框架 ────────────────────────────────────────────────────────────
const results = []
const check = (id, verdict, detail) => {
  results.push({ id, verdict, detail })
  const mark = verdict === 'PASS' ? '✓' : verdict === 'SKIP' ? '–' : '✗'
  console.log(`  ${mark} ${id.padEnd(38)} ${detail}`)
}

// ── HTTP ────────────────────────────────────────────────────────────────
async function login(who) {
  if (!who.password) return { status: 0, jar: '', reason: '无密码' }
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ email: who.email, password: who.password }),
    redirect: 'manual',
  })
  const jar = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  return { status: res.status, jar }
}

async function api(p, { method = 'GET', body, jar } = {}) {
  const headers = { Origin: BASE }
  if (jar) headers.Cookie = jar
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  })
  let json = null
  try {
    json = await res.json()
  } catch {
    /* 非 JSON（网关错误页等）：断言里体现为 null */
  }
  return { status: res.status, json }
}

const errCode = (r) => r.json?.error?.details?.code ?? r.json?.error?.code ?? null

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex')
}

// ── 主流程 ──────────────────────────────────────────────────────────────
async function main() {
  const runId = Date.now().toString(36)
  const slug = `e2e-b1-${runId}`

  console.log(`\n目标：${BASE}`)
  console.log(`本轮 slug：${slug}`)
  console.log(`数据库直查：${db ? '启用' : '未启用（DATABASE_URL 缺失，DB 断言将 SKIP）'}\n`)

  // ── 前置清理：删掉**本脚本历史上创建的** e2e 组织 ─────────────────────
  // 为什么必须先清：`GET /api/v1/org` 没有 organizationId 参数（设计如此，租户只从会话解析），
  // 它取「最早加入的 ACTIVE 成员关系」。同一个 QA 账号身上挂着上一轮的组织时，
  // C04 读到的会是上一轮那个组织 —— 断言看起来绿，实际测的是别人的租户。
  // 只删 slug 以 `e2e-b1-` 开头的组织（本脚本的命名空间），不碰任何真实租户。
  if (db) {
    const stale = await q(`SELECT id, slug FROM "Organization" WHERE slug LIKE 'e2e-b1-%'`)
    if (stale.length > 0) {
      for (const o of stale) {
        await db.execute({ sql: `DELETE FROM "OrganizationInvitation" WHERE organizationId = ?`, args: [o.id] })
        await db.execute({ sql: `DELETE FROM "Membership" WHERE organizationId = ?`, args: [o.id] })
        await db.execute({ sql: `DELETE FROM "TenantAuditEvent" WHERE organizationId = ?`, args: [o.id] })
        await db.execute({ sql: `DELETE FROM "Organization" WHERE id = ?`, args: [o.id] })
      }
      console.log(`前置清理：删除上一轮遗留的 e2e 组织 ${stale.length} 个（${stale.map((o) => o.slug).join(', ')}）`)
    }
  }

  const owner = await login(WHO.owner)
  const invitee = await login(WHO.invitee)
  const stranger = await login(WHO.stranger)

  console.log('会话：')
  console.log(`  owner   ${WHO.owner.email}   login=${owner.status}`)
  console.log(`  invitee ${WHO.invitee.email} login=${invitee.status}`)
  console.log(`  stranger ${WHO.stranger.email} login=${stranger.status}\n`)

  if (owner.status !== 200 || !owner.jar) {
    console.error('建组织者无法登录 —— 后续全部无法执行。请检查凭据与 BASE。')
    process.exit(2)
  }

  let orgId = null
  let ownerMembershipId = null
  let inviteeMembershipId = null
  let liveInvite = null // { id, token }
  // 租户作用域的调用一律显式带 organizationId：
  // 不传时 `resolveTenant()` 取「最早加入的 ACTIVE 成员关系」，同一个 QA 账号跑第二轮
  // 就会静默写进上一轮的组织里（2026-11-07 第二轮 E2E 正是这样把邀请写串了）。
  const withOrg = (p) => (orgId ? `${p}${p.includes('?') ? '&' : '?'}organizationId=${orgId}` : p)

  try {
    // ═══════════════ 建组织 ═══════════════
    console.log('[C] 建组织')
    const anonCreate = await api('/api/v1/organizations', { method: 'POST', body: { name: 'X', slug: 'x-anon' } })
    check('C01 匿名创建 → 401', anonCreate.status === 401 ? 'PASS' : 'FAIL', `status=${anonCreate.status}`)

    const created = await api('/api/v1/organizations', {
      method: 'POST',
      body: { name: `E2E B1 ${runId}`, slug },
      jar: owner.jar,
    })
    const org = created.json?.data?.organization
    orgId = org?.id ?? null
    ownerMembershipId = org?.membershipId ?? null
    check(
      'C02 创建 → 201/OWNER',
      created.status === 201 && org?.role === 'OWNER' ? 'PASS' : 'FAIL',
      `status=${created.status} role=${org?.role} id=${orgId}`,
    )

    if (db && orgId) {
      const ms = await q(
        `SELECT id, role, status FROM "Membership" WHERE organizationId = ?`,
        [orgId],
      )
      const owners = ms.filter((m) => m.role === 'OWNER' && m.status === 'ACTIVE')
      check(
        'C03 DB 恰好 1 条 ACTIVE OWNER',
        ms.length === 1 && owners.length === 1 ? 'PASS' : 'FAIL',
        `memberships=${ms.length} activeOwner=${owners.length}`,
      )
    } else {
      check('C03 DB 恰好 1 条 ACTIVE OWNER', 'SKIP', '无 DATABASE_URL')
    }

    const overview = await api('/api/v1/org', { jar: owner.jar })
    const caps = overview.json?.data?.capabilities ?? []
    const need = ['member.invite', 'member.remove', 'member.update_role', 'org.update']
    check(
      'C04 org 概览 → OWNER + 四项能力',
      overview.status === 200 && overview.json?.data?.myRole === 'OWNER' && need.every((c) => caps.includes(c))
        ? 'PASS'
        : 'FAIL',
      `status=${overview.status} myRole=${overview.json?.data?.myRole} 缺=${need.filter((c) => !caps.includes(c)).join(',') || '无'}`,
    )

    const retry = await api('/api/v1/organizations', {
      method: 'POST',
      body: { name: `E2E B1 ${runId}`, slug },
      jar: owner.jar,
    })
    let dedup = 'n/a'
    if (db && orgId) {
      const c = await one(`SELECT count(*) AS c FROM "Organization" WHERE slug = ?`, [slug])
      const m = await one(
        `SELECT count(*) AS c FROM "Membership" WHERE organizationId = ? AND userId = (SELECT id FROM "User" WHERE email = ?)`,
        [orgId, WHO.owner.email],
      )
      dedup = `orgs=${c.c} memberships=${m.c}`
      check(
        'C05 同 slug 重试 → 409 且不重复',
        retry.status === 409 && errCode(retry) === 'SLUG_TAKEN' && Number(c.c) === 1 && Number(m.c) === 1
          ? 'PASS'
          : 'FAIL',
        `status=${retry.status} code=${errCode(retry)} ${dedup}`,
      )
    } else {
      check('C05 同 slug 重试 → 409 且不重复', retry.status === 409 ? 'PASS' : 'FAIL', `status=${retry.status} code=${errCode(retry)} ${dedup}`)
    }

    const reserved = await api('/api/v1/organizations', {
      method: 'POST',
      body: { name: 'Claim Console', slug: 'console' },
      jar: owner.jar,
    })
    check(
      'C06 保留字 slug → 400',
      reserved.status === 400 && errCode(reserved) === 'SLUG_RESERVED' ? 'PASS' : 'FAIL',
      `status=${reserved.status} code=${errCode(reserved)}`,
    )

    if (db && orgId) {
      const ev = await q(`SELECT eventType FROM "TenantAuditEvent" WHERE organizationId = ?`, [orgId])
      const types = new Set(ev.map((r) => r.eventType))
      check(
        'C07 审计 organization+membership',
        types.has('organization.created') && types.has('membership.created') ? 'PASS' : 'FAIL',
        `events=${[...types].join(',')}`,
      )
    } else {
      check('C07 审计 organization+membership', 'SKIP', '无 DATABASE_URL')
    }

    // ═══════════════ 邀请 ═══════════════
    console.log('\n[I] 邀请')
    const inv1 = await api(withOrg('/api/v1/invitations'), {
      method: 'POST',
      body: { email: WHO.invitee.email, role: 'MEMBER' },
      jar: owner.jar,
    })
    const inv1d = inv1.json?.data
    const token1 = inv1d?.inviteUrl ? new URL(inv1d.inviteUrl).searchParams.get('token') : null
    liveInvite = token1 ? { id: inv1d.invitation?.id, token: token1 } : null
    check(
      'I01 邀请 → 201 + 链接',
      inv1.status === 201 && inv1d?.invitation?.status === 'PENDING' && Boolean(token1) && typeof inv1d?.emailSent === 'boolean'
        ? 'PASS'
        : 'FAIL',
      `status=${inv1.status} emailSent=${inv1d?.emailSent} token=${token1 ? `${token1.length}字符` : '缺失'}${inv1d?.emailError ? ` emailError=${inv1d.emailError}` : ''}`,
    )

    if (db && inv1d?.invitation?.id) {
      const row = await one(
        `SELECT tokenHash, status FROM "OrganizationInvitation" WHERE id = ?`,
        [inv1d.invitation.id],
      )
      check(
        'I02 DB 只存 token 哈希',
        row && row.tokenHash === sha256(token1) && row.tokenHash !== token1 ? 'PASS' : 'FAIL',
        `len(hash)=${row?.tokenHash?.length} 明文入库=${row?.tokenHash === token1}`,
      )
    } else {
      check('I02 DB 只存 token 哈希', 'SKIP', '无 DATABASE_URL')
    }

    // 换票：同邮箱再发一次
    const inv2 = await api(withOrg('/api/v1/invitations'), {
      method: 'POST',
      body: { email: WHO.invitee.email, role: 'OPERATOR' },
      jar: owner.jar,
    })
    const inv2d = inv2.json?.data
    const token2 = inv2d?.inviteUrl ? new URL(inv2d.inviteUrl).searchParams.get('token') : null
    if (inv2.status === 201 && token2) liveInvite = { id: inv2d.invitation?.id, token: token2 }
    if (db && inv1d?.invitation?.id) {
      const old = await one(`SELECT status FROM "OrganizationInvitation" WHERE id = ?`, [inv1d.invitation.id])
      check(
        'I03 重复邀请 → 换票（旧票 REVOKED）',
        inv2.status === 201 && old?.status === 'REVOKED' ? 'PASS' : 'FAIL',
        `旧票=${old?.status} 新票 role=${inv2d?.invitation?.role}`,
      )
    } else {
      check('I03 重复邀请 → 换票（旧票 REVOKED）', inv2.status === 201 ? 'PASS' : 'FAIL', `status=${inv2.status}`)
    }

    const dup = await api(withOrg('/api/v1/invitations'), {
      method: 'POST',
      body: { email: WHO.owner.email, role: 'MEMBER' },
      jar: owner.jar,
    })
    check(
      'I04 邀请已是成员 → 409',
      dup.status === 409 && errCode(dup) === 'ALREADY_MEMBER' ? 'PASS' : 'FAIL',
      `status=${dup.status} code=${errCode(dup)}`,
    )

    const ownerGrant = await api(withOrg('/api/v1/invitations'), {
      method: 'POST',
      body: { email: `x-${runId}@example.com`, role: 'OWNER' },
      jar: owner.jar,
    })
    check(
      'I05 邀请授予 OWNER → 403',
      ownerGrant.status === 403 && errCode(ownerGrant) === 'OWNER_GRANT_FORBIDDEN' ? 'PASS' : 'FAIL',
      `status=${ownerGrant.status} code=${errCode(ownerGrant)}`,
    )

    const badEmail = await api(withOrg('/api/v1/invitations'), {
      method: 'POST',
      body: { email: 'not-an-email', role: 'MEMBER' },
      jar: owner.jar,
    })
    check(
      'I06 非法邮箱 → 400',
      badEmail.status === 400 && errCode(badEmail) === 'INVALID_EMAIL' ? 'PASS' : 'FAIL',
      `status=${badEmail.status} code=${errCode(badEmail)}`,
    )

    if (stranger.jar && orgId) {
      const leak = await api(withOrg('/api/v1/invitations'), { jar: stranger.jar })
      const leak2 = await api(withOrg('/api/v1/members'), { jar: stranger.jar })
      check(
        'I07 非成员带 orgId → 403',
        leak.status === 403 && leak2.status === 403 ? 'PASS' : 'FAIL',
        `invitations=${leak.status} members=${leak2.status}`,
      )
    } else {
      check('I07 非成员带 orgId → 403', 'SKIP', '缺少 stranger 会话或 orgId')
    }

    // ═══════════════ 接受 ═══════════════
    console.log('\n[A] 接受')
    const anonAccept = await api('/api/v1/invitations/accept', { method: 'POST', body: { token: liveInvite?.token } })
    check('A01 匿名 accept → 401', anonAccept.status === 401 ? 'PASS' : 'FAIL', `status=${anonAccept.status}`)

    if (stranger.jar && liveInvite) {
      const wrong = await api('/api/v1/invitations/accept', {
        method: 'POST',
        body: { token: liveInvite.token },
        jar: stranger.jar,
      })
      let stillPending = 'n/a'
      if (db && liveInvite.id) {
        const r = await one(`SELECT status FROM "OrganizationInvitation" WHERE id = ?`, [liveInvite.id])
        stillPending = r?.status
      }
      check(
        'A02 别人拿链接 → 403 且票未消费',
        wrong.status === 403 && errCode(wrong) === 'EMAIL_MISMATCH' && (stillPending === 'PENDING' || stillPending === 'n/a')
          ? 'PASS'
          : 'FAIL',
        `status=${wrong.status} code=${errCode(wrong)} 票=${stillPending}`,
      )
    } else {
      check('A02 别人拿链接 → 403 且票未消费', 'SKIP', '缺少 stranger 会话')
    }

    if (invitee.status !== 200 || !invitee.jar) {
      check('A03 本人接受 → 200', 'SKIP', `invitee 登录失败 status=${invitee.status}`)
    } else {
      const ok = await api('/api/v1/invitations/accept', {
        method: 'POST',
        body: { token: liveInvite?.token },
        jar: invitee.jar,
      })
      const d = ok.json?.data
      let dbState = 'n/a'
      if (db && orgId) {
        const m = await one(
          `SELECT m.id, m.role, m.status FROM "Membership" m JOIN "User" u ON u.id = m.userId
           WHERE m.organizationId = ? AND u.email = ?`,
          [orgId, WHO.invitee.email],
        )
        inviteeMembershipId = m?.id ?? null
        const i = await one(`SELECT status, acceptedAt, acceptedBy FROM "OrganizationInvitation" WHERE id = ?`, [liveInvite?.id])
        dbState = `membership=${m?.role}/${m?.status} 票=${i?.status} acceptedAt=${i?.acceptedAt ? '有' : '无'}`
      }
      check(
        'A03 本人接受 → 200 + 入库',
        ok.status === 200 &&
          d?.role === 'OPERATOR' &&
          d?.reactivated === false &&
          (dbState === 'n/a' || dbState.includes('OPERATOR/ACTIVE')) &&
          (dbState === 'n/a' || dbState.includes('票=ACCEPTED'))
          ? 'PASS'
          : 'FAIL',
        `status=${ok.status} role=${d?.role} reactivated=${d?.reactivated} ${dbState}`,
      )

      const again = await api('/api/v1/invitations/accept', {
        method: 'POST',
        body: { token: liveInvite?.token },
        jar: invitee.jar,
      })
      check(
        'A04 同一 token 再接受 → 409',
        again.status === 409 && errCode(again) === 'NOT_PENDING' ? 'PASS' : 'FAIL',
        `status=${again.status} code=${errCode(again)}`,
      )
    }

    const forged = await api('/api/v1/invitations/accept', {
      method: 'POST',
      body: { token: `forged-${runId}` },
      jar: invitee.jar || owner.jar,
    })
    check(
      'A05 伪造 token → 404',
      forged.status === 404 && errCode(forged) === 'INVALID_TOKEN' ? 'PASS' : 'FAIL',
      `status=${forged.status} code=${errCode(forged)}`,
    )

    // 过期票：造一条再把它改成过期
    const expInv = await api(withOrg('/api/v1/invitations'), {
      method: 'POST',
      body: { email: WHO.stranger.email, role: 'MEMBER' },
      jar: owner.jar,
    })
    const expToken = expInv.json?.data?.inviteUrl
      ? new URL(expInv.json.data.inviteUrl).searchParams.get('token')
      : null
    const expId = expInv.json?.data?.invitation?.id ?? null
    if (db && expId && expToken && stranger.jar) {
      await db.execute({
        sql: `UPDATE "OrganizationInvitation" SET expiresAt = ? WHERE id = ?`,
        args: [new Date(Date.now() - 60_000).toISOString(), expId],
      })
      const expired = await api('/api/v1/invitations/accept', {
        method: 'POST',
        body: { token: expToken },
        jar: stranger.jar,
      })
      const after = await one(`SELECT status FROM "OrganizationInvitation" WHERE id = ?`, [expId])
      check(
        'A06 过期票 → 409 且落库 EXPIRED',
        expired.status === 409 && errCode(expired) === 'EXPIRED' && after?.status === 'EXPIRED' ? 'PASS' : 'FAIL',
        `status=${expired.status} code=${errCode(expired)} DB=${after?.status}`,
      )
    } else {
      check('A06 过期票 → 409 且落库 EXPIRED', 'SKIP', '无数据库/无 stranger 会话/无票')
    }

    // 撤销后接受
    const revInv = await api(withOrg('/api/v1/invitations'), {
      method: 'POST',
      body: { email: WHO.stranger.email, role: 'MEMBER' },
      jar: owner.jar,
    })
    const revToken = revInv.json?.data?.inviteUrl
      ? new URL(revInv.json.data.inviteUrl).searchParams.get('token')
      : null
    const revId = revInv.json?.data?.invitation?.id ?? null
    if (revId && revToken && stranger.jar) {
      const revoked = await api(withOrg(`/api/v1/invitations/${revId}`), { method: 'DELETE', jar: owner.jar })
      const useAfterRevoke = await api('/api/v1/invitations/accept', {
        method: 'POST',
        body: { token: revToken },
        jar: stranger.jar,
      })
      let dbStatus = 'n/a'
      if (db) {
        const r = await one(`SELECT status FROM "OrganizationInvitation" WHERE id = ?`, [revId])
        dbStatus = r?.status
      }
      check(
        'A07 撤销后接受 → 409 且 REVOKED',
        revoked.status === 200 &&
          useAfterRevoke.status === 409 &&
          errCode(useAfterRevoke) === 'NOT_PENDING' &&
          (dbStatus === 'REVOKED' || dbStatus === 'n/a')
          ? 'PASS'
          : 'FAIL',
        `DELETE=${revoked.status} accept=${useAfterRevoke.status}/${errCode(useAfterRevoke)} DB=${dbStatus}`,
      )
    } else {
      check('A07 撤销后接受 → 409 且 REVOKED', 'SKIP', '无法创建待撤销的邀请')
    }

    // ═══════════════ 移出 ═══════════════
    console.log('\n[R] 移出')
    if (!inviteeMembershipId) {
      for (const id of ['R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07']) {
        check(`${id} 移出相关断言`, 'SKIP', '缺少被邀请者的 membershipId（A03 未成功）')
      }
    } else {
      if (ownerMembershipId) {
        const self = await api(withOrg(`/api/v1/members/${ownerMembershipId}`), { method: 'DELETE', jar: owner.jar })
        check(
          'R01 移出自己 → 409',
          self.status === 409 && errCode(self) === 'SELF_REMOVE' ? 'PASS' : 'FAIL',
          `status=${self.status} code=${errCode(self)}`,
        )
      } else {
        check('R01 移出自己 → 409', 'SKIP', '缺少 ownerMembershipId')
      }

      const removed = await api(withOrg(`/api/v1/members/${inviteeMembershipId}`), { method: 'DELETE', jar: owner.jar })
      check(
        'R02 移出成员 → 200',
        removed.status === 200 ? 'PASS' : 'FAIL',
        `status=${removed.status} code=${errCode(removed)}`,
      )

      if (db) {
        const row = await one(`SELECT role, status FROM "Membership" WHERE id = ?`, [inviteeMembershipId])
        check(
          'R03 软移出（行仍在/SUSPENDED）',
          row && row.status === 'SUSPENDED' && row.role === 'OPERATOR' ? 'PASS' : 'FAIL',
          `role=${row?.role} status=${row?.status}`,
        )
      } else {
        check('R03 软移出（行仍在/SUSPENDED）', 'SKIP', '无 DATABASE_URL')
      }

      if (invitee.jar) {
        const after = await api(withOrg('/api/v1/members'), { jar: invitee.jar })
        const orgRead = await api('/api/v1/org', { jar: invitee.jar })
        check(
          'R04 被移出者下一次请求 → 403',
          after.status === 403 && orgRead.status === 403 ? 'PASS' : 'FAIL',
          `members=${after.status} org=${orgRead.status}`,
        )
      } else {
        check('R04 被移出者下一次请求 → 403', 'SKIP', '无 invitee 会话')
      }

      const twice = await api(withOrg(`/api/v1/members/${inviteeMembershipId}`), { method: 'DELETE', jar: owner.jar })
      check(
        'R05 再移出一次 → 400 NOT_ACTIVE',
        twice.status === 400 && errCode(twice) === 'NOT_ACTIVE' ? 'PASS' : 'FAIL',
        `status=${twice.status} code=${errCode(twice)}`,
      )

      // 跨租户：拿 default 组织的成员 id 来删
      let foreignId = null
      if (db) {
        const r = await one(
          `SELECT m.id FROM "Membership" m JOIN "Organization" o ON o.id = m.organizationId
           WHERE o.slug = 'default' AND m.organizationId <> ? LIMIT 1`,
          [orgId],
        )
        foreignId = r?.id ?? null
      }
      if (foreignId) {
        const cross = await api(withOrg(`/api/v1/members/${foreignId}`), { method: 'DELETE', jar: owner.jar })
        check(
          'R06 跨租户 id → 404（不泄露存在性）',
          cross.status === 404 ? 'PASS' : 'FAIL',
          `status=${cross.status} code=${errCode(cross)}`,
        )
        if (db) {
          const still = await one(`SELECT status FROM "Membership" WHERE id = ?`, [foreignId])
          check(
            'R06b 他租户成员未被改动',
            still?.status === 'ACTIVE' ? 'PASS' : 'FAIL',
            `status=${still?.status}`,
          )
        }
      } else {
        check('R06 跨租户 id → 404（不泄露存在性）', 'SKIP', '拿不到他租户的 membershipId')
      }

      // 重新邀请 → 恢复同一行（软移出的核心收益）
      const reinv = await api(withOrg('/api/v1/invitations'), {
        method: 'POST',
        body: { email: WHO.invitee.email, role: 'MEMBER' },
        jar: owner.jar,
      })
      const reinvToken = reinv.json?.data?.inviteUrl
        ? new URL(reinv.json.data.inviteUrl).searchParams.get('token')
        : null
      if (reinvToken && invitee.jar) {
        const accept = await api('/api/v1/invitations/accept', {
          method: 'POST',
          body: { token: reinvToken },
          jar: invitee.jar,
        })
        const d = accept.json?.data
        let rows = null
        if (db) {
          const c = await one(
            `SELECT count(*) AS c FROM "Membership" m JOIN "User" u ON u.id = m.userId
             WHERE m.organizationId = ? AND u.email = ?`,
            [orgId, WHO.invitee.email],
          )
          rows = Number(c.c)
        }
        check(
          'R07 重新邀请 → reactivated + 行数不变',
          accept.status === 200 && d?.reactivated === true && (rows === null || rows === 1) ? 'PASS' : 'FAIL',
          `status=${accept.status} reactivated=${d?.reactivated} 成员行数=${rows}`,
        )

        // 收尾：再次移出，避免把本轮测试成员留在新组织里
        await api(withOrg(`/api/v1/members/${inviteeMembershipId}`), { method: 'DELETE', jar: owner.jar })
      } else {
        check('R07 重新邀请 → reactivated + 行数不变', 'SKIP', '重新邀请未取到 token')
      }
    }

    // ═══════════════ 审计 ═══════════════
    if (db && orgId) {
      const ev = await q(
        `SELECT eventType, count(*) AS c FROM "TenantAuditEvent" WHERE organizationId = ? GROUP BY eventType`,
        [orgId],
      )
      const map = Object.fromEntries(ev.map((r) => [r.eventType, Number(r.c)]))
      const need = ['organization.created', 'membership.created', 'invitation.created', 'invitation.accepted', 'invitation.revoked', 'membership.removed']
      const missing = need.filter((k) => !map[k])
      check('R08 审计事件齐备', missing.length === 0 ? 'PASS' : 'FAIL', `${JSON.stringify(map)}`)
    } else {
      check('R08 审计事件齐备', 'SKIP', '无 DATABASE_URL')
    }
  } finally {
    // ── 清理（默认不删：审计证据留在库里） ──
    if (CLEANUP && db && orgId) {
      try {
        await db.execute({ sql: `DELETE FROM "OrganizationInvitation" WHERE organizationId = ?`, args: [orgId] })
        await db.execute({ sql: `DELETE FROM "Membership" WHERE organizationId = ?`, args: [orgId] })
        await db.execute({ sql: `DELETE FROM "TenantAuditEvent" WHERE organizationId = ?`, args: [orgId] })
        await db.execute({ sql: `DELETE FROM "Organization" WHERE id = ?`, args: [orgId] })
        const left = await one(`SELECT count(*) AS c FROM "Organization" WHERE id = ?`, [orgId])
        console.log(`\n清理：组织 ${orgId} 已删除（残留=${left.c}）`)
      } catch (err) {
        console.log(`\n清理失败（不影响上面断言）：${err?.message ?? err}`)
      }
    } else if (orgId) {
      console.log(`\n本轮组织保留：id=${orgId} slug=${slug}`)
      console.log('  清理 SQL（如需）：')
      console.log(`    DELETE FROM "OrganizationInvitation" WHERE organizationId='${orgId}';`)
      console.log(`    DELETE FROM "Membership" WHERE organizationId='${orgId}';`)
      console.log(`    DELETE FROM "TenantAuditEvent" WHERE organizationId='${orgId}';`)
      console.log(`    DELETE FROM "Organization" WHERE id='${orgId}';`)
    }
  }

  const pass = results.filter((r) => r.verdict === 'PASS').length
  const fail = results.filter((r) => r.verdict === 'FAIL').length
  const skip = results.filter((r) => r.verdict === 'SKIP').length
  console.log(`\n${pass} PASS / ${fail} FAIL / ${skip} SKIP`)
  if (fail > 0) {
    console.log('\n失败项：')
    for (const r of results.filter((x) => x.verdict === 'FAIL')) console.log(`  - ${r.id}: ${r.detail}`)
  }
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('复验脚本异常：', err?.message ?? err)
  process.exit(2)
})
