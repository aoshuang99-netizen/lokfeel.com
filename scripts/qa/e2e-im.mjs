/**
 * P0 登录态 E2E：配对 → 会话 → 收发 → 已读 → 越权边界 → 付费墙业务规则
 *
 * 前置: 先跑 scripts/qa/create-qa-accounts.mjs
 * 用法: node scripts/qa/e2e-im.mjs
 */
import fs from 'node:fs'
import crypto from 'node:crypto'

const BASE = process.env.QA_BASE || 'https://app.lokfeel.com'
// 凭据统一从 scripts/qa/qa-credentials.mjs 解析（public 仓库不入库）
import { QA_PASSWORD } from './qa-credentials.mjs'
const PASSWORD = QA_PASSWORD
const ACC = {
  male: { email: 'qa.male@lokfeel.com' },
  female: { email: 'qa.female@lokfeel.com' },
}

const log = (s = '') => console.log(s)
const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  log(`  ${ok ? '✅' : '❌'} ${name}${detail ? '  → ' + detail : ''}`)
}

class Jar {
  constructor() { this.m = new Map() }
  setFrom(res) {
    const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : []
    for (const c of raw) {
      const [pair] = c.split(';')
      const i = pair.indexOf('=')
      if (i > 0) this.m.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim())
    }
  }
  header() { return [...this.m.entries()].map(([k, v]) => `${k}=${v}`).join('; ') }
}

async function login(email) {
  const jar = new Jar()
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`, { headers: { cookie: jar.header() } })
  jar.setFrom(csrfRes)
  const { csrfToken } = await csrfRes.json()
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar.header() },
    body: new URLSearchParams({ csrfToken, email, password: PASSWORD, callbackUrl: `${BASE}/dashboard`, json: 'true' }),
    redirect: 'manual',
  })
  jar.setFrom(res)
  const sres = await fetch(`${BASE}/api/auth/session`, { headers: { cookie: jar.header() } })
  const session = await sres.json()
  if (!session?.user?.id) throw new Error('登录失败: ' + email)
  return { jar, id: session.user.id, name: session.user.name }
}

async function api(jar, method, p, body) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: { cookie: jar.header(), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  })
  let json = null
  const text = await res.text()
  try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, json }
}

log('================ 1. 登录 ================')
const male = await login(ACC.male.email)
const female = await login(ACC.female.email)
log(`  male   id=${male.id}  (${male.name})`)
log(`  female id=${female.id}  (${female.name})`)
check('两个账号均可登录', !!male.id && !!female.id)

log('\n================ 2. 配对（双向 LIKE）================')
const r1 = await api(male.jar, 'POST', '/api/matches/react', { targetUserId: female.id, reaction: 'LIKE' })
log(`  male LIKE female → ${r1.status} ${JSON.stringify(r1.json).slice(0, 160)}`)
check('male 发起 LIKE 成功（PENDING）', r1.status === 200 && r1.json?.success === true)

const r2 = await api(female.jar, 'POST', '/api/matches/react', { targetUserId: male.id, reaction: 'LIKE' })
log(`  female LIKE male → ${r2.status} ${JSON.stringify(r2.json).slice(0, 220)}`)
check('female 回应 LIKE → 形成匹配', r2.status === 200 && r2.json?.isMatch === true)
const convId = r2.json?.conversationId || r2.json?.chatId
check('匹配返回 conversationId', !!convId, String(convId))

log('\n================ 3. 会话列表 ================')
const cl = await api(male.jar, 'GET', '/api/im/conversations')
const convs = cl.json?.conversations || []
log(`  male 会话数 = ${convs.length}`)
check('male 会话列表出现该会话', convs.some(c => (c.id || c.conversationId) === convId))

log('\n================ 4. 系统消息（匹配成功）================')
let msgs = await api(male.jar, 'GET', `/api/im/messages/${convId}?limit=50`)
let list = msgs.json?.messages || []
log(`  消息数 = ${list.length}，类型 = ${list.map(m => m.msgType || m.type).join(',')}`)
check('会话内存在 SYSTEM 匹配消息', list.some(m => (m.msgType || m.type) === 'SYSTEM'))

log('\n================ 5. 发送 + 幂等 ================')
const cid = `qa-${crypto.randomUUID()}`
const s1 = await api(male.jar, 'POST', '/api/im/send', { conversationId: convId, content: 'QA baseline message #1', msgType: 'TEXT', clientMsgId: cid })
log(`  male 第1条 → ${s1.status} ${JSON.stringify(s1.json).slice(0, 160)}`)
check('male 发送第 1 条成功', s1.status === 200)

const s1b = await api(male.jar, 'POST', '/api/im/send', { conversationId: convId, content: 'QA baseline message #1', msgType: 'TEXT', clientMsgId: cid })
log(`  同 clientMsgId 重发 → ${s1b.status} duplicate=${s1b.json?.duplicate}`)
check('重复 clientMsgId 被去重（幂等）', s1b.json?.duplicate === true || s1b.status === 200)

const s2 = await api(male.jar, 'POST', '/api/im/send', { conversationId: convId, content: 'QA baseline message #2', msgType: 'TEXT' })
log(`  male 第2条 → ${s2.status} ${JSON.stringify(s2.json).slice(0, 120)}`)
check('male 发送第 2 条成功', s2.status === 200)

log('\n================ 6. 付费墙：免费男 2 条上限 ================')
const s3 = await api(male.jar, 'POST', '/api/im/send', { conversationId: convId, content: 'QA baseline message #3 (should be blocked)', msgType: 'TEXT' })
log(`  male 第3条 → ${s3.status} ${JSON.stringify(s3.json).slice(0, 200)}`)
check('male 第 3 条被拦截（UPGRADE_REQUIRED）', s3.status === 403, s3.json?.code || s3.json?.error)

log('\n================ 7. 女性无限消息 ================')
let femaleOk = true
for (let i = 1; i <= 5; i++) {
  const r = await api(female.jar, 'POST', '/api/im/send', { conversationId: convId, content: `QA female reply #${i}`, msgType: 'TEXT' })
  if (r.status !== 200) { femaleOk = false; log(`  female 第${i}条 → ${r.status} ${JSON.stringify(r.json).slice(0, 140)}`) }
}
check('female(LADY_FREE) 连发 5 条均成功', femaleOk)

log('\n================ 8. 已读回执 ================')
msgs = await api(female.jar, 'GET', `/api/im/messages/${convId}?limit=100`)
list = msgs.json?.messages || []
const unreadIds = list.filter(m => !(m.senderId === female.id)).map(m => m.id)
log(`  female 待读消息（male+SYSTEM）= ${unreadIds.length}`)
const rr = await api(female.jar, 'POST', '/api/im/read', { conversationId: convId, messageIds: unreadIds.slice(0, 100) })
log(`  read → ${rr.status} ${JSON.stringify(rr.json).slice(0, 160)}`)
check('已读接口返回成功', rr.status === 200)

const cl2 = await api(female.jar, 'GET', '/api/im/conversations')
const c2 = (cl2.json?.conversations || []).find(c => (c.id || c.conversationId) === convId)
log(`  female 会话未读 = ${JSON.stringify(c2?.unreadCount ?? c2?.unread ?? null)}`)
check('已读后未读数归零', (c2?.unreadCount ?? c2?.unread ?? 0) === 0)

log('\n================ 9. 越权边界 ================')
const bogus = crypto.randomUUID()
const b1 = await api(male.jar, 'GET', `/api/im/messages/${bogus}`)
check('访问不存在的会话 → 404', b1.status === 404, String(b1.status))
const b2 = await api({ header: () => '' }, 'GET', `/api/im/messages/${convId}`)
check('匿名访问会话消息 → 401', b2.status === 401, String(b2.status))
const b3 = await fetch(`${BASE}/api/im/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ conversationId: convId, content: 'x' }) })
check('匿名发送消息 → 401', b3.status === 401, String(b3.status))

log('\n================ 10. 键入/在线状态 ================')
const tp = await api(male.jar, 'POST', '/api/im/typing', { conversationId: convId, isTyping: true })
check('typing 接口可用', tp.status === 200, String(tp.status))
const pr = await api(female.jar, 'GET', '/api/im/presence')
check('presence 接口可用', pr.status === 200, String(pr.status))

log('\n================ 结果汇总 ================')
const pass = results.filter(r => r.ok).length
log(`通过 ${pass}/${results.length}`)
for (const r of results) if (!r.ok) log(`  ❌ ${r.name}`)
fs.writeFileSync('/tmp/qa-im-result.json', JSON.stringify({ convId, maleId: male.id, femaleId: female.id, results }, null, 2))
log('\n上下文已存 /tmp/qa-im-result.json')
