#!/usr/bin/env node
/**
 * T12 · **AC-10** 端到端取证：数据生命周期（导出 / 删除）按政策生效
 * ═══════════════════════════════════════════════════════════════════════
 * AC-10 的原文（交付包 `docs/ACCEPTANCE_MATRIX.md`）：
 *   「**导出、删除、缓存/索引/任务清理按政策生效**」—— 级别 **BLOCKER**，证据形式：**数据治理测试**。
 *
 * 在本次取证之前，AC-10 是一支 BLOCKER 却**无人认领**的缺口
 * （见 `docs/implementation/LIFECYCLE.md` §"仍开放"）：
 *   任务清理 ✅（T06+ 已交付）· **导出 ❌**（未实现）· **删除请求 ❌**（未实现）。
 * 本脚本证的是后两支 —— 以及它们**没有越过对方的数据**。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 为什么必须真 dev server + 真隔离库 + 真会话
 * ═══════════════════════════════════════════════════════════════════════
 *   · `tests/lifecycle/account.test.ts` 证的是**政策纯函数**（邮箱怎么生成、
 *     补丁里有哪些字段）—— 它不知道"改了以后库里到底长什么样"。
 *   · 本脚本补的正是这一层：真实 HTTP + 真实 cookie 会话 + 真实 SQLite，
 *     并且**直连库回读**每一张被覆盖的表 —— 断言的是**库状态**，不是响应体。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 判据设计的核心：**先证前置非空，再断言消失**
 * ═══════════════════════════════════════════════════════════════════════
 *   "导出物里**不含** password" 单独拿出来是**空集套空集** —— 导出为空时它也成立。
 *   所以每一处"不含/已清除"都配一条**前置**：同一条字符串在**导出成功时必须在场**
 *   （证明真的读到了数据）。两段一起看，"消失"才唯一地归因到**擦除**。
 *   删除侧同理：`u_ac10_other` 这个**对照账号**必须原样不动 ——
 *   没有对照，"删干净了"与"删过头了"看起来一模一样。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 四组取证
 * ═══════════════════════════════════════════════════════════════════════
 *   ① **未授权（负）**：无会话 → 导出/删除计划/执行 三面全 401
 *   ② **导出（正）**：真实数据在场；凭据与内部备注**不在**导出物里；未覆盖面显式声明
 *   ③ **删除计划（只读）**：影响面与动作清单齐全；**跑完库里一个字节都没变**
 *   ④ **执行删除**：库状态逐表断言（匿化/收窄/删除）+ **对照账号零波及**
 *      + 原邮箱**再也登不进来**
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 用法
 * ═══════════════════════════════════════════════════════════════════════
 *   npm run verify:ac10:lifecycle
 *   覆盖：AC10_PORT=3123 AC10_DB_FILE=/tmp/x.db
 *   退出码 0 = AC-10 通过。
 *
 * ⚠️ 长任务（起 next dev + 真实登录）—— 与其它扫描/自证脚本**不可并行**（8G 机）。
 * ⚠️ 本脚本**不需要**浏览器：AC-10 的判据是数据治理，不是渲染。
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createClient } from '@libsql/client'
import { AC10_EXPECT, AC10_IDS, AC10_OTHER, AC10_PASSWORD, AC10_PII } from './ac10-fixture.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const PORT = Number(process.env.AC10_PORT || '3123')
const BASE = `http://localhost:${PORT}`
const DB_FILE = process.env.AC10_DB_FILE || '/tmp/ac10-lifecycle.db'
const LOG_DIR = process.env.AC10_LOG_DIR || '/tmp/lf-ac10-logs'

const EXPORT_PATH = '/api/v1/me/export'
const ERASURE_PATH = '/api/v1/me/erasure'

let pass = 0
let fail = 0
const ck = (label, ok, extra = '') => {
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? '✅' : '❌'} ${label}${extra ? `  ${extra}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const section = (t) => console.log(`\n${t}`)

// ── 子进程（与 AC-19 / AC-22 同一套：detached + 组杀）──
const children = []
function spawnBg(name, cmd, args, env, logName) {
  fs.mkdirSync(LOG_DIR, { recursive: true })
  const logPath = path.join(LOG_DIR, `${logName}.log`)
  const out = fs.openSync(logPath, 'a')
  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ['ignore', out, out],
  })
  child.on('error', (e) => console.log(`  ⚠️ ${name} 启动失败：${e.message}`))
  children.push({ name, child, logPath })
  return child
}
function killAll() {
  for (const { child } of children) {
    if (!child || child.exitCode !== null) continue
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      try {
        child.kill('SIGTERM')
      } catch {
        /* 已经没了 */
      }
    }
  }
}
function runToCompletion(cmd, args, env) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env } })
    let tail = ''
    const keep = (c) => {
      tail = `${tail}${c.toString()}`.slice(-2000)
    }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    child.on('error', () => resolve({ code: -1, tail }))
    child.on('exit', (code) => resolve({ code, tail }))
  })
}
/** 就绪判据必须精确：只要求"fetch 没抛"会把 404 当就绪（T11 踩过）。 */
async function waitForHttp(url, { timeoutMs, label, expectStatus }) {
  const t0 = Date.now()
  let last = ''
  let lastStatus = 0
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) })
      lastStatus = r.status
      if (expectStatus === undefined || r.status === expectStatus) return { ok: true, status: r.status }
      last = `status=${r.status}（期望 ${expectStatus}）`
    } catch (e) {
      last = e instanceof Error ? e.message : String(e)
    }
    await sleep(1000)
  }
  console.log(`  ⚠️ ${label} 未在 ${timeoutMs}ms 内就绪（最后：${last}）`)
  return { ok: false, status: lastStatus }
}

const DEV_ENV = () => ({
  DATABASE_URL: `file:${DB_FILE}`,
  AUTH_URL: BASE,
  NEXTAUTH_URL: BASE,
  NEXT_PUBLIC_APP_URL: BASE,
})

async function startDevServer() {
  for (let attempt = 1; attempt <= 2; attempt++) {
    spawnBg('next-dev', 'npx', ['next', 'dev', '--turbopack', '-p', String(PORT)], DEV_ENV(), 'next-dev')
    const ready = await waitForHttp(`${BASE}/api/health`, {
      timeoutMs: 240_000,
      label: `dev server（第 ${attempt} 次）`,
      expectStatus: 200,
    })
    if (ready.ok) {
      ck(`dev server 就绪（/api/health 200）${attempt > 1 ? `｜第 ${attempt} 次` : ''}`, true, `status=${ready.status}`)
      return true
    }
    console.log(`  ↻ 第 ${attempt} 次未就绪（status=${ready.status}），清理 .next 后重试`)
    killAll()
    children.length = 0
    await sleep(1500)
    try {
      fs.rmSync(path.join(ROOT, '.next'), { recursive: true, force: true })
      console.log('  🧹 已清理 .next（Turbopack 构建产物）')
    } catch (err) {
      console.log(`  ⚠️ 清理 .next 失败（继续重试）：${err?.message}`)
    }
  }
  ck('dev server 就绪（/api/health 200）', false, '两次尝试均失败 —— 请查服务日志')
  return false
}

// ── HTTP ──────────────────────────────────────────────────
async function login(email) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: BASE, Referer: `${BASE}/login` },
    body: JSON.stringify({ email, password: AC10_PASSWORD }),
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  })
  return { status: res.status, cookie: (res.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]), text: (await res.text()).slice(0, 200) }
}
async function parse(res) {
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* 非 JSON */
  }
  return { status: res.status, json, text }
}
/** 带会话请求。`Origin`/`Referer` 必须有（`proxy.ts` 的 CORS 判定）。 */
async function me(cookie, method, p) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: {
      ...(cookie ? { cookie: cookie.join('; ') } : {}),
      Origin: BASE,
      Referer: `${BASE}/workspace`,
    },
    redirect: 'manual',
    signal: AbortSignal.timeout(60_000),
  })
  return parse(res)
}

// ── 直连隔离库回读 ────────────────────────────────────────
const dbClient = createClient({ url: `file:${DB_FILE}` })
async function rows(sql, args = []) {
  return (await dbClient.execute({ sql, args })).rows
}
async function one(sql, args = []) {
  return (await rows(sql, args))[0] ?? null
}

async function main() {
  // ── 0. 夹具 ──
  section('── 0 · 夹具准备')
  const seeded = await runToCompletion('node', ['scripts/qa/seed-ac10-lifecycle.mjs', '--reset', '--regenerate'], {})
  ck('隔离库夹具播种成功', seeded.code === 0, seeded.code === 0 ? '' : seeded.tail.slice(-300))
  if (seeded.code !== 0) return

  if (!(await startDevServer())) return

  // ── 登录 ──
  const loginSubject = await login(AC10_PII.email)
  ck('待销号账号可真实登录（换到 cookie）', loginSubject.status === 200 && loginSubject.cookie.length > 0, `status=${loginSubject.status}`)
  if (loginSubject.status !== 200) return
  const cookie = loginSubject.cookie

  const loginOther = await login(AC10_OTHER.email)
  ck('对照账号可真实登录', loginOther.status === 200, `status=${loginOther.status}`)
  const cookieOther = loginOther.cookie

  // ═══════════════════════════════════════════════════════════
  section('── ① 未授权（负）：无会话三面全 401')
  const anonExport = await me(null, 'GET', EXPORT_PATH)
  ck('匿名 GET /me/export ⇒ 401', anonExport.status === 401, `status=${anonExport.status}`)
  const anonPlan = await me(null, 'GET', ERASURE_PATH)
  ck('匿名 GET /me/erasure ⇒ 401', anonPlan.status === 401, `status=${anonPlan.status}`)
  const anonApply = await me(null, 'POST', `${ERASURE_PATH}?apply=1`)
  ck('匿名 POST /me/erasure?apply=1 ⇒ 401', anonApply.status === 401, `status=${anonApply.status}`)

  // ═══════════════════════════════════════════════════════════
  section('── ② 导出（正）：真实数据在场 · 凭据与内部字段不在场')
  const exp = await me(cookie, 'GET', EXPORT_PATH)
  ck('GET /me/export ⇒ 200', exp.status === 200, `status=${exp.status}`)
  const meta = exp.json?.data?.meta
  const data = exp.json?.data?.data ?? {}
  ck('导出物带格式版本与生成时间', !!meta?.exportVersion && !!meta?.generatedAt, `exportVersion=${meta?.exportVersion}`)
  ck('导出物显式声明未覆盖面（不假装完整）', Array.isArray(meta?.uncovered) && meta.uncovered.length > 0, `uncovered=${meta?.uncovered?.length}`)

  // 🔴 前置非空：这些必须**在场**，否则后面的"不在场"断言等于没测
  const accountRow = data.account?.rows?.[0] ?? {}
  const profileRow = data.profile?.rows?.[0] ?? {}
  ck('【前置】账号行在场且含真实邮箱', accountRow.email === AC10_PII.email, `email=${accountRow.email}`)
  ck('【前置】档案行在场且含真实 displayName', profileRow.displayName === AC10_PII.displayName, `displayName=${profileRow.displayName}`)
  ck(
    '【前置】档案含真实粗粒度属性（age=30 / gender=MAN）—— 是后面"归零"断言的前置',
    Number(profileRow.age) === 30 && profileRow.gender === 'MAN',
    `age=${profileRow.age} gender=${profileRow.gender}`,
  )
  ck('【前置】意图正文在场', (data.socialIntents?.rows ?? []).some((r) => r.need === AC10_PII.intentNeed), `count=${data.socialIntents?.count}`)
  ck('【前置】跨群 opt-in 在场', (data.bridgeMemberOptIns?.count ?? 0) >= 1, `count=${data.bridgeMemberOptIns?.count}`)
  ck('【前置】AgentRun 在场', (data.agentRuns?.count ?? 0) >= 1, `count=${data.agentRuns?.count}`)
  ck('【前置】站内信在场', (data.notifications?.count ?? 0) >= 1, `count=${data.notifications?.count}`)
  ck('【前置】本人任务在场', (data.missions?.count ?? 0) >= 1, `count=${data.missions?.count}`)

  // 🔴 负向：凭据与内部运营字段**不得**随导出外流
  const rawExport = JSON.stringify(exp.json ?? {})
  ck('🔒 导出物不含 password 字段', !('password' in accountRow), `keys=${Object.keys(accountRow).slice(0, 6).join(',')}`)
  ck('🔒 导出物不含 tokenVersion 字段', !('tokenVersion' in accountRow))
  ck('🔒 导出物不含 botConfig 字段', !('botConfig' in accountRow))
  ck('🔒 档案内部备注（adminNotes）不进导出', !('adminNotes' in profileRow))
  ck('🔒 导出物全文中不含内部备注的**值**', !rawExport.includes(AC10_PII.adminNotes))

  // ═══════════════════════════════════════════════════════════
  section('── ③ 删除计划（只读）：影响面齐全 · 库零改动')
  const beforeUser = await one(`SELECT email, deletedAt, tokenVersion FROM "User" WHERE id=?`, [AC10_IDS.user])
  const plan = await me(cookie, 'GET', ERASURE_PATH)
  ck('GET /me/erasure ⇒ 200（计划）', plan.status === 200, `status=${plan.status}`)
  const planData = plan.json?.data ?? {}
  const impactOf = (t) => (planData.impact ?? []).find((i) => i.target === t)
  ck('计划含政策版本', !!planData.policyVersion, `policyVersion=${planData.policyVersion}`)
  ck('计划：User 待改 1 行', impactOf('User')?.rows === 1, `rows=${impactOf('User')?.rows}`)
  ck('计划：Profile 待改 1 行', impactOf('Profile')?.rows === 1, `rows=${impactOf('Profile')?.rows}`)
  ck('计划：站内信待删 1 行', impactOf('Notification')?.rows === 1, `rows=${impactOf('Notification')?.rows}`)
  ck('计划标出「保留」项（Membership）', impactOf('Membership')?.retained === true)
  ck('计划标出「保留」项（Outcome / ConnectionProposal 相关）', (planData.impact ?? []).some((i) => i.retained && i.target !== 'Membership'))
  ck('动作清单含 retain 与非 retain 两类', (planData.actions ?? []).some((a) => a.action === 'retain') && (planData.actions ?? []).some((a) => a.action !== 'retain'))

  const afterPlanUser = await one(`SELECT email, deletedAt, tokenVersion FROM "User" WHERE id=?`, [AC10_IDS.user])
  ck(
    '🔒 跑完计划后库**零改动**（email/deletedAt/tokenVersion 全等）',
    JSON.stringify(beforeUser) === JSON.stringify(afterPlanUser),
    `email=${afterPlanUser?.email}`,
  )
  const planNoApply = await me(cookie, 'POST', ERASURE_PATH)
  ck('POST 不带 apply ⇒ 仍只返回计划（不写库）', planNoApply.status === 200 && !!planNoApply.json?.data?.actions)
  const afterNoApply = await one(`SELECT email FROM "User" WHERE id=?`, [AC10_IDS.user])
  ck('🔒 POST 不带 apply 后 email 仍是原值', afterNoApply?.email === AC10_PII.email, `email=${afterNoApply?.email}`)

  // ═══════════════════════════════════════════════════════════
  section('── ④ 执行删除：逐表库状态 + 对照账号零波及')
  const apply = await me(cookie, 'POST', `${ERASURE_PATH}?apply=1`)
  ck('POST /me/erasure?apply=1 ⇒ 200', apply.status === 200, `status=${apply.status}`)
  ck('执行结果带 erasedAt', !!apply.json?.data?.erasedAt, `erasedAt=${apply.json?.data?.erasedAt}`)

  // 🔴 缓存：AC-10 原文点名「缓存」。回执必须**显式列出**已失效的键 ——
  //    否则"清了"与"忘了清"在响应里长得一模一样，无从取证。
  const cacheInfo = apply.json?.data?.cache ?? {}
  const cacheKeys = cacheInfo.keys ?? []
  ck(
    '🔴 回执列出已失效的本人缓存键（≥4 个，且全部指向本人）',
    cacheKeys.length >= 4 && cacheKeys.every((k) => k.endsWith(`:${AC10_IDS.user}`)),
    `keys=${cacheKeys.length}`,
  )
  ck(
    '🔴 回执覆盖 auth:user 与 discover:profile 两个命名空间（PII 最重的两处）',
    cacheKeys.some((k) => k.startsWith('auth:user:')) &&
      cacheKeys.some((k) => k.startsWith('discover:profile:')),
    cacheKeys.join(' '),
  )
  ck(
    '🔴 引用他人的缓存前缀一并**全局**失效（who-liked-me: —— 它的值里含本人快照）',
    (cacheInfo.prefixes ?? []).includes('who-liked-me:'),
    `prefixes=${(cacheInfo.prefixes ?? []).join(',')}`,
  )

  // ── 账号 ──
  const u = await one(`SELECT email, name, image, password, tokenVersion, deletedAt FROM "User" WHERE id=?`, [AC10_IDS.user])
  ck('账号邮箱已匿化（erased+<id>@erased.invalid）', u?.email === `erased+${AC10_IDS.user}@${AC10_EXPECT.emailDomain}`, `email=${u?.email}`)
  ck('账号密码已清空', u?.password === null)
  ck('账号昵称/头像已清空', u?.name === null && u?.image === null)
  ck('tokenVersion 已递增（现存会话失效）', Number(u?.tokenVersion) >= 1, `tokenVersion=${u?.tokenVersion}`)
  ck('deletedAt 已置位（留痕）', !!u?.deletedAt, `deletedAt=${u?.deletedAt}`)

  // ── 档案 ──
  const p = await one(
    `SELECT displayName, bio, city, occupation, company, adminNotes, profileStatus, isApproved,
            age, gender, sexuality, relationshipGoal, country, attachmentStyle, preferredAgeMin
     FROM "Profile" WHERE userId=?`,
    [AC10_IDS.user],
  )
  ck('🔴 档案 profileStatus=DEACTIVATED（各查询面的闸门）', p?.profileStatus === 'DEACTIVATED', `profileStatus=${p?.profileStatus}`)
  ck('档案 isApproved=0', Number(p?.isApproved) === 0)
  ck('档案 displayName 已替换为占位', p?.displayName === AC10_EXPECT.displayName, `displayName=${p?.displayName}`)
  ck('档案 PII 已清空（bio/city/occupation/company）', !p?.bio && !p?.city && !p?.occupation && !p?.company)
  ck('档案内部备注已清空', p?.adminNotes === null)
  ck(
    '🔴 档案非空列已用中性哨兵（age=0 / gender=PREFER_NOT_TO_SAY / sexuality="" / goal=NOT_SURE）',
    Number(p?.age) === 0 &&
      p?.gender === 'PREFER_NOT_TO_SAY' &&
      p?.sexuality === '' &&
      p?.relationshipGoal === 'NOT_SURE',
    `age=${p?.age} gender=${p?.gender} sexuality=${JSON.stringify(p?.sexuality)} goal=${p?.relationshipGoal}`,
  )
  ck(
    '档案风格与匹配偏好已清空（country / attachmentStyle / preferredAgeMin）',
    !p?.country && !p?.attachmentStyle && p?.preferredAgeMin === null,
    `country=${p?.country} attachment=${p?.attachmentStyle} ageMin=${p?.preferredAgeMin}`,
  )

  // ── 意图 / 参与 / 桥接 / Agent / 通知 ──
  const it = await one(`SELECT need, offer, disclosure, status FROM "SocialIntent" WHERE userId=?`, [AC10_IDS.user])
  ck('意图正文已清空（need/offer → 占位）', it?.need === AC10_EXPECT.textPlaceholder && it?.offer === AC10_EXPECT.textPlaceholder)
  ck('意图披露表已清空', it?.disclosure === null)
  ck('意图已收窄为 WITHDRAWN', it?.status === 'WITHDRAWN', `status=${it?.status}`)

  const mp = await one(`SELECT status FROM "MissionParticipation" WHERE userId=?`, [AC10_IDS.user])
  ck('参与关系已撤回（WITHDRAWN，保留行）', mp?.status === 'WITHDRAWN', `status=${mp?.status}`)

  const boi = await one(`SELECT status, disclosedFieldKeys FROM "BridgeMemberOptIn" WHERE userId=?`, [AC10_IDS.user])
  ck('跨群 opt-in 已撤回', boi?.status === 'WITHDRAWN', `status=${boi?.status}`)
  ck('跨群披露字段已清空（[]）', boi?.disclosedFieldKeys === '[]', `disclosed=${boi?.disclosedFieldKeys}`)

  const ar = await one(`SELECT goal, rawText, proposalJson FROM "AgentRun" WHERE requestedBy=?`, [AC10_IDS.user])
  ck('AgentRun 目标文本已清空', ar?.goal === AC10_EXPECT.textPlaceholder, `goal=${ar?.goal}`)
  ck('AgentRun 模型原始文本已清空', ar?.rawText === null)

  const ntf = await one(`SELECT COUNT(*) AS n FROM "Notification" WHERE userId=?`, [AC10_IDS.user])
  ck('站内信已删除（0 行）', Number(ntf?.n) === 0, `n=${ntf?.n}`)

  // ── 🔴 保留项：**必须**仍在 ──
  const ms = await one(`SELECT COUNT(*) AS n FROM "Membership" WHERE userId=?`, [AC10_IDS.user])
  ck('🔒 保留项：Membership 仍在（组织审计）', Number(ms?.n) === 1, `n=${ms?.n}`)
  const mission = await one(`SELECT COUNT(*) AS n FROM "Mission" WHERE ownerId=?`, [AC10_IDS.user])
  ck('🔒 保留项：本人 Mission 仍在（对方侧仍可读）', Number(mission?.n) === 1, `n=${mission?.n}`)

  // ── 🔴 对照账号：零波及 ──
  const other = await one(`SELECT email, name, deletedAt FROM "User" WHERE id=?`, [AC10_IDS.other])
  ck('🔴 对照账号邮箱**未**被改', other?.email === AC10_OTHER.email, `email=${other?.email}`)
  ck('🔴 对照账号昵称**未**被清', other?.name === AC10_OTHER.name)
  ck('🔴 对照账号 deletedAt 仍为 null', other?.deletedAt === null)
  const otherProfile = await one(`SELECT displayName, profileStatus FROM "Profile" WHERE userId=?`, [AC10_IDS.other])
  ck('🔴 对照账号档案未被 DEACTIVATED', otherProfile?.profileStatus === 'APPROVED' && otherProfile?.displayName === AC10_OTHER.displayName, `status=${otherProfile?.profileStatus}`)

  // ── 🔴 原邮箱再也登不进来 ──
  const relogin = await login(AC10_PII.email)
  ck('🔴 销号后**原邮箱无法再登录**', relogin.status !== 200, `status=${relogin.status}`)

  // ── 对照账号仍能正常访问自己的导出（证明系统没被"一刀切"）──
  const otherExport = await me(cookieOther, 'GET', EXPORT_PATH)
  ck('🔒 对照账号仍可正常导出（擦除不是全局破坏）', otherExport.status === 200 && otherExport.json?.data?.data?.account?.rows?.[0]?.email === AC10_OTHER.email, `status=${otherExport.status}`)

  section('════════════ AC-10 结果 ════════════')
  console.log(`判定：${fail === 0 ? '✅ PASS' : '❌ FAIL'}（${pass} 通过 / ${fail} 失败）`)
  console.log('覆盖：导出（凭据剔除 + 未覆盖声明）· 删除计划（只读零改动）· 执行删除（逐表库状态）')
  console.log('      保留项（Membership/Mission）· 对照账号零波及 · 原邮箱不可再登录')
  console.log(`（已停止本次启动的子进程；日志见 ${LOG_DIR}）`)
}

main()
  .catch((err) => {
    console.error('❌ AC-10 取证异常：', err?.message || err)
    fail += 1
  })
  .finally(() => {
    try {
      dbClient.close()
    } catch {
      /* ignore */
    }
    killAll()
    process.exit(fail === 0 ? 0 : 1)
  })
