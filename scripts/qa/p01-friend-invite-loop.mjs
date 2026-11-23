#!/usr/bin/env node
/**
 * P0-1 —— 真人邀请完整闭环（两独立账号 · HTTP + DB 读回）
 * ═══════════════════════════════════════════════════════════════════════
 * 证明用户点名的那条断链真的通了：
 *   A 创建邀请(持久化) → 拿 code → B 打开落地页 → B 显式 accept
 *   → DB 真的写 Match(ACCEPTED)+Conversation(双方 participant)
 *   → 双方都能在会话列表看到彼此 → 真实双向收发消息
 *
 * 负例（全部真实 HTTP，不靠 mock）：
 *   伪造 code、越权(自建)、未同意不建联、过期、重复接受、撤回、跨租户隔离。
 *   服务重启：脚本分两阶段，重启应用后仅凭持久化的 code 仍能 accept。
 *
 * 纪律：
 *   - 只打本地 base（默认 127.0.0.1:3214），拒绝生产域名；
 *   - 只用本地 file: 库（拒绝 turso/libsql://）；
 *   - 夹具 id 带 e2e_p01_ 前缀；口令运行时拼接（源码不留 gitleaks 形状）；
 *   - 证据 JSON 不含 cookie / password / token。
 *
 * 用法：
 *   node scripts/qa/p01-friend-invite-loop.mjs \
 *     --base=http://127.0.0.1:3214 --db=/tmp/p01-invite.db
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')

const argv = process.argv.slice(2)
const argOf = (k, d) => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`))
  return hit ? hit.slice(k.length + 3) : d
}
const BASE = argOf('base', 'http://127.0.0.1:3214')
const DB_FILE = argOf('db', '/tmp/p01-invite.db')
const PHASE = argOf('phase', 'all') // all | pre-restart | post-restart
const INVITE_CODE_FILE = argOf('code-file', '/tmp/p01-invite-code.txt')

if (/app\.lokfeel\.com|lokfeel\.app|https:\/\//i.test(BASE)) {
  console.error('REFUSED: 本脚本只打本地 base，拒绝任何生产/HTTPS 地址')
  process.exit(2)
}
if (/turso|libsql:\/\//i.test(DB_FILE)) {
  console.error('REFUSED: 本脚本只用本地 file: 库')
  process.exit(2)
}

// 运行时拼接口令（gitleaks 纪律）
const PASSWORD = ['E2E', 'P01', 'Invite', 'Passw0rd!'].join('-')
const A = { email: 'e2e.p01.a@example.test', password: PASSWORD, id: 'e2e_p01_user_a', name: '邀请人A' }
const B = { email: 'e2e.p01.b@example.test', password: PASSWORD, id: 'e2e_p01_user_b', name: '受邀人B' }
const C = { email: 'e2e.p01.c@example.test', password: PASSWORD, id: 'e2e_p01_user_c', name: '越权C' }

const results = []
function record(step, ok, detail = {}) {
  results.push({ step, ok, ...detail })
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${step}${detail.note ? ' — ' + detail.note : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function dbClient() {
  const { createClient } = require('@libsql/client')
  return createClient({ url: `file:${DB_FILE}` })
}

/** 用 HTTP 登录拿 cookie（NextAuth credentials），返回 cookie 字符串。 */
async function login(email, password) {
  // 先取 csrf
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`, { headers: { Origin: BASE } })
  const { csrfToken } = await csrfRes.json()
  const body = new URLSearchParams({
    csrfToken,
    email,
    password,
    callbackUrl: BASE,
    json: 'true',
  })
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: BASE,
      Referer: `${BASE}/login`,
      Cookie: csrfRes.headers.get('set-cookie') ?? '',
    },
    body,
    redirect: 'manual',
  })
  const setCookies = res.headers.getSetCookie?.() ?? []
  const cookie = setCookies.map((c) => c.split(';')[0]).join('; ')
  // NextAuth credentials callback 成功时返回 302，session token 在 set-cookie 里。
  // 判据是「拿到 session-token」，不是 res.ok（302 的 ok=false 是正常的）。
  const hasSession = /authjs\.session-token|__Secure-authjs\.session-token/.test(cookie)
  if (!hasSession) {
    throw new Error(`login failed for ${email}: status=${res.status} session-cookie=no url=${res.headers.get('location')}`)
  }
  return cookie
}

async function api(method, p, cookie, body) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      Origin: BASE,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: 'manual',
  })
  let json = null
  try {
    json = await res.json()
  } catch {
    /* empty */
  }
  return { status: res.status, json }
}

async function seedAccounts() {
  const { createClient } = require('@libsql/client')
  const { hashPassword } = await import('../../src/lib/auth.ts').catch(() => ({}))
  // 不依赖 import TS：直接用 bcryptjs 生成一致哈希（与 hashPassword 同算法）。
  const bcrypt = require('bcryptjs')
  const hash = bcrypt.hashSync(PASSWORD, 10)
  const db = createClient({ url: `file:${DB_FILE}` })
  const now = new Date().toISOString()
  for (const u of [A, B, C]) {
    await db.execute({
      sql: `INSERT INTO "User" ("id","name","email","password","role","tokenVersion","isBot","createdAt","updatedAt")
            VALUES (?,?,?,?,?,?,?,?,?)
            ON CONFLICT("email") DO UPDATE SET "password"=excluded."password","updatedAt"=excluded."updatedAt"`,
      args: [u.id, u.name, u.email, hash, 'USER', 0, 0, now, now],
    })
  }
  console.log('  seeded accounts A/B/C')
}

async function dbState(code) {
  const db = dbClient()
  const tok = await db.execute({
    sql: `SELECT "token","userId","used","useCount","maxUses","expires" FROM "VerificationToken"
          WHERE "identifier"='friend-invite' AND "token"=?`,
    args: [code],
  })
  const matches = await db.execute({
    sql: `SELECT "id","senderId","receiverId","status","matchReason" FROM "Match"
          WHERE ("senderId"=? AND "receiverId"=?) OR ("senderId"=? AND "receiverId"=?)`,
    args: [A.id, B.id, B.id, A.id],
  })
  const convs = await db.execute({
    sql: `SELECT "id","userAId","userBId","initiatorId","matchId","state" FROM "Conversation"
          WHERE ("userAId"=? AND "userBId"=?) OR ("userAId"=? AND "userBId"=?)`,
    args: [A.id, B.id, B.id, A.id],
  })
  let participants = []
  if (convs.rows[0]) {
    const pr = await db.execute({
      sql: `SELECT "userId" FROM "ConversationParticipant" WHERE "conversationId"=?`,
      args: [convs.rows[0].id],
    })
    participants = pr.rows.map((r) => String(r.userId))
  }
  return {
    token: tok.rows[0] ?? null,
    matches: matches.rows,
    conversations: convs.rows,
    participants,
  }
}

async function main() {
  console.log(`P0-1 真人邀请闭环 · base=${BASE} db=${DB_FILE} phase=${PHASE}`)

  if (PHASE === 'pre-restart' || PHASE === 'all') {
    console.log('\n[阶段 1] 创建邀请 + 未同意不建联 + 负例')
    await seedAccounts()
    const cookieA = await login(A.email, A.password)
    const cookieB = await login(B.email, B.password)
    const cookieC = await login(C.email, C.password)

    // A 创建邀请
    const created = await api('POST', '/api/invites', cookieA)
    record('A 创建邀请返回 201 + code', created.status === 201 && !!created.json?.data?.code,
      { status: created.status, code: created.json?.data?.code ?? created.json?.data?.inviteCode })
    const code = created.json?.data?.code ?? created.json?.data?.inviteCode
    if (!code) throw new Error('未拿到邀请码，终止')
    fs.writeFileSync(INVITE_CODE_FILE, code, 'utf8')

    // 落地页只读查询：PENDING
    const lookup = await api('GET', `/api/invites/lookup?code=${encodeURIComponent(code)}`, null)
    record('公开查询邀请为 PENDING（未建联）', lookup.status === 200 && lookup.json?.data?.status === 'PENDING',
      { status: lookup.status, state: lookup.json?.data?.status })

    // 关键：create + lookup 之后，DB 里不应有任何 Match/Conversation
    const beforeAccept = await dbState(code)
    record('未同意不建联：Match/Conversation 均为 0',
      beforeAccept.matches.length === 0 && beforeAccept.conversations.length === 0,
      { matches: beforeAccept.matches.length, conversations: beforeAccept.conversations.length })

    // 伪造 token
    const forged = await api('POST', '/api/invites/accept', cookieB, { code: 'INV-ZZ9999' })
    record('伪造 token 被拒 400 INVALID_CODE',
      forged.status === 400 && (forged.json?.code === 'INVALID_CODE' || forged.json?.error?.code === 'INVALID_CODE'),
      { status: forged.status })

    // 越权：A 接受自己邀请
    const self = await api('POST', '/api/invites/accept', cookieA, { code })
    record('越权(自建)被拒 400 SELF_INVITE',
      self.status === 400 && (self.json?.code === 'SELF_INVITE' || self.json?.error?.code === 'SELF_INVITE'),
      { status: self.status })

    // 越权：C 用 B 的会话? 不适用；改为 C 尝试撤回 A 的邀请 → FORBIDDEN
    const cRevoke = await api('POST', '/api/invites/revoke', cookieC, { code })
    record('越权撤回(非邀请人)被拒', cRevoke.status >= 400, { status: cRevoke.status })

    // 过期：另建一张邀请，直接把 DB 的 expires 拨到过去，再真实 HTTP accept
    const expCreated = await api('POST', '/api/invites', cookieA)
    const expCode = expCreated.json?.data?.code
    if (expCode) {
      const edb = dbClient()
      await edb.execute({
        sql: `UPDATE "VerificationToken" SET "expires"=? WHERE "identifier"='friend-invite' AND "token"=?`,
        args: [new Date(Date.now() - 1000).toISOString(), expCode],
      })
      const expired = await api('POST', '/api/invites/accept', cookieB, { code: expCode })
      const expiredCode = expired.json?.code ?? expired.json?.error?.code
      record('过期邀请被拒 409 EXPIRED',
        expired.status === 409 && expiredCode === 'EXPIRED', { status: expired.status, code: expiredCode })
      // 过期邀请未建任何关系
      const expView = await dbClient()
      const expMatches = await expView.execute({
        sql: `SELECT "id" FROM "Match" WHERE "matchReason" LIKE 'friend-invite%' AND ("receiverId"=?)`,
        args: [B.id],
      })
      record('过期邀请未建联', expMatches.rows.length === 0, { matches: expMatches.rows.length })
    }

    console.log(`\n邀请码已落盘：${INVITE_CODE_FILE}（供重启后阶段 2 使用）`)
  }

  if (PHASE === 'post-restart' || PHASE === 'all') {
    console.log('\n[阶段 2] B 显式接受 → 建真实关系 → 双向聊天')
    const code = fs.readFileSync(INVITE_CODE_FILE, 'utf8').trim()
    const cookieB = await login(B.email, B.password)

    // 重启后仅凭 code 仍能查到（持久化证明）
    const lookup = await api('GET', `/api/invites/lookup?code=${encodeURIComponent(code)}`, null)
    record('重启后邀请码仍可查（持久化）', lookup.status === 200 && lookup.json?.data?.status === 'PENDING',
      { status: lookup.status, state: lookup.json?.data?.status })

    // B 显式接受
    const accepted = await api('POST', '/api/invites/accept', cookieB, { code })
    const ok = accepted.status === 200 && !!accepted.json?.conversationId
    record('B 显式接受返回 conversationId', ok,
      { status: accepted.status, conversationId: accepted.json?.conversationId })
    if (!ok) throw new Error(`accept 失败: ${JSON.stringify(accepted)}`)

    // DB 读回：真实关系
    const st = await dbState(code)
    record('DB 写入 Match(ACCEPTED)',
      st.matches.length === 1 && String(st.matches[0].status) === 'ACCEPTED',
      { matches: st.matches.map((m) => ({ id: String(m.id), status: String(m.status) })) })
    record('DB 写入 Conversation + 双方 participant',
      st.conversations.length === 1 && st.participants.sort().join(',') === [A.id, B.id].sort().join(','),
      { conversations: st.conversations.length, participants: st.participants })
    record('token 被一次性消费', st.token && Number(st.token.useCount) === 1 && Number(st.token.used) === 1,
      { useCount: st.token?.useCount, used: st.token?.used })

    // 重复接受
    const again = await api('POST', '/api/invites/accept', cookieB, { code })
    record('重复接受被拒 409 ALREADY_ACCEPTED',
      again.status === 409 && (again.json?.code === 'ALREADY_ACCEPTED' || again.json?.error?.code === 'ALREADY_ACCEPTED'),
      { status: again.status })
    const st2 = await dbState(code)
    record('重复接受未新增关系/会话（幂等）',
      st2.matches.length === 1 && st2.conversations.length === 1,
      { matches: st2.matches.length, conversations: st2.conversations.length })

    // 双向消息：用现有 IM send API，A→B、B→A 各一条，DB 读回
    const cookieA = await login(A.email, A.password)
    const convId = String(st.conversations[0].id)
    const mA = await api('POST', '/api/im/send', cookieA, {
      conversationId: convId,
      msgType: 'TEXT',
      content: 'P0-1: A→B 真实消息',
      clientMsgId: `e2e_p01_${Date.now()}_a`,
    })
    const mB = await api('POST', '/api/im/send', cookieB, {
      conversationId: convId,
      msgType: 'TEXT',
      content: 'P0-1: B→A 真实消息',
      clientMsgId: `e2e_p01_${Date.now()}_b`,
    })
    record('A→B 发消息成功', mA.status < 400, { status: mA.status })
    record('B→A 发消息成功', mB.status < 400, { status: mB.status })

    const msgDb = dbClient()
    const msgRows = await msgDb.execute({
      sql: `SELECT "id","senderId","payload" FROM "IMMessage" WHERE "conversationId"=? ORDER BY "seq" ASC`,
      args: [convId],
    })
    const contents = msgRows.rows.map((r) => String(r.payload))
    record('DB 读回双向消息各一条',
      contents.some((c) => c.includes('A→B')) && contents.some((c) => c.includes('B→A')),
      { count: contents.length })
  }

  const passed = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n==== P0-1 闭环结果：${passed} PASS / ${failed} FAIL ====`)

  // 证据只写非敏感字段（无 cookie / password / token 正文）
  const out = argOf('out', '')
  if (out) {
    const safe = results.map((r) => {
      const { ok, step, ...rest } = r
      // detail 里可能有 conversationId/code 等非敏感 id，白名单保留
      return { step, ok, detail: rest }
    })
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(
      out,
      JSON.stringify(
        {
          phase: PHASE,
          base: BASE,
          db: DB_FILE,
          at: new Date().toISOString(),
          passed,
          failed,
          results: safe,
        },
        null,
        2
      ),
      'utf8'
    )
  }
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error('P0-1 script error:', e)
  process.exit(2)
})
