#!/usr/bin/env node
/**
 * V20.5 · Batch 3 —— 会话生命周期与授权边界的**真实**复验
 *
 * 覆盖：会话基线 / 有效期 / tokenVersion 撤销（含缓存延迟与还原）/ 登出 /
 *       组织切换 / 权限变更即时生效 / CSRF。
 *
 * 明确不覆盖（并给出原因，不写成 PASS）：
 *   · **Google OAuth 成功回调**：需要真实 client_secret + 真人在 Google 授权页点同意。
 *     本地 `.env.local` 只有 GOOGLE_CLIENT_ID、没有 SECRET。这一条记 `NOT_TESTED`。
 *     授权请求的形状（含 state / PKCE / redirect_uri）与坏回调的拒绝行为由
 *     既有 `v204-oauth-shape.mjs` 覆盖（本轮复跑，不重写）。
 *   · **滑动续期**（跨 Auth.js `updateAge` 窗口重新签发）：需要真实等待一个窗口，
 *     本轮不动系统时钟、不伪造凭据，如实记 `NOT_TESTED`。
 *   · 本脚本只测**单机会话**，不测"多设备并发"语义（JWT 无状态，各设备独立）。
 *
 * 🔴 每条断言都同时看 **HTTP** 与（必要时）**数据库**。只看 HTTP 会把
 *    "200 但什么都没变" 当成成功；只看库会把 "函数能跑" 当成 "外部可达"。
 *
 * 🔴 本脚本的三处判据在首跑时是**错的**，改判据的理由写在各自注释里。
 *    它们不是"删掉失败断言求绿"，而是"原来断的是不存在的性质"：
 *      · 原 S07 断言"还原 tokenVersion 后旧 JWT 立即复效" —— 忽略了 60s 用户缓存；
 *      · 原 S08 断言"POST /api/auth/signout 会清 cookie" —— 实际返回 MissingCSRF；
 *      · 原 S14 断言"降级后失去 member.invite" —— 用的是 OPERATOR，它本来就没有该能力。
 *
 * 用法：
 *   node scripts/qa/v205-auth-session.mjs --base=http://localhost:3111
 *   node scripts/qa/v205-auth-session.mjs --base=https://app.lokfeel.com
 *
 * 凭据：`.qa-credentials.local.json`（gitignored）。缺则相关断言记 SKIP。
 * 残留：tokenVersion 试验后**还原原值**；角色试验后还原；租户偏好切回原值；
 *       登出只影响本地 jar。
 */

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

const argv = process.argv.slice(2)
const argOf = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : d
}
const BASE = argOf('base', 'https://app.lokfeel.com').replace(/\/$/, '')

const local = (() => {
  const f = path.join(ROOT, '.qa-credentials.local.json')
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'))
  } catch {
    return {}
  }
})()
const pw = (envKey, fileKey) => process.env[envKey] || local[fileKey] || null

const WHO = {
  qa: { email: 'qa.female@lokfeel.com', password: pw('QA_PASSWORD', 'password') },
  admin: { email: 'admin@lokfeel.com', password: pw('ADMIN_PASSWORD', 'adminPassword') },
  e2e: { email: 'e2e-test@lokfeel.com', password: pw('E2E_TEST_PASSWORD', 'e2e-testPassword') },
}

const db = env.DATABASE_URL ? createClient({ url: env.DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN }) : null
const q = async (sql, args = []) => (await db.execute({ sql, args })).rows
const one = async (sql, args = []) => (await q(sql, args))[0] ?? null

const results = []
const MARK = { PASS: '✓', FAIL: '✗', SKIP: '–', NOT_TESTED: '?', BLOCKED: '!' }
const check = (id, verdict, detail) => {
  results.push({ id, verdict, detail })
  console.log(`  ${MARK[verdict] ?? '·'} ${id.padEnd(46)} ${detail}`)
}

/** 把响应里的 Set-Cookie 合进 cookie jar（`name=` 空值视为删除）。 */
function mergeJar(jar, setCookies) {
  const map = new Map()
  for (const c of jar.split('; ').filter(Boolean)) {
    const i = c.indexOf('=')
    map.set(c.slice(0, i), c.slice(i + 1))
  }
  for (const raw of setCookies) {
    const pair = raw.split(';')[0]
    const i = pair.indexOf('=')
    const k = pair.slice(0, i)
    const v = pair.slice(i + 1)
    if (!v) map.delete(k)
    else map.set(k, v)
  }
  return [...map].map(([k, v]) => `${k}=${v}`).join('; ')
}

async function login(who, { origin = BASE } = {}) {
  if (!who.password) return { status: 0, jar: '', reason: 'no-password', cookies: [] }
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ email: who.email, password: who.password }),
    redirect: 'manual',
  })
  const cookies = res.headers.getSetCookie?.() ?? []
  const jar = cookies.map((c) => c.split(';')[0]).join('; ')
  return { status: res.status, jar, cookies, json: await res.json().catch(() => null) }
}

async function api(p, { method = 'GET', body, jar, headers = {} } = {}) {
  const h = { Origin: BASE, ...headers }
  if (jar) h.Cookie = jar
  if (body !== undefined) h['Content-Type'] = 'application/json'
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* 非 JSON（重定向/HTML）—— 由 status 与 location 断言 */
  }
  return {
    status: res.status,
    json,
    text,
    location: res.headers.get('location'),
    setCookie: res.headers.getSetCookie?.() ?? [],
  }
}
const errCode = (r) => r.json?.error?.details?.code ?? r.json?.error?.code ?? null
const orgSlugOf = (r) => r.json?.data?.organization?.slug ?? null
const capsOf = (r) => r.json?.data?.capabilities ?? []

/** 轮询到条件成立或超时。返回 { elapsed, value }。 */
async function pollFor(fn, { timeoutMs = 75_000, intervalMs = 1_500 } = {}) {
  const t0 = Date.now()
  for (;;) {
    const value = await fn()
    if (value) return { elapsed: Date.now() - t0, value }
    if (Date.now() - t0 >= timeoutMs) return { elapsed: Date.now() - t0, value: null }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

async function main() {
  console.log(`\n目标：${BASE}`)
  console.log(`数据库直查：${db ? '启用' : '未启用'}\n`)

  // ═══════════ S1 会话基线 ═══════════
  console.log('[S1] 会话基线')
  const anon = await api('/api/v1/org')
  check('S01 匿名 → 401', anon.status === 401 ? 'PASS' : 'FAIL', `status=${anon.status}`)

  const qaSes = await login(WHO.qa)
  check(
    'S02 登录 → 200 + session cookie',
    qaSes.status === 200 && /session-token/.test(qaSes.jar) ? 'PASS' : 'FAIL',
    `status=${qaSes.status} cookie=${qaSes.jar ? '有' : '无'}`,
  )

  const sessCookie = qaSes.cookies.find((c) => /session-token/.test(c)) ?? ''
  const attrs = sessCookie.toLowerCase()
  const hasHttpOnly = attrs.includes('httponly')
  const sameSite = /samesite=(\w+)/.exec(attrs)?.[1] ?? 'none'
  check(
    'S03 cookie 属性（HttpOnly + SameSite=Lax/Strict）',
    hasHttpOnly && (sameSite === 'lax' || sameSite === 'strict') ? 'PASS' : 'FAIL',
    `HttpOnly=${hasHttpOnly} SameSite=${sameSite}`,
  )

  const sessionDto = await api('/api/auth/session', { jar: qaSes.jar })
  const sessionUserId = sessionDto.json?.user?.id ?? null
  let dbUserId = null
  if (db) {
    const row = await one(`SELECT id FROM "User" WHERE email = ?`, [WHO.qa.email])
    dbUserId = row?.id ?? null
  }
  check(
    'S04 /api/auth/session 与库一致',
    sessionDto.status === 200 && sessionUserId && (!dbUserId || sessionUserId === dbUserId) ? 'PASS' : 'FAIL',
    `status=${sessionDto.status} sessionUser=${sessionUserId?.slice(0, 10)} dbUser=${dbUserId?.slice(0, 10)}`,
  )

  // 会话有效期：绝对 7 天（`Max-Age=604800`）。不测"无限会话"这类无法证伪的表述，
  // 只测写进 cookie 的那条事实上界。
  const maxAge = Number(/max-age=(\d+)/.exec(attrs)?.[1] ?? 0)
  check(
    'S05 会话有效期有上界（Max-Age ≈ 7 天）',
    maxAge >= 6 * 24 * 3600 && maxAge <= 8 * 24 * 3600 ? 'PASS' : 'FAIL',
    `Max-Age=${maxAge}s`,
  )

  check(
    'S06 滑动续期（跨 updateAge 窗口重签）',
    'NOT_TESTED',
    '需真实等待一个 updateAge 窗口（小时级）或改系统时钟；本轮不伪造时间。' +
      '当前实现是"登录时签发 7 天绝对有效期"，续期语义未启用。',
  )

  // ═══════════ S2 撤销（tokenVersion） ═══════════
  console.log('\n[S2] 撤销 / 还原')
  const again = await api('/api/v1/org', { jar: qaSes.jar })
  check('S07 有效会话可反复使用', again.status === 200 ? 'PASS' : 'FAIL', `status=${again.status}`)

  const e2eSes = await login(WHO.e2e)
  if (db && e2eSes.status === 200 && e2eSes.jar) {
    const u = await one(`SELECT id, "tokenVersion" FROM "User" WHERE email = ?`, [WHO.e2e.email])
    const v0 = u?.tokenVersion ?? 0
    // 探针用 `/api/v1/organizations` 而不是 `/api/v1/org`：
    // 前者**只做会话校验**（requireAuth），后者还要解析租户。
    // e2e-test 目前只有一个 SUSPENDED 成员关系 ⇒ `/api/v1/org` 无论会话是否有效
    // 都会是 403，根本区分不出"凭据被撤销"。这是首跑 S09 判错的真正原因：
    // 我拿"200"当"会话有效"的判据，而该账号永远拿不到 200。
    const PROBE = '/api/v1/organizations'
    // 先打热缓存：撤销延迟的上界由 requireAuth 的用户缓存 TTL 决定（60s），
    // 冷缓存会给出 0s 的假象 —— 所以故意先请求一次把缓存点亮。
    await api(PROBE, { jar: e2eSes.jar })
    await db.execute({
      sql: `UPDATE "User" SET "tokenVersion" = ?, "updatedAt" = ? WHERE id = ?`,
      args: [v0 + 1, new Date().toISOString(), u.id],
    })
    // 🔴 超时必须 > 90s，不是 > 60s：`redisCache` 的 TTL 带 **0–30s 随机抖动**
    //    （`withJitter`，防缓存雪崩），所以"撤销可见"的真实上界是 60+30=90s。
    //    首跑用 75s 判据时偶发 FAIL（一次 68.7s 通过、一次 >75s 未失效），
    //    红的那次不是产品抖动，是我的上界算错了 —— 判据必须覆盖最坏情况。
    const revoked = await pollFor(
      async () => (await api(PROBE, { jar: e2eSes.jar })).status === 401,
      { timeoutMs: 120_000, intervalMs: 2_000 },
    )
    check(
      'S08 tokenVersion+1 → 旧 JWT 失效（≤120s = 60s TTL + 0–30s 抖动）',
      revoked.value ? 'PASS' : 'FAIL',
      revoked.value ? `失效延迟 ≈ ${(revoked.elapsed / 1000).toFixed(1)}s` : '120s 内仍未失效',
    )

    // 还原 DB 原值。
    await db.execute({
      sql: `UPDATE "User" SET "tokenVersion" = ?, "updatedAt" = ? WHERE id = ?`,
      args: [v0, new Date().toISOString(), u.id],
    })
    const restoredRow = await one(`SELECT "tokenVersion" FROM "User" WHERE id = ?`, [u.id])
    const dbRestored = Number(restoredRow?.tokenVersion) === Number(v0)
    // 🔴 原判据是"还原后**立即**复效 → 200"。两处都错了：
    //    ① 400ms 后立刻请求时缓存里还是 v0+1（60s TTL），必然 401；
    //    ② 即便缓存过期，"200"也不是正确判据（该账号没有 ACTIVE 租户）。
    //    真判据：**缓存换成新版本之后**，同一枚 JWT 被重新接受（401 → 非 401）。
    //    这不是产品缺陷，而是"等式比较 + 短期缓存"两条设计的必然结果；
    //    它同时是"降 tokenVersion 会让旧凭据复效"的实测证明（所以运维绝不该降版本号）。
    const revived = await pollFor(
      async () => (await api(PROBE, { jar: e2eSes.jar })).status !== 401,
      { timeoutMs: 180_000, intervalMs: 2_000 },
    )
    check(
      'S09 还原 tokenVersion → 缓存换版后旧 JWT 重新被接受',
      dbRestored && Boolean(revived.value) ? 'PASS' : 'FAIL',
      `DB还原=${dbRestored} 复效=${revived.value ? `${(revived.elapsed / 1000).toFixed(1)}s` : '180s 内未复效'} ——` +
        ` 判据是"版本不等即拒"，不是黑名单；降版本号会让旧凭据复效`,
    )
  } else {
    check('S08 tokenVersion+1 → 旧 JWT 失效（≤120s = 60s TTL + 0–30s 抖动）', 'SKIP', `e2e 登录 status=${e2eSes.status} 或无库`)
    check('S09 还原 tokenVersion → 缓存换版后旧 JWT 重新被接受', 'SKIP', '同上')
  }

  // ═══════════ S3 登出 ═══════════
  console.log('\n[S3] 登出')
  const qaJarBefore = qaSes.jar
  // ⚠️ 不再走 Auth.js 的 `/api/auth/signout`：它对双提交 CSRF 有硬要求，只带会话
  //    cookie 时返回 `302 → /login?error=MissingCSRF` 且**不下发任何 set-cookie**
  //    （探测脚本 `scripts/qa/_probe-signout.mjs` 的原始输出）。照着它写断言会得到
  //    一个"看起来跳走了、其实没登出"的假绿 —— 本轮首跑就是这个假绿的反面：
  //    我断言了 302 却没检查它跳去哪。V20.5 因此新增了 `/api/auth/logout`。
  const signOut = await api('/api/auth/logout', { method: 'POST', jar: qaSes.jar, body: {} })
  const clearedCookies = signOut.setCookie.filter((c) => /session-token=/.test(c))
  const allCleared =
    clearedCookies.length >= 1 && clearedCookies.every((c) => /session-token=;/.test(c) && /max-age=0/i.test(c))
  check(
    'S10 登出 → 200 且会话 cookie 被清（含 __Secure- 变体）',
    signOut.status === 200 && allCleared ? 'PASS' : 'FAIL',
    `status=${signOut.status} 清了 ${clearedCookies.length} 个 session-token cookie，Max-Age=0 全部成立=${allCleared}`,
  )

  const jarAfterLogout = mergeJar(qaSes.jar, signOut.setCookie)
  const afterLogout = await api('/api/v1/org', { jar: jarAfterLogout })
  check(
    'S11 登出后（浏览器视角的 cookie jar）→ 401',
    afterLogout.status === 401 ? 'PASS' : 'FAIL',
    `status=${afterLogout.status} cookie=${jarAfterLogout ? '仍在' : '已空'}`,
  )

  // JWT 是无状态凭据：删客户端 cookie ≠ 服务端撤销。这条必须写出来，
  // 否则"登出"会被误当成"封禁"。
  const replay = await api('/api/v1/org', { jar: qaJarBefore })
  check(
    'S12 手工重放登出前的 cookie → 仍可用（无状态 JWT 的已知边界）',
    replay.status === 200 ? 'PASS' : 'FAIL',
    `status=${replay.status} —— 登出是"删客户端凭据"；真撤销必须 tokenVersion+1`,
  )

  // ═══════════ S4 组织切换 ═══════════
  console.log('\n[S4] 组织切换')
  const adminSes = await login(WHO.admin)
  let adminJar = adminSes.jar
  let tenants = []
  if (adminSes.status === 200) {
    const list = await api('/api/v1/organizations', { jar: adminJar })
    tenants = list.json?.data?.organizations ?? []
    check(
      'S13 列出我的组织（≥2 才能测切换）',
      list.status === 200 && tenants.length >= 2 ? 'PASS' : 'FAIL',
      `status=${list.status} count=${tenants.length}`,
    )

    if (tenants.length >= 2) {
      const [a, b] = tenants
      const ma = await api(`/api/v1/members?organizationId=${a.organizationId}&pageSize=5`, { jar: adminJar })
      const mb = await api(`/api/v1/members?organizationId=${b.organizationId}&pageSize=5`, { jar: adminJar })
      check(
        'S14 显式指定 organizationId → 各自成员目录',
        ma.status === 200 && mb.status === 200 ? 'PASS' : 'FAIL',
        `${a.slug}=${ma.status}(${ma.json?.meta?.total ?? '?'}) ${b.slug}=${mb.status}(${mb.json?.meta?.total ?? '?'})`,
      )

      // 默认（无 cookie、无参数）→ 最早加入的社群。这是"多社群用户只能看到第一个"的
      // 实际形态：先把它测出来，才能证明切换器真的改变了行为。
      const defaultOrg = await api('/api/v1/org', { jar: adminJar })
      const defaultSlug = orgSlugOf(defaultOrg)
      const targetSlug = a.slug === defaultSlug ? b.slug : a.slug
      const target = tenants.find((t) => t.slug === targetSlug)

      const sw = await api('/api/v1/organizations/active', {
        method: 'POST',
        jar: adminJar,
        body: { organizationId: target.organizationId },
      })
      adminJar = mergeJar(adminJar, sw.setCookie)
      const afterSwitch = await api('/api/v1/org', { jar: adminJar })
      const switchedSlug = orgSlugOf(afterSwitch)
      check(
        'S15 切换社群 → 无参请求解析到新租户（cookie 软偏好）',
        sw.status === 200 && switchedSlug === target.slug
          ? 'PASS'
          : 'FAIL',
        `POST=${sw.status} default=${defaultSlug} → target=${target.slug} → 实际=${switchedSlug}`,
      )

      // 还原：切回原默认，避免把测试痕迹留给后续脚本/人。
      const back = await api('/api/v1/organizations/active', {
        method: 'POST',
        jar: adminJar,
        body: { organizationId: tenants.find((t) => t.slug === defaultSlug).organizationId },
      })
      adminJar = mergeJar(adminJar, back.setCookie)
      const backSlug = orgSlugOf(await api('/api/v1/org', { jar: adminJar }))
      check(
        'S16 切回原租户（还原测试痕迹）',
        back.status === 200 && backSlug === defaultSlug ? 'PASS' : 'FAIL',
        `POST=${back.status} slug=${backSlug}`,
      )

      // 跨租户负例：把一个"我不是成员"的租户写进偏好 —— 必须 403，且不得下发 cookie。
      const foreignOrg = db
        ? await one(
            `SELECT o.id FROM "Organization" o
             WHERE o.status='ACTIVE' AND NOT EXISTS (
               SELECT 1 FROM "Membership" m WHERE m."organizationId"=o.id
                 AND m."userId"=(SELECT id FROM "User" WHERE email=?)
             ) LIMIT 1`,
            [WHO.admin.email],
          )
        : null
      if (foreignOrg?.id) {
        const denied = await api('/api/v1/organizations/active', {
          method: 'POST',
          jar: adminJar,
          body: { organizationId: foreignOrg.id },
        })
        const wroteCookie = denied.setCookie.some((c) => /lf-active-org=/.test(c))
        check(
          'S17 切到"我不是成员的租户" → 403 且不写偏好 cookie',
          denied.status === 403 && !wroteCookie ? 'PASS' : 'FAIL',
          `status=${denied.status} code=${errCode(denied)} cookie写入=${wroteCookie}`,
        )
      } else {
        check('S17 切到"我不是成员的租户" → 403 且不写偏好 cookie', 'SKIP', '找不到 admin 不是成员的组织')
      }

      // 形状非法的 id：不查库、直接 400（避免把任意输入变成查询面）。
      const malformed = await api('/api/v1/organizations/active', {
        method: 'POST',
        jar: adminJar,
        body: { organizationId: "x' OR 1=1 --" },
      })
      check(
        'S18 非法 organizationId 形状 → 400（不进查询）',
        malformed.status === 400 ? 'PASS' : 'FAIL',
        `status=${malformed.status} code=${errCode(malformed)}`,
      )
    } else {
      for (const id of ['S14', 'S15', 'S16', 'S17', 'S18']) check(`${id} 组织切换相关`, 'SKIP', '组织数不足 2')
    }
  } else {
    for (const id of ['S13', 'S14', 'S15', 'S16', 'S17', 'S18']) {
      check(`${id} 组织切换相关`, 'SKIP', `admin 登录失败 status=${adminSes.status}`)
    }
  }

  // ═══════════ S5 权限变更即时生效 ═══════════
  console.log('\n[S5] 权限变更是否即时生效')
  const qaSes2 = await login(WHO.qa)
  if (adminSes.status === 200 && qaSes2.status === 200 && db) {
    const orgRow = await one(`SELECT id FROM "Organization" WHERE slug = 'default'`)
    const orgId = orgRow?.id
    const mine = await api(`/api/v1/members?organizationId=${orgId}&pageSize=100`, { jar: adminJar })
    const target = (mine.json?.data ?? []).find((m) => m.email === WHO.qa.email)
    const before = await api('/api/v1/org', { jar: qaSes2.jar })
    const beforeCaps = capsOf(before)
    if (target) {
      let demoted = false
      try {
        const down = await api(`/api/v1/members/${target.membershipId}?organizationId=${orgId}`, {
          method: 'PATCH',
          body: { role: 'MEMBER' },
          jar: adminJar,
        })
        demoted = down.status === 200
        // 不重新登录：同一个 cookie 立刻读能力，证明权限**不缓存在 JWT 里**。
        const after = await api('/api/v1/org', { jar: qaSes2.jar })
        const afterCaps = capsOf(after)
        const lost = beforeCaps.filter((c) => !afterCaps.includes(c))
        const gained = afterCaps.filter((c) => !beforeCaps.includes(c))
        // 🔴 原判据写的是 `beforeCaps.includes('member.invite')` —— 但 qa.female 是
        //    OPERATOR，而 `member.invite` 只属于 ADMIN+（见 capabilities.ts 的
        //    OPERATOR_EXTRA / ADMIN_EXTRA）。断言前提为假，于是永远 FAIL。
        //    正确判据是**实际差集**：OPERATOR→MEMBER 必然失去 member.read / mission.*
        //    / agent.run 等运营能力，且**不得**凭空获得任何能力。
        check(
          'S19 角色降级后同一会话能力立即收缩（差集非空、无新增）',
          demoted && lost.length > 0 && gained.length === 0 && !afterCaps.includes('member.read')
            ? 'PASS'
            : 'FAIL',
          `PATCH=${down.status} before=${beforeCaps.length} after=${afterCaps.length} 失去=[${lost.join(',')}] 新增=[${gained.join(',')}]`,
        )
      } finally {
        if (demoted) {
          const up = await api(`/api/v1/members/${target.membershipId}?organizationId=${orgId}`, {
            method: 'PATCH',
            body: { role: 'OPERATOR' },
            jar: adminJar,
          })
          const restore = await api('/api/v1/org', { jar: qaSes2.jar })
          const restoreCaps = capsOf(restore)
          const sameSet =
            restoreCaps.length === beforeCaps.length && beforeCaps.every((c) => restoreCaps.includes(c))
          check(
            'S20 还原角色后能力恢复（与降级前集合相等）',
            up.status === 200 && sameSet ? 'PASS' : 'FAIL',
            `PATCH=${up.status} caps=${restoreCaps.length}/${beforeCaps.length} 集合相等=${sameSet}`,
          )
        } else {
          check('S20 还原角色后能力恢复（与降级前集合相等）', 'SKIP', 'S19 未成功降级，无需还原')
        }
      }
    } else {
      check('S19 角色降级后同一会话能力立即收缩（差集非空、无新增）', 'SKIP', 'default 里找不到 qa.female 的成员关系')
      check('S20 还原角色后能力恢复（与降级前集合相等）', 'SKIP', '同上')
    }
  } else {
    check('S19 角色降级后同一会话能力立即收缩（差集非空、无新增）', 'SKIP', '缺 admin/qa 会话或数据库')
    check('S20 还原角色后能力恢复（与降级前集合相等）', 'SKIP', '同上')
  }

  // ═══════════ S6 CSRF ═══════════
  console.log('\n[S6] CSRF')
  const badOrigin = await login(WHO.qa, { origin: 'https://evil.example.com' })
  check(
    'S21 登录：跨源 Origin → 拒绝',
    badOrigin.status === 401 || badOrigin.status === 403 ? 'PASS' : 'FAIL',
    `status=${badOrigin.status}`,
  )
  const noOrigin = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: WHO.qa.email, password: WHO.qa.password }),
    redirect: 'manual',
  })
  check(
    'S22 登录：无 Origin 且无 Referer → 拒绝',
    noOrigin.status === 401 || noOrigin.status === 403 ? 'PASS' : 'FAIL',
    `status=${noOrigin.status}`,
  )

  const csrfLogout = await fetch(`${BASE}/api/auth/logout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example.com', Cookie: qaJarBefore },
    body: '{}',
    redirect: 'manual',
  })
  const leakedClear = (csrfLogout.headers.getSetCookie?.() ?? []).some((c) => /session-token=;/.test(c))
  check(
    'S23 登出：跨源 Origin → 403 且不下发清 cookie',
    csrfLogout.status === 403 && !leakedClear ? 'PASS' : 'FAIL',
    `status=${csrfLogout.status} 下发清cookie=${leakedClear}`,
  )

  // ═══════════ S7 OAuth ═══════════
  console.log('\n[S7] OAuth')
  check(
    'S24 Google OAuth 成功回调',
    'NOT_TESTED',
    '需真实 GOOGLE_CLIENT_SECRET + 真人在 consent 页同意；本地只有 CLIENT_ID。' +
      '授权请求形状（state/PKCE/redirect_uri）与坏回调拒绝见 v204-oauth-shape.mjs',
  )

  const count = (v) => results.filter((r) => r.verdict === v).length
  console.log(
    `\n${count('PASS')} PASS / ${count('FAIL')} FAIL / ${count('SKIP')} SKIP / ` +
      `${count('NOT_TESTED')} NOT_TESTED / ${count('BLOCKED')} BLOCKED`,
  )
  const fails = results.filter((r) => r.verdict === 'FAIL')
  if (fails.length) {
    console.log('\n失败项：')
    for (const r of fails) console.log(`  - ${r.id}: ${r.detail}`)
  }
  process.exit(fails.length === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('复验脚本异常：', e?.message ?? e)
  process.exit(2)
})
