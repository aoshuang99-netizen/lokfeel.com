#!/usr/bin/env node
/**
 * T07 · 成员角色写路径 —— 生产复验（`PATCH /api/v1/members/[membershipId]`）
 *
 * 为什么单测不够：单测直接 import handler，`params` 不参与真实路由匹配，Cookie 也不存在。
 * 「路由真的挂在 /api/v1/members/<id> 上」「__Secure- cookie 能过守卫」「能力关卡在生产生效」
 * 这三件事只能在部署后的生产上证明。
 *
 * 断言（每条都能独立失败）：
 *   P01 匿名 PATCH                → 401 + JSON（路由存在，不是 404）
 *   P02 OPERATOR 发起             → 403（member.update_role = ADMIN+）
 *   P03 ADMIN 改自己              → 409 SELF_ROLE_CHANGE（不变量在生产可达）
 *   P04 ADMIN 授予 OWNER          → 403（所有权只能走 org.transfer）
 *   P05 ADMIN 降级 OPERATOR       → 200 且回读为 MEMBER（真实写入）
 *   P06 还原（MEMBER → OPERATOR） → 200 且回读为 OPERATOR（**本轮不留残留**）
 *   P07 非法角色                  → 400（校验在生产生效）
 *   P08 审计                      → 两条 membership.role_changed 落库（直查 DB）
 *
 * 用法：
 *   node scripts/qa/verify-member-role-prod.mjs --base=https://app.lokfeel.com
 *   QA_PASSWORD=... ADMIN_PASSWORD=... node scripts/qa/verify-member-role-prod.mjs
 *
 * 凭据：QA 密码取 `QA_PASSWORD` 或 `.qa-credentials.local.json`；
 *       ADMIN 密码取 `ADMIN_PASSWORD`（不落库、不写进本文件）。
 *       缺 ADMIN 密码时，P03~P06 记 SKIP 而不是 PASS —— 没跑过就不许算绿。
 *
 * 安全：只动 **QA 账号**（qa.female）的角色，且 finally 里还原；不碰 OWNER，不建成员。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@libsql/client'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function parseEnv(file) {
  const out = {}
  if (!fs.existsSync(file)) return out
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
  }
  return out
}

const env = { ...parseEnv(path.join(ROOT, '.env')), ...parseEnv(path.join(ROOT, '.env.local')) }
const argOf = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const BASE = argOf('base', env.QA_BASE_URL || 'https://app.lokfeel.com').replace(/\/$/, '')

function localPassword() {
  if (process.env.QA_PASSWORD) return process.env.QA_PASSWORD
  const f = path.join(ROOT, '.qa-credentials.local.json')
  if (!fs.existsSync(f)) return null
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'))
    return j.password || null
  } catch {
    return null
  }
}

const QA_PASSWORD = localPassword()
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || null

/**
 * 目标组织：默认 `default`。
 *
 * 🔴 必须显式传 `organizationId`：`admin@lokfeel.com` 同时是 `preview` 的 ADMIN，
 *    而 `resolveTenant()` 在未指定租户时取「最早加入的 ACTIVE 成员关系」——
 *    对 admin 来说那是 `preview`，不是 `default`。不显式指定就会在错误的租户里找成员，
 *    表现为"目标行不存在"（第一次跑正是这么 SKIP 的）。
 */
const ORG_SLUG = argOf('org', 'default')

let orgId = null
if (env.DATABASE_URL) {
  const db = createClient({ url: env.DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN })
  const r = await db.execute({
    sql: 'SELECT id FROM "Organization" WHERE slug = ?',
    args: [ORG_SLUG],
  })
  orgId = r.rows[0]?.id ?? null
}
const withOrg = (p) => (orgId ? `${p}${p.includes('?') ? '&' : '?'}organizationId=${orgId}` : p)

const results = []
const check = (id, verdict, detail) => {
  results.push({ id, verdict, detail })
  console.log(`  ${verdict === 'PASS' ? '✓' : verdict === 'SKIP' ? '–' : '✗'} ${id.padEnd(34)} ${detail}`)
}

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ email, password }),
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
    /* 非 JSON（网关错误页等）—— 断言里体现为 null */
  }
  return { status: res.status, json, contentType: res.headers.get('content-type') ?? '' }
}

const errCode = (r) => r.json?.error?.details?.code ?? r.json?.error?.code ?? null

async function main() {
  console.log(`\n生产：${BASE}\n`)

  // ── P01 匿名 ────────────────────────────────────────────────────────
  const anon = await api('/api/v1/members/ms_probe', { method: 'PATCH', body: { role: 'ADMIN' } })
  check('P01 匿名 → 401', anon.status === 401 ? 'PASS' : 'FAIL', `status=${anon.status}`)

  if (!QA_PASSWORD) {
    check('P02 OPERATOR → 403', 'SKIP', '缺少 QA 密码')
  } else {
    const male = await login('qa.male@lokfeel.com', QA_PASSWORD)
    if (male.status !== 200 || !male.jar) {
      check('P02 OPERATOR → 403', 'SKIP', `qa.male 登录失败 status=${male.status}`)
    } else {
      const listed = await api(withOrg('/api/v1/members?pageSize=100'), { jar: male.jar })
      const all = listed.json?.data ?? []
      const me = all.find((m) => m.email === 'qa.male@lokfeel.com')
      const female = all.find((m) => m.email === 'qa.female@lokfeel.com')

      const op = await api(withOrg(`/api/v1/members/${female?.membershipId ?? 'x'}`), {
        method: 'PATCH',
        body: { role: 'ADMIN' },
        jar: male.jar,
      })
      check('P02 OPERATOR → 403', op.status === 403 ? 'PASS' : 'FAIL', `status=${op.status}`)

      // ── ADMIN 段 ────────────────────────────────────────────────────
      if (!ADMIN_PASSWORD) {
        for (const id of ['P03 改自己 → 409', 'P04 授予 OWNER → 403', 'P05 降级 → 200', 'P06 还原 → 200']) {
          check(id, 'SKIP', '缺少 ADMIN_PASSWORD')
        }
      } else {
        const admin = await login('admin@lokfeel.com', ADMIN_PASSWORD)
        if (admin.status !== 200 || !admin.jar) {
          for (const id of ['P03 改自己 → 409', 'P04 授予 OWNER → 403', 'P05 降级 → 200', 'P06 还原 → 200']) {
            check(id, 'SKIP', `admin 登录失败 status=${admin.status}`)
          }
        } else {
          const l2 = await api(withOrg('/api/v1/members?pageSize=100'), { jar: admin.jar })
          const rows = l2.json?.data ?? []
          const adminSelf = rows.find((m) => m.email === 'admin@lokfeel.com')
          const target = rows.find((m) => m.email === 'qa.female@lokfeel.com')

          if (!adminSelf || !target) {
            for (const id of ['P03 改自己 → 409', 'P04 授予 OWNER → 403', 'P05 降级 → 200', 'P06 还原 → 200']) {
              check(id, 'SKIP', `找不到目标行（admin=${!!adminSelf} qa.female=${!!target}）`)
            }
          } else {
            const self = await api(withOrg(`/api/v1/members/${adminSelf.membershipId}`), {
              method: 'PATCH',
              body: { role: 'OPERATOR' },
              jar: admin.jar,
            })
            check(
              'P03 改自己 → 409',
              self.status === 409 && errCode(self) === 'SELF_ROLE_CHANGE' ? 'PASS' : 'FAIL',
              `status=${self.status} code=${errCode(self)}`
            )

            const grantOwner = await api(withOrg(`/api/v1/members/${target.membershipId}`), {
              method: 'PATCH',
              body: { role: 'OWNER' },
              jar: admin.jar,
            })
            check(
              'P04 授予 OWNER → 403',
              grantOwner.status === 403 ? 'PASS' : 'FAIL',
              `status=${grantOwner.status}`
            )

            const bad = await api(withOrg(`/api/v1/members/${target.membershipId}`), {
              method: 'PATCH',
              body: { role: 'superuser' },
              jar: admin.jar,
            })
            check('P07 非法角色 → 400', bad.status === 400 ? 'PASS' : 'FAIL', `status=${bad.status}`)

            const before = target.role
            let demoted = false
            try {
              const down = await api(withOrg(`/api/v1/members/${target.membershipId}`), {
                method: 'PATCH',
                body: { role: 'MEMBER' },
                jar: admin.jar,
              })
              demoted = down.status === 200
              const after = await api(withOrg('/api/v1/members?pageSize=100'), { jar: admin.jar })
              const now = (after.json?.data ?? []).find((m) => m.email === 'qa.female@lokfeel.com')
              check(
                'P05 降级 → 200',
                demoted && now?.role === 'MEMBER' ? 'PASS' : 'FAIL',
                `status=${down.status} 回读 role=${now?.role}（原 ${before}）`
              )
            } finally {
              if (demoted) {
                const up = await api(withOrg(`/api/v1/members/${target.membershipId}`), {
                  method: 'PATCH',
                  body: { role: before },
                  jar: admin.jar,
                })
                const after2 = await api(withOrg('/api/v1/members?pageSize=100'), { jar: admin.jar })
                const now2 = (after2.json?.data ?? []).find((m) => m.email === 'qa.female@lokfeel.com')
                check(
                  'P06 还原 → 200',
                  up.status === 200 && now2?.role === before ? 'PASS' : 'FAIL',
                  `status=${up.status} 回读 role=${now2?.role}`
                )
              } else {
                check('P06 还原 → 200', 'SKIP', 'P05 未成功，无需还原（也不会留下残留）')
              }
            }

            // ── P08 审计直查 ──────────────────────────────────────────
            if (env.DATABASE_URL) {
              const db = createClient({ url: env.DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN })
              const r = await db.execute({
                sql: `SELECT safeMetadata, createdAt FROM "TenantAuditEvent"
                      WHERE resourceId = ? AND eventType = 'membership.role_changed'
                      ORDER BY createdAt DESC LIMIT 4`,
                args: [target.membershipId],
              })
              const metas = r.rows.map((x) => {
                try {
                  return JSON.parse(String(x.safeMetadata))
                } catch {
                  return {}
                }
              })
              const roundTrip =
                metas.some((m) => m.from === before && m.to === 'MEMBER') &&
                metas.some((m) => m.from === 'MEMBER' && m.to === before)
              check(
                'P08 审计两条（去+回）',
                roundTrip ? 'PASS' : 'FAIL',
                `样本=${metas.length} ${JSON.stringify(metas.slice(0, 2))}`
              )
            } else {
              check('P08 审计两条（去+回）', 'SKIP', '无 DATABASE_URL')
            }
          }
        }
      }
      void me
    }
  }

  const pass = results.filter((r) => r.verdict === 'PASS').length
  const fail = results.filter((r) => r.verdict === 'FAIL').length
  const skip = results.filter((r) => r.verdict === 'SKIP').length
  console.log(`\n${pass} PASS / ${fail} FAIL / ${skip} SKIP`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('复验脚本异常:', err?.message ?? err)
  process.exit(2)
})
