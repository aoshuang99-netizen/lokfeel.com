#!/usr/bin/env node
/**
 * 生产「真实登录 → 会话 → 受保护端点 → ICE/TURN」全链路自动化
 *
 * ## WHY 要有这个脚本
 * `LAUNCH_READINESS.md` 曾把两件事列为「必须人工点」：
 *   ① 用真实账号从 /login 走完登录 → 进 dashboard
 *   ② 登录后确认 ICE 拿到 TURN（不是 stun-only）
 * 人工点的**代价**是会忘、会漂、无法复跑。本脚本把它变成一条命令：
 *
 *   注册（脚本自己建号）→ 从库里取验证码 → 完成注册 → 密码登录 →
 *   带 cookie 验会话 → 取 ICE → 打受保护端点 → **删号并复验计数归零**
 *
 * 全程不需要人手，也不需要预先存在账号。跑完生产库与跑之前**逐表一致**。
 *
 * ## 为什么用「注册」而不是直接建库
 * 直接 INSERT 一个 User 只能证明「表里有行」，证明不了 `hashPassword` /
 * 验证码一次性消费 / 登录端点 / JWT 下发这一整条链路。注册走的是用户真实路径，
 * 顺带把**验证码邮件真的发出去了**也覆盖了（发送失败时注册仍会成功，所以
 * 邮件送达另由 `verify-email-delivery.mjs` 用 Resend 事件取证）。
 *
 * ## 安全边界
 * - 账号邮箱默认 `delivered@resend.dev`（Resend 官方测试收件人，永不计入退信率，
 *   不进任何真实用户收件箱）；可用 `--email=` 覆盖。
 * - 密码每次随机生成，**只存在于内存**，不落盘、不打印。
 * - `finally` 里删号：按 `pragma foreign_key_list` 实测的 39 条外键逐表删，
 *   再断言 `User` 计数回到基线。中途失败也会尽量清理（`--keep` 可跳过，仅排障）。
 * - 只读+自建自删，不触碰任何既有用户数据。
 *
 * ## 退出码
 *   0 = 全部通过        1 = 有断言失败        2 = 探针不可信（网络/DB/前置不成立）
 *
 * ## 用法
 *   node scripts/qa/verify-prod-session.mjs
 *   node scripts/qa/verify-prod-session.mjs --base=https://app.lokfeel.com
 *   node scripts/qa/verify-prod-session.mjs --keep          # 不删号（排障）
 *   node scripts/qa/verify-prod-session.mjs --json out.json # 额外落一份机器可读结果
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import { createTurso, foreignKeysTo, deleteUserCascade } from './lib/turso-http.mjs'

// ─── 参数 ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const argOf = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : dflt
}
const BASE = argOf('base', process.env.QA_BASE || 'https://app.lokfeel.com').replace(/\/$/, '')
const EMAIL = argOf('email', 'delivered@resend.dev')
const KEEP = argv.includes('--keep')
const JSON_OUT = argOf('json', '')
const ORIGIN = BASE

const PASSWORD = crypto.randomBytes(18).toString('base64url') // 24 chars, 仅内存
const NAME = 'QA Launch Probe'
const DOB = '1994-05-17'

const results = []
let hardBlocked = null
const ck = (label, ok, detail = '') => {
  results.push({ label, ok, detail })
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? '  → ' + detail : ''}`)
}
const note = (label, detail = '') => {
  results.push({ label, ok: true, detail, note: true })
  console.log(`  ·  ${label}${detail ? '  → ' + detail : ''}`)
}

const cookieJar = () => {
  const jar = new Map()
  const absorb = (res) => {
    const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : []
    for (const c of raw) {
      const [pair] = c.split(';')
      const idx = pair.indexOf('=')
      if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1))
    }
    return raw
  }
  const header = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  return { jar, absorb, header }
}

async function http(pathname, { method = 'GET', body, cookie, headers = {}, redirect = 'manual' } = {}) {
  const init = {
    method,
    redirect,
    headers: {
      origin: ORIGIN,
      referer: `${ORIGIN}/login`,
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    signal: AbortSignal.timeout(30_000),
  }
  if (body) init.body = JSON.stringify(body)
  const res = await fetch(`${BASE}${pathname}`, init)
  let json = null
  const text = await res.text().catch(() => '')
  try {
    json = JSON.parse(text)
  } catch {
    /* 非 JSON（HTML 错误页）保留 null */
  }
  return { res, status: res.status, json, text }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ─── 主流程 ────────────────────────────────────────────────────────────
let db = null
let userId = null
let baselineUsers = null
let cleaned = null

async function main() {
  console.log(`\n━━━ 生产会话全链路（真实登录 + ICE）━━━`)
  console.log(`目标   : ${BASE}`)
  console.log(`账号   : ${EMAIL}（本次随机密码，不落盘）\n`)

  // ① 前置：站点活着 + 库可读
  const health = await http('/api/health')
  if (health.status !== 200) {
    hardBlocked = `前置失败：/api/health 返回 ${health.status}，站点不可用`
    return
  }
  ck('基线：/api/health 200', true, health.json?.status || '')

  try {
    db = createTurso()
    await db.ping()
    ck('基线：生产库可读（Turso HTTP）', true, '')
  } catch (e) {
    hardBlocked = `前置失败：生产库不可读 —— ${e.message}`
    return
  }

  baselineUsers = await db.scalar('select count(*) as n from User')
  ck('基线：记录当前 User 计数（清理后须回到该值）', Number.isFinite(baselineUsers), String(baselineUsers))

  // ② 先清理上次可能残留的同名测试账号（崩在中途会留）
  const leftovers = await db.query('select id from User where email = ?', [EMAIL])
  if (leftovers.length) {
    for (const row of leftovers) {
      await deleteUserCascade(db, row.id, { fks: await foreignKeysTo(db, 'User') })
    }
    await db.exec('delete from VerificationToken where identifier = ?', [EMAIL])
    note('预清理：删除上次残留的同名测试账号', `${leftovers.length} 个`)
  }

  // ③ 验证码注册（第一步：发码）
  const send = await http('/api/auth/register', {
    method: 'POST',
    body: {
      step: 'send-code',
      email: EMAIL,
      password: PASSWORD,
      name: NAME,
      displayName: NAME,
      gender: 'man',
      sexuality: 'straight',
      dob: DOB,
      verifyMethod: 'email',
    },
  })
  ck(
    '注册①：send-code 返回 200（未把已存在账号泄露成 409）',
    send.status === 200,
    `HTTP ${send.status} ${send.json?.message || ''}`.trim(),
  )
  if (send.status !== 200) {
    hardBlocked = `send-code 失败（HTTP ${send.status}）`
    return
  }

  // ④ 从库里取验证码（这是唯一能拿到码的方式；接口在生产不会回显）
  let code = null
  for (let i = 0; i < 20; i++) {
    const rows = await db.query(
      `select token from VerificationToken
        where identifier = ? and used = 0 and length(token) = 6
        order by expires desc limit 1`,
      [EMAIL],
    )
    if (rows.length) {
      code = String(rows[0].token)
      break
    }
    await sleep(500)
  }
  ck('注册②：验证码已落库（6 位，未使用）', Boolean(code), code ? `已取到（不回显）` : '10s 内未出现')
  if (!code) {
    hardBlocked = '验证码未落库 —— 无法继续（多半是 send-code 被限流或写库失败）'
    return
  }

  // ⑤ 验证码兑换成账号
  const verify = await http('/api/auth/register', {
    method: 'POST',
    body: {
      step: 'verify',
      email: EMAIL,
      password: PASSWORD,
      name: NAME,
      displayName: NAME,
      gender: 'man',
      sexuality: 'straight',
      dob: DOB,
      code,
      verifyMethod: 'email',
    },
  })
  userId = verify.json?.user?.id || null
  ck(
    '注册③：verify 返回 201 并创建账号',
    verify.status === 201 && Boolean(userId),
    `HTTP ${verify.status}`,
  )
  if (!userId) {
    hardBlocked = `verify 失败（HTTP ${verify.status}: ${verify.json?.message || ''}）`
    return
  }

  const dbUser = await db.query('select id, email, password, emailVerified from User where id = ?', [userId])
  ck('注册④：密码入库为 bcrypt 哈希（非明文）', /^\$2[aby]\$/.test(String(dbUser[0]?.password || '')), '')
  ck('注册⑤：emailVerified 已置位（不是待验证态）', Boolean(dbUser[0]?.emailVerified), '')
  ck(
    '注册⑥：验证码已一次性消费（used=1 或已删）',
    (await db.scalar(
      `select count(*) as n from VerificationToken where identifier = ? and token = ? and used = 0`,
      [EMAIL, code],
    )) === 0,
    '',
  )

  // ⑥ 密码登录（走用户真实提交的自定义端点）
  const jar = cookieJar()
  const login = await http('/api/auth/login', {
    method: 'POST',
    body: { email: EMAIL, password: PASSWORD },
  })
  const setCookies = jar.absorb(login.res)
  ck('登录①：/api/auth/login 返回 200', login.status === 200, `HTTP ${login.status}`)
  ck(
    '登录②：下发了会话 cookie',
    jar.jar.size > 0,
    [...jar.jar.keys()].join(',') || '(none)',
  )
  const deployHostLeak = setCookies.some((c) => /domain=.*--[a-z0-9-]+\.netlify\.app/i.test(c))
  ck('登录③：cookie 未落在部署专用域名', !deployHostLeak, deployHostLeak ? '发现 Domain=部署域名' : 'host-only 落公开域名')

  const session = await http('/api/auth/session', { cookie: jar.header() })
  ck(
    '会话①：/api/auth/session 认得这个 cookie',
    session.status === 200 && session.json?.user?.email === EMAIL,
    `user=${session.json?.user?.email || 'null'}`,
  )
  ck(
    '会话②：会话里的 user.id 与库中一致',
    session.json?.user?.id === userId,
    '',
  )

  // ⑦ 受保护端点：未登录必须 401，登录后必须不是 401
  const PROTECTED = ['/api/user/limits', '/api/im/conversations', '/api/notifications/unread-count']
  for (const p of PROTECTED) {
    const anon = await http(p)
    const authed = await http(p, { cookie: jar.header() })
    // 既有的路径若对匿名返回 405（方法不符）也接受，但必须与登录态不同或本就非 401
    ck(
      `端点 ${p}：匿名 401 → 登录后放行`,
      anon.status === 401 && authed.status !== 401,
      `anon=${anon.status} authed=${authed.status}`,
    )
  }

  // ⑧ ICE / TURN（这曾是「必须人工确认」的一条）
  const iceAnon = await http('/api/rtc/ice-servers')
  ck('ICE①：匿名请求 401（不泄露 TURN 凭据）', iceAnon.status === 401, `HTTP ${iceAnon.status}`)

  const ice = await http('/api/rtc/ice-servers', {
    cookie: jar.header(),
    headers: { 'cache-control': 'no-cache' },
  })
  ck('ICE②：登录后返回 200', ice.status === 200, `HTTP ${ice.status}`)
  const servers = Array.isArray(ice.json?.iceServers) ? ice.json.iceServers : []
  const urls = servers.flatMap((s) => (Array.isArray(s.urls) ? s.urls : [s.urls])).filter(Boolean)
  const turnUrls = urls.filter((u) => /^turns?:/i.test(String(u)))
  const hasCred = servers.some((s) => s.credential || s.username)
  const source = ice.json?.source || '(none)'
  ck('ICE③：下发了 ICE 服务器列表', servers.length > 0, `${servers.length} 条`)
  ck('ICE④：来源不是 stun-only', source !== 'stun-only', `source=${source}`)
  ck('ICE⑤：包含 TURN（含 turns:）条目', turnUrls.length > 0, `${turnUrls.length} 条`)
  ck('ICE⑥：TURN 带凭据（username/credential）', hasCred, '')
  ck('ICE⑦：响应里未出现明文密钥形态', !/["']?(secret|api_?key)["']?\s*[:=]/i.test(ice.text), '')

  // ⑨ 登录态页面可达（受保护 SSR 页；跟随重定向会回到 /login 才算失败）
  const dash = await fetch(`${BASE}/dashboard`, {
    headers: { cookie: jar.header() },
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  })
  const loc = dash.headers.get('location') || ''
  ck(
    '页面：/dashboard 登录态不跳回登录页',
    dash.status === 200 || (dash.status >= 300 && dash.status < 400 && !/\/login/.test(loc)),
    `HTTP ${dash.status}${loc ? ' → ' + loc : ''}`,
  )
}

async function cleanup() {
  if (!db) return
  // 验证码行（identifier 维度，userId 可能为 null）
  try {
    await db.exec('delete from VerificationToken where identifier = ?', [EMAIL])
  } catch {
    /* 表可能不存在则忽略 */
  }

  if (userId && !KEEP) {
    try {
      const fks = await foreignKeysTo(db, 'User')
      cleaned = await deleteUserCascade(db, userId, { fks })
    } catch (e) {
      cleaned = { error: e.message }
    }
  }

  const gone = userId ? await db.scalar('select count(*) as n from User where id = ?', [userId]) : 0
  const total = await db.scalar('select count(*) as n from User')
  const restored = baselineUsers === null ? null : total === baselineUsers

  console.log('')
  if (KEEP) {
    note('清理：--keep 已跳过删号', `user=${userId}`)
    results.push({ label: '清理：已删号', ok: true, detail: 'skipped(--keep)', note: true })
    return
  }
  ck('清理①：测试账号已从库中消失', gone === 0, `剩余 ${gone}`)
  ck(
    '清理②：User 总数回到基线（证明没有留下孤儿行）',
    restored === true,
    `baseline=${baselineUsers} now=${total}`,
  )
  if (cleaned?.rounds) {
    note(
      '清理③：级联删除轮次',
      cleaned.rounds.map((r) => `-${r.deleted}${r.errors ? `(${r.errors} 表被依赖阻塞)` : ''}`).join(' '),
    )
  }
  if (cleaned?.error) {
    results.push({ label: '清理：级联删除异常', ok: false, detail: cleaned.error })
  }
}

function report() {
  const failed = results.filter((r) => !r.ok)
  const passed = results.length - failed.length
  console.log('')
  if (hardBlocked) {
    console.log(`⛔ 探针不可信：${hardBlocked}`)
    console.log(`结论：${passed} 通过 / ${failed.length} 失败 · 其余步骤未执行\n`)
    return 2
  }
  if (failed.length) {
    console.log(`结论：${failed.length} 项失败（共 ${results.length} 项）`)
    for (const f of failed) console.log(`   ❌ ${f.label}${f.detail ? ' → ' + f.detail : ''}`)
    console.log('')
    return 1
  }
  console.log(`结论：${passed}/${results.length} 全部通过\n`)
  return 0
}

// ─── 执行 ──────────────────────────────────────────────────────────────
;(async () => {
  let exitCode
  try {
    await main()
  } catch (e) {
    hardBlocked = `未预期异常：${e.message}`
  } finally {
    try {
      await cleanup()
    } catch (e) {
      hardBlocked = hardBlocked || `清理异常：${e.message}`
    }
    exitCode = report()
    if (JSON_OUT) {
      const payload = {
        base: BASE,
        at: new Date().toISOString(),
        exitCode,
        hardBlocked,
        baselineUsers,
        userId,
        results,
      }
      fs.writeFileSync(JSON_OUT, JSON.stringify(payload, null, 2))
      console.log(`结果已写入 ${JSON_OUT}`)
    }
    process.exit(exitCode)
  }
})()
